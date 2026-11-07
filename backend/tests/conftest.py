"""Pytest setup.

Environment variables are set **before** importing the app so the tests use a
temporary SQLite database and a temporary config directory.  No PostgreSQL,
Asterisk or Docker is required to run them.
"""

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_ROOT = Path(tempfile.mkdtemp(prefix="asterisk-backend-tests-"))

os.environ.update(
    {
        "DATABASE_URL": f"sqlite:///{TEST_ROOT / 'test.db'}",
        "AMI_HOST": "",
        "AMI_PASSWORD": "",
        "PBX_CONFIG_DIR": str(TEST_ROOT / "generated"),
        "JWT_SECRET": "test-secret-0123456789abcdef0123456789abcdef",
        "SEED_ADMIN_USERNAME": "admin",
        "SEED_ADMIN_PASSWORD": "admin",
        "SEED_DEMO_DATA": "true",
    }
)

from app.main import app  # noqa: E402  (must come after the environment setup)


@pytest.fixture(scope="session")
def client():
    # The context manager runs the lifespan: tables, seed data, config files.
    with TestClient(app) as test_client:
        yield test_client


def _login(client: TestClient, username: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


@pytest.fixture(scope="session")
def admin_headers(client) -> dict[str, str]:
    return _login(client, "admin", "admin")


@pytest.fixture(scope="session")
def operator_headers(client) -> dict[str, str]:
    return _login(client, "operator", "operator")


@pytest.fixture(scope="session")
def viewer_headers(client) -> dict[str, str]:
    return _login(client, "viewer", "viewer")
