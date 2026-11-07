"""End-to-end API tests using FastAPI's TestClient."""

from fastapi.testclient import TestClient


def test_health_is_ok_without_asterisk(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok", "asterisk": "down"}


def test_login_rejects_bad_password(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login", json={"username": "admin", "password": "wrong"}
    )
    assert response.status_code == 401
    # The frontend reads `message`, not FastAPI's `detail`.
    assert response.json()["message"] == "Invalid username or password"


def test_login_and_me(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.get("/api/auth/me", headers=admin_headers)
    assert response.status_code == 200
    assert response.json() == {
        "username": "admin",
        "fullName": "System Administrator",
        "role": "admin",
    }


def test_me_requires_a_token(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 401


def test_users_are_listed_in_camel_case(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.get("/api/users", headers=admin_headers)
    assert response.status_code == 200
    users = response.json()
    assert any(user["fullName"] == "System Administrator" for user in users)
    assert "createdAt" in users[0]
    assert "full_name" not in users[0]


def test_user_crud(client: TestClient, admin_headers: dict[str, str]) -> None:
    payload = {
        "fullName": "Test Person",
        "email": "test.person@appliance.local",
        "department": "finance",
    }
    created = client.post("/api/users", json=payload, headers=admin_headers)
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]

    duplicate = client.post("/api/users", json=payload, headers=admin_headers)
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["message"]

    updated = client.put(
        f"/api/users/{user_id}",
        json={**payload, "fullName": "Updated Person"},
        headers=admin_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["fullName"] == "Updated Person"

    deleted = client.delete(f"/api/users/{user_id}", headers=admin_headers)
    assert deleted.status_code == 204
    assert deleted.content == b""


def test_viewer_cannot_change_users(
    client: TestClient, viewer_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/users",
        json={
            "fullName": "Not Allowed",
            "email": "not.allowed@appliance.local",
            "department": "it",
        },
        headers=viewer_headers,
    )
    assert response.status_code == 403
    assert "permission" in response.json()["message"]


def test_extensions_are_seeded_and_hide_secrets(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.get("/api/extensions", headers=admin_headers)
    assert response.status_code == 200
    extensions = response.json()
    assert len(extensions) == 500
    assert extensions[0]["number"] == "100"
    assert extensions[-1]["number"] == "599"
    assert set(extensions[0]) == {
        "number",
        "userId",
        "enabled",
        "registered",
        "contactIp",
    }
    assert "secret" not in extensions[0]


def test_extension_validation(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/extensions",
        json={"number": "600", "userId": None, "secret": "abcdefgh", "enabled": True},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "100 to 599" in response.json()["message"]

    response = client.post(
        "/api/extensions",
        json={"number": "123", "userId": None, "secret": "short", "enabled": True},
        headers=admin_headers,
    )
    assert response.status_code == 422


def test_extension_crud_and_bulk(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    # Free a number, then create it through the API.
    assert (
        client.delete("/api/extensions/123", headers=admin_headers).status_code == 204
    )
    created = client.post(
        "/api/extensions",
        json={
            "number": "123",
            "userId": None,
            "secret": "abcdefgh",
            "enabled": True,
        },
        headers=admin_headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["number"] == "123"

    updated = client.put(
        "/api/extensions/123",
        json={
            "number": "123",
            "userId": None,
            "secret": "",
            "enabled": True,
        },
        headers=admin_headers,
    )
    assert updated.status_code == 200

    disabled = client.patch(
        "/api/extensions/123", json={"enabled": False}, headers=admin_headers
    )
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False

    # 598 is free now; 100 already exists and must be reported as skipped.
    client.delete("/api/extensions/598", headers=admin_headers)
    bulk = client.post(
        "/api/extensions/bulk",
        json={
            "extensions": [
                {"number": "598", "secret": "abcdefgh"},
                {"number": "100", "secret": "abcdefgh"},
            ],
            "enabled": True,
        },
        headers=admin_headers,
    )
    assert bulk.status_code == 200
    assert bulk.json() == {"created": ["598"], "skipped": ["100"]}


def test_viewer_cannot_create_extensions(
    client: TestClient, viewer_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/extensions",
        json={
            "number": "597",
            "userId": None,
            "secret": "abcdefgh",
            "enabled": True,
        },
        headers=viewer_headers,
    )
    assert response.status_code == 403


def test_dashboard_summary(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.get("/api/dashboard/summary", headers=admin_headers)
    assert response.status_code == 200
    summary = response.json()
    assert summary["asterisk"]["status"] == "stopped"
    assert summary["extensions"]["total"] == 500
    assert summary["calls"]["today"] == 0
    assert summary["recentCalls"] == []


def test_system_metrics(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.get("/api/system/metrics", headers=admin_headers)
    assert response.status_code == 200
    metrics = response.json()
    assert 0 <= metrics["cpuPercent"] <= 100
    assert metrics["memoryTotalMb"] > 0
    assert metrics["diskTotalGb"] > 0


def test_audit_log_is_admin_only(
    client: TestClient,
    admin_headers: dict[str, str],
    operator_headers: dict[str, str],
) -> None:
    assert client.get("/api/audit", headers=operator_headers).status_code == 403

    response = client.get("/api/audit", headers=admin_headers)
    assert response.status_code == 200
    actions = {entry["action"] for entry in response.json()}
    assert "login" in actions


def test_asterisk_status_when_offline(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    response = client.get("/api/asterisk/status", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "stopped"
