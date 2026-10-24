"""Configuration backup and restore.

The export is a gzip-compressed JSON document containing every configuration
table plus optional CDR rows.  Version 2 deliberately includes credentials that
the API never exposes (password hashes, SIP secrets and PINs) so a restored
appliance is byte-for-byte equivalent from the user's point of view.
"""

from __future__ import annotations

import gzip
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, sessionmaker

from .models import (
    Backup,
    CDR,
    ConferenceRoom,
    DialplanRule,
    Extension,
    IVRMenu,
    IVRMenuOption,
    Queue,
    QueueMember,
    Setting,
    User,
    VoicemailBox,
    utcnow,
)
from .responses import go_time

log = logging.getLogger("asterisk.backup")

FORMAT = "asterisk-appliance-backup"
VERSION = 2
MAX_RESTORE_BYTES = 256 << 20


class BackupError(Exception):
    pass


def _parse_time(value: Any, fallback: datetime | None = None) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        text = value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            if fallback is not None:
                return fallback
            raise BackupError(f"invalid timestamp in backup: {value!r}")
    else:
        if fallback is not None:
            return fallback
        raise BackupError("missing timestamp in backup")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _optional_time(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    return _parse_time(value)


def _text(value: Any) -> str:
    return "" if value is None else str(value)


def _bool(value: Any, default: bool = False) -> bool:
    return bool(default if value is None else value)


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _user_record(user: User) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": user.id,
        "created_at": go_time(user.created_at),
        "updated_at": go_time(user.updated_at),
        "username": user.username,
        "email": _text(user.email),
        "full_name": _text(user.full_name),
        "password_hash": user.password_hash,
        "role": user.role,
        "active": bool(user.active),
    }
    if user.last_login_at is not None:
        record["last_login_at"] = go_time(user.last_login_at)
    if user.last_login_ip:
        record["last_login_ip"] = user.last_login_ip
    return record


def _extension_record(ext: Extension) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": ext.id,
        "created_at": go_time(ext.created_at),
        "updated_at": go_time(ext.updated_at),
        "number": ext.number,
        "display_name": _text(ext.display_name),
        "context": ext.context,
        "codecs": ext.codecs,
        "sip_password": ext.sip_password,
        "voicemail_enabled": bool(ext.voicemail_enabled),
        "enabled": bool(ext.enabled),
    }
    if ext.user_id:
        record["user_id"] = ext.user_id
    if ext.caller_id:
        record["caller_id"] = ext.caller_id
    if ext.voicemail_pin:
        record["voicemail_pin"] = ext.voicemail_pin
    if ext.description:
        record["description"] = ext.description
    return record


def _voicemail_record(box: VoicemailBox) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": box.id,
        "created_at": go_time(box.created_at),
        "updated_at": go_time(box.updated_at),
        "extension": box.extension,
        "context": box.context,
        "name": _text(box.name),
        "pin": box.pin,
        "max_messages": box.max_messages,
        "active": bool(box.active),
    }
    if box.email:
        record["email"] = box.email
    if box.time_zone:
        record["timezone"] = box.time_zone
    return record


def _conference_record(room: ConferenceRoom) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": room.id,
        "created_at": go_time(room.created_at),
        "updated_at": go_time(room.updated_at),
        "number": room.number,
        "name": _text(room.name),
        "max_members": room.max_members,
        "muted": bool(room.muted),
        "record": bool(room.record),
        "active": bool(room.active),
    }
    if room.pin:
        record["pin"] = room.pin
    if room.description:
        record["description"] = room.description
    return record


def _dialplan_record(rule: DialplanRule) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": rule.id,
        "created_at": go_time(rule.created_at),
        "updated_at": go_time(rule.updated_at),
        "context": rule.context,
        "pattern": rule.pattern,
        "priority": rule.priority,
        "app": rule.app,
        "app_data": _text(rule.app_data),
        "enabled": bool(rule.enabled),
    }
    if rule.description:
        record["description"] = rule.description
    return record


def _queue_record(queue: Queue) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": queue.id,
        "created_at": go_time(queue.created_at),
        "updated_at": go_time(queue.updated_at),
        "name": queue.name,
        "strategy": queue.strategy,
        "timeout": queue.timeout,
        "ring_in_use": bool(queue.ring_in_use),
        "max_wait": queue.max_wait,
        "announce_frequency": queue.announce_frequency,
        "active": bool(queue.active),
    }
    if queue.music_on_hold:
        record["music_on_hold"] = queue.music_on_hold
    if queue.announce:
        record["announce"] = queue.announce
    if queue.description:
        record["description"] = queue.description
    return record


def _queue_member_record(member: QueueMember) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": member.id,
        "created_at": go_time(member.created_at),
        "updated_at": go_time(member.updated_at),
        "queue_id": member.queue_id,
        "interface": member.interface,
        "penalty": member.penalty,
        "paused": bool(member.paused),
    }
    if member.member_name:
        record["member_name"] = member.member_name
    return record


def _ivr_option_record(option: IVRMenuOption) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": option.id,
        "created_at": go_time(option.created_at),
        "updated_at": go_time(option.updated_at),
        "menu_id": option.menu_id,
        "digit": option.digit,
        "destination_type": option.destination_type,
        "destination": option.destination,
        "sort_order": option.sort_order,
    }
    if option.description:
        record["description"] = option.description
    return record


def _ivr_record(menu: IVRMenu, options: Iterable[IVRMenuOption]) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": menu.id,
        "created_at": go_time(menu.created_at),
        "updated_at": go_time(menu.updated_at),
        "name": menu.name,
        "greeting_sound": _text(menu.greeting_sound),
        "timeout": menu.timeout,
        "max_attempts": menu.max_attempts,
        "active": bool(menu.active),
    }
    if menu.description:
        record["description"] = menu.description
    if menu.invalid_sound:
        record["invalid_sound"] = menu.invalid_sound
    record["options"] = [_ivr_option_record(option) for option in options]
    return record


def _setting_record(setting: Setting) -> dict[str, Any]:
    record: dict[str, Any] = {
        "key": setting.key,
        "value": setting.value,
        "updated_at": go_time(setting.updated_at),
    }
    if setting.description:
        record["description"] = setting.description
    if setting.updated_by:
        record["updated_by"] = setting.updated_by
    return record


def _cdr_record(record: CDR) -> dict[str, Any]:
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


class BackupManager:
    def __init__(self, session_factory: sessionmaker[Session], data_dir: str) -> None:
        self.session_factory = session_factory
        self.dir = Path(data_dir).expanduser().resolve() / "backups"
        self.dir.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.dir, 0o700)
        except OSError:
            pass

    # ── export ────────────────────────────────────────────────────────────
    def create(self, username: str, include_cdr: bool) -> Backup:
        includes = "users,extensions,dialplan,voicemail,queues,ivr,conferences,settings"
        if include_cdr:
            includes += ",cdr"
        with self.session_factory() as session:
            meta = Backup(
                filename="",
                size_bytes=0,
                status="running",
                includes=includes,
                error="",
                created_by=username,
            )
            session.add(meta)
            session.commit()
            session.refresh(meta)
            meta_id = meta.id

        try:
            payload = self._collect(include_cdr)
            filename = (
                "backup-"
                + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
                + "-"
                + uuid.uuid4().hex[:8]
                + ".json.gz"
            )
            full = self.dir / filename
            data = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")
            with open(full, "xb") as raw:
                try:
                    os.chmod(full, 0o600)
                except OSError:
                    pass
                with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz:
                    gz.write(data)
                    gz.write(b"\n")
            size = full.stat().st_size

            with self.session_factory() as session:
                meta = session.get(Backup, meta_id)
                if meta is None:
                    raise BackupError("backup metadata disappeared")
                meta.filename = filename
                meta.size_bytes = size
                meta.status = "completed"
                meta.completed_at = utcnow()
                meta.updated_at = utcnow()
                session.commit()
                session.refresh(meta)
                return meta
        except Exception as exc:
            log.exception("backup failed")
            with self.session_factory() as session:
                meta = session.get(Backup, meta_id)
                if meta is not None:
                    meta.status = "failed"
                    meta.error = str(exc)
                    meta.updated_at = utcnow()
                    session.commit()
                    session.refresh(meta)
                    return meta
            raise

    def _collect(self, include_cdr: bool) -> dict[str, Any]:
        with self.session_factory() as session:
            users = session.scalars(select(User).order_by(User.created_at)).all()
            extensions = session.scalars(select(Extension).order_by(Extension.number)).all()
            rules = session.scalars(
                select(DialplanRule).order_by(
                    DialplanRule.context, DialplanRule.pattern, DialplanRule.priority
                )
            ).all()
            boxes = session.scalars(
                select(VoicemailBox).order_by(VoicemailBox.extension)
            ).all()
            queues = session.scalars(select(Queue).order_by(Queue.name)).all()
            members = session.scalars(
                select(QueueMember).order_by(QueueMember.queue_id, QueueMember.interface)
            ).all()
            menus = session.scalars(select(IVRMenu).order_by(IVRMenu.name)).all()
            options = session.scalars(
                select(IVRMenuOption).order_by(
                    IVRMenuOption.menu_id, IVRMenuOption.sort_order, IVRMenuOption.digit
                )
            ).all()
            rooms = session.scalars(
                select(ConferenceRoom).order_by(ConferenceRoom.number)
            ).all()
            settings = session.scalars(select(Setting).order_by(Setting.key)).all()
            cdr_rows = (
                session.scalars(select(CDR).order_by(CDR.calldate)).all()
                if include_cdr
                else []
            )

            by_menu: dict[str, list[IVRMenuOption]] = {}
            for option in options:
                by_menu.setdefault(option.menu_id, []).append(option)

            return {
                "format": FORMAT,
                "version": VERSION,
                "created_at": go_time(utcnow()),
                "includes_cdr": include_cdr,
                "users": [_user_record(user) for user in users],
                "extensions": [_extension_record(ext) for ext in extensions],
                "dialplan": [_dialplan_record(rule) for rule in rules],
                "voicemail": [_voicemail_record(box) for box in boxes],
                "queues": [_queue_record(queue) for queue in queues],
                "queue_members": [_queue_member_record(member) for member in members],
                "ivr_menus": [
                    _ivr_record(menu, by_menu.get(menu.id, [])) for menu in menus
                ],
                "conferences": [_conference_record(room) for room in rooms],
                "settings": [_setting_record(setting) for setting in settings],
                "cdr": [_cdr_record(row) for row in cdr_rows] if include_cdr else [],
            }

    # ── download/delete ───────────────────────────────────────────────────
    def path(self, meta: Backup) -> Path:
        name = os.path.basename(meta.filename or "")
        if name != meta.filename or not name.endswith(".json.gz"):
            raise BackupError("invalid backup filename")
        return self.dir / name

    def delete(self, meta: Backup) -> None:
        path = self.path(meta)
        try:
            path.unlink()
        except FileNotFoundError:
            pass

    # ── restore ───────────────────────────────────────────────────────────
    def restore(self, meta: Backup) -> None:
        path = self.path(meta)
        try:
            with gzip.open(path, "rb") as gz:
                raw = gz.read(MAX_RESTORE_BYTES + 1)
        except OSError as exc:
            raise BackupError(f"open backup: {exc}") from exc
        if len(raw) > MAX_RESTORE_BYTES:
            raise BackupError("backup is too large")
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise BackupError(f"decode backup: {exc}") from exc
        if not isinstance(data, dict):
            raise BackupError("decode backup: expected a JSON object")
        if data.get("format") != FORMAT or data.get("version") != VERSION:
            raise BackupError("unsupported backup format or version")

        users = [self._user_model(record) for record in data.get("users") or []]
        extensions = [
            self._extension_model(record) for record in data.get("extensions") or []
        ]
        rules = [
            self._dialplan_model(record) for record in data.get("dialplan") or []
        ]
        boxes = [
            self._voicemail_model(record) for record in data.get("voicemail") or []
        ]
        queues = [self._queue_model(record) for record in data.get("queues") or []]
        members = [
            self._queue_member_model(record)
            for record in data.get("queue_members") or []
        ]
        menus: list[tuple[IVRMenu, list[IVRMenuOption]]] = []
        for record in data.get("ivr_menus") or []:
            menu = self._ivr_model(record)
            options = [
                self._ivr_option_model(option, menu.id)
                for option in record.get("options") or []
            ]
            menus.append((menu, options))
        rooms = [
            self._conference_model(record) for record in data.get("conferences") or []
        ]
        settings = [
            self._setting_model(record) for record in data.get("settings") or []
        ]
        cdr_rows = (
            [self._cdr_model(record) for record in data.get("cdr") or []]
            if data.get("includes_cdr")
            else []
        )

        with self.session_factory() as session:
            try:
                with session.begin():
                    for model in (
                        IVRMenuOption,
                        IVRMenu,
                        QueueMember,
                        Queue,
                        VoicemailBox,
                        DialplanRule,
                        ConferenceRoom,
                        Extension,
                        User,
                        Setting,
                    ):
                        session.execute(delete(model))

                    session.add_all(users)
                    session.flush()
                    session.add_all(extensions)
                    session.flush()
                    session.add_all(rules)
                    session.flush()
                    session.add_all(boxes)
                    session.flush()
                    session.add_all(queues)
                    session.flush()
                    session.add_all(members)
                    session.flush()
                    for menu, options in menus:
                        session.add(menu)
                        session.flush()
                        for option in options:
                            option.menu_id = menu.id
                            session.add(option)
                    session.flush()
                    session.add_all(rooms)
                    session.flush()

                    for setting in settings:
                        statement = (
                            pg_insert(Setting)
                            .values(
                                key=setting.key,
                                value=setting.value,
                                description=setting.description,
                                updated_by=setting.updated_by,
                                updated_at=setting.updated_at,
                            )
                            .on_conflict_do_update(
                                index_elements=["key"],
                                set_={
                                    "value": setting.value,
                                    "description": setting.description,
                                    "updated_by": setting.updated_by,
                                    "updated_at": setting.updated_at,
                                },
                            )
                        )
                        session.execute(statement)

                    for index, row in enumerate(cdr_rows):
                        statement = pg_insert(CDR).values(
                            id=row.id,
                            calldate=row.calldate,
                            clid=row.clid,
                            src=row.src,
                            dst=row.dst,
                            dcontext=row.dcontext,
                            channel=row.channel,
                            dstchannel=row.dstchannel,
                            lastapp=row.lastapp,
                            lastdata=row.lastdata,
                            duration=row.duration,
                            billsec=row.billsec,
                            disposition=row.disposition,
                            amaflags=row.amaflags,
                            accountcode=row.accountcode,
                            uniqueid=row.uniqueid,
                            userfield=row.userfield,
                            peeraccount=row.peeraccount,
                            linkedid=row.linkedid,
                            sequence=row.sequence,
                        )
                        session.execute(statement.on_conflict_do_nothing())
                        if index and index % 500 == 0:
                            session.flush()
            except Exception as exc:
                raise BackupError(f"restore backup: {exc}") from exc

    # ── record → model ────────────────────────────────────────────────────
    def _user_model(self, record: dict[str, Any]) -> User:
        now = utcnow()
        return User(
            id=str(record.get("id") or uuid.uuid4()),
            created_at=_parse_time(record.get("created_at"), now),
            updated_at=_parse_time(record.get("updated_at"), now),
            username=_text(record.get("username")),
            email=_text(record.get("email")),
            full_name=_text(record.get("full_name")),
            password_hash=_text(record.get("password_hash")),
            role=_text(record.get("role")) or "viewer",
            active=_bool(record.get("active"), True),
            last_login_at=_optional_time(record.get("last_login_at")),
            last_login_ip=_text(record.get("last_login_ip")),
        )

    def _extension_model(self, record: dict[str, Any]) -> Extension:
        now = utcnow()
        return Extension(
            id=str(record.get("id") or uuid.uuid4()),
            created_at=_parse_time(record.get("created_at"), now),
            updated_at=_parse_time(record.get("updated_at"), now),
            number=_text(record.get("number")),
            display_name=_text(record.get("display_name")),
            user_id=record.get("user_id") or None,
            context=_text(record.get("context")) or "internal",
            codecs=_text(record.get("codecs")) or "ulaw,alaw,opus,g722",
            sip_password=_text(record.get("sip_password")),
            caller_id=_text(record.get("caller_id")),
            voicemail_enabled=_bool(record.get("voicemail_enabled")),
            voicemail_pin=_text(record.get("voicemail_pin")),
            enabled=_bool(record.get("enabled"), True),
            description=_text(record.get("description")),
        )

    def _dialplan_model(self, record: dict[str, Any]) -> DialplanRule:
        now = utcnow()
        return DialplanRule(
            id=str(record.get("id") or uuid.uuid4()),
            created_at=_parse_time(record.get("created_at"), now),
            updated_at=_parse_time(record.get("updated_at"), now),
            context=_text(record.get("context")) or "internal",
            pattern=_text(record.get("pattern")),
            priority=_int(record.get("priority"), 1),
            app=_text(record.get("app")),
            app_data=_text(record.get("app_data")),
            description=_text(record.get("description")),
            enabled=_bool(record.get("enabled"), True),
        )

    def _voicemail_model(self, record: dict[str, Any]) -> VoicemailBox:
        now = utcnow()
        return VoicemailBox(
            id=str(record.get("id") or uuid.uuid4()),
            created_at=_parse_time(record.get("created_at"), now),
            updated_at=_parse_time(record.get("updated_at"), now),
            extension=_text(record.get("extension")),
            context=_text(record.get("context")) or "internal",
            name=_text(record.get("name")),
            email=_text(record.get("email")),
            pin=_text(record.get("pin")),
            time_zone=_text(record.get("timezone")),
            max_messages=_int(record.get("max_messages"), 50),
            active=_bool(record.get("active"), True),
        )

    def _queue_model(self, record: dict[str, Any]) -> Queue:
        now = utcnow()
        return Queue(
            id=str(record.get("id") or uuid.uuid4()),
            created_at=_parse_time(record.get("created_at"), now),
            updated_at=_parse_time(record.get("updated_at"), now),
            name=_text(record.get("name")),
            strategy=_text(record.get("strategy")) or "ringall",
            timeout=_int(record.get("timeout"), 30),
            music_on_hold=_text(record.get("music_on_hold")),
            ring_in_use=_bool(record.get("ring_in_use")),
            max_wait=_int(record.get("max_wait"), 300),
            announce=_text(record.get("announce")),
            announce_frequency=_int(record.get("announce_frequency")),
            description=_text(record.get("description")),
            active=_bool(record.get("active"), True),
        )

    def _queue_member_model(self, record: dict[str, Any]) -> QueueMember:
        now = utcnow()
        return QueueMember(
            id=str(record.get("id") or uuid.uuid4()),
            created_at=_parse_time(record.get("created_at"), now),
            updated_at=_parse_time(record.get("updated_at"), now),
            queue_id=_text(record.get("queue_id")),
            interface=_text(record.get("interface")),
            member_name=_text(record.get("member_name")),
            penalty=_int(record.get("penalty")),
            paused=_bool(record.get("paused")),
        )

    def _ivr_model(self, record: dict[str, Any]) -> IVRMenu:
        now = utcnow()
        return IVRMenu(
            id=str(record.get("id") or uuid.uuid4()),
            created_at=_parse_time(record.get("created_at"), now),
            updated_at=_parse_time(record.get("updated_at"), now),
            name=_text(record.get("name")),
            description=_text(record.get("description")),
            greeting_sound=_text(record.get("greeting_sound")),
            invalid_sound=_text(record.get("invalid_sound")),
            timeout=_int(record.get("timeout"), 5),
            max_attempts=_int(record.get("max_attempts"), 3),
            active=_bool(record.get("active"), True),
        )

    def _ivr_option_model(
        self, record: dict[str, Any], menu_id: str
    ) -> IVRMenuOption:
        now = utcnow()
        return IVRMenuOption(
            id=str(record.get("id") or uuid.uuid4()),
            created_at=_parse_time(record.get("created_at"), now),
            updated_at=_parse_time(record.get("updated_at"), now),
            menu_id=_text(record.get("menu_id")) or menu_id,
            digit=_text(record.get("digit")),
            destination_type=_text(record.get("destination_type")),
            destination=_text(record.get("destination")),
            description=_text(record.get("description")),
            sort_order=_int(record.get("sort_order")),
        )

    def _conference_model(self, record: dict[str, Any]) -> ConferenceRoom:
        now = utcnow()
        return ConferenceRoom(
            id=str(record.get("id") or uuid.uuid4()),
            created_at=_parse_time(record.get("created_at"), now),
            updated_at=_parse_time(record.get("updated_at"), now),
            number=_text(record.get("number")),
            name=_text(record.get("name")),
            pin=_text(record.get("pin")),
            max_members=_int(record.get("max_members"), 10),
            muted=_bool(record.get("muted")),
            record=_bool(record.get("record")),
            active=_bool(record.get("active"), True),
            description=_text(record.get("description")),
        )

    def _setting_model(self, record: dict[str, Any]) -> Setting:
        now = utcnow()
        value = record.get("value")
        if not isinstance(value, str):
            value = json.dumps(value, ensure_ascii=False)
        return Setting(
            key=_text(record.get("key")),
            value=value,
            description=_text(record.get("description")),
            updated_by=_text(record.get("updated_by")),
            updated_at=_parse_time(record.get("updated_at"), now),
        )

    def _cdr_model(self, record: dict[str, Any]) -> CDR:
        return CDR(
            id=_int(record.get("id"), 0),
            calldate=_parse_time(record.get("calldate"), utcnow()),
            clid=_text(record.get("clid")),
            src=_text(record.get("src")),
            dst=_text(record.get("dst")),
            dcontext=_text(record.get("dcontext")),
            channel=_text(record.get("channel")),
            dstchannel=_text(record.get("dstchannel")),
            lastapp=_text(record.get("lastapp")),
            lastdata=_text(record.get("lastdata")),
            duration=_int(record.get("duration")),
            billsec=_int(record.get("billsec")),
            disposition=_text(record.get("disposition")),
            amaflags=_int(record.get("amaflags")),
            accountcode=_text(record.get("accountcode")),
            uniqueid=_text(record.get("uniqueid")),
            userfield=_text(record.get("userfield")),
            peeraccount=_text(record.get("peeraccount")),
            linkedid=_text(record.get("linkedid")),
            sequence=_int(record.get("sequence")),
        )
