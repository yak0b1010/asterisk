"""Read call data from the Asterisk CDR table.

`cdr_odbc` writes one row per finished call into PostgreSQL.  The dashboard
uses that table for "calls today" and "recent calls".  If the table does not
exist yet (fresh install or local SQLite development), the helpers below
return empty values instead of failing.

`cdr_odbc` uses the classic ODBC schema: the call start time is stored in the
`calldate` column (not `start`).
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from sqlalchemy import inspect, text

from .database import engine

_table_cache: dict[str, tuple[float, bool]] = {}
_table_lock = threading.Lock()
TABLE_CACHE_SECONDS = 30.0


def has_cdr_table() -> bool:
    now = time.monotonic()
    with _table_lock:
        cached = _table_cache.get("value")
        if cached and cached[0] > now:
            return cached[1]

    try:
        exists = inspect(engine).has_table("cdr")
    except Exception:
        exists = False

    with _table_lock:
        _table_cache["value"] = (time.monotonic() + TABLE_CACHE_SECONDS, exists)
    return exists


def _empty_stats() -> dict:
    return {"today": 0, "answered": 0, "missed": 0, "avg_duration_sec": 0}


def call_stats_today() -> dict:
    """Count today's calls.

    `cdr_odbc` is configured with `usegmtime=yes`, so `calldate` is naive UTC.
    """
    if not has_cdr_table():
        return _empty_stats()

    day_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0, tzinfo=None
    )
    query = text(
        """
        SELECT
            COUNT(*) AS today,
            COALESCE(SUM(CASE WHEN disposition = 'ANSWERED' THEN 1 ELSE 0 END), 0)
                AS answered,
            COALESCE(SUM(CASE WHEN COALESCE(disposition, '') <> 'ANSWERED' THEN 1 ELSE 0 END), 0)
                AS missed,
            COALESCE(AVG(CASE WHEN disposition = 'ANSWERED' THEN billsec END), 0)
                AS avg_duration
        FROM cdr
        WHERE calldate >= :day_start
        """
    )

    try:
        with engine.connect() as connection:
            row = connection.execute(query, {"day_start": day_start}).mappings().first()
    except Exception:
        return _empty_stats()

    if row is None:
        return _empty_stats()

    return {
        "today": int(row["today"] or 0),
        "answered": int(row["answered"] or 0),
        "missed": int(row["missed"] or 0),
        "avg_duration_sec": int(round(float(row["avg_duration"] or 0))),
    }


def _status_for(disposition: str | None) -> str:
    value = (disposition or "").upper()
    if value == "ANSWERED":
        return "answered"
    if value == "BUSY":
        return "busy"
    if value in ("FAILED", "CONGESTION"):
        return "failed"
    return "missed"


def recent_calls(limit: int = 8) -> list[dict]:
    """Return the newest finished calls in the shape the dashboard expects."""
    if not has_cdr_table():
        return []

    query = text(
        """
        SELECT uniqueid, calldate, src, dst, billsec, disposition
        FROM cdr
        ORDER BY calldate DESC
        LIMIT :limit
        """
    )

    try:
        with engine.connect() as connection:
            rows = connection.execute(query, {"limit": limit}).mappings().all()
    except Exception:
        return []

    calls = []
    for index, row in enumerate(rows):
        started_at = row["calldate"] or datetime.now(timezone.utc)
        if started_at.tzinfo is None:
            # Stored as UTC (usegmtime=yes); tell the browser explicitly.
            started_at = started_at.replace(tzinfo=timezone.utc)
        calls.append(
            {
                "id": str(row["uniqueid"] or f"cdr-{index}"),
                "started_at": started_at,
                "caller": str(row["src"] or ""),
                "callee": str(row["dst"] or ""),
                "duration_sec": int(row["billsec"] or 0),
                "status": _status_for(row["disposition"]),
            }
        )
    return calls
