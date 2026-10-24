"""Conference room endpoints and live conference monitoring."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import is_unique_violation
from ..deps import get_current_user, get_db, require_permission
from ..models import ConferenceRoom, User, utcnow
from ..responses import (
    bad_request,
    clean,
    conference_response,
    conflict,
    not_found,
    pagination,
    parse_uuid,
    query_bool,
    read_json,
    reject_unknown,
    respond,
    respond_error,
    respond_list,
    to_optional_bool,
    to_optional_int,
    to_optional_str,
    to_str,
    valid_number,
)
from ..telephony import NotConfigured

log = logging.getLogger("asterisk.conferences")

router = APIRouter(
    prefix="/api/v1/conferences",
    tags=["conferences"],
    dependencies=[Depends(get_current_user)],
)

_CREATE_FIELDS = {
    "number",
    "name",
    "pin",
    "max_members",
    "muted",
    "record",
    "active",
    "description",
}
_UPDATE_FIELDS = _CREATE_FIELDS - {"number"}


def _find(session: Session, key: str) -> ConferenceRoom:
    key = (key or "").strip()
    if not key:
        raise bad_request("conference id or number is required")
    if parse_uuid(key):
        room = session.get(ConferenceRoom, key)
    else:
        room = session.scalars(
            select(ConferenceRoom).where(ConferenceRoom.number == key)
        ).first()
    if room is None:
        raise not_found("conference room")
    return room


@router.get("")
@router.get("/")
def list_conferences(
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("conferences.read")),
):
    page, limit, offset = pagination(request)
    conditions = []
    search = (request.query_params.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                ConferenceRoom.number.ilike(like),
                ConferenceRoom.name.ilike(like),
            )
        )
    active, present = query_bool(request, "active")
    if present:
        conditions.append(ConferenceRoom.active.is_(active))
    total = session.scalar(
        select(func.count()).select_from(ConferenceRoom).where(*conditions)
    ) or 0
    rooms = session.scalars(
        select(ConferenceRoom)
        .where(*conditions)
        .order_by(ConferenceRoom.number.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    return respond_list(
        [conference_response(room, actor) for room in rooms], page, limit, total
    )


@router.get("/live")
def live_conferences(
    request: Request,
    _: User = Depends(require_permission("conferences.read")),
):
    try:
        rooms = request.app.state.telephony.conferences()
    except NotConfigured:
        return respond({"configured": False, "conferences": []})
    except Exception as exc:
        return respond_error(502, "asterisk_unavailable", str(exc))
    return respond({"configured": True, "conferences": rooms})


@router.post("", status_code=201)
@router.post("/", status_code=201)
async def create_conference(
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("conferences.write")),
):
    body = await read_json(request)
    reject_unknown(body, _CREATE_FIELDS)
    number = to_str(body, "number").strip()
    pin = to_str(body, "pin").strip()
    if not valid_number(number, 2, 10):
        raise bad_request("number must contain 2-10 digits")
    if pin != "" and not valid_number(pin, 4, 8):
        raise bad_request("pin must be empty or contain 4-8 digits")
    max_members = to_optional_int(body, "max_members") or 10
    if max_members < 1 or max_members > 100:
        raise bad_request("max_members must be between 1 and 100")
    active = to_optional_bool(body, "active")
    room = ConferenceRoom(
        number=number,
        name=clean(to_str(body, "name"), 120),
        pin=pin,
        max_members=max_members,
        muted=bool(to_optional_bool(body, "muted")),
        record=bool(to_optional_bool(body, "record")),
        active=True if active is None else active,
        description=clean(to_str(body, "description"), 255),
    )
    session.add(room)
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        if is_unique_violation(exc):
            return conflict("conference number already exists")
        raise
    try:
        request.app.state.realtime.sync_conference(session, room)
    except Exception as exc:
        log.error("failed to sync conference to realtime: %s", exc)
        session.delete(room)
        session.commit()
        return respond_error(500, "internal_error", "an internal error occurred")
    return respond(conference_response(room, actor), status=201)


@router.get("/{conference_id}")
def get_conference(
    conference_id: str,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("conferences.read")),
):
    return respond(conference_response(_find(session, conference_id), actor))


@router.put("/{conference_id}")
@router.patch("/{conference_id}")
async def update_conference(
    conference_id: str,
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("conferences.write")),
):
    room = _find(session, conference_id)
    body = await read_json(request)
    reject_unknown(body, _UPDATE_FIELDS)
    changed = False

    name = to_optional_str(body, "name")
    if name is not None:
        room.name = clean(name, 120)
        changed = True
    pin = to_optional_str(body, "pin")
    if pin is not None:
        pin = pin.strip()
        if pin != "" and not valid_number(pin, 4, 8):
            raise bad_request("pin must be empty or contain 4-8 digits")
        room.pin = pin
        changed = True
    max_members = to_optional_int(body, "max_members")
    if max_members is not None:
        if max_members < 1 or max_members > 100:
            raise bad_request("max_members must be between 1 and 100")
        room.max_members = max_members
        changed = True
    muted = to_optional_bool(body, "muted")
    if muted is not None:
        room.muted = muted
        changed = True
    record = to_optional_bool(body, "record")
    if record is not None:
        room.record = record
        changed = True
    active = to_optional_bool(body, "active")
    if active is not None:
        room.active = active
        changed = True
    description = to_optional_str(body, "description")
    if description is not None:
        room.description = clean(description, 255)
        changed = True
    if not changed:
        raise bad_request("no supported fields supplied")

    room.updated_at = utcnow()
    session.commit()
    try:
        request.app.state.realtime.sync_conference(session, room)
    except Exception as exc:
        return respond_error(
            502,
            "realtime_sync_failed",
            "conference saved but Asterisk realtime sync failed",
            {"error": str(exc)},
        )
    return respond(conference_response(room, actor))


@router.delete("/{conference_id}")
def delete_conference(
    conference_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("conferences.write")),
):
    room = _find(session, conference_id)
    number = room.number
    session.delete(room)
    session.commit()
    try:
        request.app.state.realtime.delete_conference(session, number)
    except Exception as exc:
        log.warning("failed to delete realtime conference %s: %s", number, exc)
    from ..responses import no_content

    return no_content()


@router.get("/{conference_id}/dialplan")
def conference_dialplan(
    conference_id: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("conferences.read")),
):
    room = _find(session, conference_id)
    body = (
        f";; Conference {room.number} (generated by asterisk-backend)\n"
        f"exten => {room.number},1,Answer()\n"
        f" same => n,ConfBridge({room.number})\n"
    )
    return Response(
        content=body,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="conference-{room.number}.conf"'
            )
        },
    )
