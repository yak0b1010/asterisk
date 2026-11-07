"""Audit log listing (admin only)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import AuditLog, User
from ..schemas import AuditLogOut

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditLogOut])
def list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles("admin")),
) -> list[AuditLogOut]:
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(limit).all()
    return [
        AuditLogOut(
            id=row.id,
            username=row.username,
            action=row.action,
            entity=row.entity,
            detail=row.detail,
            created_at=row.created_at,
        )
        for row in rows
    ]
