"""Dashboard summary and recent-call endpoints."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, require_permission
from ..models import (
    CDR,
    ConferenceRoom,
    DialplanRule,
    Extension,
    IVRMenu,
    Queue,
    User,
    VoicemailBox,
)
from ..responses import (
    cdr_response,
    query_int,
    respond,
    respond_list,
)

log = logging.getLogger("asterisk.dashboard")

router = APIRouter(
    prefix="/api/v1/dashboard",
    tags=["dashboard"],
    dependencies=[Depends(get_current_user)],
)


def _count(session: Session, model, *conditions) -> int:
    try:
        value = session.scalar(
            select(func.count()).select_from(model).where(*conditions)
        )
    except Exception as exc:
        log.warning("dashboard count failed: %s", exc)
        return 0
    return int(value or 0)


@router.get("/stats")
def dashboard_stats(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("dashboard.read")),
):
    users_total = _count(session, User)
    users_active = _count(session, User, User.active.is_(True))
    extensions_total = _count(session, Extension)
    extensions_enabled = _count(session, Extension, Extension.enabled.is_(True))
    voicemail_enabled = _count(
        session, Extension, Extension.voicemail_enabled.is_(True)
    )
    dialplan_rules = _count(session, DialplanRule, DialplanRule.enabled.is_(True))

    start_of_day = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    calls_today = _count(session, CDR, CDR.calldate >= start_of_day)
    answered_today = _count(
        session,
        CDR,
        CDR.calldate >= start_of_day,
        func.upper(CDR.disposition) == "ANSWERED",
    )

    config = request.app.state.config
    asterisk_configured = bool(
        config.asterisk.ami_password or config.asterisk.ari_password
    )
    active_calls = 0
    active_calls_error = ""
    if asterisk_configured:
        try:
            calls, _source = request.app.state.telephony.calls()
            active_calls = len(calls)
        except Exception as exc:
            active_calls_error = str(exc)

    system = request.app.state.monitor.snapshot()
    return respond(
        {
            "users": {"total": users_total, "active": users_active},
            "extensions": {
                "total": extensions_total,
                "enabled": extensions_enabled,
                "voicemail_enabled": voicemail_enabled,
            },
            "dialplan": {"enabled_rules": dialplan_rules},
            "queues": {"total": _count(session, Queue)},
            "ivr": {"total": _count(session, IVRMenu)},
            "conferences": {"total": _count(session, ConferenceRoom)},
            "voicemail": {
                "boxes": _count(session, VoicemailBox),
                "active": _count(session, VoicemailBox, VoicemailBox.active.is_(True)),
            },
            "calls": {
                "today": calls_today,
                "answered_today": answered_today,
                "active": active_calls,
                "asterisk_configured": asterisk_configured,
                "active_calls_error": active_calls_error,
            },
            "system": {
                "cpu_percent": system["cpu_percent"],
                "memory_percent": system["memory_percent"],
                "disk_percent": system["disk_percent"],
                "load_1": system["load_1"],
                "uptime_seconds": system["uptime_seconds"],
            },
        }
    )


@router.get("/recent-calls")
def dashboard_recent_calls(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("dashboard.read")),
):
    limit = query_int(request, "limit", 10)
    if limit < 1:
        limit = 10
    if limit > 50:
        limit = 50
    conditions = []
    disposition = (request.query_params.get("disposition") or "").strip()
    if disposition:
        conditions.append(func.upper(CDR.disposition) == disposition.upper())
    total = session.scalar(
        select(func.count()).select_from(CDR).where(*conditions)
    ) or 0
    records = session.scalars(
        select(CDR)
        .where(*conditions)
        .order_by(CDR.calldate.desc(), CDR.id.desc())
        .limit(limit)
    ).all()
    return respond_list(
        [cdr_response(record) for record in records], 1, limit, total
    )
