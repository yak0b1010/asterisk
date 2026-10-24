"""Audit log endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, require_permission
from ..models import AuditLog, User
from ..responses import (
    audit_response,
    bad_request,
    not_found,
    pagination,
    parse_positive_int,
    parse_time_bound,
    parse_uuid,
    respond,
    respond_list,
)

router = APIRouter(
    prefix="/api/v1/audit",
    tags=["audit"],
    dependencies=[
        Depends(get_current_user),
        Depends(require_permission("audit.read")),
    ],
)


@router.get("")
@router.get("/")
def list_audit(
    request: Request,
    session: Session = Depends(get_db),
):
    page, limit, offset = pagination(request)
    conditions = []

    raw = (request.query_params.get("from") or "").strip()
    if raw:
        bound, _, ok = parse_time_bound(raw, False)
        if not ok:
            raise bad_request("from must be an RFC3339 timestamp or YYYY-MM-DD date")
        conditions.append(AuditLog.created_at >= bound)
    raw = (request.query_params.get("to") or "").strip()
    if raw:
        bound, exclusive, ok = parse_time_bound(raw, True)
        if not ok:
            raise bad_request("to must be an RFC3339 timestamp or YYYY-MM-DD date")
        if exclusive:
            conditions.append(AuditLog.created_at < bound)
        else:
            conditions.append(AuditLog.created_at <= bound)

    user_id = (request.query_params.get("user_id") or "").strip()
    if user_id:
        if not parse_uuid(user_id):
            raise bad_request("user_id must be a valid UUID")
        conditions.append(AuditLog.user_id == user_id)
    for key, column in (
        ("username", AuditLog.username),
        ("action", AuditLog.action),
        ("entity_type", AuditLog.entity_type),
        ("entity_id", AuditLog.entity_id),
    ):
        value = (request.query_params.get(key) or "").strip()
        if value:
            conditions.append(column == value)
    method = (request.query_params.get("method") or "").strip()
    if method:
        conditions.append(AuditLog.method == method.upper())
    status_code = (request.query_params.get("status_code") or "").strip()
    if status_code:
        try:
            code = int(status_code)
        except ValueError as exc:
            raise bad_request("status_code must be a valid HTTP status") from exc
        if code < 100 or code > 599:
            raise bad_request("status_code must be a valid HTTP status")
        conditions.append(AuditLog.status_code == code)
    search = (request.query_params.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                AuditLog.username.ilike(like),
                AuditLog.path.ilike(like),
                AuditLog.details.ilike(like),
            )
        )

    total = session.scalar(
        select(func.count()).select_from(AuditLog).where(*conditions)
    ) or 0
    entries = session.scalars(
        select(AuditLog)
        .where(*conditions)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return respond_list(
        [audit_response(entry) for entry in entries], page, limit, total
    )


@router.get("/{audit_id}")
def get_audit(
    audit_id: str,
    session: Session = Depends(get_db),
):
    entry_id = parse_positive_int(audit_id, "id")
    entry = session.get(AuditLog, entry_id)
    if entry is None:
        raise not_found("audit log")
    return respond(audit_response(entry))
