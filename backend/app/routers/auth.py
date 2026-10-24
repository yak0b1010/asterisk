"""Authentication, session and account endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..auth import (
    TokenService,
    check_password,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    permissions_for_role,
)
from ..deps import get_current_user, get_db
from ..middleware import LoginLimiter, client_ip
from ..models import AuditLog, RefreshToken, User, utcnow
from ..responses import (
    APIError,
    bad_request,
    go_time,
    no_content,
    parse_uuid,
    read_json,
    reject_unknown,
    respond,
    respond_error,
    session_response,
    to_optional_str,
    to_str,
    user_response,
    valid_email,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

_LOGIN_FIELDS = {"username", "password"}
_REFRESH_FIELDS = {"refresh_token"}
_ME_FIELDS = {"full_name", "email"}
_PASSWORD_FIELDS = {"current_password", "new_password"}


def _issue_tokens(
    request: Request, session: Session, user: User
) -> tuple[str, datetime, str]:
    tokens: TokenService = request.app.state.tokens
    access, expires = tokens.issue_access_token(user)
    refresh, refresh_hash = new_refresh_token()
    record = RefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        expires_at=utcnow() + tokens.refresh_ttl,
        user_agent=request.headers.get("user-agent", ""),
        ip=getattr(request.state, "client_ip", client_ip(request)),
    )
    session.add(record)
    session.commit()
    return access, expires, refresh


def _token_payload(
    access: str, expires: datetime, refresh: str, user: User
) -> dict:
    remaining = int((expires - datetime.now(timezone.utc)).total_seconds())
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": max(remaining, 0),
        "user": user_response(user),
        "permissions": permissions_for_role(user.role),
    }


def _login_audit(
    request: Request,
    session: Session,
    user: User | None,
    username: str,
    action: str,
    status: int,
) -> None:
    entry = AuditLog(
        user_id=user.id if user is not None else None,
        username=username,
        action=action,
        entity_type="auth",
        entity_id="",
        method=request.method,
        path=request.url.path,
        status_code=status,
        ip=getattr(request.state, "client_ip", client_ip(request)),
        user_agent=request.headers.get("user-agent", ""),
        details="",
    )
    try:
        session.add(entry)
        session.commit()
    except Exception:
        session.rollback()


@router.post("/login")
async def login(request: Request, session: Session = Depends(get_db)):
    ip = getattr(request.state, "client_ip", client_ip(request))
    limiter: LoginLimiter = request.app.state.limiter
    allowed, retry = limiter.allow(ip)
    if not allowed:
        return respond_error(
            429,
            "rate_limited",
            "too many login attempts, try again later",
            headers={"Retry-After": str(int(retry) + 1)},
        )

    body = await read_json(request)
    reject_unknown(body, _LOGIN_FIELDS)
    username = to_str(body, "username").strip()
    password = to_str(body, "password")
    if not username or not password:
        raise bad_request("username and password are required")

    user = session.scalars(
        select(User).where(func.lower(User.username) == username.lower())
    ).first()
    if user is None or not check_password(user.password_hash, password):
        _login_audit(request, session, None, username, "login_failed", 401)
        return respond_error(
            401, "invalid_credentials", "invalid username or password"
        )
    if not user.active:
        _login_audit(request, session, user, username, "login_blocked", 403)
        return respond_error(403, "account_disabled", "account is disabled")

    now = utcnow()
    user.last_login_at = now
    user.last_login_ip = ip
    session.commit()

    access, expires, refresh = _issue_tokens(request, session, user)
    limiter.reset(ip)
    _login_audit(request, session, user, user.username, "login", 200)
    return respond(_token_payload(access, expires, refresh, user))


@router.post("/refresh")
async def refresh(request: Request, session: Session = Depends(get_db)):
    body = await read_json(request)
    reject_unknown(body, _REFRESH_FIELDS)
    raw = to_str(body, "refresh_token").strip()
    if not raw:
        raise bad_request("refresh_token is required")

    token = session.scalars(
        select(RefreshToken).where(
            RefreshToken.token_hash == hash_refresh_token(raw)
        )
    ).first()
    if token is None:
        return respond_error(
            401, "invalid_token", "refresh token is invalid or expired"
        )
    if token.revoked_at is not None or utcnow() > token.expires_at:
        return respond_error(
            401, "invalid_token", "refresh token is invalid or expired"
        )

    user = session.get(User, token.user_id)
    if user is None:
        return respond_error(401, "invalid_token", "user no longer exists")
    if not user.active:
        return respond_error(403, "account_disabled", "account is disabled")

    access, expires, new_raw = _issue_tokens(request, session, user)
    token.revoked_at = utcnow()
    token.replaced_by = hash_refresh_token(new_raw)
    session.commit()
    return respond(_token_payload(access, expires, new_raw, user))


@router.post("/logout")
async def logout(
    request: Request,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    body = await read_json(request, allow_empty=True)
    reject_unknown(body, _REFRESH_FIELDS)
    raw = to_str(body, "refresh_token").strip()
    stmt = (
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    if raw:
        stmt = stmt.where(RefreshToken.token_hash == hash_refresh_token(raw))
    session.execute(stmt)
    session.commit()
    return no_content()


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return respond(
        {
            "user": user_response(user),
            "permissions": permissions_for_role(user.role),
        }
    )


@router.patch("/me")
async def update_me(
    request: Request,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    body = await read_json(request)
    reject_unknown(body, _ME_FIELDS)
    email = to_str(body, "email").strip()
    if not valid_email(email):
        raise bad_request("email is invalid")
    user.full_name = to_str(body, "full_name").strip()[:120]
    user.email = email[:255]
    user.updated_at = utcnow()
    session.commit()
    return respond(user_response(user))


@router.put("/me/password")
async def change_password(
    request: Request,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    body = await read_json(request)
    reject_unknown(body, _PASSWORD_FIELDS)
    current = to_str(body, "current_password")
    new = to_str(body, "new_password")
    if len(new) < 8 or len(new) > 128:
        raise bad_request("new_password must be between 8 and 128 characters")
    if not check_password(user.password_hash, current):
        return respond_error(
            401, "invalid_credentials", "current password is incorrect"
        )
    user.password_hash = hash_password(new)
    user.updated_at = utcnow()
    session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    session.commit()
    return respond({"message": "password changed; sign in again"})


@router.get("/permissions")
def permissions(user: User = Depends(get_current_user)):
    return respond(
        {
            "role": user.role,
            "permissions": permissions_for_role(user.role),
        }
    )


@router.get("/sessions")
def list_sessions(
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    now = utcnow()
    tokens = session.scalars(
        select(RefreshToken)
        .where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > now,
        )
        .order_by(RefreshToken.created_at.desc())
    ).all()
    return respond([session_response(token) for token in tokens])


@router.delete("/sessions/{session_id}")
def revoke_session(
    session_id: str,
    session: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not parse_uuid(session_id):
        raise bad_request("id must be a valid UUID")
    result = session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.id == session_id,
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=utcnow())
    )
    if result.rowcount == 0:
        raise APIError(404, "not_found", "session not found")
    session.commit()
    return no_content()
