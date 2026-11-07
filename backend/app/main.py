"""FastAPI application entry point.

Start the server with:

    uvicorn app.main:app --reload --port 8000

All routes live under `/api`, which is what the React app and the nginx
container expect.
"""

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import models  # noqa: F401  (registers the tables on Base.metadata)
from . import pbx
from .config import settings
from .database import Base, SessionLocal, engine
from .routers import asterisk, audit, auth, dashboard, extensions, health, system, users
from .seed import seed_database

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def _create_tables() -> None:
    """Create tables, waiting for PostgreSQL during the first Compose start."""
    for attempt in range(1, 31):
        try:
            Base.metadata.create_all(bind=engine)
            return
        except OperationalError:
            if attempt == 30:
                raise
            logger.warning(
                "database not ready (attempt %s/30), retrying in 1 second", attempt
            )
            time.sleep(1)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _create_tables()

    with SessionLocal() as db:
        seed_database(db)
        try:
            pbx.write_configs(db)
        except Exception:
            # The API must stay usable even if the config volume is read-only.
            logger.exception("could not write generated Asterisk configuration")

    logger.info("backend ready")
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    lifespan=lifespan,
    docs_url=f"{settings.api_prefix}/docs",
    openapi_url=f"{settings.api_prefix}/openapi.json",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_request, exc: StarletteHTTPException) -> JSONResponse:
    """The frontend reads `message`, so never return FastAPI's `detail` key."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"message": str(exc.detail)},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    first = errors[0] if errors else {}
    location = ".".join(
        str(part)
        for part in first.get("loc", ())
        if part not in ("body", "query", "path")
    )
    message = str(first.get("msg", "Invalid request")).replace("Value error, ", "")
    if location:
        message = f"{location}: {message}"
    return JSONResponse(status_code=422, content={"message": message})


for router in (
    health.router,
    auth.router,
    users.router,
    extensions.router,
    dashboard.router,
    system.router,
    asterisk.router,
    audit.router,
):
    app.include_router(router, prefix=settings.api_prefix)
