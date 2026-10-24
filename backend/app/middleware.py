"""HTTP middleware: correlation IDs, logging, metrics, CORS and auditing."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from typing import Awaitable, Callable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .metrics import Metrics
from .models import AuditLog
from .responses import GoJSONResponse

log = logging.getLogger("asterisk.http")

MAX_BODY = 2 << 20  # 2 MiB
_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
_INT_RE = re.compile(r"/\d+(?=/|$)")


def route_pattern(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", "") if route is not None else ""
    if path:
        return path
    # Fallback for requests that never matched a route (404, 405).
    path = _UUID_RE.sub("{id}", request.url.path)
    path = _INT_RE.sub("/{id}", path)
    return path


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    real = request.headers.get("x-real-ip", "").strip()
    if real:
        return real
    client = request.scope.get("client")
    if client:
        return str(client[0])
    return ""


def _audit_action(method: str, pattern: str) -> str:
    lower = pattern.lower()
    if "/restore" in lower:
        return "restore"
    if "/reload" in lower:
        return "reload"
    if "/password" in lower:
        return "password_reset"
    if lower.endswith("/pause") or lower.endswith("/resume"):
        return "update"
    return {
        "POST": "create",
        "PUT": "update",
        "PATCH": "update",
        "DELETE": "delete",
    }.get(method, method.lower())


def _entity_from_pattern(pattern: str) -> str:
    trimmed = pattern.removeprefix("/api/v1/").strip("/")
    if not trimmed:
        return "unknown"
    return trimmed.split("/", 1)[0]


class LoginLimiter:
    """Ten login attempts per minute per client IP."""

    LIMIT = 10
    WINDOW = 60.0

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._windows: dict[str, tuple[float, int]] = {}

    def allow(self, ip: str) -> tuple[bool, float]:
        now = time.monotonic()
        with self._lock:
            if len(self._windows) > 5000:
                for key, (start, _) in list(self._windows.items()):
                    if now - start >= self.WINDOW:
                        self._windows.pop(key, None)
            entry = self._windows.get(ip)
            if entry is None or now - entry[0] >= self.WINDOW:
                self._windows[ip] = (now, 1)
                return True, 0.0
            start, count = entry
            if count >= self.LIMIT:
                return False, self.WINDOW - (now - start)
            self._windows[ip] = (start, count + 1)
            return True, 0.0

    def reset(self, ip: str) -> None:
        with self._lock:
            self._windows.pop(ip, None)


class AppMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, config, metrics: Metrics) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self.config = config
        self.metrics = metrics
        self._allowed = set(config.cors_origins)
        self._wildcard = "*" in self._allowed

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.perf_counter()

        request_id = (request.headers.get("x-request-id") or "").strip()
        if not request_id or len(request_id) > 128:
            request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        request.state.client_ip = client_ip(request)

        origin = request.headers.get("origin", "")
        cors_headers = self._cors_headers(origin)
        if request.method == "OPTIONS":
            response = Response(status_code=204)
            for key, value in cors_headers.items():
                response.headers[key] = value
            response.headers["X-Request-ID"] = request_id
            self._security_headers(response)
            return response

        if request.method in {"POST", "PUT", "PATCH"}:
            length = request.headers.get("content-length")
            if length and length.isdigit() and int(length) > MAX_BODY:
                response = GoJSONResponse(
                    {
                        "error": {
                            "code": "invalid_request",
                            "message": "request body is too large",
                        }
                    },
                    status_code=413,
                )
                self._finish_headers(response, request_id, cors_headers)
                return response

        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
        except Exception:
            log.exception(
                "unhandled request error",
                extra={"request_id": request_id, "path": request.url.path},
            )
            response = GoJSONResponse(
                {
                    "error": {
                        "code": "internal_error",
                        "message": "an internal error occurred",
                    }
                },
                status_code=500,
            )
        finally:
            duration = time.perf_counter() - started
            pattern = route_pattern(request)
            self.metrics.observe(request.method, pattern, status, duration)

        user = getattr(request.state, "user", None)
        log.info(
            "http request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "route": pattern,
                "status": status,
                "duration_ms": round(duration * 1000, 3),
                "ip": request.state.client_ip,
                "user": getattr(user, "username", ""),
                "request_id": request_id,
            },
        )

        self._finish_headers(response, request_id, cors_headers)
        self._write_audit(request, pattern, status, user)
        return response

    # ── helpers ───────────────────────────────────────────────────────────
    def _cors_headers(self, origin: str) -> dict[str, str]:
        headers: dict[str, str] = {}
        if not origin:
            return headers
        if self._wildcard:
            headers["Access-Control-Allow-Origin"] = "*"
        elif origin in self._allowed:
            headers["Access-Control-Allow-Origin"] = origin
            headers["Vary"] = "Origin"
        headers["Access-Control-Allow-Methods"] = (
            "GET,POST,PUT,PATCH,DELETE,OPTIONS"
        )
        headers["Access-Control-Allow-Headers"] = (
            "Authorization,Content-Type,X-Request-ID"
        )
        headers["Access-Control-Expose-Headers"] = "X-Request-ID,Content-Disposition"
        headers["Access-Control-Max-Age"] = "600"
        return headers

    @staticmethod
    def _security_headers(response: Response) -> None:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"

    def _finish_headers(
        self, response: Response, request_id: str, cors_headers: dict[str, str]
    ) -> None:
        response.headers["X-Request-ID"] = request_id
        for key, value in cors_headers.items():
            response.headers[key] = value
        self._security_headers(response)

    def _write_audit(
        self, request: Request, pattern: str, status: int, user: object | None
    ) -> None:
        if request.method in {"GET", "HEAD", "OPTIONS"} or user is None:
            return
        user_id = getattr(user, "id", None)
        username = getattr(user, "username", "")
        if not user_id:
            return
        details: dict[str, str] = {"route": pattern}
        if request.url.query:
            details["query"] = request.url.query
        entity_id = ""
        path_params = request.scope.get("path_params") or {}
        for key in ("id", "key"):
            value = path_params.get(key)
            if value:
                entity_id = str(value)
                break
        entry = AuditLog(
            user_id=str(user_id),
            username=username,
            action=_audit_action(request.method, pattern),
            entity_type=_entity_from_pattern(pattern),
            entity_id=entity_id,
            method=request.method,
            path=request.url.path,
            status_code=status,
            ip=request.state.client_ip,
            user_agent=request.headers.get("user-agent", ""),
            details=json.dumps(details, separators=(",", ":")),
        )
        session_factory = request.app.state.session_factory
        session = session_factory()
        try:
            session.add(entry)
            session.commit()
        except Exception:
            session.rollback()
            log.warning(
                "failed to write audit log",
                extra={"request_id": request.state.request_id},
            )
        finally:
            session.close()
