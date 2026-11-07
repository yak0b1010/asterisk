"""Directory users (people who own extensions).

Login accounts live in the same table, but a directory person has no username
and therefore cannot sign in.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import pbx
from ..audit import add_audit
from ..database import get_db
from ..deps import get_current_user, require_roles
from ..models import User
from ..schemas import UserIn, UserOut

router = APIRouter(prefix="/users", tags=["users"])


def _as_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        department=user.department,
        created_at=user.created_at,
    )


def _email_in_use(db: Session, email: str, excluding_id: str | None = None) -> bool:
    query = db.query(User).filter(func.lower(User.email) == email)
    if excluding_id is not None:
        query = query.filter(User.id != excluding_id)
    return query.first() is not None


@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[UserOut]:
    users = db.query(User).order_by(User.full_name).all()
    return [_as_out(user) for user in users]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserIn,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles("admin", "operator")),
) -> UserOut:
    email = str(payload.email).lower()
    if _email_in_use(db, email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    user = User(
        full_name=payload.full_name.strip(),
        email=email,
        department=payload.department,
        role="viewer",
        is_active=True,
    )
    db.add(user)
    db.flush()

    # A new person changes caller-id / voicemail names in the PBX files.
    pbx.write_configs(db)
    add_audit(db, current, "create", "user", f"{user.full_name} <{user.email}>")
    db.commit()
    pbx.reload_asterisk()

    return _as_out(user)


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: str,
    payload: UserIn,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles("admin", "operator")),
) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    email = str(payload.email).lower()
    if _email_in_use(db, email, excluding_id=user.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    user.full_name = payload.full_name.strip()
    user.email = email
    user.department = payload.department

    db.flush()
    pbx.write_configs(db)
    add_audit(db, current, "update", "user", f"{user.full_name} <{user.email}>")
    db.commit()
    pbx.reload_asterisk()

    return _as_out(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles("admin")),
) -> Response:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )

    # Unassign this person's extensions; the extensions themselves remain.
    for extension in list(user.extensions):
        extension.user = None

    db.delete(user)
    db.flush()
    pbx.write_configs(db)
    add_audit(db, current, "delete", "user", f"{user.full_name} <{user.email}>")
    db.commit()
    pbx.reload_asterisk()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
