"""Password hashing and JSON Web Tokens.

Only two ideas are needed here:

* bcrypt turns a password into a hash that cannot be reversed.
* PyJWT signs a small "token" that proves who the caller is.
"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings


def hash_password(password: str) -> str:
    """Return a bcrypt hash for the given plain password."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    """Check a plain password against a stored hash."""
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # The stored value is not a valid bcrypt hash.
        return False


def create_access_token(username: str) -> str:
    """Create a signed token that expires after `JWT_EXPIRE_MINUTES`."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def read_access_token(token: str) -> str | None:
    """Return the username inside a token, or None when it is invalid/expired."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    username = payload.get("sub")
    return username if isinstance(username, str) else None
