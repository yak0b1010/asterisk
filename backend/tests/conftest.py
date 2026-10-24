"""Shared pytest fixtures.

Integration tests run the real FastAPI application (including its lifespan,
migrations and PostgreSQL connection).  They are skipped when PostgreSQL is not
reachable so the unit tests remain useful on a workstation without a database.
"""

from __future__ import annotations

import os
import random

import pytest
from fastapi.testclient import TestClient

from app.database import ping
from app.main import app


@pytest.fixture(scope="session")
def client():
    if not ping(app.state.engine):
        pytest.skip("PostgreSQL is not reachable; skipping integration tests")
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def admin_login(client):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "username": os.getenv("ADMIN_USERNAME", "admin"),
            "password": os.getenv("ADMIN_PASSWORD", "admin12345"),
        },
    )
    if response.status_code != 200:
        pytest.skip("default administrator credentials are not available")
    return response.json()["data"]


@pytest.fixture(scope="session")
def auth_headers(admin_login):
    return {"Authorization": "Bearer " + admin_login["access_token"]}


@pytest.fixture()
def unique() -> str:
    return f"{random.randint(100000, 999999)}"


class ResourceCleanup:
    """Best-effort deletion of resources created by a test."""

    def __init__(self, client: TestClient, headers: dict[str, str]) -> None:
        self.client = client
        self.headers = headers
        self.paths: list[str] = []

    def add(self, path: str) -> str:
        self.paths.append(path)
        return path

    def remove(self, path: str) -> None:
        if path in self.paths:
            self.paths.remove(path)

    def close(self) -> None:
        for path in reversed(self.paths):
            try:
                self.client.delete(path, headers=self.headers)
            except Exception:
                pass
        self.paths.clear()


@pytest.fixture()
def cleanup(client, auth_headers):
    tracker = ResourceCleanup(client, auth_headers)
    try:
        yield tracker
    finally:
        tracker.close()
