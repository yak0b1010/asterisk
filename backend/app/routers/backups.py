"""Backup metadata, download, restore and deletion endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..backup import BackupError
from ..deps import get_current_user, get_db, require_permission
from ..models import Backup, User, utcnow
from ..responses import (
    backup_response,
    bad_request,
    go_time,
    not_found,
    pagination,
    parse_uuid,
    read_json,
    reject_unknown,
    respond,
    respond_error,
    respond_list,
)

log = logging.getLogger("asterisk.backups")

router = APIRouter(
    prefix="/api/v1/backups",
    tags=["backups"],
    dependencies=[Depends(get_current_user)],
)

_CREATE_FIELDS = {"include_cdr"}


def _find(session: Session, backup_id: str) -> Backup:
    if not parse_uuid(backup_id):
        raise bad_request("id must be a valid UUID")
    meta = session.get(Backup, backup_id)
    if meta is None:
        raise not_found("backup")
    return meta


@router.get("")
@router.get("/")
def list_backups(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("backups.read")),
):
    page, limit, offset = pagination(request)
    conditions = []
    status = (request.query_params.get("status") or "").strip()
    if status:
        conditions.append(Backup.status == status)
    total = session.scalar(
        select(func.count()).select_from(Backup).where(*conditions)
    ) or 0
    backups = session.scalars(
        select(Backup)
        .where(*conditions)
        .order_by(Backup.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return respond_list(
        [backup_response(meta) for meta in backups], page, limit, total
    )


@router.post("", status_code=201)
@router.post("/", status_code=201)
async def create_backup(
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("backups.write")),
):
    body = await read_json(request, allow_empty=True)
    reject_unknown(body, _CREATE_FIELDS)
    include_cdr = body.get("include_cdr", False)
    if not isinstance(include_cdr, bool):
        raise bad_request("invalid JSON body: field include_cdr must be a boolean")
    manager = request.app.state.backups
    try:
        meta = manager.create(actor.username, include_cdr)
    except Exception as exc:
        log.exception("backup could not be started")
        return respond_error(
            500,
            "backup_failed",
            "backup could not be completed",
            {"error": str(exc)},
        )
    if meta.status == "failed":
        return respond_error(
            500,
            "backup_failed",
            "backup could not be completed",
            {"backup_id": meta.id, "error": meta.error},
        )
    return respond(backup_response(meta), status=201)


@router.get("/{backup_id}")
def get_backup(
    backup_id: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("backups.read")),
):
    return respond(backup_response(_find(session, backup_id)))


@router.get("/{backup_id}/download")
def download_backup(
    backup_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("backups.read")),
):
    meta = _find(session, backup_id)
    if not meta.filename:
        raise not_found("backup file")
    try:
        path = request.app.state.backups.path(meta)
    except BackupError:
        return respond_error(500, "internal_error", "an internal error occurred")
    if not path.is_file():
        raise not_found("backup file")
    return FileResponse(
        path,
        media_type="application/gzip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{meta.filename}"'
            )
        },
    )


@router.post("/{backup_id}/restore")
def restore_backup(
    backup_id: str,
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("backups.write")),
):
    meta = _find(session, backup_id)
    if meta.status != "completed":
        raise bad_request(
            "only completed backups can be restored", {"status": meta.status}
        )
    manager = request.app.state.backups
    try:
        manager.restore(meta)
    except BackupError as exc:
        return respond_error(
            500,
            "restore_failed",
            "backup could not be restored",
            {"backup_id": meta.id, "error": str(exc)},
        )
    except Exception as exc:
        log.exception("backup restore failed")
        return respond_error(
            500,
            "restore_failed",
            "backup could not be restored",
            {"backup_id": meta.id, "error": str(exc)},
        )

    realtime_synced = True
    realtime_error = ""
    restore_session = request.app.state.session_factory()
    try:
        request.app.state.realtime.sync_all(restore_session)
    except Exception as exc:
        realtime_synced = False
        realtime_error = str(exc)
        log.error(
            "failed to rebuild realtime tables after restore: %s", exc
        )
    finally:
        restore_session.close()

    log.info(
        "configuration restored from backup",
        extra={
            "backup_id": meta.id,
            "backup_filename": meta.filename,
            "username": actor.username,
        },
    )
    return respond(
        {
            "restored": True,
            "backup_id": meta.id,
            "filename": meta.filename,
            "restored_at": go_time(utcnow()),
            "includes_cdr": "cdr" in (meta.includes or "").split(","),
            "realtime_synced": realtime_synced,
            "realtime_error": realtime_error,
        }
    )


@router.delete("/{backup_id}")
def delete_backup(
    backup_id: str,
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("backups.write")),
):
    meta = _find(session, backup_id)
    try:
        request.app.state.backups.delete(meta)
    except BackupError as exc:
        return respond_error(500, "internal_error", str(exc))
    except Exception as exc:
        log.exception("failed to delete backup file")
        return respond_error(500, "internal_error", "an internal error occurred")
    session.delete(meta)
    session.commit()
    from ..responses import no_content

    return no_content()
