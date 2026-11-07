"""Application settings.

Every value can be set with an environment variable.  The names are kept
simple on purpose so a beginner can follow them from `.env` to the code.
"""

from pathlib import Path
from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # HTTP
    app_name: str = "Asterisk Appliance API"
    api_prefix: str = "/api"
    cors_origins: str = "http://localhost:5173,http://localhost:8080"

    # Database
    database_url: str = ""
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "asterisk"
    db_user: str = "asterisk"
    db_password: str = ""

    # Authentication
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    # Initial data
    seed_admin_username: str = "admin"
    seed_admin_password: str = "admin"
    seed_demo_data: bool = True

    # Asterisk AMI
    ami_host: str = ""
    ami_port: int = 5038
    ami_username: str = "backend"
    ami_password: str = ""
    ami_timeout: float = 2.0

    # PBX configuration generation
    pbx_config_dir: str = "../asterisk/generated"
    pbx_fqdn: str = "asterisk.local"
    pbx_public_ip: str = ""
    pbx_reload_enabled: bool = True

    @property
    def sqlalchemy_url(self) -> str:
        """Return the database URL used by SQLAlchemy."""
        if self.database_url:
            # Render's old style URL is not understood by SQLAlchemy 2.
            if self.database_url.startswith("postgres://"):
                return self.database_url.replace("postgres://", "postgresql+psycopg://", 1)
            return self.database_url

        if self.db_password:
            user = quote_plus(self.db_user)
            password = quote_plus(self.db_password)
            return f"postgresql+psycopg://{user}:{password}@{self.db_host}:{self.db_port}/{self.db_name}"

        # No database configured: use SQLite so local development still works.
        return "sqlite:///./data/app.db"

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def config_directory(self) -> Path:
        return Path(self.pbx_config_dir).expanduser().resolve()


settings = Settings()
