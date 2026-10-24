"""FastAPI dependencies shared by the routers."""

from __future__ import annotations

from typing import Generator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from .auth import (
    InvalidToken,
    TokenService,
    has_permission,
)
from .config import Config
from .models import User
from .responses import APIError


def get_config(request: Request) -> Config:
    return request.app.state.config


def get_tokens(request: Request) -> TokenService:
    return request.app.state.tokens


def get_db(request: Request) -> Generator[Session, None, None]:
    session: Session = request.app.state.session_factory()
    try:
        yield session
    finally:
        session.close()


def _bearer(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    prefix = "Bearer "
    if not header.startswith(prefix):
        raise APIError(401, "unauthorized", "missing bearer token")
    raw = header[len(prefix) :].strip()
    if not raw:
        raise APIError(401, "unauthorized", "missing bearer token")
    return raw


def get_current_user(
    request: Request,
    session: Session = Depends(get_db),
) -> User:
    if getattr(request.state, "user", None) is not None:
        return request.state.user

    raw = _bearer(request)
    tokens: TokenService = request.app.state.tokens
    try:
        claims = tokens.parse_access_token(raw)
    except InvalidToken as exc:
        raise APIError(401, "invalid_token", "token is invalid or expired") from exc

    user = session.get(User, claims.get("uid"))
    if user is None:
        raise APIError(401, "invalid_token", "user no longer exists")
    if not user.active:
        raise APIError(403, "account_disabled", "account is disabled")

    request.state.user = user
    request.state.claims = claims
    return user


def require_permission(permission: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if not has_permission(user.role, permission):
            raise APIError(
                403,
                "forbidden",
                "permission denied",
                {"required": permission},
            )
        return user

    return dependency


def current_user(request: Request) -> User | None:
    return getattr(request.state, "user", None)
