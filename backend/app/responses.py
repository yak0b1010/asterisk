"""Response envelopes, serializers and request parsing helpers."""

from __future__ import annotations

import json
import math
import secrets
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable, Mapping, Optional

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from .auth import has_permission
from .models import (
    AuditLog,
    Backup,
    CDR,
    ConferenceRoom,
    DialplanRule,
    Extension,
    IVRMenu,
    IVRMenuOption,
    Queue,
    QueueMember,
    RefreshToken,
    Setting,
    User,
    VoicemailBox,
)

UTC = timezone.utc


class APIError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def bad_request(message: str, details: Any | None = None) -> APIError:
    return APIError(400, "invalid_request", message, details)


def not_found(entity: str) -> APIError:
    return APIError(404, "not_found", f"{entity} not found")


def conflict(message: str) -> APIError:
    return APIError(409, "conflict", message)


def internal_error() -> APIError:
    return APIError(500, "internal_error", "an internal error occurred")


def go_time(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    value = value.astimezone(UTC)
    base = value.strftime("%Y-%m-%dT%H:%M:%S")
    if value.microsecond:
        base += "." + f"{value.microsecond:06d}".rstrip("0")
    return base + "Z"


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return go_time(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, time):
        return value.isoformat()
    if isinstance(value, set):
        return sorted(value)
    return value


class GoJSONEncoder(json.JSONEncoder):
    def default(self, o: Any) -> Any:
        converted = _json_value(o)
        if converted is not o:
            return converted
        return super().default(o)


class GoJSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"

    def render(self, content: Any) -> bytes:
        return json.dumps(
            content,
            cls=GoJSONEncoder,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")


def respond(data: Any, status: int = 200) -> GoJSONResponse:
    return GoJSONResponse({"data": data}, status_code=status)


def respond_list(
    data: Any, page: int, limit: int, total: int, status: int = 200
) -> GoJSONResponse:
    pages = math.ceil(total / limit) if limit > 0 else 0
    return GoJSONResponse(
        {
            "data": data,
            "meta": {"page": page, "limit": limit, "total": total, "pages": pages},
        },
        status_code=status,
    )


def respond_error(
    status: int,
    code: str,
    message: str,
    details: Any | None = None,
    headers: dict[str, str] | None = None,
) -> GoJSONResponse:
    payload: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        payload["details"] = details
    return GoJSONResponse(
        {"error": payload}, status_code=status, headers=headers
    )


def no_content() -> Response:
    return Response(status_code=204)


def _text(value: Any) -> str:
    return "" if value is None else str(value)


def user_response(user: User) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": user.id,
        "username": user.username,
        "email": _text(user.email),
        "full_name": _text(user.full_name),
        "role": user.role,
        "active": bool(user.active),
        "created_at": go_time(user.created_at),
        "updated_at": go_time(user.updated_at),
    }
    if user.last_login_at is not None:
        payload["last_login_at"] = go_time(user.last_login_at)
    return payload


def session_response(token: RefreshToken) -> dict[str, Any]:
    return {
        "id": token.id,
        "ip": _text(token.ip),
        "user_agent": _text(token.user_agent),
        "created_at": go_time(token.created_at),
        "expires_at": go_time(token.expires_at),
    }


def extension_response(ext: Extension, user: User | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": ext.id,
        "number": ext.number,
        "display_name": _text(ext.display_name),
    }
    if ext.user_id:
        payload["user_id"] = ext.user_id
    payload.update(
        {
            "context": ext.context,
            "codecs": ext.codecs,
        }
    )
    if ext.caller_id:
        payload["caller_id"] = ext.caller_id
    payload.update(
        {
            "voicemail_enabled": bool(ext.voicemail_enabled),
            "enabled": bool(ext.enabled),
        }
    )
    if ext.description:
        payload["description"] = ext.description
    if user is not None and has_permission(user.role, "extensions.credentials"):
        if ext.sip_password:
            payload["sip_password"] = ext.sip_password
        if ext.voicemail_pin:
            payload["voicemail_pin"] = ext.voicemail_pin
    payload["created_at"] = go_time(ext.created_at)
    payload["updated_at"] = go_time(ext.updated_at)
    return payload


def dialplan_response(rule: DialplanRule) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": rule.id,
        "created_at": go_time(rule.created_at),
        "updated_at": go_time(rule.updated_at),
        "context": rule.context,
        "pattern": rule.pattern,
        "priority": rule.priority,
        "app": rule.app,
        "app_data": _text(rule.app_data),
    }
    if rule.description:
        payload["description"] = rule.description
    payload["enabled"] = bool(rule.enabled)
    return payload


def voicemail_response(box: VoicemailBox, user: User | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": box.id,
        "extension": box.extension,
        "context": box.context,
        "name": _text(box.name),
    }
    if box.email:
        payload["email"] = box.email
    if box.time_zone:
        payload["timezone"] = box.time_zone
    payload.update(
        {
            "max_messages": box.max_messages,
            "active": bool(box.active),
        }
    )
    if user is not None and has_permission(user.role, "extensions.credentials"):
        if box.pin:
            payload["pin"] = box.pin
    payload["created_at"] = go_time(box.created_at)
    payload["updated_at"] = go_time(box.updated_at)
    return payload


def queue_member_response(member: QueueMember) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": member.id,
        "queue_id": member.queue_id,
        "interface": member.interface,
    }
    if member.member_name:
        payload["member_name"] = member.member_name
    payload.update(
        {
            "penalty": member.penalty,
            "paused": bool(member.paused),
            "created_at": go_time(member.created_at),
            "updated_at": go_time(member.updated_at),
        }
    )
    return payload


def queue_response(
    queue: Queue,
    members_count: int,
    members: Iterable[QueueMember] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": queue.id,
        "name": queue.name,
        "strategy": queue.strategy,
        "timeout": queue.timeout,
    }
    if queue.music_on_hold:
        payload["music_on_hold"] = queue.music_on_hold
    payload.update(
        {
            "ring_in_use": bool(queue.ring_in_use),
            "max_wait": queue.max_wait,
        }
    )
    if queue.announce:
        payload["announce"] = queue.announce
    payload.update(
        {
            "announce_frequency": queue.announce_frequency,
        }
    )
    if queue.description:
        payload["description"] = queue.description
    payload.update(
        {
            "active": bool(queue.active),
            "members_count": members_count,
            "created_at": go_time(queue.created_at),
            "updated_at": go_time(queue.updated_at),
        }
    )
    if members is not None:
        payload["members"] = [queue_member_response(member) for member in members]
    return payload


def ivr_option_response(option: IVRMenuOption) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": option.id,
        "menu_id": option.menu_id,
        "digit": option.digit,
        "destination_type": option.destination_type,
        "destination": option.destination,
    }
    if option.description:
        payload["description"] = option.description
    payload["sort_order"] = option.sort_order
    return payload


def ivr_response(menu: IVRMenu, options: Iterable[IVRMenuOption]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": menu.id,
        "name": menu.name,
    }
    if menu.description:
        payload["description"] = menu.description
    payload["greeting_sound"] = _text(menu.greeting_sound)
    if menu.invalid_sound:
        payload["invalid_sound"] = menu.invalid_sound
    payload.update(
        {
            "timeout": menu.timeout,
            "max_attempts": menu.max_attempts,
            "active": bool(menu.active),
            "options": [ivr_option_response(option) for option in options],
            "created_at": go_time(menu.created_at),
            "updated_at": go_time(menu.updated_at),
        }
    )
    return payload


def conference_response(room: ConferenceRoom, user: User | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": room.id,
        "number": room.number,
        "name": _text(room.name),
        "max_members": room.max_members,
        "muted": bool(room.muted),
        "record": bool(room.record),
        "active": bool(room.active),
    }
    if room.description:
        payload["description"] = room.description
    if user is not None and has_permission(user.role, "extensions.credentials"):
        if room.pin:
            payload["pin"] = room.pin
    payload["created_at"] = go_time(room.created_at)
    payload["updated_at"] = go_time(room.updated_at)
    return payload


def cdr_response(record: CDR) -> dict[str, Any]:
    return {
        "id": record.id,
        "calldate": go_time(record.calldate),
        "clid": _text(record.clid),
        "src": _text(record.src),
        "dst": _text(record.dst),
        "dcontext": _text(record.dcontext),
        "channel": _text(record.channel),
        "dstchannel": _text(record.dstchannel),
        "lastapp": _text(record.lastapp),
        "lastdata": _text(record.lastdata),
        "duration": record.duration,
        "billsec": record.billsec,
        "disposition": _text(record.disposition),
        "amaflags": record.amaflags,
        "accountcode": _text(record.accountcode),
        "uniqueid": _text(record.uniqueid),
        "userfield": _text(record.userfield),
        "peeraccount": _text(record.peeraccount),
        "linkedid": _text(record.linkedid),
        "sequence": record.sequence,
    }


def audit_response(entry: AuditLog) -> dict[str, Any]:
    payload: dict[str, Any] = {"id": entry.id}
    if entry.user_id:
        payload["user_id"] = entry.user_id
    payload.update(
        {
            "username": _text(entry.username),
            "action": _text(entry.action),
            "entity_type": _text(entry.entity_type),
        }
    )
    if entry.entity_id:
        payload["entity_id"] = entry.entity_id
    payload.update(
        {
            "method": _text(entry.method),
            "path": _text(entry.path),
            "status_code": entry.status_code,
            "ip": _text(entry.ip),
        }
    )
    if entry.user_agent:
        payload["user_agent"] = entry.user_agent
    if entry.details:
        payload["details"] = entry.details
    payload["created_at"] = go_time(entry.created_at)
    return payload


def setting_response(setting: Setting) -> dict[str, Any]:
    try:
        value = json.loads(setting.value)
    except (TypeError, ValueError):
        value = setting.value
    payload: dict[str, Any] = {
        "key": setting.key,
        "value": value,
    }
    if setting.description:
        payload["description"] = setting.description
    if setting.updated_by:
        payload["updated_by"] = setting.updated_by
    payload["updated_at"] = go_time(setting.updated_at)
    return payload


def backup_response(meta: Backup) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": meta.id,
        "created_at": go_time(meta.created_at),
        "updated_at": go_time(meta.updated_at),
        "filename": meta.filename,
        "size_bytes": meta.size_bytes,
        "status": meta.status,
        "includes": _text(meta.includes),
    }
    if meta.error:
        payload["error"] = meta.error
    payload["created_by"] = _text(meta.created_by)
    if meta.completed_at is not None:
        payload["completed_at"] = go_time(meta.completed_at)
    return payload


# ── request helpers ──────────────────────────────────────────────────────


async def read_json(request: Request, allow_empty: bool = False) -> dict[str, Any]:
    body = await request.body()
    if not body or not body.strip():
        if allow_empty:
            return {}
        raise bad_request("invalid JSON body: EOF")
    try:
        value = json.loads(body)
    except ValueError as exc:
        raise bad_request(f"invalid JSON body: {exc}") from exc
    if not isinstance(value, dict):
        raise bad_request("invalid JSON body: request body must contain a single JSON object")
    return value


def reject_unknown(body: Mapping[str, Any], allowed: Iterable[str]) -> None:
    allowed_set = set(allowed)
    for key in body:
        if key not in allowed_set:
            raise bad_request(f'invalid JSON body: json: unknown field "{key}"')


def to_str(body: Mapping[str, Any], key: str, default: str = "") -> str:
    value = body.get(key)
    if value is None:
        return default
    if not isinstance(value, str):
        raise bad_request(f"invalid JSON body: field {key} must be a string")
    return value


def to_optional_str(body: Mapping[str, Any], key: str) -> Optional[str]:
    if key not in body or body[key] is None:
        return None
    value = body[key]
    if not isinstance(value, str):
        raise bad_request(f"invalid JSON body: field {key} must be a string")
    return value


def to_int(body: Mapping[str, Any], key: str, default: int = 0) -> int:
    value = body.get(key)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise bad_request(f"invalid JSON body: field {key} must be an integer")
    if isinstance(value, float) and not value.is_integer():
        raise bad_request(f"invalid JSON body: field {key} must be an integer")
    return int(value)


def to_optional_int(body: Mapping[str, Any], key: str) -> Optional[int]:
    if key not in body or body[key] is None:
        return None
    return to_int(body, key)


def to_bool(body: Mapping[str, Any], key: str, default: bool = False) -> bool:
    value = body.get(key)
    if value is None:
        return default
    if not isinstance(value, bool):
        raise bad_request(f"invalid JSON body: field {key} must be a boolean")
    return value


def to_optional_bool(body: Mapping[str, Any], key: str) -> Optional[bool]:
    if key not in body or body[key] is None:
        return None
    value = body[key]
    if not isinstance(value, bool):
        raise bad_request(f"invalid JSON body: field {key} must be a boolean")
    return value


def pagination(request: Request) -> tuple[int, int, int]:
    def _int(key: str, fallback: int) -> int:
        raw = (request.query_params.get(key) or "").strip()
        if not raw:
            return fallback
        try:
            return int(raw)
        except ValueError:
            return fallback

    page = _int("page", 1)
    if page < 1:
        page = 1
    limit = _int("limit", 50)
    if limit < 1:
        limit = 50
    if limit > 200:
        limit = 200
    return page, limit, (page - 1) * limit


def query_int(request: Request, key: str, fallback: int) -> int:
    raw = (request.query_params.get(key) or "").strip()
    if not raw:
        return fallback
    try:
        return int(raw)
    except ValueError:
        return fallback


def query_bool(request: Request, key: str) -> tuple[bool, bool]:
    raw = (request.query_params.get(key) or "").strip().lower()
    if raw == "":
        return False, False
    if raw in {"1", "true", "t", "yes", "y"}:
        return True, True
    if raw in {"0", "false", "f", "no", "n"}:
        return False, True
    return False, False


def parse_time_bound(raw: str, end_of_day: bool) -> tuple[datetime, bool, bool]:
    raw = (raw or "").strip()
    if not raw:
        return datetime.min.replace(tzinfo=UTC), False, False
    if len(raw) == 10:
        try:
            parsed = datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=UTC)
            if end_of_day:
                return parsed + timedelta(days=1), True, True
            return parsed, False, True
        except ValueError:
            pass
    text = raw.replace("Z", "+00:00")
    for parser in (
        lambda value: datetime.fromisoformat(value),
        lambda value: datetime.strptime(value, "%Y-%m-%d %H:%M:%S"),
        lambda value: datetime.strptime(value, "%Y-%m-%dT%H:%M:%S"),
    ):
        try:
            parsed = parser(text)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC), False, True
        except (ValueError, TypeError):
            continue
    return datetime.min.replace(tzinfo=UTC), False, False


def parse_time_query(request: Request, key: str) -> tuple[datetime | None, bool]:
    raw = (request.query_params.get(key) or "").strip()
    if not raw:
        return None, True
    text = raw.replace("Z", "+00:00")
    for parser in (datetime.fromisoformat,):
        try:
            parsed = parser(text)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC), True
        except ValueError:
            continue
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=UTC)
        return parsed, True
    except ValueError:
        return None, False


def clean(value: str, maximum: int) -> str:
    value = (value or "").strip()
    if maximum > 0 and len(value) > maximum:
        value = value[:maximum]
    return value


def valid_email(value: str) -> bool:
    if value == "":
        return True
    at = value.rfind("@")
    if at <= 0 or at >= len(value) - 1:
        return False
    return not any(ch in " \t\r\n" for ch in value)


def valid_number(value: str, minimum: int, maximum: int) -> bool:
    if len(value) < minimum or len(value) > maximum:
        return False
    return value.isdigit()


def valid_username(value: str) -> bool:
    if len(value) < 3 or len(value) > 40:
        return False
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.")
    return all(ch in allowed for ch in value)


def valid_slug(value: str, maximum: int) -> bool:
    if not value or len(value) > maximum:
        return False
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.")
    return all(ch in allowed for ch in value)


def normalize_codecs(raw: str) -> str:
    raw = (raw or "").strip()
    if raw == "":
        return "ulaw,alaw,opus,g722"
    out: list[str] = []
    seen: set[str] = set()
    for part in raw.split(","):
        codec = part.strip().lower()
        if not codec or not valid_slug(codec, 32) or codec in seen:
            continue
        seen.add(codec)
        out.append(codec)
    return ",".join(out)


def random_secret(length: int) -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def parse_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def require_uuid(value: str, field: str = "id") -> str:
    if not parse_uuid(value):
        raise bad_request(f"{field} must be a valid UUID")
    return value


def parse_positive_int(value: str, field: str = "id") -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise bad_request(f"{field} must be a positive integer") from exc
    if number < 0:
        raise bad_request(f"{field} must be a positive integer")
    return number
