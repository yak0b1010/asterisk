"""Authentication, permissions and token helpers."""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
import jwt

from .models import User

ACCESS = "access"
REFRESH = "refresh"

PERM_DASHBOARD_READ = "dashboard.read"
PERM_USERS_READ = "users.read"
PERM_USERS_WRITE = "users.write"
PERM_EXTENSIONS_READ = "extensions.read"
PERM_EXTENSIONS_WRITE = "extensions.write"
PERM_EXTENSIONS_CREDS = "extensions.credentials"
PERM_DIALPLAN_READ = "dialplan.read"
PERM_DIALPLAN_WRITE = "dialplan.write"
PERM_VOICEMAIL_READ = "voicemail.read"
PERM_VOICEMAIL_WRITE = "voicemail.write"
PERM_QUEUES_READ = "queues.read"
PERM_QUEUES_WRITE = "queues.write"
PERM_IVR_READ = "ivr.read"
PERM_IVR_WRITE = "ivr.write"
PERM_CONFERENCES_READ = "conferences.read"
PERM_CONFERENCES_WRITE = "conferences.write"
PERM_CDR_READ = "cdr.read"
PERM_CDR_EXPORT = "cdr.export"
PERM_CDR_DELETE = "cdr.delete"
PERM_MONITORING_READ = "monitoring.read"
PERM_AUDIT_READ = "audit.read"
PERM_SETTINGS_READ = "settings.read"
PERM_SETTINGS_WRITE = "settings.write"
PERM_BACKUPS_READ = "backups.read"
PERM_BACKUPS_WRITE = "backups.write"

ALL_PERMISSIONS = [
    PERM_DASHBOARD_READ,
    PERM_USERS_READ,
    PERM_USERS_WRITE,
    PERM_EXTENSIONS_READ,
    PERM_EXTENSIONS_WRITE,
    PERM_EXTENSIONS_CREDS,
    PERM_DIALPLAN_READ,
    PERM_DIALPLAN_WRITE,
    PERM_VOICEMAIL_READ,
    PERM_VOICEMAIL_WRITE,
    PERM_QUEUES_READ,
    PERM_QUEUES_WRITE,
    PERM_IVR_READ,
    PERM_IVR_WRITE,
    PERM_CONFERENCES_READ,
    PERM_CONFERENCES_WRITE,
    PERM_CDR_READ,
    PERM_CDR_EXPORT,
    PERM_CDR_DELETE,
    PERM_MONITORING_READ,
    PERM_AUDIT_READ,
    PERM_SETTINGS_READ,
    PERM_SETTINGS_WRITE,
    PERM_BACKUPS_READ,
    PERM_BACKUPS_WRITE,
]

_SUPERVISOR = {
    PERM_DASHBOARD_READ,
    PERM_MONITORING_READ,
    PERM_USERS_READ,
    PERM_EXTENSIONS_READ,
    PERM_EXTENSIONS_WRITE,
    PERM_DIALPLAN_READ,
    PERM_DIALPLAN_WRITE,
    PERM_VOICEMAIL_READ,
    PERM_VOICEMAIL_WRITE,
    PERM_QUEUES_READ,
    PERM_QUEUES_WRITE,
    PERM_IVR_READ,
    PERM_IVR_WRITE,
    PERM_CONFERENCES_READ,
    PERM_CONFERENCES_WRITE,
    PERM_CDR_READ,
    PERM_CDR_EXPORT,
    PERM_AUDIT_READ,
    PERM_SETTINGS_READ,
    PERM_BACKUPS_READ,
    PERM_BACKUPS_WRITE,
}

_AGENT = {
    PERM_DASHBOARD_READ,
    PERM_MONITORING_READ,
    PERM_EXTENSIONS_READ,
    PERM_DIALPLAN_READ,
    PERM_VOICEMAIL_READ,
    PERM_VOICEMAIL_WRITE,
    PERM_QUEUES_READ,
    PERM_IVR_READ,
    PERM_CONFERENCES_READ,
    PERM_CDR_READ,
}

_VIEWER = {
    PERM_DASHBOARD_READ,
    PERM_MONITORING_READ,
    PERM_USERS_READ,
    PERM_EXTENSIONS_READ,
    PERM_DIALPLAN_READ,
    PERM_VOICEMAIL_READ,
    PERM_QUEUES_READ,
    PERM_IVR_READ,
    PERM_CONFERENCES_READ,
    PERM_CDR_READ,
    PERM_AUDIT_READ,
    PERM_SETTINGS_READ,
    PERM_BACKUPS_READ,
}

ROLE_PERMISSIONS = {
    "supervisor": _SUPERVISOR,
    "agent": _AGENT,
    "viewer": _VIEWER,
}

VALID_ROLES = ("admin", "supervisor", "agent", "viewer")


def valid_role(role: str) -> bool:
    return role in VALID_ROLES


def has_permission(role: str, permission: str) -> bool:
    if role == "admin":
        return True
    return permission in ROLE_PERMISSIONS.get(role, set())


def permissions_for_role(role: str) -> list[str]:
    if role == "admin":
        return list(ALL_PERMISSIONS)
    granted = ROLE_PERMISSIONS.get(role, set())
    return [permission for permission in ALL_PERMISSIONS if permission in granted]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def check_password(password_hash: str, plain: str) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def new_refresh_token() -> tuple[str, str]:
    raw = secrets.token_bytes(48)
    token = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    return token, hash_refresh_token(token)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class InvalidToken(Exception):
    pass


class ExpiredToken(InvalidToken):
    pass


class TokenService:
    def __init__(
        self,
        secret: str,
        issuer: str,
        audience: str,
        access_ttl: float,
        refresh_ttl: float,
    ) -> None:
        self.secret = secret
        self.issuer = issuer
        self.audience = audience
        self.access_ttl = timedelta(seconds=access_ttl)
        self.refresh_ttl = timedelta(seconds=refresh_ttl)

    def issue_access_token(self, user: User) -> tuple[str, datetime]:
        now = datetime.now(timezone.utc)
        expires = now + self.access_ttl
        payload: dict[str, Any] = {
            "uid": user.id,
            "username": user.username,
            "role": user.role,
            "typ": ACCESS,
            "iss": self.issuer,
            "sub": user.id,
            "aud": self.audience,
            "exp": expires,
            "iat": now,
            "nbf": now - timedelta(seconds=5),
            "jti": str(uuid.uuid4()),
        }
        token = jwt.encode(payload, self.secret, algorithm="HS256")
        return token, expires

    def parse_access_token(self, raw: str) -> dict[str, Any]:
        try:
            claims = jwt.decode(
                raw,
                self.secret,
                algorithms=["HS256"],
                audience=self.audience,
                issuer=self.issuer,
                options={"require": ["exp", "iat", "nbf"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise ExpiredToken("expired token") from exc
        except jwt.PyJWTError as exc:
            raise InvalidToken("invalid token") from exc
        if claims.get("typ") != ACCESS or not claims.get("uid"):
            raise InvalidToken("invalid token")
        return claims


def access_token_ttl_seconds(service: TokenService) -> int:
    return int(service.access_ttl.total_seconds())


def as_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None
