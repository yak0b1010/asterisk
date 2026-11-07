"""Request and response shapes.

The database uses snake_case (`full_name`) while the React frontend uses
camelCase (`fullName`).  One shared `alias_generator` converts between the two,
so the API and the UI can both use the style that feels natural.
"""

from datetime import datetime
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

Role = Literal["admin", "operator", "viewer"]
Department = Literal["administration", "finance", "it", "support", "management"]
CallStatus = Literal["answered", "missed", "busy", "failed"]

NUMBER_PATTERN = r"^[1-5]\d\d$"


class ApiModel(BaseModel):
    """Base model: camelCase on the wire, snake_case in Python."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ── Authentication ────────────────────────────────────────────────────────
class LoginRequest(ApiModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=200)


class AuthUser(ApiModel):
    username: str
    full_name: str
    role: Role


class LoginResponse(ApiModel):
    token: str
    user: AuthUser


class MessageResponse(ApiModel):
    message: str


# ── Users (directory) ─────────────────────────────────────────────────────
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_email(value: str) -> str:
    """Allow appliance-internal domains such as `appliance.local`.

    `EmailStr` rejects special-use TLDs like `.local`, which is exactly the
    domain this appliance uses, so a small explicit check is better here.
    """
    value = value.strip().lower()
    if not EMAIL_PATTERN.match(value):
        raise ValueError("Enter a valid email address")
    return value


class UserIn(ApiModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=190)
    department: Department

    _email = field_validator("email")(validate_email)


class UserOut(ApiModel):
    id: str
    full_name: str
    email: str
    department: Department
    created_at: datetime


# ── Extensions ────────────────────────────────────────────────────────────
def validate_number(value: str) -> str:
    if not value.isdigit() or len(value) != 3 or not ("100" <= value <= "599"):
        raise ValueError("Use a 3-digit number from 100 to 599")
    return value


def validate_secret(value: str) -> str:
    if len(value) < 8 or any(char.isspace() for char in value):
        raise ValueError("At least 8 characters, no spaces")
    return value


class ExtensionOut(ApiModel):
    number: str
    user_id: str | None
    enabled: bool
    registered: bool
    contact_ip: str | None


class ExtensionIn(ApiModel):
    number: str
    user_id: str | None = None
    secret: str
    enabled: bool = True

    _number = field_validator("number")(validate_number)
    _secret = field_validator("secret")(validate_secret)


class ExtensionUpdate(ApiModel):
    """Body for PUT/PATCH. Only the fields sent by the client are changed."""

    user_id: str | None = None
    secret: str | None = None
    enabled: bool | None = None

    @field_validator("secret")
    @classmethod
    def check_secret(cls, value: str | None) -> str | None:
        if value in (None, ""):
            return value
        return validate_secret(value)


class BulkExtensionItem(ApiModel):
    number: str
    secret: str

    _number = field_validator("number")(validate_number)
    _secret = field_validator("secret")(validate_secret)


class BulkExtensionsIn(ApiModel):
    extensions: list[BulkExtensionItem] = Field(min_length=1, max_length=500)
    enabled: bool = True


class BulkExtensionsResult(ApiModel):
    created: list[str]
    skipped: list[str]


# ── Dashboard ─────────────────────────────────────────────────────────────
class AsteriskInfo(ApiModel):
    status: Literal["running", "degraded", "stopped"]
    version: str
    uptime_sec: int


class ExtensionStats(ApiModel):
    total: int
    registered: int


class CallStats(ApiModel):
    active: int
    today: int
    answered: int
    missed: int
    avg_duration_sec: int


class RecentCall(ApiModel):
    id: str
    started_at: datetime
    caller: str
    callee: str
    duration_sec: int
    status: CallStatus


class DashboardSummary(ApiModel):
    asterisk: AsteriskInfo
    extensions: ExtensionStats
    calls: CallStats
    recent_calls: list[RecentCall]


class SystemMetrics(ApiModel):
    timestamp: datetime
    cpu_percent: float
    memory_percent: float
    memory_used_mb: float
    memory_total_mb: float
    disk_percent: float
    disk_used_gb: float
    disk_total_gb: float


# ── Asterisk status / audit ───────────────────────────────────────────────
class AsteriskStatusOut(ApiModel):
    status: Literal["running", "degraded", "stopped"]
    version: str
    uptime_sec: int
    active_calls: int
    registered_extensions: int


class AuditLogOut(ApiModel):
    id: int
    username: str
    action: str
    entity: str
    detail: str
    created_at: datetime
