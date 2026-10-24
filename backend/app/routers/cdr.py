"""Call detail record listing, statistics, export and ingestion."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, require_permission
from ..models import CDR, User
from ..responses import (
    bad_request,
    cdr_response,
    clean,
    go_time,
    not_found,
    pagination,
    parse_positive_int,
    parse_time_bound,
    query_int,
    read_json,
    reject_unknown,
    respond,
    respond_list,
    to_int,
    to_str,
    valid_number,
)

router = APIRouter(
    prefix="/api/v1/cdr",
    tags=["cdr"],
    dependencies=[Depends(get_current_user)],
)

VALID_DISPOSITIONS = {
    "ANSWERED",
    "NO ANSWER",
    "BUSY",
    "FAILED",
    "CONGESTION",
    "UNKNOWN",
}

_INGEST_FIELDS = {
    "calldate",
    "clid",
    "src",
    "dst",
    "dcontext",
    "channel",
    "dstchannel",
    "lastapp",
    "lastdata",
    "duration",
    "billsec",
    "disposition",
    "amaflags",
    "accountcode",
    "uniqueid",
    "userfield",
    "peeraccount",
    "linkedid",
    "sequence",
}


def _round2(value: float) -> float:
    return float(int(value * 100 + 0.5)) / 100


def _conditions(request: Request) -> list:
    conditions = []
    raw = (request.query_params.get("from") or "").strip()
    if raw:
        bound, _, ok = parse_time_bound(raw, False)
        if not ok:
            raise bad_request("from must be an RFC3339 timestamp or YYYY-MM-DD date")
        conditions.append(CDR.calldate >= bound)
    raw = (request.query_params.get("to") or "").strip()
    if raw:
        bound, exclusive, ok = parse_time_bound(raw, True)
        if not ok:
            raise bad_request("to must be an RFC3339 timestamp or YYYY-MM-DD date")
        if exclusive:
            conditions.append(CDR.calldate < bound)
        else:
            conditions.append(CDR.calldate <= bound)
    for key, column in (
        ("src", CDR.src),
        ("dst", CDR.dst),
        ("uniqueid", CDR.uniqueid),
        ("linkedid", CDR.linkedid),
        ("accountcode", CDR.accountcode),
        ("context", CDR.dcontext),
    ):
        value = (request.query_params.get(key) or "").strip()
        if value:
            conditions.append(column == value)
    disposition = (request.query_params.get("disposition") or "").strip()
    if disposition:
        conditions.append(func.upper(CDR.disposition) == disposition.upper())
    search = (request.query_params.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        conditions.append(
            or_(
                CDR.clid.ilike(like),
                CDR.src.ilike(like),
                CDR.dst.ilike(like),
                CDR.uniqueid.ilike(like),
                CDR.accountcode.ilike(like),
            )
        )
    min_billsec = (request.query_params.get("min_billsec") or "").strip()
    if min_billsec:
        try:
            value = int(min_billsec)
        except ValueError as exc:
            raise bad_request("min_billsec must be a non-negative integer") from exc
        if value < 0:
            raise bad_request("min_billsec must be a non-negative integer")
        conditions.append(CDR.billsec >= value)
    return conditions


def _order(request: Request):
    columns = {
        "duration": CDR.duration,
        "billsec": CDR.billsec,
        "src": CDR.src,
        "dst": CDR.dst,
        "disposition": CDR.disposition,
        "calldate": CDR.calldate,
    }
    column = columns.get(
        (request.query_params.get("sort") or "").strip().lower(), CDR.calldate
    )
    descending = (request.query_params.get("order") or "").strip().lower() != "asc"
    if descending:
        return column.desc(), CDR.id.desc()
    return column.asc(), CDR.id.asc()


def _find(session: Session, raw_id: str) -> CDR:
    record_id = parse_positive_int(raw_id, "id")
    record = session.get(CDR, record_id)
    if record is None:
        raise not_found("CDR")
    return record


@router.get("")
@router.get("/")
def list_cdr(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("cdr.read")),
):
    page, limit, offset = pagination(request)
    conditions = _conditions(request)
    total = session.scalar(
        select(func.count()).select_from(CDR).where(*conditions)
    ) or 0
    records = session.scalars(
        select(CDR)
        .where(*conditions)
        .order_by(*_order(request))
        .limit(limit)
        .offset(offset)
    ).all()
    return respond_list([cdr_response(record) for record in records], page, limit, total)


@router.get("/stats")
def cdr_stats(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("cdr.read")),
):
    conditions = _conditions(request)
    overall = session.execute(
        select(
            func.count(CDR.id),
            func.coalesce(func.sum(CDR.duration), 0),
            func.coalesce(func.sum(CDR.billsec), 0),
        ).where(*conditions)
    ).one()
    total, total_duration, total_billsec = (
        int(overall[0] or 0),
        int(overall[1] or 0),
        int(overall[2] or 0),
    )

    disposition_expr = func.coalesce(
        func.nullif(func.upper(CDR.disposition), ""), "UNKNOWN"
    )
    rows = session.execute(
        select(
            disposition_expr.label("disposition"),
            func.count().label("count"),
            func.coalesce(func.sum(CDR.billsec), 0).label("total_billsec"),
        )
        .where(*conditions)
        .group_by(disposition_expr)
        .order_by(func.count().desc())
    ).all()
    by_disposition = [
        {
            "disposition": row[0] or "UNKNOWN",
            "count": int(row[1] or 0),
            "total_billsec_seconds": int(row[2] or 0),
        }
        for row in rows
    ]

    day_expr = func.to_char(CDR.calldate, "YYYY-MM-DD")
    day_rows = session.execute(
        select(
            day_expr.label("day"),
            func.count().label("count"),
            func.count()
            .filter(func.upper(CDR.disposition) == "ANSWERED")
            .label("answered"),
            func.coalesce(func.sum(CDR.billsec), 0).label("total_billsec"),
        )
        .where(*conditions)
        .group_by(day_expr)
        .order_by(day_expr.desc())
        .limit(31)
    ).all()
    by_day = [
        {
            "day": row[0],
            "count": int(row[1] or 0),
            "answered": int(row[2] or 0),
            "total_billsec_seconds": int(row[3] or 0),
        }
        for row in day_rows
    ]

    answered = no_answer = busy = failed = 0
    for row in by_disposition:
        disposition = str(row["disposition"]).upper()
        if disposition == "ANSWERED":
            answered = row["count"]
        elif disposition == "NO ANSWER":
            no_answer = row["count"]
        elif disposition == "BUSY":
            busy = row["count"]
        elif disposition in {"FAILED", "CONGESTION"}:
            failed += row["count"]

    return respond(
        {
            "total": total,
            "answered": answered,
            "no_answer": no_answer,
            "busy": busy,
            "failed": failed,
            "answer_rate": (
                _round2(answered / total * 100) if total > 0 else 0.0
            ),
            "total_duration_seconds": total_duration,
            "total_billsec_seconds": total_billsec,
            "average_duration_seconds": (
                _round2(total_duration / total) if total > 0 else 0.0
            ),
            "average_billsec_seconds": (
                _round2(total_billsec / total) if total > 0 else 0.0
            ),
            "by_disposition": by_disposition,
            "by_day": by_day,
        }
    )


@router.get("/export")
def export_cdr(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("cdr.export")),
):
    conditions = _conditions(request)
    records = session.scalars(
        select(CDR).where(*conditions).order_by(*_order(request)).limit(100000)
    ).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "id",
            "calldate",
            "clid",
            "src",
            "dst",
            "dcontext",
            "channel",
            "dstchannel",
            "lastapp",
            "lastdata",
            "duration",
            "billsec",
            "disposition",
            "amaflags",
            "accountcode",
            "uniqueid",
            "userfield",
            "peeraccount",
            "linkedid",
            "sequence",
        ]
    )
    for record in records:
        calldate = record.calldate
        if calldate.tzinfo is None:
            calldate = calldate.replace(tzinfo=timezone.utc)
        writer.writerow(
            [
                record.id,
                calldate.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                record.clid,
                record.src,
                record.dst,
                record.dcontext,
                record.channel,
                record.dstchannel,
                record.lastapp,
                record.lastdata,
                record.duration,
                record.billsec,
                record.disposition,
                record.amaflags,
                record.accountcode,
                record.uniqueid,
                record.userfield,
                record.peeraccount,
                record.linkedid,
                record.sequence,
            ]
        )
    filename = (
        "cdr-"
        + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        + ".csv"
    )
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


@router.post("", status_code=201)
@router.post("/", status_code=201)
async def ingest_cdr(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("cdr.delete")),
):
    body = await read_json(request)
    reject_unknown(body, _INGEST_FIELDS)
    src = to_str(body, "src").strip()
    dst = to_str(body, "dst").strip()
    disposition = to_str(body, "disposition").strip().upper() or "ANSWERED"
    if not src or not dst:
        raise bad_request("src and dst are required")
    if len(src) > 80 or len(dst) > 80:
        raise bad_request("src and dst must be at most 80 characters")
    if disposition not in VALID_DISPOSITIONS:
        raise bad_request(
            "disposition must be ANSWERED, NO ANSWER, BUSY, FAILED, "
            "CONGESTION or UNKNOWN"
        )
    duration = to_int(body, "duration")
    billsec = to_int(body, "billsec")
    if duration < 0 or billsec < 0:
        raise bad_request("duration and billsec must not be negative")

    calldate = datetime.now(timezone.utc)
    raw_calldate = to_str(body, "calldate").strip()
    if raw_calldate:
        parsed, _, ok = parse_time_bound(raw_calldate, False)
        if not ok:
            raise bad_request(
                "calldate must be an RFC3339 timestamp or YYYY-MM-DD date"
            )
        calldate = parsed

    uniqueid = clean(to_str(body, "uniqueid"), 150) or str(uuid.uuid4())
    record = CDR(
        calldate=calldate,
        clid=clean(to_str(body, "clid"), 80),
        src=src,
        dst=dst,
        dcontext=clean(to_str(body, "dcontext"), 80),
        channel=clean(to_str(body, "channel"), 80),
        dstchannel=clean(to_str(body, "dstchannel"), 80),
        lastapp=clean(to_str(body, "lastapp"), 80),
        lastdata=clean(to_str(body, "lastdata"), 80),
        duration=duration,
        billsec=billsec,
        disposition=disposition,
        amaflags=to_int(body, "amaflags"),
        accountcode=clean(to_str(body, "accountcode"), 80),
        uniqueid=uniqueid,
        userfield=clean(to_str(body, "userfield"), 255),
        peeraccount=clean(to_str(body, "peeraccount"), 80),
        linkedid=clean(to_str(body, "linkedid"), 150),
        sequence=to_int(body, "sequence"),
    )
    session.add(record)
    session.commit()
    return respond(cdr_response(record), status=201)


@router.get("/{cdr_id}")
def get_cdr(
    cdr_id: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("cdr.read")),
):
    return respond(cdr_response(_find(session, cdr_id)))


@router.delete("/{cdr_id}")
def delete_cdr(
    cdr_id: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("cdr.delete")),
):
    record = _find(session, cdr_id)
    session.delete(record)
    session.commit()
    from ..responses import no_content

    return no_content()
