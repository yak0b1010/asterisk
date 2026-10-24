"""Mirror application configuration into Asterisk's realtime tables."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterable, Iterator

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .models import (
    ConferenceRoom,
    DialplanRule,
    Extension,
    Queue,
    QueueMember,
    VoicemailBox,
)

ENDPOINT_SQL = """
INSERT INTO ps_endpoints
    (id, transport, aors, auth, context, disallow, allow, direct_media,
     mailboxes, callerid, ice_support, media_encryption, rewrite_contact,
     rtp_symmetric, force_rport, aggregate_mwi, allow_transfer, allow_subscribe)
VALUES (:number, :transport, :number, :number, :context, 'all', :codecs, 'no',
        NULLIF(:mailboxes, ''), NULLIF(:callerid, ''),
        'no', 'no', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes')
ON CONFLICT (id) DO UPDATE SET
    transport = EXCLUDED.transport,
    aors = EXCLUDED.aors,
    auth = EXCLUDED.auth,
    context = EXCLUDED.context,
    disallow = EXCLUDED.disallow,
    allow = EXCLUDED.allow,
    direct_media = EXCLUDED.direct_media,
    mailboxes = EXCLUDED.mailboxes,
    callerid = EXCLUDED.callerid
"""

AUTH_SQL = """
INSERT INTO ps_auths (id, auth_type, username, password, realm)
VALUES (:number, 'userpass', :number, :password, NULL)
ON CONFLICT (id) DO UPDATE SET
    auth_type = EXCLUDED.auth_type,
    username = EXCLUDED.username,
    password = EXCLUDED.password
"""

AOR_SQL = """
INSERT INTO ps_aors
    (id, max_contacts, remove_existing, qualify_frequency, mailboxes)
VALUES (:number, 2, 'yes', 60, NULLIF(:mailboxes, ''))
ON CONFLICT (id) DO UPDATE SET
    max_contacts = EXCLUDED.max_contacts,
    remove_existing = EXCLUDED.remove_existing,
    qualify_frequency = EXCLUDED.qualify_frequency,
    mailboxes = EXCLUDED.mailboxes
"""

QUEUE_SQL = """
INSERT INTO queues
    (name, musiconhold, announce, context, timeout, ringinuse, announce_frequency,
     strategy, maxlen, servicelevel, weight)
VALUES (:name, NULLIF(:music_on_hold, ''), NULLIF(:announce, ''), 'internal',
        :timeout, :ring_in_use, :announce_frequency, :strategy, 0, 30, 0)
ON CONFLICT (name) DO UPDATE SET
    musiconhold = EXCLUDED.musiconhold,
    announce = EXCLUDED.announce,
    timeout = EXCLUDED.timeout,
    ringinuse = EXCLUDED.ringinuse,
    announce_frequency = EXCLUDED.announce_frequency,
    strategy = EXCLUDED.strategy
"""

QUEUE_MEMBER_SQL = """
INSERT INTO queue_members
    (queue_name, interface, uniqueid, membername, state_interface, penalty, paused)
VALUES (:queue_name, :interface, '', NULLIF(:member_name, ''),
        NULLIF(:state_interface, ''), :penalty, :paused)
"""

DIALPLAN_SQL = """
INSERT INTO extensions (context, exten, priority, app, appdata)
VALUES (:context, :exten, :priority, :app, :appdata)
ON CONFLICT (context, exten, priority) DO UPDATE SET
    app = EXCLUDED.app, appdata = EXCLUDED.appdata
"""


class RealtimeService:
    def __init__(self, transport: str = "transport-udp") -> None:
        self.transport = transport or "transport-udp"

    @staticmethod
    @contextmanager
    def _atomic(session: Session) -> Iterator[None]:
        """Run realtime writes in a transaction and commit when finished.

        SQLAlchemy autobegins a transaction on the first SELECT, so a plain
        ``with session.begin()`` would fail after a handler has already read
        the object it just saved.  Committing here is intentional: realtime
        rows are a mirror of the application tables, never part of their
        transaction.
        """
        if session.in_transaction():
            try:
                yield
                session.commit()
            except Exception:
                session.rollback()
                raise
        else:
            with session.begin():
                yield

    # ── extensions ───────────────────────────────────────────────────────
    def sync_extension(self, session: Session, extension: Extension) -> None:
        with self._atomic(session):
            self._sync_extension(session, extension)

    def _sync_extension(self, session: Session, extension: Extension) -> None:
        if not extension.enabled:
            self._delete_extension(session, extension.number)
            return
        mailboxes = ""
        if extension.voicemail_enabled and extension.voicemail_pin:
            mailboxes = f"{extension.number}@{extension.context}"
        caller_id = extension.caller_id or ""
        if not caller_id and extension.display_name:
            caller_id = f'"{extension.display_name}" <{extension.number}>'
        params = {
            "number": extension.number,
            "transport": self.transport,
            "context": extension.context,
            "codecs": extension.codecs,
            "mailboxes": mailboxes,
            "callerid": caller_id,
            "password": extension.sip_password,
        }
        session.execute(text(ENDPOINT_SQL), params)
        session.execute(text(AUTH_SQL), params)
        session.execute(text(AOR_SQL), params)

    def delete_extension(self, session: Session, number: str) -> None:
        with self._atomic(session):
            self._delete_extension(session, number)

    def _delete_extension(self, session: Session, number: str) -> None:
        session.execute(
            text("DELETE FROM ps_contacts WHERE endpoint = :number"),
            {"number": number},
        )
        for table in ("ps_endpoints", "ps_auths", "ps_aors"):
            session.execute(
                text(f"DELETE FROM {table} WHERE id = :number"),
                {"number": number},
            )

    # ── voicemail ────────────────────────────────────────────────────────
    def sync_voicemail(self, session: Session, box: VoicemailBox) -> None:
        with self._atomic(session):
            self._sync_voicemail(session, box)

    def _sync_voicemail(self, session: Session, box: VoicemailBox) -> None:
        if not box.active:
            self._delete_voicemail(session, box.extension, box.context)
            return
        session.execute(
            text("DELETE FROM voicemail WHERE context = :context AND mailbox = :mailbox"),
            {"context": box.context, "mailbox": box.extension},
        )
        session.execute(
            text(
                """
                INSERT INTO voicemail
                    (context, mailbox, password, fullname, email, tz, maxmsg, language)
                VALUES (:context, :mailbox, :password, NULLIF(:fullname, ''),
                        NULLIF(:email, ''), NULLIF(:tz, ''), :maxmsg, 'en')
                """
            ),
            {
                "context": box.context,
                "mailbox": box.extension,
                "password": box.pin,
                "fullname": box.name or "",
                "email": box.email or "",
                "tz": box.time_zone or "",
                "maxmsg": box.max_messages,
            },
        )

    def delete_voicemail(
        self, session: Session, extension: str, context: str
    ) -> None:
        with self._atomic(session):
            self._delete_voicemail(session, extension, context)

    def _delete_voicemail(
        self, session: Session, extension: str, context: str
    ) -> None:
        session.execute(
            text("DELETE FROM voicemail WHERE context = :context AND mailbox = :mailbox"),
            {"context": context, "mailbox": extension},
        )

    # ── queues ───────────────────────────────────────────────────────────
    def sync_queue(
        self,
        session: Session,
        queue: Queue,
        members: Iterable[QueueMember],
    ) -> None:
        with self._atomic(session):
            self._sync_queue(session, queue, list(members))

    def _sync_queue(
        self, session: Session, queue: Queue, members: list[QueueMember]
    ) -> None:
        if not queue.active:
            self._delete_queue(session, queue.name)
            return
        session.execute(
            text(QUEUE_SQL),
            {
                "name": queue.name,
                "music_on_hold": queue.music_on_hold or "",
                "announce": queue.announce or "",
                "timeout": queue.timeout,
                "ring_in_use": "yes" if queue.ring_in_use else "no",
                "announce_frequency": queue.announce_frequency,
                "strategy": queue.strategy,
            },
        )
        session.execute(
            text("DELETE FROM queue_members WHERE queue_name = :name"),
            {"name": queue.name},
        )
        for member in members:
            session.execute(
                text(QUEUE_MEMBER_SQL),
                {
                    "queue_name": queue.name,
                    "interface": member.interface,
                    "member_name": member.member_name or "",
                    "state_interface": member.interface,
                    "penalty": member.penalty,
                    "paused": 1 if member.paused else 0,
                },
            )

    def delete_queue(self, session: Session, name: str) -> None:
        with self._atomic(session):
            self._delete_queue(session, name)

    def _delete_queue(self, session: Session, name: str) -> None:
        session.execute(
            text("DELETE FROM queue_members WHERE queue_name = :name"),
            {"name": name},
        )
        session.execute(text("DELETE FROM queues WHERE name = :name"), {"name": name})

    # ── dialplan ─────────────────────────────────────────────────────────
    def sync_dialplan_rule(self, session: Session, rule: DialplanRule) -> None:
        with self._atomic(session):
            self._sync_dialplan_rule(session, rule)

    def _sync_dialplan_rule(self, session: Session, rule: DialplanRule) -> None:
        if not rule.enabled:
            self._delete_dialplan_rule(
                session, rule.context, rule.pattern, rule.priority
            )
            return
        session.execute(
            text(DIALPLAN_SQL),
            {
                "context": rule.context,
                "exten": rule.pattern,
                "priority": rule.priority,
                "app": rule.app,
                "appdata": rule.app_data or "",
            },
        )

    def replace_dialplan_rule(
        self, session: Session, previous: DialplanRule | None, rule: DialplanRule
    ) -> None:
        with self._atomic(session):
            if previous is not None and (
                previous.context != rule.context
                or previous.pattern != rule.pattern
                or previous.priority != rule.priority
            ):
                self._delete_dialplan_rule(
                    session, previous.context, previous.pattern, previous.priority
                )
            self._sync_dialplan_rule(session, rule)

    def delete_dialplan_rule(
        self, session: Session, context: str, pattern: str, priority: int
    ) -> None:
        with self._atomic(session):
            self._delete_dialplan_rule(session, context, pattern, priority)

    def _delete_dialplan_rule(
        self, session: Session, context: str, pattern: str, priority: int
    ) -> None:
        session.execute(
            text(
                "DELETE FROM extensions "
                "WHERE context = :context AND exten = :exten AND priority = :priority"
            ),
            {"context": context, "exten": pattern, "priority": priority},
        )

    # ── conferences ──────────────────────────────────────────────────────
    def sync_conference(self, session: Session, room: ConferenceRoom) -> None:
        with self._atomic(session):
            self._sync_conference(session, room)

    def _sync_conference(self, session: Session, room: ConferenceRoom) -> None:
        if not room.active:
            self._delete_conference(session, room.number)
            return
        session.execute(
            text(
                """
                INSERT INTO meetme (confno, pin, pinadmin)
                VALUES (:confno, NULLIF(:pin, ''), NULL)
                ON CONFLICT (confno) DO UPDATE SET pin = EXCLUDED.pin
                """
            ),
            {"confno": room.number, "pin": room.pin or ""},
        )

    def delete_conference(self, session: Session, number: str) -> None:
        with self._atomic(session):
            self._delete_conference(session, number)

    def _delete_conference(self, session: Session, number: str) -> None:
        session.execute(
            text("DELETE FROM meetme WHERE confno = :confno"), {"confno": number}
        )

    # ── rebuild ──────────────────────────────────────────────────────────
    def sync_all(self, session: Session) -> None:
        with self._atomic(session):
            for statement in (
                "DELETE FROM ps_contacts",
                "DELETE FROM ps_endpoints",
                "DELETE FROM ps_auths",
                "DELETE FROM ps_aors",
                "DELETE FROM voicemail",
                "DELETE FROM queue_members",
                "DELETE FROM queues",
                "DELETE FROM extensions",
                "DELETE FROM meetme",
            ):
                session.execute(text(statement))

            extensions = session.scalars(
                select(Extension).where(Extension.enabled.is_(True)).order_by(Extension.number)
            ).all()
            for extension in extensions:
                self._sync_extension(session, extension)

            boxes = session.scalars(
                select(VoicemailBox)
                .where(VoicemailBox.active.is_(True))
                .order_by(VoicemailBox.extension)
            ).all()
            for box in boxes:
                self._sync_voicemail(session, box)

            queues = session.scalars(
                select(Queue).where(Queue.active.is_(True)).order_by(Queue.name)
            ).all()
            for queue in queues:
                members = session.scalars(
                    select(QueueMember)
                    .where(QueueMember.queue_id == queue.id)
                    .order_by(QueueMember.interface)
                ).all()
                self._sync_queue(session, queue, list(members))

            rules = session.scalars(
                select(DialplanRule)
                .where(DialplanRule.enabled.is_(True))
                .order_by(DialplanRule.context, DialplanRule.pattern, DialplanRule.priority)
            ).all()
            for rule in rules:
                self._sync_dialplan_rule(session, rule)

            rooms = session.scalars(
                select(ConferenceRoom)
                .where(ConferenceRoom.active.is_(True))
                .order_by(ConferenceRoom.number)
            ).all()
            for room in rooms:
                self._sync_conference(session, room)
