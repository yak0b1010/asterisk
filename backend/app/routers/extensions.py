"""Extension endpoints and Asterisk realtime synchronisation."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from ..auth import has_permission
from ..database import is_unique_violation
from ..deps import get_current_user, get_db, require_permission
from ..models import Extension, User, VoicemailBox, utcnow
from ..responses import (
    APIError,
    bad_request,
    clean,
    conflict,
    extension_response,
    normalize_codecs,
    not_found,
    pagination,
    parse_uuid,
    query_bool,
    random_secret,
    read_json,
    reject_unknown,
    respond,
    respond_error,
    respond_list,
    to_optional_bool,
    to_optional_str,
    to_str,
    valid_number,
    valid_slug,
)
from ..telephony import NotConfigured
from .common import reload_asterisk

log = logging.getLogger("asterisk.extensions")

router = APIRouter(
    prefix="/api/v1/extensions",
    tags=["extensions"],
    dependencies=[Depends(get_current_user)],
)

_CREATE_FIELDS = {
    "number",
    "display_name",
    "user_id",
    "context",
    "codecs",
    "sip_password",
    "caller_id",
    "voicemail_enabled",
    "voicemail_pin",
    "enabled",
    "description",
}
_UPDATE_FIELDS = _CREATE_FIELDS - {"number"}


def _find(session: Session, key: str) -> Extension:
    key = (key or "").strip()
    if not key:
        raise bad_request("extension id or number is required")
    if parse_uuid(key):
        ext = session.get(Extension, key)
    else:
        ext = session.scalars(
            select(Extension).where(Extension.number == key)
        ).first()
    if ext is None:
        raise not_found("extension")
    return ext


def _validate_user_id(session: Session, raw: str) -> str | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    if not parse_uuid(raw):
        raise bad_request("user_id must be a valid UUID")
    if session.get(User, raw) is None:
        raise bad_request("user_id does not reference an existing user")
    return raw


def _sync_voicemail(session: Session, request: Request, ext: Extension) -> None:
    rt = request.app.state.realtime
    if not ext.voicemail_enabled or not ext.voicemail_pin:
        try:
            rt.delete_voicemail(session, ext.number, ext.context)
        except Exception:
            log.warning("failed to delete realtime voicemail for %s", ext.number)
        return
    box = session.scalars(
        select(VoicemailBox).where(
            VoicemailBox.extension == ext.number,
            VoicemailBox.context == ext.context,
        )
    ).first()
    try:
        if box is None:
            box = VoicemailBox(
                extension=ext.number,
                context=ext.context,
                name=ext.display_name,
                email="",
                pin=ext.voicemail_pin,
                time_zone="",
                max_messages=50,
                active=True,
            )
            session.add(box)
        else:
            box.pin = ext.voicemail_pin
            box.name = ext.display_name
            box.active = ext.enabled
            box.updated_at = utcnow()
        session.commit()
    except Exception:
        session.rollback()
        log.warning("failed to save voicemail box for extension %s", ext.number)
        return
    try:
        rt.sync_voicemail(session, box)
    except Exception:
        log.warning("failed to sync voicemail for extension %s", ext.number)


@router.get("")
@router.get("/")
def list_extensions(
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("extensions.read")),
):
    page, limit, offset = pagination(request)
    conditions = []
    search = (request.query_params.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(Extension.number.ilike(like), Extension.display_name.ilike(like))
        )
    context = (request.query_params.get("context") or "").strip()
    if context:
        conditions.append(Extension.context == context)
    enabled, present = query_bool(request, "enabled")
    if present:
        conditions.append(Extension.enabled.is_(enabled))
    voicemail, present = query_bool(request, "voicemail")
    if present:
        conditions.append(Extension.voicemail_enabled.is_(voicemail))
    user_id = (request.query_params.get("user_id") or "").strip()
    if user_id:
        if not parse_uuid(user_id):
            raise bad_request("user_id must be a valid UUID")
        conditions.append(Extension.user_id == user_id)

    total = session.scalar(
        select(func.count()).select_from(Extension).where(*conditions)
    ) or 0
    extensions = session.scalars(
        select(Extension)
        .where(*conditions)
        .order_by(Extension.number.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    return respond_list(
        [extension_response(ext, actor) for ext in extensions],
        page,
        limit,
        total,
    )


@router.get("/registrations")
def registrations(
    request: Request,
    _: User = Depends(require_permission("extensions.read")),
):
    try:
        data = request.app.state.telephony.registrations()
    except NotConfigured:
        return respond({"configured": False, "registrations": []})
    except Exception as exc:
        return respond_error(502, "asterisk_unavailable", str(exc))
    return respond({"configured": True, "registrations": data})


@router.get("/status")
def extension_statuses(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("extensions.read")),
):
    extensions = session.scalars(
        select(Extension)
        .where(Extension.enabled.is_(True))
        .order_by(Extension.number.asc())
    ).all()
    states: dict[str, dict] = {}
    source = "none"
    configured = False
    try:
        endpoints, source = request.app.state.telephony.endpoints()
        configured = True
        for endpoint in endpoints:
            states[str(endpoint.get("resource", ""))] = endpoint
    except NotConfigured:
        pass
    except Exception as exc:
        return respond_error(502, "asterisk_unavailable", str(exc))

    out = []
    for ext in extensions:
        state = states.get(ext.number)
        if not state:
            state = {"resource": ext.number, "state": "unknown", "source": source}
        out.append(
            {
                "extension": ext.number,
                "enabled": bool(ext.enabled),
                "state": state.get("state", "unknown"),
                "channels": state.get("channel_ids"),
                "source": state.get("source", source),
            }
        )
    return respond({"configured": configured, "source": source, "endpoints": out})


@router.post("", status_code=201)
@router.post("/", status_code=201)
async def create_extension(
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("extensions.write")),
):
    body = await read_json(request)
    reject_unknown(body, _CREATE_FIELDS)
    number = to_str(body, "number").strip()
    context = to_str(body, "context").strip() or "internal"
    if not valid_number(number, 2, 10):
        raise bad_request("number must contain 2-10 digits")
    if not valid_slug(context, 64):
        raise bad_request("context is invalid")
    codecs = normalize_codecs(to_str(body, "codecs"))
    if not codecs:
        raise bad_request(
            "codecs must be a comma-separated list such as ulaw,alaw,opus,g722"
        )
    password = to_str(body, "sip_password").strip() or random_secret(16)
    if len(password) < 8 or len(password) > 128:
        raise bad_request("sip_password must be between 8 and 128 characters")
    vm_enabled = to_optional_bool(body, "voicemail_enabled") or False
    vm_pin = to_str(body, "voicemail_pin").strip()
    if vm_enabled and not valid_number(vm_pin, 4, 8):
        raise bad_request("voicemail_pin must contain 4-8 digits")
    if not vm_enabled:
        vm_pin = ""
    user_id = _validate_user_id(session, to_str(body, "user_id"))
    enabled = to_optional_bool(body, "enabled")
    ext = Extension(
        number=number,
        display_name=clean(to_str(body, "display_name"), 120),
        user_id=user_id,
        context=context,
        codecs=codecs,
        sip_password=password,
        caller_id=clean(to_str(body, "caller_id"), 120),
        voicemail_enabled=vm_enabled,
        voicemail_pin=vm_pin,
        enabled=True if enabled is None else enabled,
        description=clean(to_str(body, "description"), 255),
    )
    session.add(ext)
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        if is_unique_violation(exc):
            return conflict("extension number already exists")
        raise

    try:
        request.app.state.realtime.sync_extension(session, ext)
    except Exception as exc:
        log.error("failed to sync extension %s: %s", ext.number, exc)
        session.delete(ext)
        session.commit()
        return respond_error(500, "internal_error", "an internal error occurred")
    _sync_voicemail(session, request, ext)
    return respond(extension_response(ext, actor), status=201)


@router.get("/{extension_id}")
def get_extension(
    extension_id: str,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("extensions.read")),
):
    return respond(extension_response(_find(session, extension_id), actor))


@router.put("/{extension_id}")
@router.patch("/{extension_id}")
async def update_extension(
    extension_id: str,
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("extensions.write")),
):
    ext = _find(session, extension_id)
    body = await read_json(request)
    reject_unknown(body, _UPDATE_FIELDS)
    changed = False

    display_name = to_optional_str(body, "display_name")
    if display_name is not None:
        ext.display_name = clean(display_name, 120)
        changed = True
    context = to_optional_str(body, "context")
    if context is not None:
        context = context.strip()
        if not valid_slug(context, 64):
            raise bad_request("context is invalid")
        ext.context = context
        changed = True
    codecs = to_optional_str(body, "codecs")
    if codecs is not None:
        normalized = normalize_codecs(codecs)
        if not normalized:
            raise bad_request(
                "codecs must be a comma-separated list such as ulaw,alaw,opus,g722"
            )
        ext.codecs = normalized
        changed = True
    password = to_optional_str(body, "sip_password")
    if password is not None:
        password = password.strip()
        if len(password) < 8 or len(password) > 128:
            raise bad_request("sip_password must be between 8 and 128 characters")
        ext.sip_password = password
        changed = True
    caller_id = to_optional_str(body, "caller_id")
    if caller_id is not None:
        ext.caller_id = clean(caller_id, 120)
        changed = True
    description = to_optional_str(body, "description")
    if description is not None:
        ext.description = clean(description, 255)
        changed = True
    user_id = to_optional_str(body, "user_id")
    if user_id is not None:
        ext.user_id = _validate_user_id(session, user_id)
        changed = True
    enabled = to_optional_bool(body, "enabled")
    if enabled is not None:
        ext.enabled = enabled
        changed = True

    vm_enabled = to_optional_bool(body, "voicemail_enabled")
    vm_pin_raw = to_optional_str(body, "voicemail_pin")
    if vm_enabled is not None:
        ext.voicemail_enabled = vm_enabled
        if vm_enabled and not ext.voicemail_pin and not (vm_pin_raw or "").strip():
            raise bad_request("voicemail_pin is required when enabling voicemail")
        if not vm_enabled and vm_pin_raw is None:
            ext.voicemail_pin = ""
        changed = True
    if vm_pin_raw is not None:
        pin = vm_pin_raw.strip()
        if ext.voicemail_enabled and not valid_number(pin, 4, 8):
            raise bad_request("voicemail_pin must contain 4-8 digits")
        ext.voicemail_pin = pin
        changed = True
    if not changed:
        raise bad_request("no supported fields supplied")

    ext.updated_at = utcnow()
    session.commit()
    try:
        request.app.state.realtime.sync_extension(session, ext)
    except Exception as exc:
        return respond_error(
            502,
            "realtime_sync_failed",
            "extension saved but Asterisk realtime sync failed",
            {"error": str(exc)},
        )
    _sync_voicemail(session, request, ext)
    return respond(extension_response(ext, actor))


@router.delete("/{extension_id}")
def delete_extension(
    extension_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("extensions.write")),
):
    ext = _find(session, extension_id)
    number, context = ext.number, ext.context
    session.execute(
        delete(VoicemailBox).where(
            VoicemailBox.extension == number,
            VoicemailBox.context == context,
        )
    )
    session.delete(ext)
    session.commit()
    rt = request.app.state.realtime
    try:
        rt.delete_extension(session, number)
    except Exception as exc:
        log.warning("failed to delete realtime extension %s: %s", number, exc)
    try:
        rt.delete_voicemail(session, number, context)
    except Exception:
        pass
    from ..responses import no_content

    return no_content()


@router.get("/{extension_id}/status")
def extension_status(
    extension_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("extensions.read")),
):
    ext = _find(session, extension_id)
    configured = True
    try:
        status = request.app.state.telephony.endpoint_status(ext.number)
    except NotConfigured:
        configured = False
        status = {"resource": "", "state": "", "source": ""}
    except Exception as exc:
        return respond_error(502, "asterisk_unavailable", str(exc))
    return respond(
        {
            "extension": ext.number,
            "enabled": bool(ext.enabled),
            "configured": configured,
            "status": status,
        }
    )


@router.post("/{extension_id}/reload")
def reload_extensions(
    extension_id: str,
    request: Request,
    _: User = Depends(require_permission("extensions.write")),
):
    return reload_asterisk(request, "pjsip")


@router.get("/{extension_id}/credentials")
def extension_credentials(
    extension_id: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("extensions.credentials")),
):
    ext = _find(session, extension_id)
    return respond(
        {
            "id": ext.id,
            "number": ext.number,
            "sip_password": ext.sip_password,
            "voicemail_pin": ext.voicemail_pin,
        }
    )
