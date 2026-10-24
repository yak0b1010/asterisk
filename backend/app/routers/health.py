"""Health, readiness, metrics, API info and documentation routes."""

from __future__ import annotations

import platform
import time

from fastapi import APIRouter, Request
from fastapi.responses import Response

from ..database import ping
from ..models import utcnow
from ..responses import GoJSONResponse, go_time, respond

router = APIRouter(tags=["system"])

VERSION = "dev"

_DOCS_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>Asterisk Backend API</title>
<style>body{font-family:system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem;line-height:1.5}code{background:#eee;padding:.1rem .3rem}pre{background:#111;color:#eee;padding:1rem;overflow:auto}</style>
</head><body>
<h1>Asterisk Backend API v1</h1>
<p>OpenAPI document: <a href="/api/v1/openapi.yaml">/api/v1/openapi.yaml</a></p>
<p>Authenticate with <code>POST /api/v1/auth/login</code>, then send
<code>Authorization: Bearer &lt;access_token&gt;</code>.</p>
<pre>curl -s http://localhost:8080/api/v1/auth/login \\
  -H 'Content-Type: application/json' \\
  -d '{"username":"admin","password":"admin12345"}'</pre>
</body></html>"""


@router.get("/")
def root(request: Request):
    return respond(
        {
            "service": "asterisk-backend",
            "version": VERSION,
            "status": "ok",
            "time": go_time(utcnow()),
            "endpoints": {
                "health": "/health",
                "ready": "/ready",
                "metrics": "/metrics",
                "api": "/api/v1",
                "openapi": "/api/v1/openapi.yaml",
                "docs": "/api/v1/docs",
            },
        }
    )


@router.get("/health")
def health(request: Request):
    return GoJSONResponse(
        {
            "status": "ok",
            "service": "asterisk-backend",
            "version": VERSION,
            "time": go_time(utcnow()),
            "uptime_seconds": time.time() - request.app.state.started_at,
        }
    )


@router.get("/ready")
def ready(request: Request):
    checks = {"database": "up"}
    status = 200
    overall = "ready"
    if not ping(request.app.state.engine):
        checks["database"] = "down"
        status = 503
        overall = "not_ready"
    return GoJSONResponse(
        {"status": overall, "checks": checks, "time": go_time(utcnow())},
        status_code=status,
    )


@router.get("/metrics")
def prometheus(request: Request):
    db_up = 1.0 if ping(request.app.state.engine) else 0.0
    asterisk_up = 0.0
    config = request.app.state.config
    if config.asterisk.ami_password or config.asterisk.ari_password:
        try:
            status = request.app.state.telephony.status()
            if status["ami"]["connected"] or status["ari"]["connected"]:
                asterisk_up = 1.0
        except Exception:
            asterisk_up = 0.0
    body = request.app.state.metrics.render(
        {
            "asterisk_backend_db_up": db_up,
            "asterisk_backend_asterisk_up": asterisk_up,
            "asterisk_backend_build_info": 1.0,
        }
    )
    return Response(
        content=body, media_type="text/plain; version=0.0.4; charset=utf-8"
    )


@router.get("/api/v1")
@router.get("/api/v1/")
def api_info(request: Request):
    return respond(
        {
            "name": "Asterisk Appliance API",
            "version": VERSION,
            "api": "v1",
            "python_version": platform.python_version(),
            "time": go_time(utcnow()),
            "docs": "/api/v1/docs",
            "openapi": "/api/v1/openapi.yaml",
        }
    )


@router.get("/api/v1/openapi.yaml")
def openapi(request: Request):
    return Response(
        content=request.app.state.openapi_spec,
        media_type="application/yaml; charset=utf-8",
    )


@router.get("/api/v1/docs")
def docs():
    return Response(content=_DOCS_HTML, media_type="text/html; charset=utf-8")
