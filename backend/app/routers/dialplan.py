"""Dialplan rule endpoints and generated dialplan export."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, require_permission
from ..models import DialplanRule, User, utcnow
from ..responses import (
    bad_request,
    clean,
    conflict,
    dialplan_response,
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
    valid_slug,
)
from .common import reload_asterisk

log = logging.getLogger("asterisk.dialplan")

router = APIRouter(
    prefix="/api/v1/dialplan",
    tags=["dialplan"],
    dependencies=[Depends(get_current_user)],
)

_CREATE_FIELDS = {
    "context",
    "pattern",
    "priority",
    "app",
    "app_data",
    "description",
    "enabled",
}
_UPDATE_FIELDS = _CREATE_FIELDS


def _find(session: Session, rule_id: str) -> DialplanRule:
    if not parse_uuid(rule_id):
        raise bad_request("id must be a valid UUID")
    rule = session.get(DialplanRule, rule_id)
    if rule is None:
        raise not_found("dialplan rule")
    return rule


def _validate(
    context: str, pattern: str, priority: int, app: str, app_data: str
) -> None:
    context = (context or "").strip()
    pattern = (pattern or "").strip()
    app = (app or "").strip()
    if not valid_slug(context, 64):
        raise bad_request(
            "context must be 1-64 letters, digits, dot, underscore or hyphen"
        )
    if not pattern or len(pattern) > 64 or any(ch.isspace() for ch in pattern):
        raise bad_request("pattern is required and must not contain whitespace")
    if priority < 1 or priority > 1000:
        raise bad_request("priority must be between 1 and 1000")
    if not app or len(app) > 64 or not valid_slug(app, 64):
        raise bad_request("app is required and must be a valid application name")
    if len(app_data) > 512 or "\r" in app_data or "\n" in app_data:
        raise bad_request(
            "app_data must be at most 512 characters and contain no newlines"
        )


def _duplicate(
    session: Session, context: str, pattern: str, priority: int, exclude: str | None
) -> bool:
    stmt = select(func.count()).select_from(DialplanRule).where(
        DialplanRule.context == context,
        DialplanRule.pattern == pattern,
        DialplanRule.priority == priority,
    )
    if exclude:
        stmt = stmt.where(DialplanRule.id != exclude)
    return (session.scalar(stmt) or 0) > 0


@router.get("")
@router.get("/")
def list_dialplan(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("dialplan.read")),
):
    page, limit, offset = pagination(request)
    conditions = []
    context = (request.query_params.get("context") or "").strip()
    if context:
        conditions.append(DialplanRule.context == context)
    search = (request.query_params.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                DialplanRule.pattern.ilike(like),
                DialplanRule.app.ilike(like),
                DialplanRule.app_data.ilike(like),
            )
        )
    enabled, present = query_bool(request, "enabled")
    if present:
        conditions.append(DialplanRule.enabled.is_(enabled))
    total = session.scalar(
        select(func.count()).select_from(DialplanRule).where(*conditions)
    ) or 0
    rules = session.scalars(
        select(DialplanRule)
        .where(*conditions)
        .order_by(
            DialplanRule.context.asc(),
            DialplanRule.pattern.asc(),
            DialplanRule.priority.asc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()
    return respond_list([dialplan_response(rule) for rule in rules], page, limit, total)


@router.get("/contexts")
def dialplan_contexts(
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("dialplan.read")),
):
    rows = session.execute(
        select(DialplanRule.context, func.count())
        .group_by(DialplanRule.context)
        .order_by(DialplanRule.context.asc())
    ).all()
    return respond([{"context": context, "count": count} for context, count in rows])


@router.get("/export")
def export_dialplan(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("dialplan.read")),
):
    context = (request.query_params.get("context") or "").strip()
    stmt = select(DialplanRule).where(DialplanRule.enabled.is_(True))
    if context:
        stmt = stmt.where(DialplanRule.context == context)
    rules = session.scalars(
        stmt.order_by(
            DialplanRule.context.asc(),
            DialplanRule.pattern.asc(),
            DialplanRule.priority.asc(),
        )
    ).all()
    grouped: dict[str, list[DialplanRule]] = {}
    for rule in rules:
        grouped.setdefault(rule.context, []).append(rule)

    lines = ["; Generated by asterisk-backend. Do not edit by hand.", ""]
    for context_name in sorted(grouped):
        lines.append(f"[{context_name}]")
        previous = ""
        for rule in grouped[context_name]:
            prefix = " same" if rule.pattern == previous else "exten"
            previous = rule.pattern
            lines.append(
                f"{prefix} => {rule.pattern},{rule.priority},"
                f"{rule.app}({rule.app_data})"
            )
        lines.append("")
    body = "\n".join(lines) + "\n"
    return Response(
        content=body,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="extensions_generated.conf"'
        },
    )


@router.post("/reload")
def reload_dialplan(
    request: Request,
    _: User = Depends(require_permission("dialplan.write")),
):
    return reload_asterisk(request, "dialplan")


@router.post("", status_code=201)
@router.post("/", status_code=201)
async def create_dialplan_rule(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("dialplan.write")),
):
    body = await read_json(request)
    reject_unknown(body, _CREATE_FIELDS)
    context = to_str(body, "context").strip() or "internal"
    pattern = to_str(body, "pattern").strip()
    priority = to_optional_int(body, "priority") or 0
    app = to_str(body, "app").strip()
    app_data = to_str(body, "app_data").strip()
    _validate(context, pattern, priority, app, app_data)
    if _duplicate(session, context, pattern, priority, None):
        return conflict(
            "a rule with the same context, pattern and priority already exists"
        )
    enabled = to_optional_bool(body, "enabled")
    rule = DialplanRule(
        context=context,
        pattern=pattern,
        priority=priority,
        app=app,
        app_data=app_data,
        description=clean(to_str(body, "description"), 255),
        enabled=True if enabled is None else enabled,
    )
    session.add(rule)
    session.commit()
    try:
        request.app.state.realtime.sync_dialplan_rule(session, rule)
    except Exception as exc:
        log.error("failed to sync dialplan rule %s: %s", rule.id, exc)
        session.delete(rule)
        session.commit()
        return respond_error(500, "internal_error", "an internal error occurred")
    return respond(dialplan_response(rule), status=201)


@router.get("/{rule_id}")
def get_dialplan_rule(
    rule_id: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("dialplan.read")),
):
    return respond(dialplan_response(_find(session, rule_id)))


@router.put("/{rule_id}")
@router.patch("/{rule_id}")
async def update_dialplan_rule(
    rule_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("dialplan.write")),
):
    rule = _find(session, rule_id)
    body = await read_json(request)
    reject_unknown(body, _UPDATE_FIELDS)

    previous = DialplanRule(
        id=rule.id,
        context=rule.context,
        pattern=rule.pattern,
        priority=rule.priority,
        app=rule.app,
        app_data=rule.app_data,
        description=rule.description,
        enabled=rule.enabled,
    )

    changed = False
    context = to_optional_str(body, "context")
    if context is not None:
        rule.context = context.strip()
        changed = True
    pattern = to_optional_str(body, "pattern")
    if pattern is not None:
        rule.pattern = pattern.strip()
        changed = True
    priority = to_optional_int(body, "priority")
    if priority is not None:
        rule.priority = priority
        changed = True
    app = to_optional_str(body, "app")
    if app is not None:
        rule.app = app.strip()
        changed = True
    app_data = to_optional_str(body, "app_data")
    if app_data is not None:
        rule.app_data = app_data.strip()
        changed = True
    description = to_optional_str(body, "description")
    if description is not None:
        rule.description = clean(description, 255)
        changed = True
    enabled = to_optional_bool(body, "enabled")
    if enabled is not None:
        rule.enabled = enabled
        changed = True
    if not changed:
        raise bad_request("no supported fields supplied")

    _validate(rule.context, rule.pattern, rule.priority, rule.app, rule.app_data)
    if _duplicate(session, rule.context, rule.pattern, rule.priority, rule.id):
        return conflict(
            "a rule with the same context, pattern and priority already exists"
        )
    rule.updated_at = utcnow()
    session.commit()
    try:
        request.app.state.realtime.replace_dialplan_rule(session, previous, rule)
    except Exception as exc:
        return respond_error(
            502,
            "realtime_sync_failed",
            "dialplan rule saved but Asterisk realtime sync failed",
            {"error": str(exc)},
        )
    return respond(dialplan_response(rule))


@router.delete("/{rule_id}")
def delete_dialplan_rule(
    rule_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("dialplan.write")),
):
    rule = _find(session, rule_id)
    context, pattern, priority = rule.context, rule.pattern, rule.priority
    session.delete(rule)
    session.commit()
    try:
        request.app.state.realtime.delete_dialplan_rule(
            session, context, pattern, priority
        )
    except Exception as exc:
        log.warning("failed to delete realtime dialplan rule %s: %s", rule_id, exc)
    from ..responses import no_content

    return no_content()
