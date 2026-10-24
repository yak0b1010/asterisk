"""Configuration loaded from the environment.

The repository keeps deployment values in the root ``.env``.  The backend
loads a local ``backend/.env`` first and then walks up to the repository root
so container overrides keep working.  Process environment variables always win.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv


def _env(key: str, fallback: str = "") -> str:
    value = os.getenv(key)
    if value is None or not value.strip():
        return fallback
    return value.strip()


def _env_int(key: str, fallback: int) -> int:
    raw = os.getenv(key)
    if raw is None or not raw.strip():
        return fallback
    try:
        value = int(raw.strip())
    except ValueError:
        return fallback
    return value if value > 0 else fallback


def _env_bool(key: str, fallback: bool) -> bool:
    raw = os.getenv(key)
    if raw is None or not raw.strip():
        return fallback
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return fallback


_DURATION_RE = re.compile(r"(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h|d)", re.IGNORECASE)
_DURATION_UNITS = {
    "ns": 1e-9,
    "us": 1e-6,
    "µs": 1e-6,
    "ms": 1e-3,
    "s": 1.0,
    "m": 60.0,
    "h": 3600.0,
    "d": 86400.0,
}


def _env_duration(key: str, fallback_seconds: float) -> float:
    raw = os.getenv(key)
    if raw is None or not raw.strip():
        return fallback_seconds
    text = raw.strip()
    # Plain numbers are interpreted as seconds.
    try:
        value = float(text)
        return value if value > 0 else fallback_seconds
    except ValueError:
        pass
    total = 0.0
    position = 0
    for match in _DURATION_RE.finditer(text):
        if match.start() != position:
            return fallback_seconds
        total += float(match.group(1)) * _DURATION_UNITS[match.group(2).lower()]
        position = match.end()
    if position != len(text) or total <= 0:
        return fallback_seconds
    return total


def _split_csv(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def _in_container() -> bool:
    return Path("/.dockerenv").exists() or Path("/run/.containerenv").exists()


def _load_dotenv_files() -> None:
    explicit = os.getenv("ENV_FILE")
    if explicit:
        load_dotenv(explicit, override=False)
        return

    directory = Path.cwd()
    for _ in range(4):
        candidate = directory / ".env"
        if candidate.is_file():
            load_dotenv(candidate, override=False)
            if directory.name == "backend":
                parent = directory.parent / ".env"
                if parent.is_file():
                    load_dotenv(parent, override=False)
            return
        parent = directory.parent
        if parent == directory:
            return
        directory = parent


@dataclass(slots=True)
class DatabaseConfig:
    url: str = ""
    host: str = "localhost"
    port: int = 5232
    name: str = "astrisk"
    user: str = "astrisk_user"
    password: str = ""
    sslmode: str = "disable"

    def dsn(self) -> str:
        if self.url:
            url = self.url
            if url.startswith("postgres://"):
                url = "postgresql+psycopg://" + url[len("postgres://") :]
            elif url.startswith("postgresql://"):
                url = "postgresql+psycopg://" + url[len("postgresql://") :]
            return url
        sslmode = self.sslmode or "disable"
        return (
            f"postgresql+psycopg://{quote_plus(self.user)}:{quote_plus(self.password)}"
            f"@{self.host}:{self.port}/{quote_plus(self.name)}?sslmode={quote_plus(sslmode)}"
        )

    def redacted(self) -> str:
        if self.url:
            return "(DATABASE_URL)"
        return f"host={self.host} port={self.port} dbname={self.name} user={self.user}"


@dataclass(slots=True)
class JWTConfig:
    secret: str = "change-me-in-production"
    issuer: str = "asterisk-backend"
    audience: str = "asterisk-dashboard"
    access_ttl: float = 15 * 60
    refresh_ttl: float = 7 * 24 * 3600


@dataclass(slots=True)
class AdminConfig:
    username: str = "admin"
    password: str = "admin12345"
    email: str = "admin@asterisk.local"


@dataclass(slots=True)
class AsteriskConfig:
    ami_host: str = "127.0.0.1"
    ami_port: int = 5038
    ami_username: str = "backend"
    ami_password: str = ""
    ari_url: str = "http://127.0.0.1:8088/ari"
    ari_username: str = "asterisk"
    ari_password: str = ""
    transport: str = "transport-udp"


@dataclass(slots=True)
class Config:
    env: str = "development"
    http_addr: str = ":8080"
    http_host: str = "0.0.0.0"
    http_port: int = 8080
    log_level: str = "info"
    data_dir: str = "./data"
    auto_migrate: bool = True
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    jwt: JWTConfig = field(default_factory=JWTConfig)
    admin: AdminConfig = field(default_factory=AdminConfig)
    cors_origins: list[str] = field(
        default_factory=lambda: [
            "http://localhost:8080",
            "http://localhost:5173",
            "http://localhost:3000",
        ]
    )
    asterisk: AsteriskConfig = field(default_factory=AsteriskConfig)

    def validate(self) -> None:
        if not self.database.url:
            if not self.database.name or not self.database.user:
                raise ValueError("DB_NAME and DB_USER are required when DATABASE_URL is not set")
            if not self.database.password:
                raise ValueError("DB_PASSWORD is required when DATABASE_URL is not set")
        if self.jwt.secret == "change-me-in-production" and self.env == "production":
            raise ValueError("JWT_SECRET must be changed when APP_ENV=production")
        if self.jwt.access_ttl <= 0 or self.jwt.refresh_ttl <= 0:
            raise ValueError("token TTLs must be positive")
        if not self.admin.username or not self.admin.password:
            raise ValueError("ADMIN_USERNAME and ADMIN_PASSWORD are required")


def _parse_http_addr(raw: str) -> tuple[str, int]:
    text = raw.strip()
    if not text:
        return "0.0.0.0", 8080
    if text.startswith(":"):
        try:
            return "0.0.0.0", int(text[1:])
        except ValueError:
            return "0.0.0.0", 8080
    if ":" in text:
        host, port = text.rsplit(":", 1)
        try:
            return host or "0.0.0.0", int(port)
        except ValueError:
            return "0.0.0.0", 8080
    return "0.0.0.0", 8080


def load_config() -> Config:
    _load_dotenv_files()

    http_addr = _env("HTTP_ADDR", ":8080")
    http_host, http_port = _parse_http_addr(http_addr)

    db = DatabaseConfig(
        url=_env("DATABASE_URL"),
        host=_env("DB_HOST", "localhost"),
        port=_env_int("DB_PORT", 5232),
        name=_env("DB_NAME", "astrisk"),
        user=_env("DB_USER", "astrisk_user"),
        password=os.getenv("DB_PASSWORD", ""),
        sslmode=_env("DB_SSLMODE", "disable"),
    )
    # The repository .env is written for the Compose network.  When the API
    # runs on the host, reach Postgres through its published port instead.
    if not _in_container() and db.host in {"postgres", "db"}:
        db.host = "127.0.0.1"
    if db.port == 0:
        db.port = 5232

    cfg = Config(
        env=_env("APP_ENV", "development"),
        http_addr=http_addr,
        http_host=http_host,
        http_port=http_port,
        log_level=_env("LOG_LEVEL", "info"),
        data_dir=_env("DATA_DIR", "./data"),
        auto_migrate=_env_bool("AUTO_MIGRATE", True),
        database=db,
        jwt=JWTConfig(
            secret=_env("JWT_SECRET", "change-me-in-production"),
            issuer=_env("JWT_ISSUER", "asterisk-backend"),
            audience=_env("JWT_AUDIENCE", "asterisk-dashboard"),
            access_ttl=_env_duration("ACCESS_TOKEN_TTL", 15 * 60),
            refresh_ttl=_env_duration("REFRESH_TOKEN_TTL", 7 * 24 * 3600),
        ),
        admin=AdminConfig(
            username=_env("ADMIN_USERNAME", "admin"),
            password=_env("ADMIN_PASSWORD", "admin12345"),
            email=_env("ADMIN_EMAIL", "admin@asterisk.local"),
        ),
        cors_origins=_split_csv(
            _env(
                "CORS_ORIGINS",
                "http://localhost:8080,http://localhost:5173,http://localhost:3000",
            )
        ),
        asterisk=AsteriskConfig(
            ami_host=_env("ASTERISK_AMI_HOST", "127.0.0.1"),
            ami_port=_env_int("ASTERISK_AMI_PORT", 5038),
            ami_username=_env("ASTERISK_AMI_USERNAME", "backend"),
            ami_password=os.getenv("ASTERISK_AMI_PASSWORD", ""),
            ari_url=_env("ASTERISK_ARI_URL", "http://127.0.0.1:8088/ari").rstrip("/"),
            ari_username=_env("ASTERISK_ARI_USERNAME", "asterisk"),
            ari_password=os.getenv("ASTERISK_ARI_PASSWORD", ""),
            transport=_env("ASTERISK_TRANSPORT", "transport-udp"),
        ),
    )
    cfg.validate()
    return cfg
