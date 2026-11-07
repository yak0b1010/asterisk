"""Tiny audit-log helper.

The caller adds the entry to the same database transaction as the change it
describes.  That way the log and the data are always saved together.
"""

from sqlalchemy.orm import Session

from .models import AuditLog, User


def add_audit(
    db: Session,
    user: User | None,
    action: str,
    entity: str,
    detail: str = "",
) -> None:
    db.add(
        AuditLog(
            username=(user.username or user.full_name) if user else "system",
            action=action,
            entity=entity,
            detail=detail[:2000],
        )
    )
