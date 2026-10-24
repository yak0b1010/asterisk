"""User administration endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from ..auth import (
    hash_password,
    has_permission,
    valid_role,
)
from ..database import is_unique_violation
from ..deps import get_current_user, get_db, require_permission
from ..models import Extension, RefreshToken, User, utcnow
from ..responses import (
    APIError,
    bad_request,
    clean,
    conflict,
    extension_response,
    not_found,
    pagination,
    parse_uuid,
    query_bool,
    read_json,
    reject_unknown,
    respond,
    respond_list,
    to_bool,
    to_optional_bool,
    to_optional_str,
    to_str,
    user_response,
    valid_email,
    valid_username,
)

router = APIRouter(
    prefix="/api/v1/users",
    tags=["users"],
    dependencies=[Depends(get_current_user)],
)

_CREATE_FIELDS = {"username", "email", "full_name", "password", "role", "active"}
_UPDATE_FIELDS = {"email", "full_name", "role", "active"}
_PASSWORD_FIELDS = {"password", "new_password"}


def _find_user(session: Session, user_id: str) -> User:
    if not parse_uuid(user_id):
        raise bad_request("id must be a valid UUID")
    user = session.get(User, user_id)
    if user is None:
        raise not_found("user")
    return user


def _last_active_admin(session: Session, exclude_id: str) -> bool:
    count = session.scalar(
        select(func.count())
        .select_from(User)
        .where(User.role == "admin", User.active.is_(True), User.id != exclude_id)
    )
    return (count or 0) == 0


@router.get("")
@router.get("/")
def list_users(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("users.read")),
):
    page, limit, offset = pagination(request)
    conditions = []
    search = (request.query_params.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                User.username.ilike(like),
                User.full_name.ilike(like),
                User.email.ilike(like),
            )
        )
    role = (request.query_params.get("role") or "").strip()
    if role:
        if not valid_role(role):
            raise bad_request("invalid role filter")
        conditions.append(User.role == role)
    active, present = query_bool(request, "active")
    if present:
        conditions.append(User.active.is_(active))

    total = session.scalar(
        select(func.count()).select_from(User).where(*conditions)
    ) or 0
    users = session.scalars(
        select(User)
        .where(*conditions)
        .order_by(User.username.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    return respond_list([user_response(user) for user in users], page, limit, total)


@router.post("", status_code=201)
@router.post("/", status_code=201)
async def create_user(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("users.write")),
):
    body = await read_json(request)
    reject_unknown(body, _CREATE_FIELDS)
    username = to_str(body, "username").strip()
    email = to_str(body, "email").strip()
    full_name = clean(to_str(body, "full_name"), 120)
    password = to_str(body, "password")
    role = to_str(body, "role").strip() or "agent"
    if not valid_username(username):
        raise bad_request(
            "username must be 3-40 characters and contain only letters, digits, "
            "dot, underscore or hyphen"
        )
    if not valid_email(email):
        raise bad_request("email is invalid")
    if len(password) < 8 or len(password) > 128:
        raise bad_request("password must be between 8 and 128 characters")
    if not valid_role(role):
        raise bad_request("role must be one of admin, supervisor, agent, viewer")
    active = to_optional_bool(body, "active")
    user = User(
        username=username,
        email=email,
        full_name=full_name,
        password_hash=hash_password(password),
        role=role,
        active=True if active is None else active,
        last_login_ip="",
    )
    session.add(user)
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        if is_unique_violation(exc):
            return conflict("username already exists")
        raise
    return respond(user_response(user), status=201)


@router.get("/{user_id}")
def get_user(
    user_id: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("users.read")),
):
    return respond(user_response(_find_user(session, user_id)))


@router.put("/{user_id}")
@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("users.write")),
):
    target = _find_user(session, user_id)
    body = await read_json(request)
    reject_unknown(body, _UPDATE_FIELDS)

    changed = False
    email = to_optional_str(body, "email")
    if email is not None:
        email = email.strip()
        if not valid_email(email):
            raise bad_request("email is invalid")
        target.email = clean(email, 255)
        changed = True
    full_name = to_optional_str(body, "full_name")
    if full_name is not None:
        target.full_name = clean(full_name, 120)
        changed = True
    role = to_optional_str(body, "role")
    if role is not None:
        role = role.strip()
        if not valid_role(role):
            raise bad_request("role must be one of admin, supervisor, agent, viewer")
        if actor.id == target.id and role != target.role:
            raise bad_request("you cannot change your own role")
        if target.role == "admin" and role != "admin":
            if _last_active_admin(session, target.id):
                return conflict("cannot demote the last active administrator")
        target.role = role
        changed = True
    active = to_optional_bool(body, "active")
    if active is not None:
        if actor.id == target.id and not active:
            raise bad_request("you cannot deactivate your own account")
        if not active and target.role == "admin":
            if _last_active_admin(session, target.id):
                return conflict("cannot deactivate the last active administrator")
        target.active = active
        changed = True
    if not changed:
        raise bad_request("no supported fields supplied")

    target.updated_at = utcnow()
    if active is False:
        session.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_id == target.id,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=utcnow())
        )
    session.commit()
    return respond(user_response(target))


@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("users.write")),
):
    target = _find_user(session, user_id)
    if actor.id == target.id:
        raise bad_request("you cannot delete your own account")
    if target.role == "admin" and _last_active_admin(session, target.id):
        return conflict("cannot delete the last active administrator")
    session.execute(
        update(Extension)
        .where(Extension.user_id == target.id)
        .values(user_id=None)
    )
    session.execute(delete(RefreshToken).where(RefreshToken.user_id == target.id))
    session.delete(target)
    session.commit()
    from ..responses import no_content

    return no_content()


@router.post("/{user_id}/password")
async def reset_password(
    user_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("users.write")),
):
    target = _find_user(session, user_id)
    body = await read_json(request)
    reject_unknown(body, _PASSWORD_FIELDS)
    password = to_str(body, "new_password") or to_str(body, "password")
    if len(password) < 8 or len(password) > 128:
        raise bad_request("password must be between 8 and 128 characters")
    target.password_hash = hash_password(password)
    target.updated_at = utcnow()
    session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.user_id == target.id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=utcnow())
    )
    session.commit()
    return respond({"message": "password reset; existing sessions revoked"})


@router.get("/{user_id}/extensions")
def user_extensions(
    user_id: str,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("users.read")),
):
    target = _find_user(session, user_id)
    extensions = session.scalars(
        select(Extension)
        .where(Extension.user_id == target.id)
        .order_by(Extension.number.asc())
    ).all()
    return respond(
        [extension_response(ext, actor if has_permission(actor.role, "extensions.credentials") else None) for ext in extensions]
    )
