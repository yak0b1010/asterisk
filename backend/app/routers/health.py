"""Liveness/readiness endpoint used by Docker Compose.

The API stays healthy when Asterisk is offline; the response simply reports
`"asterisk": "down"`.  That keeps the web interface available for diagnostics.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import asterisk
from ..database import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:
        database = "error"

    snapshot = asterisk.snapshot()
    return {
        "status": "ok" if database == "ok" else "degraded",
        "database": database,
        "asterisk": "up" if snapshot["reachable"] else "down",
    }
