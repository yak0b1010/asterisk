"""Shared router helpers."""

from __future__ import annotations

from typing import Any

from fastapi import Request

from ..responses import respond, respond_error
from ..telephony import NotConfigured


def reload_asterisk(request: Request, component: str):
    """Best-effort reload: an unconfigured AMI is not an API failure."""
    telephony = request.app.state.telephony
    try:
        telephony.reload(component)
    except NotConfigured:
        return respond(
            {
                "reloaded": False,
                "component": component,
                "configured": False,
                "message": (
                    "Asterisk AMI is not configured; configuration was stored "
                    "in PostgreSQL only"
                ),
            }
        )
    except Exception as exc:
        return respond_error(
            502,
            "asterisk_unavailable",
            f"Asterisk reload failed: {exc}",
            {"component": component},
        )
    return respond({"reloaded": True, "component": component, "configured": True})


def asterisk_unavailable(exc: Exception):
    return respond_error(502, "asterisk_unavailable", str(exc))


def not_configured_payload(**extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"configured": False}
    payload.update(extra)
    return payload
