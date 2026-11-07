"""Extension CRUD, bulk creation, and live registration information."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from .. import asterisk, pbx
from ..audit import add_audit
from ..database import get_db
from ..deps import get_current_user, require_roles
from ..models import Extension, User
from ..schemas import (
    BulkExtensionsIn,
    BulkExtensionsResult,
    ExtensionIn,
    ExtensionOut,
    ExtensionUpdate,
    validate_number,
)

router = APIRouter(prefix="/extensions", tags=["extensions"])


def _check_number(number: str) -> None:
    try:
        validate_number(number)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def _check_user(db: Session, user_id: str | None) -> None:
    if user_id is not None and db.get(User, user_id) is None:
        raise HTTPException(status_code=422, detail="Selected user does not exist")


def _as_out(extension: Extension, contact_ip: str | None = None) -> ExtensionOut:
    return ExtensionOut(
        number=extension.number,
        user_id=extension.user_id,
        enabled=extension.enabled,
        registered=contact_ip is not None,
        contact_ip=contact_ip,
    )


def _save(db: Session, current: User, action: str, detail: str) -> None:
    """Write configs, record the action, commit, then reload Asterisk."""
    db.flush()
    pbx.write_configs(db)
    add_audit(db, current, action, "extension", detail)
    db.commit()
    pbx.reload_asterisk()


@router.get("", response_model=list[ExtensionOut])
def list_extensions(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[ExtensionOut]:
    contacts = asterisk.snapshot()["registrations"]
    extensions = db.query(Extension).order_by(Extension.number).all()
    return [
        _as_out(extension, contacts.get(extension.number) if extension.enabled else None)
        for extension in extensions
    ]


@router.post("", response_model=ExtensionOut, status_code=status.HTTP_201_CREATED)
def create_extension(
    payload: ExtensionIn,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles("admin", "operator")),
) -> ExtensionOut:
    _check_number(payload.number)
    if db.get(Extension, payload.number) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Extension {payload.number} already exists",
        )
    _check_user(db, payload.user_id)

    extension = Extension(
        number=payload.number,
        user_id=payload.user_id,
        secret=payload.secret,
        enabled=payload.enabled,
    )
    db.add(extension)
    _save(db, current, "create", f"extension {extension.number}")
    return _as_out(extension)


@router.post("/bulk", response_model=BulkExtensionsResult)
def bulk_create_extensions(
    payload: BulkExtensionsIn,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles("admin", "operator")),
) -> BulkExtensionsResult:
    existing = {number for (number,) in db.query(Extension.number).all()}
    seen: set[str] = set()
    created: list[str] = []
    skipped: list[str] = []

    for item in payload.extensions:
        if item.number in existing or item.number in seen:
            skipped.append(item.number)
            continue
        seen.add(item.number)
        created.append(item.number)
        db.add(
            Extension(
                number=item.number,
                user_id=None,
                secret=item.secret,
                enabled=payload.enabled,
            )
        )

    if created:
        _save(
            db,
            current,
            "bulk_create",
            f"created {len(created)}, skipped {len(skipped)}",
        )

    return BulkExtensionsResult(created=created, skipped=skipped)


@router.put("/{number}", response_model=ExtensionOut)
@router.patch("/{number}", response_model=ExtensionOut)
def update_extension(
    number: str,
    payload: ExtensionUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles("admin", "operator")),
) -> ExtensionOut:
    _check_number(number)
    extension = db.get(Extension, number)
    if extension is None:
        raise HTTPException(status_code=404, detail="Extension not found")

    changes = payload.model_dump(exclude_unset=True)
    if "user_id" in changes:
        _check_user(db, changes["user_id"])
    if "secret" in changes and not changes["secret"]:
        # Empty secret means "keep the current password".
        changes.pop("secret")

    for field, value in changes.items():
        setattr(extension, field, value)

    _save(db, current, "update", f"extension {number}: {', '.join(sorted(changes))}")
    return _as_out(extension)


@router.delete("/{number}", status_code=status.HTTP_204_NO_CONTENT)
def delete_extension(
    number: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles("admin")),
) -> Response:
    _check_number(number)
    extension = db.get(Extension, number)
    if extension is None:
        raise HTTPException(status_code=404, detail="Extension not found")

    db.delete(extension)
    _save(db, current, "delete", f"extension {number}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
