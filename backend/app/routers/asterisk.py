"""Asterisk-specific endpoints: status and manual configuration reload."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import asterisk, pbx
from ..database import get_db
from ..deps import get_current_user, require_roles
from ..models import Extension, User
from ..schemas import AsteriskStatusOut, MessageResponse

router = APIRouter(prefix="/asterisk", tags=["asterisk"])


@router.get("/status", response_model=AsteriskStatusOut)
def status(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> AsteriskStatusOut:
    snapshot = asterisk.snapshot()
    enabled_numbers = {
        number
        for (number,) in db.query(Extension.number)
        .filter(Extension.enabled.is_(True))
        .all()
    }
    return AsteriskStatusOut(
        status="running" if snapshot["reachable"] else "stopped",
        version=snapshot["version"],
        uptime_sec=snapshot["uptime_sec"],
        active_calls=snapshot["active_calls"],
        registered_extensions=len(set(snapshot["registrations"]) & enabled_numbers),
    )


@router.post("/reload", response_model=MessageResponse)
def reload(
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("admin")),
) -> MessageResponse:
    db.flush()
    pbx.write_configs(db)
    db.commit()

    if pbx.reload_asterisk():
        return MessageResponse(message="Configuration reloaded")
    return MessageResponse(
        message="Configuration written, but Asterisk is offline; reload skipped"
    )
