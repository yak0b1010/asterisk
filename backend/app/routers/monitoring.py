"""Monitoring endpoints for the database and Asterisk control plane."""

from __future__ import annotations

import platform
import time

from fastapi import APIRouter, Depends, Request

from ..database import ping, pool_stats
from ..deps import get_current_user, require_permission
from ..models import User, utcnow
from ..responses import go_time, respond, respond_error
from ..telephony import NotConfigured

router = APIRouter(
    prefix="/api/v1/monitoring",
    tags=["monitoring"],
    dependencies=[
        Depends(get_current_user),
        Depends(require_permission("monitoring.read")),
    ],
)

VERSION = "dev"


@router.get("/status")
def monitoring_status(request: Request):
    engine = request.app.state.engine
    db_connected = ping(engine)
    asterisk = request.app.state.telephony.status()
    status = "ok"
    if (
        not db_connected
        or (asterisk["ami"]["configured"] and not asterisk["ami"]["connected"])
        or (asterisk["ari"]["configured"] and not asterisk["ari"]["connected"])
    ):
        status = "degraded"
    return respond(
        {
            "status": status,
            "version": VERSION,
            "uptime_seconds": time.time() - request.app.state.started_at,
            "database": {"connected": db_connected, "pool": pool_stats(engine)},
            "asterisk": asterisk,
            "time": go_time(utcnow()),
        }
    )


@router.get("/system")
def monitoring_system(request: Request):
    collector = request.app.state.monitor
    return respond(
        {
            "system": collector.snapshot(),
            "process": {
                "version": VERSION,
                "python_version": platform.python_version(),
                "uptime_seconds": collector.process_uptime(),
            },
        }
    )


@router.get("/asterisk")
def monitoring_asterisk(request: Request):
    telephony = request.app.state.telephony
    status = telephony.status()
    out = {
        "configured": (
            status["ami"]["configured"] or status["ari"]["configured"]
        ),
        "status": status,
    }
    if status["ami"]["configured"]:
        try:
            out["core"] = telephony.core_status()
        except Exception as exc:
            out["core_error"] = str(exc)
    try:
        out["version"] = telephony.version()
    except Exception:
        pass
    return respond(out)


@router.get("/calls")
def monitoring_calls(request: Request):
    try:
        calls, source = request.app.state.telephony.calls()
    except NotConfigured:
        return respond(
            {"configured": False, "source": "none", "calls": [], "count": 0}
        )
    except Exception as exc:
        return respond_error(502, "asterisk_unavailable", str(exc))
    return respond(
        {
            "configured": True,
            "source": source,
            "calls": calls,
            "count": len(calls),
        }
    )


@router.get("/endpoints")
def monitoring_endpoints(request: Request):
    try:
        endpoints, source = request.app.state.telephony.endpoints()
    except NotConfigured:
        return respond(
            {
                "configured": False,
                "source": "none",
                "endpoints": [],
                "count": 0,
            }
        )
    except Exception as exc:
        return respond_error(502, "asterisk_unavailable", str(exc))
    return respond(
        {
            "configured": True,
            "source": source,
            "endpoints": endpoints,
            "count": len(endpoints),
        }
    )


@router.get("/registrations")
def monitoring_registrations(request: Request):
    try:
        registrations = request.app.state.telephony.registrations()
    except NotConfigured:
        return respond(
            {"configured": False, "registrations": [], "count": 0}
        )
    except Exception as exc:
        return respond_error(502, "asterisk_unavailable", str(exc))
    return respond(
        {
            "configured": True,
            "registrations": registrations,
            "count": len(registrations),
        }
    )


@router.get("/queues")
def monitoring_queues(request: Request):
    try:
        queues = request.app.state.telephony.queues()
    except NotConfigured:
        return respond({"configured": False, "queues": [], "count": 0})
    except Exception as exc:
        return respond_error(502, "asterisk_unavailable", str(exc))
    return respond(
        {"configured": True, "queues": queues, "count": len(queues)}
    )


@router.get("/conferences")
def monitoring_conferences(request: Request):
    try:
        conferences = request.app.state.telephony.conferences()
    except NotConfigured:
        return respond(
            {"configured": False, "conferences": [], "count": 0}
        )
    except Exception as exc:
        return respond_error(502, "asterisk_unavailable", str(exc))
    return respond(
        {
            "configured": True,
            "conferences": conferences,
            "count": len(conferences),
        }
    )
