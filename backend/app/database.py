"""Database engine, migrations and bootstrap data."""

from __future__ import annotations

import json
import logging
import re
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Generator, Iterator

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from .auth import hash_password
from .config import Config
from .models import Setting, User, utcnow

log = logging.getLogger("asterisk.database")

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def build_engine(cfg: Config) -> Engine:
    return create_engine(
        cfg.database.dsn(),
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_timeout=30,
        pool_recycle=1800,
        future=True,
    )


def build_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


def wait_for_database(engine: Engine, attempts: int = 20, delay: float = 1.0) -> None:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except OperationalError as exc:  # pragma: no cover - depends on startup race
            last_error = exc
            log.warning("database not ready (attempt %s/%s)", attempt, attempts)
            time.sleep(delay)
    raise RuntimeError(f"database did not become ready: {last_error}")


def _strip_sql_comments(sql: str) -> str:
    lines = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        lines.append(line)
    return "\n".join(lines)


def _split_statements(sql: str) -> list[str]:
    """Split a migration into individual statements.

    The migration files only contain plain DDL and comments (no functions or
    dollar-quoted bodies), so a semicolon split is sufficient and keeps every
    statement idempotent when executed through the driver.
    """
    body = _strip_sql_comments(sql)
    return [part.strip() for part in re.split(r";\s*(?:\n|$)", body) if part.strip()]


def run_migrations(engine: Engine) -> None:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no migrations found in {MIGRATIONS_DIR}")
    with engine.begin() as conn:
        for path in files:
            sql = path.read_text(encoding="utf-8")
            for statement in _split_statements(sql):
                conn.exec_driver_sql(statement)
            log.info("applied migration %s", path.name)


def seed(session: Session, cfg: Config) -> None:
    count = session.scalar(select(func.count()).select_from(User)) or 0
    if count == 0:
        admin = User(
            username=cfg.admin.username,
            email=cfg.admin.email,
            full_name="System Administrator",
            password_hash=hash_password(cfg.admin.password),
            role="admin",
            active=True,
        )
        session.add(admin)
        session.commit()
        log.info("bootstrap administrator created: %s", cfg.admin.username)

    defaults = [
        ("pbx.name", "Asterisk Appliance", "Display name of the PBX"),
        ("pbx.fqdn", "asterisk.local", "PBX FQDN used by SIP clients"),
        ("pbx.context", "internal", "Default dialplan context"),
        ("pbx.transport", "transport-udp", "PJSIP transport for endpoints"),
        ("ui.timezone", "UTC", "Timezone used by reports"),
        ("backup.retention_days", 30, "Days to keep backup files"),
        ("cdr.retention_days", 365, "Days to keep call detail records"),
    ]
    now = utcnow()
    for key, value, description in defaults:
        stmt = (
            pg_insert(Setting)
            .values(
                key=key,
                value=json.dumps(value),
                description=description,
                updated_by="",
                updated_at=now,
            )
            .on_conflict_do_nothing(index_elements=["key"])
        )
        session.execute(stmt)
    session.commit()


def ping(engine: Engine) -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:  # pragma: no cover - diagnostic path
        return False


def pool_stats(engine: Engine) -> dict[str, float | int]:
    pool = engine.pool
    return {
        "open": pool.checkedout() + pool.checkedin(),
        "in_use": pool.checkedout(),
        "idle": pool.checkedin(),
        "max_open": pool.size() + pool.overflow(),
        "wait_count": 0,
        "wait_duration_s": 0.0,
    }


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session(factory: sessionmaker[Session]) -> Generator[Session, None, None]:
    session = factory()
    try:
        yield session
    finally:
        session.close()


def is_unique_violation(exc: BaseException) -> bool:
    if isinstance(exc, IntegrityError):
        original = getattr(exc, "orig", None)
        state = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
        if state == "23505":
            return True
        return "duplicate key" in str(exc).lower()
    return False
