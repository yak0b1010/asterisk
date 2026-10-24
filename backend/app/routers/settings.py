"""Runtime settings endpoints."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, require_permission
from ..models import Setting, User, utcnow
from ..responses import (
    bad_request,
    clean,
    not_found,
    read_json,
    reject_unknown,
    respond,
    setting_response,
    to_optional_str,
    valid_slug,
)

router = APIRouter(
    prefix="/api/v1/settings",
    tags=["settings"],
    dependencies=[Depends(get_current_user)],
)

_UPDATE_FIELDS = {"value", "description"}
MAX_VALUE_BYTES = 64 << 10


def _valid_key(key: str) -> bool:
    return valid_slug(key, 120)


@router.get("")
@router.get("/")
def list_settings(
    request: Request,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("settings.read")),
):
    stmt = select(Setting)
    search = (request.query_params.get("search") or "").strip()
    if search:
        like = f"%{search}%"
        stmt = stmt.where(
            or_(Setting.key.ilike(like), Setting.description.ilike(like))
        )
    settings = session.scalars(stmt.order_by(Setting.key.asc())).all()
    return respond([setting_response(setting) for setting in settings])


@router.get("/{key}")
def get_setting(
    key: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("settings.read")),
):
    if not _valid_key(key):
        raise bad_request("setting key is invalid")
    setting = session.get(Setting, key)
    if setting is None:
        raise not_found("setting")
    return respond(setting_response(setting))


@router.put("/{key}")
async def update_setting(
    key: str,
    request: Request,
    session: Session = Depends(get_db),
    actor: User = Depends(require_permission("settings.write")),
):
    if not _valid_key(key):
        raise bad_request("setting key is invalid")
    body = await read_json(request)
    reject_unknown(body, _UPDATE_FIELDS)
    if "value" not in body:
        raise bad_request("value is required")
    value = json.dumps(body["value"], ensure_ascii=False, separators=(",", ":"))
    if len(value.encode("utf-8")) > MAX_VALUE_BYTES:
        raise bad_request("value must be at most 64 KiB")

    existing = session.get(Setting, key)
    description = existing.description if existing is not None else ""
    supplied = to_optional_str(body, "description")
    if supplied is not None:
        description = clean(supplied, 255)

    now = utcnow()
    statement = (
        pg_insert(Setting)
        .values(
            key=key,
            value=value,
            description=description,
            updated_by=actor.username,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["key"],
            set_={
                "value": value,
                "description": description,
                "updated_by": actor.username,
                "updated_at": now,
            },
        )
    )
    session.execute(statement)
    session.commit()
    saved = session.get(Setting, key)
    if saved is None:
        raise not_found("setting")
    return respond(setting_response(saved))


@router.delete("/{key}")
def delete_setting(
    key: str,
    session: Session = Depends(get_db),
    _: User = Depends(require_permission("settings.write")),
):
    if not _valid_key(key):
        raise bad_request("setting key is invalid")
    result = session.execute(delete(Setting).where(Setting.key == key))
    if result.rowcount == 0:
        raise not_found("setting")
    session.commit()
    from ..responses import no_content

    return no_content()
