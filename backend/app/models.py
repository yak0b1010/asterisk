"""SQLAlchemy models for the appliance database.

The table and column names intentionally match the schema the Go backend used
(GORM naming).  In particular ``app_extensions`` stores the SIP secret in the
historical ``s_ip_password`` column.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class UUIDMixin:
    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class User(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "app_users"

    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_login_ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)


class RefreshToken(UUIDMixin, Base):
    __tablename__ = "app_refresh_tokens"

    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    replaced_by: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    user_agent: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Extension(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "app_extensions"

    number: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False))
    context: Mapped[str] = mapped_column(String(64), default="internal", nullable=False)
    codecs: Mapped[str] = mapped_column(
        String(255), default="ulaw,alaw,opus,g722", nullable=False
    )
    sip_password: Mapped[str] = mapped_column(
        "s_ip_password", String(255), nullable=False
    )
    caller_id: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    voicemail_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    voicemail_pin: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)


class DialplanRule(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "app_dialplan_rules"

    context: Mapped[str] = mapped_column(String(64), nullable=False)
    pattern: Mapped[str] = mapped_column(String(64), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False)
    app: Mapped[str] = mapped_column(String(64), nullable=False)
    app_data: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class VoicemailBox(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "app_voicemail_boxes"

    extension: Mapped[str] = mapped_column(String(16), nullable=False)
    context: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    email: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    pin: Mapped[str] = mapped_column(String(32), nullable=False)
    time_zone: Mapped[str] = mapped_column("time_zone", String(64), default="", nullable=False)
    max_messages: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        UniqueConstraint("extension", "context", name="idx_vm_extension_context"),
    )


class Queue(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "app_queues"

    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    strategy: Mapped[str] = mapped_column(String(32), default="ringall", nullable=False)
    timeout: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    music_on_hold: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    ring_in_use: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    max_wait: Mapped[int] = mapped_column(Integer, default=300, nullable=False)
    announce: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    announce_frequency: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class QueueMember(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "app_queue_members"

    queue_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    interface: Mapped[str] = mapped_column(String(80), nullable=False)
    member_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    penalty: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    paused: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint("queue_id", "interface", name="idx_queue_member"),
    )


class IVRMenu(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "app_ivr_menus"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    greeting_sound: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    invalid_sound: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    timeout: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class IVRMenuOption(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "app_ivr_options"

    menu_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    digit: Mapped[str] = mapped_column(String(4), nullable=False)
    destination_type: Mapped[str] = mapped_column(String(32), nullable=False)
    destination: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        UniqueConstraint("menu_id", "digit", name="idx_ivr_option"),
        Index("idx_app_ivr_options_menu_id", "menu_id"),
    )


class ConferenceRoom(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "app_conference_rooms"

    number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    pin: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    max_members: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    muted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    record: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)


class CDR(Base):
    __tablename__ = "cdr"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    calldate: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    clid: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    src: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    dst: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    dcontext: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    channel: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    dstchannel: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    lastapp: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    lastdata: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    duration: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    billsec: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    disposition: Mapped[str] = mapped_column(String(45), default="", nullable=False)
    amaflags: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    accountcode: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    uniqueid: Mapped[str] = mapped_column(String(150), default="", nullable=False)
    userfield: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    peeraccount: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    linkedid: Mapped[str] = mapped_column(String(150), default="", nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class AuditLog(Base):
    __tablename__ = "app_audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False))
    username: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    action: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    method: Mapped[str] = mapped_column(String(12), default="", nullable=False)
    path: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    user_agent: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    details: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Setting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    updated_by: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Backup(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "app_backups"

    filename: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    includes: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
