"""Database engine and session management.

The backend uses SQLAlchemy's "sync" mode because it is the easiest style to
read.  FastAPI runs these functions in a thread pool, so the API stays fast.
"""

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

url = settings.sqlalchemy_url

# SQLite needs a special flag because FastAPI may use different threads.
connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}

# Create the local SQLite directory when needed.
if url.startswith("sqlite:///"):
    Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Base class for all database models."""


def get_db():
    """FastAPI dependency that gives one database session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
