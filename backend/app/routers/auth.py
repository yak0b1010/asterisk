"""Sign-in, current user and sign-out."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..audit import add_audit
from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import AuthUser, LoginRequest, LoginResponse, MessageResponse
from ..security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _as_auth_user(user: User) -> AuthUser:
    return AuthUser(username=user.username or "", full_name=user.full_name, role=user.role)


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    username = payload.username.strip().lower()
    user = db.query(User).filter(func.lower(User.username) == username).first()

    if user is None or not user.is_active or not verify_password(
        payload.password, user.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    add_audit(db, user, "login", "session")
    db.commit()

    return LoginResponse(
        token=create_access_token(user.username or username),
        user=_as_auth_user(user),
    )


@router.get("/me", response_model=AuthUser)
def me(user: User = Depends(get_current_user)) -> AuthUser:
    return _as_auth_user(user)


@router.post("/logout", response_model=MessageResponse)
def logout(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> MessageResponse:
    # Tokens are stateless: the browser deletes its copy.  We only record the
    # action in the audit log.
    add_audit(db, user, "logout", "session")
    db.commit()
    return MessageResponse(message="Signed out")
