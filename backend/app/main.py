"""FastAPI application wiring for the Asterisk appliance backend."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .auth import TokenService
from .backup import BackupManager
from .config import Config, load_config
from .database import (
    build_engine,
    build_session_factory,
    run_migrations,
    seed,
    wait_for_database,
)
from .metrics import Metrics
from .middleware import AppMiddleware, LoginLimiter
from .monitor import Collector
from .realtime import RealtimeService
from .responses import APIError, respond_error
from .routers import (
    audit,
    auth,
    backups,
    cdr,
    conferences,
    dashboard,
    dialplan,
    extensions,
    health,
    ivr,
    monitoring,
    queues,
    settings,
    users,
    voicemail,
)
from .telephony import TelephonyService

VERSION = "dev"

log = logging.getLogger("asterisk")


def _configure_logging(level: str) -> None:
    numeric = getattr(logging, (level or "info").upper(), logging.INFO)
    logging.basicConfig(
        level=numeric,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def _read_openapi() -> bytes:
    path = Path(__file__).resolve().parent / "openapi.yaml"
    try:
        return path.read_bytes()
    except OSError:
        log.warning("openapi.yaml is missing at %s", path)
        return b"openapi: 3.0.3\ninfo:\n  title: Asterisk Backend API\n  version: dev\n"


def create_app(config: Config | None = None) -> FastAPI:
    cfg = config or load_config()
    _configure_logging(cfg.log_level)

    engine = build_engine(cfg)
    session_factory = build_session_factory(engine)
    metrics = Metrics()
    monitor = Collector()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        wait_for_database(engine)
        if cfg.auto_migrate:
            started = time.monotonic()
            run_migrations(engine)
            log.info(
                "database schema is up to date in %.0f ms",
                (time.monotonic() - started) * 1000,
            )
        with session_factory() as session:
            seed(session, cfg)
        app.state.telephony = TelephonyService(cfg.asterisk)
        app.state.realtime = RealtimeService(cfg.asterisk.transport)
        app.state.backups = BackupManager(session_factory, cfg.data_dir)
        log.info(
            "asterisk backend ready env=%s database=%s",
            cfg.env,
            cfg.database.redacted(),
        )
        try:
            yield
        finally:
            app.state.telephony.close()
            engine.dispose()

    app = FastAPI(
        title="Asterisk Appliance API",
        version=VERSION,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.config = cfg
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.metrics = metrics
    app.state.monitor = monitor
    app.state.limiter = LoginLimiter()
    app.state.tokens = TokenService(
        cfg.jwt.secret,
        cfg.jwt.issuer,
        cfg.jwt.audience,
        cfg.jwt.access_ttl,
        cfg.jwt.refresh_ttl,
    )
    app.state.started_at = time.time()
    app.state.openapi_spec = _read_openapi()
    # Services are created during startup; initialise placeholders so imports
    # and tests can inspect the state object before the lifespan runs.
    app.state.telephony = None
    app.state.realtime = None
    app.state.backups = None

    app.add_middleware(AppMiddleware, config=cfg, metrics=metrics)

    @app.exception_handler(APIError)
    async def handle_api_error(request: Request, exc: APIError):
        return respond_error(exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ):
        return respond_error(400, "invalid_request", "invalid request")

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException):
        if exc.status_code == 404:
            return respond_error(404, "not_found", "route not found")
        if exc.status_code == 405:
            return respond_error(405, "method_not_allowed", "method not allowed")
        message = exc.detail if isinstance(exc.detail, str) else "request failed"
        return respond_error(exc.status_code, "http_error", message)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(extensions.router)
    app.include_router(dialplan.router)
    app.include_router(voicemail.router)
    app.include_router(queues.router)
    app.include_router(ivr.router)
    app.include_router(conferences.router)
    app.include_router(cdr.router)
    app.include_router(monitoring.router)
    app.include_router(audit.router)
    app.include_router(settings.router)
    app.include_router(backups.router)
    app.include_router(dashboard.router)
    return app


app = create_app()
