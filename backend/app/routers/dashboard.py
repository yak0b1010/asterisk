"""Dashboard summary: PBX status, extensions and call statistics."""

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import asterisk, cdr
from ..database import get_db
from ..deps import get_current_user
from ..models import Extension, User
from ..schemas import (
    AsteriskInfo,
    CallStats,
    DashboardSummary,
    ExtensionStats,
)

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/summary", response_model=DashboardSummary)
def summary(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> DashboardSummary:
    # One cached AMI snapshot provides status, active calls and contacts.
    snapshot = asterisk.snapshot()

    total_extensions = db.query(func.count(Extension.number)).scalar() or 0
    enabled_numbers = {
        number
        for (number,) in db.query(Extension.number)
        .filter(Extension.enabled.is_(True))
        .all()
    }
    registered = len(set(snapshot["registrations"]) & enabled_numbers)

    call_stats = cdr.call_stats_today()

    return DashboardSummary(
        asterisk=AsteriskInfo(
            status="running" if snapshot["reachable"] else "stopped",
            version=snapshot["version"],
            uptime_sec=snapshot["uptime_sec"],
        ),
        extensions=ExtensionStats(
            total=total_extensions,
            registered=registered,
        ),
        calls=CallStats(
            active=snapshot["active_calls"],
            today=call_stats["today"],
            answered=call_stats["answered"],
            missed=call_stats["missed"],
            avg_duration_sec=call_stats["avg_duration_sec"],
        ),
        recent_calls=cdr.recent_calls(8),
    )
