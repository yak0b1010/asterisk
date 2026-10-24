"""Voicemail box endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import is_unique_violation
from ..deps import get_current_user, get_db, require_permission
from ..models import User, VoicemailBox, utcnow
from ..responses import (
    bad_request,
    clean,
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
    valid_email,
    valid_number,
    valid_slug,
    voicemail_response,
)
from .common import reload_asterisk

log = logging.getLogger("asterisk.voicemail")

router = APIRouter(
    prefix="/api/v1/voicemail",
    tags=["voicemail"],
    dependencies=[Depends(get_current_user)],
)

_CREATE_FIELDS = {
    "extension",
    "context",
    "name",
    "email",
    "pin",
    "timezone",
    "max_messages",
    "active",
}
_UPDATE_FIELDS = _CREATE_FIELDS - {"extension"}


def _find(session: Session, box_id: str) -> VoicemailBox:
    if not parse_uuid(box_id):
        raise bad_request("id must be a valid UUID")
    box = session.get(VoicemailBox, box_id)
    if box is None:
        raise not_found("voicemail box")
    return box


@router.get("")
@router.get("/")
def list_voicemail(
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("voicemail.read")),
):
    page, limit, offset = pagination(request)
    conditions = []
    search = (request.query_params.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                VoicemailBox.extension.ilike(like),
                VoicemailBox.name.ilike(like),
                VoicemailBox.email.ilike(like),
            )
        )
    context = (request.query_params.get("context") or "").strip()
    if context:
        conditions.append(VoicemailBox.context == context)
    active, present = query_bool(request, "active")
    if present:
        conditions.append(VoicemailBox.active.is_(active))
    total = session.scalar(
        select(func.count()).select_from(VoicemailBox).where(*conditions)
    ) or 0
    boxes = session.scalars(
        select(VoicemailBox)
        .where(*conditions)
        .order_by(VoicemailBox.extension.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    return respond_list(
        [voicemail_response(box, actor) for box in boxes], page, limit, total
    )


@router.post("/reload")
def reload_voicemail(
    request: Request,
    _: User = Depends(require_permission("voicemail.write")),
):
    return reload_asterisk(request, "voicemail")


@router.post("", status_code=201)
@router.post("/", status_code=201)
async def create_voicemail(
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("voicemail.write")),
):
    body = await read_json(request)
    reject_unknown(body, _CREATE_FIELDS)
    extension = to_str(body, "extension").strip()
    context = to_str(body, "context").strip() or "internal"
    pin = to_str(body, "pin").strip()
    email = to_str(body, "email").strip()
    if not valid_number(extension, 2, 10):
        raise bad_request("extension must contain 2-10 digits")
    if not valid_slug(context, 64):
        raise bad_request("context is invalid")
    if not valid_number(pin, 4, 8):
        raise bad_request("pin must contain 4-8 digits")
    if not valid_email(email):
        raise bad_request("email is invalid")
    max_messages = to_optional_int(body, "max_messages") or 50
    if max_messages < 1 or max_messages > 1000:
        raise bad_request("max_messages must be between 1 and 1000")
    active = to_optional_bool(body, "active")
    box = VoicemailBox(
        extension=extension,
        context=context,
        name=clean(to_str(body, "name"), 120),
        email=clean(email, 255),
        pin=pin,
        time_zone=clean(to_str(body, "timezone"), 64),
        max_messages=max_messages,
        active=True if active is None else active,
    )
    session.add(box)
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        if is_unique_violation(exc):
            return conflict(
                "a voicemail box already exists for this extension and context"
            )
        raise
    try:
        request.app.state.realtime.sync_voicemail(session, box)
    except Exception as exc:
        session.delete(box)
        session.commit()
        return respond_error(
            502,
            "realtime_sync_failed",
            "voicemail saved but realtime sync failed",
            {"error": str(exc)},
        )
    return respond(voicemail_response(box, actor), status=201)


@router.get("/{box_id}")
def get_voicemail(
    box_id: str,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("voicemail.read")),
):
    return respond(voicemail_response(_find(session, box_id), actor))


@router.put("/{box_id}")
@router.patch("/{box_id}")
async def update_voicemail(
    box_id: str,
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("voicemail.write")),
):
    box = _find(session, box_id)
    old_context = box.context
    body = await read_json(request)
    reject_unknown(body, _UPDATE_FIELDS)
    changed = False

    context = to_optional_str(body, "context")
    if context is not None:
        context = context.strip()
        if not valid_slug(context, 64):
            raise bad_request("context is invalid")
        box.context = context
        changed = True
    name = to_optional_str(body, "name")
    if name is not None:
        box.name = clean(name, 120)
        changed = True
    email = to_optional_str(body, "email")
    if email is not None:
        email = email.strip()
        if not valid_email(email):
            raise bad_request("email is invalid")
        box.email = clean(email, 255)
        changed = True
    pin = to_optional_str(body, "pin")
    if pin is not None:
        pin = pin.strip()
        if not valid_number(pin, 4, 8):
            raise bad_request("pin must contain 4-8 digits")
        box.pin = pin
        changed = True
    timezone = to_optional_str(body, "timezone")
    if timezone is not None:
        box.time_zone = clean(timezone, 64)
        changed = True
    max_messages = to_optional_int(body, "max_messages")
    if max_messages is not None:
        if max_messages < 1 or max_messages > 1000:
            raise bad_request("max_messages must be between 1 and 1000")
        box.max_messages = max_messages
        changed = True
    active = to_optional_bool(body, "active")
    if active is not None:
        box.active = active
        changed = True
    if not changed:
        raise bad_request("no supported fields supplied")

    box.updated_at = utcnow()
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        if is_unique_violation(exc):
            return conflict(
                "a voicemail box already exists for this extension and context"
            )
        raise

    rt = request.app.state.realtime
    if old_context != box.context:
        try:
            rt.delete_voicemail(session, box.extension, old_context)
        except Exception:
            pass
    try:
        rt.sync_voicemail(session, box)
    except Exception as exc:
        return respond_error(
            502,
            "realtime_sync_failed",
            "voicemail saved but realtime sync failed",
            {"error": str(exc)},
        )
    return respond(voicemail_response(box, actor))


@router.delete("/{box_id}")
def delete_voicemail(
    box_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("voicemail.write")),
):
    box = _find(session, box_id)
    extension, context = box.extension, box.context
    session.delete(box)
    session.commit()
    try:
        request.app.state.realtime.delete_voicemail(session, extension, context)
    except Exception as exc:
        log.warning("failed to delete realtime voicemail %s: %s", extension, exc)
    from ..responses import no_content

    return no_content()
