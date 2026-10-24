"""Queue and queue member endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from ..database import is_unique_violation
from ..deps import get_current_user, get_db, require_permission
from ..models import Queue, QueueMember, User, utcnow
from ..responses import (
    bad_request,
    clean,
    conflict,
    not_found,
    pagination,
    parse_uuid,
    query_bool,
    queue_member_response,
    queue_response,
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
    valid_slug,
)
from ..telephony import NotConfigured
from .common import reload_asterisk

log = logging.getLogger("asterisk.queues")

router = APIRouter(
    prefix="/api/v1/queues",
    tags=["queues"],
    dependencies=[Depends(get_current_user)],
)

VALID_STRATEGIES = {
    "ringall",
    "leastrecent",
    "fewestcalls",
    "random",
    "rrmemory",
    "linear",
    "wrandom",
    "rrordered",
}

_CREATE_FIELDS = {
    "name",
    "strategy",
    "timeout",
    "music_on_hold",
    "ring_in_use",
    "max_wait",
    "announce",
    "announce_frequency",
    "description",
    "active",
    "members",
}
_UPDATE_FIELDS = _CREATE_FIELDS - {"members"}
_MEMBER_FIELDS = {"interface", "extension", "member_name", "penalty", "paused"}
_MEMBER_UPDATE_FIELDS = {"member_name", "penalty", "paused"}


def _find(session: Session, key: str) -> Queue:
    key = (key or "").strip()
    if not key:
        raise bad_request("queue id or name is required")
    if parse_uuid(key):
        queue = session.get(Queue, key)
    else:
        queue = session.scalars(select(Queue).where(Queue.name == key)).first()
    if queue is None:
        raise not_found("queue")
    return queue


def _find_member(session: Session, member_id: str, queue_id: str) -> QueueMember:
    if not parse_uuid(member_id):
        raise bad_request("memberID must be a valid UUID")
    member = session.scalars(
        select(QueueMember).where(
            QueueMember.id == member_id, QueueMember.queue_id == queue_id
        )
    ).first()
    if member is None:
        raise not_found("queue member")
    return member


def _validate_numbers(timeout: int, max_wait: int, announce_frequency: int) -> None:
    if timeout < 1 or timeout > 3600:
        raise bad_request("timeout must be between 1 and 3600 seconds")
    if max_wait < 0 or max_wait > 86400:
        raise bad_request("max_wait must be between 0 and 86400 seconds")
    if announce_frequency < 0 or announce_frequency > 3600:
        raise bad_request("announce_frequency must be between 0 and 3600 seconds")


def _member_from_body(body: dict, queue_id: str) -> QueueMember:
    interface = to_str(body, "interface").strip()
    if not interface:
        extension = to_str(body, "extension").strip()
        if not valid_number(extension, 2, 10):
            raise bad_request("interface or extension is required")
        interface = f"PJSIP/{extension}"
    if len(interface) > 80 or "/" not in interface:
        raise bad_request("interface must look like PJSIP/1001")
    penalty = to_optional_int(body, "penalty") or 0
    if penalty < 0 or penalty > 100:
        raise bad_request("penalty must be between 0 and 100")
    paused = to_optional_bool(body, "paused") or False
    return QueueMember(
        queue_id=queue_id,
        interface=interface,
        member_name=clean(to_str(body, "member_name"), 120),
        penalty=penalty,
        paused=paused,
    )


def _load_members(session: Session, queue_id: str) -> list[QueueMember]:
    return list(
        session.scalars(
            select(QueueMember)
            .where(QueueMember.queue_id == queue_id)
            .order_by(QueueMember.interface.asc())
        ).all()
    )


def _member_counts(session: Session, ids: list[str]) -> dict[str, int]:
    if not ids:
        return {}
    rows = session.execute(
        select(QueueMember.queue_id, func.count())
        .where(QueueMember.queue_id.in_(ids))
        .group_by(QueueMember.queue_id)
    ).all()
    return {str(queue_id): count for queue_id, count in rows}


@router.get("")
@router.get("/")
def list_queues(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("queues.read")),
):
    page, limit, offset = pagination(request)
    conditions = []
    search = (request.query_params.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(Queue.name.ilike(like), Queue.description.ilike(like))
        )
    active, present = query_bool(request, "active")
    if present:
        conditions.append(Queue.active.is_(active))
    strategy = (request.query_params.get("strategy") or "").strip()
    if strategy:
        conditions.append(Queue.strategy == strategy)
    total = session.scalar(
        select(func.count()).select_from(Queue).where(*conditions)
    ) or 0
    queues = session.scalars(
        select(Queue)
        .where(*conditions)
        .order_by(Queue.name.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    counts = _member_counts(session, [queue.id for queue in queues])
    return respond_list(
        [
            queue_response(queue, counts.get(queue.id, 0), None)
            for queue in queues
        ],
        page,
        limit,
        total,
    )


@router.get("/status")
def queue_status(
    request: Request,
    _: User = Depends(require_permission("queues.read")),
):
    try:
        queues = request.app.state.telephony.queues()
    except NotConfigured:
        return respond({"configured": False, "queues": []})
    except Exception as exc:
        return respond_error(502, "asterisk_unavailable", str(exc))
    return respond({"configured": True, "queues": queues})


@router.post("/reload")
def reload_queues(
    request: Request,
    _: User = Depends(require_permission("queues.write")),
):
    return reload_asterisk(request, "queues")


@router.post("", status_code=201)
@router.post("/", status_code=201)
async def create_queue(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("queues.write")),
):
    body = await read_json(request)
    reject_unknown(body, _CREATE_FIELDS)
    name = to_str(body, "name").strip()
    if not valid_slug(name, 128):
        raise bad_request(
            "name must be 1-128 letters, digits, dot, underscore or hyphen"
        )
    strategy = to_str(body, "strategy").strip() or "ringall"
    if strategy not in VALID_STRATEGIES:
        raise bad_request("strategy is not supported")
    timeout = to_optional_int(body, "timeout") or 30
    max_wait = to_optional_int(body, "max_wait") or 0
    announce_frequency = to_optional_int(body, "announce_frequency") or 0
    _validate_numbers(timeout, max_wait, announce_frequency)
    active = to_optional_bool(body, "active")
    ring_in_use = to_optional_bool(body, "ring_in_use") or False
    queue = Queue(
        name=name,
        strategy=strategy,
        timeout=timeout,
        music_on_hold=clean(to_str(body, "music_on_hold"), 128),
        ring_in_use=ring_in_use,
        max_wait=max_wait,
        announce=clean(to_str(body, "announce"), 128),
        announce_frequency=announce_frequency,
        description=clean(to_str(body, "description"), 255),
        active=True if active is None else active,
    )
    members_in = body.get("members") or []
    if not isinstance(members_in, list):
        raise bad_request("members must be an array")
    members: list[QueueMember] = []
    for raw in members_in:
        if not isinstance(raw, dict):
            raise bad_request("members must contain objects")
        reject_unknown(raw, _MEMBER_FIELDS)
        members.append(_member_from_body(raw, ""))

    try:
        session.add(queue)
        session.flush()
        for member in members:
            member.queue_id = queue.id
            session.add(member)
        session.commit()
    except Exception as exc:
        session.rollback()
        if is_unique_violation(exc):
            return conflict("queue name or queue member already exists")
        raise
    try:
        request.app.state.realtime.sync_queue(session, queue, members)
    except Exception as exc:
        return respond_error(
            502,
            "realtime_sync_failed",
            "queue saved but realtime sync failed",
            {"error": str(exc)},
        )
    return respond(queue_response(queue, len(members), members), status=201)


@router.get("/{queue_id}")
def get_queue(
    queue_id: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("queues.read")),
):
    queue = _find(session, queue_id)
    members = _load_members(session, queue.id)
    return respond(queue_response(queue, len(members), members))


@router.put("/{queue_id}")
@router.patch("/{queue_id}")
async def update_queue(
    queue_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("queues.write")),
):
    queue = _find(session, queue_id)
    old_name = queue.name
    body = await read_json(request)
    reject_unknown(body, _UPDATE_FIELDS)
    changed = False

    name = to_optional_str(body, "name")
    if name is not None:
        name = name.strip()
        if not valid_slug(name, 128):
            raise bad_request(
                "name must be 1-128 letters, digits, dot, underscore or hyphen"
            )
        queue.name = name
        changed = True
    strategy = to_optional_str(body, "strategy")
    if strategy is not None:
        if strategy not in VALID_STRATEGIES:
            raise bad_request("strategy is not supported")
        queue.strategy = strategy
        changed = True
    timeout = to_optional_int(body, "timeout")
    max_wait = to_optional_int(body, "max_wait")
    announce_frequency = to_optional_int(body, "announce_frequency")
    if timeout is not None:
        queue.timeout = timeout
        changed = True
    if max_wait is not None:
        queue.max_wait = max_wait
        changed = True
    if announce_frequency is not None:
        queue.announce_frequency = announce_frequency
        changed = True
    _validate_numbers(queue.timeout, queue.max_wait, queue.announce_frequency)
    music_on_hold = to_optional_str(body, "music_on_hold")
    if music_on_hold is not None:
        queue.music_on_hold = clean(music_on_hold, 128)
        changed = True
    ring_in_use = to_optional_bool(body, "ring_in_use")
    if ring_in_use is not None:
        queue.ring_in_use = ring_in_use
        changed = True
    announce = to_optional_str(body, "announce")
    if announce is not None:
        queue.announce = clean(announce, 128)
        changed = True
    description = to_optional_str(body, "description")
    if description is not None:
        queue.description = clean(description, 255)
        changed = True
    active = to_optional_bool(body, "active")
    if active is not None:
        queue.active = active
        changed = True
    if not changed:
        raise bad_request("no supported fields supplied")

    queue.updated_at = utcnow()
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        if is_unique_violation(exc):
            return conflict("queue name already exists")
        raise
    members = _load_members(session, queue.id)
    rt = request.app.state.realtime
    if old_name != queue.name:
        try:
            rt.delete_queue(session, old_name)
        except Exception:
            pass
    try:
        rt.sync_queue(session, queue, members)
    except Exception as exc:
        return respond_error(
            502,
            "realtime_sync_failed",
            "queue saved but realtime sync failed",
            {"error": str(exc)},
        )
    return respond(queue_response(queue, len(members), members))


@router.delete("/{queue_id}")
def delete_queue(
    queue_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("queues.write")),
):
    queue = _find(session, queue_id)
    name = queue.name
    session.execute(delete(QueueMember).where(QueueMember.queue_id == queue.id))
    session.delete(queue)
    session.commit()
    try:
        request.app.state.realtime.delete_queue(session, name)
    except Exception as exc:
        log.warning("failed to delete realtime queue %s: %s", name, exc)
    from ..responses import no_content

    return no_content()


@router.get("/{queue_id}/members")
def list_queue_members(
    queue_id: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("queues.read")),
):
    queue = _find(session, queue_id)
    members = _load_members(session, queue.id)
    return respond([queue_member_response(member) for member in members])


@router.post("/{queue_id}/members", status_code=201)
async def add_queue_member(
    queue_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("queues.write")),
):
    queue = _find(session, queue_id)
    body = await read_json(request)
    reject_unknown(body, _MEMBER_FIELDS)
    member = _member_from_body(body, queue.id)
    session.add(member)
    try:
        session.commit()
    except Exception as exc:
        session.rollback()
        if is_unique_violation(exc):
            return conflict("member is already in this queue")
        raise
    members = _load_members(session, queue.id)
    try:
        request.app.state.realtime.sync_queue(session, queue, members)
    except Exception as exc:
        return respond_error(
            502,
            "realtime_sync_failed",
            "member saved but realtime sync failed",
            {"error": str(exc)},
        )
    return respond(queue_member_response(member), status=201)


@router.patch("/{queue_id}/members/{member_id}")
async def update_queue_member(
    queue_id: str,
    member_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("queues.write")),
):
    queue = _find(session, queue_id)
    member = _find_member(session, member_id, queue.id)
    body = await read_json(request)
    reject_unknown(body, _MEMBER_UPDATE_FIELDS)
    changed = False
    name = to_optional_str(body, "member_name")
    if name is not None:
        member.member_name = clean(name, 120)
        changed = True
    penalty = to_optional_int(body, "penalty")
    if penalty is not None:
        if penalty < 0 or penalty > 100:
            raise bad_request("penalty must be between 0 and 100")
        member.penalty = penalty
        changed = True
    paused = to_optional_bool(body, "paused")
    if paused is not None:
        member.paused = paused
        changed = True
    if not changed:
        raise bad_request("no supported fields supplied")
    member.updated_at = utcnow()
    session.commit()
    members = _load_members(session, queue.id)
    try:
        request.app.state.realtime.sync_queue(session, queue, members)
    except Exception as exc:
        return respond_error(
            502,
            "realtime_sync_failed",
            "member saved but realtime sync failed",
            {"error": str(exc)},
        )
    return respond(queue_member_response(member))


@router.delete("/{queue_id}/members/{member_id}")
def remove_queue_member(
    queue_id: str,
    member_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("queues.write")),
):
    queue = _find(session, queue_id)
    member = _find_member(session, member_id, queue.id)
    session.delete(member)
    session.commit()
    members = _load_members(session, queue.id)
    try:
        request.app.state.realtime.sync_queue(session, queue, members)
    except Exception as exc:
        return respond_error(
            502,
            "realtime_sync_failed",
            "member removed but realtime sync failed",
            {"error": str(exc)},
        )
    from ..responses import no_content

    return no_content()
