"""Integration tests against PostgreSQL.

Run with the normal ``pytest`` command from ``backend/``.  The fixtures skip
these tests automatically when PostgreSQL is not reachable.
"""

from __future__ import annotations

from sqlalchemy import text


def scalar(client, statement: str, parameters: dict | None = None) -> int:
    with client.app.state.engine.connect() as connection:
        return int(connection.execute(text(statement), parameters or {}).scalar_one())


def test_health_and_auth(client, admin_login):
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    ready = client.get("/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"]["database"] == "up"

    bad = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "definitely-wrong"},
    )
    assert bad.status_code == 401

    headers = {"Authorization": "Bearer " + admin_login["access_token"]}
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["data"]["user"]["username"] == "admin"

    permissions = client.get("/api/v1/auth/permissions", headers=headers)
    assert permissions.status_code == 200
    assert "extensions.write" in permissions.json()["data"]["permissions"]

    sessions = client.get("/api/v1/auth/sessions", headers=headers)
    assert sessions.status_code == 200

    refreshed = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": admin_login["refresh_token"]},
    )
    assert refreshed.status_code == 200
    logout = client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": refreshed.json()["data"]["refresh_token"]},
        headers=headers,
    )
    assert logout.status_code == 204


def test_users_crud(client, auth_headers, cleanup, unique):
    username = "pytest" + unique
    response = client.post(
        "/api/v1/users",
        headers=auth_headers,
        json={
            "username": username,
            "password": "Password123!",
            "email": username + "@example.com",
            "full_name": "Pytest User",
            "role": "viewer",
        },
    )
    assert response.status_code == 201, response.text
    user = response.json()["data"]
    user_id = user["id"]
    cleanup.add(f"/api/v1/users/{user_id}")
    assert "password_hash" not in user
    assert user["role"] == "viewer"

    found = client.get(f"/api/v1/users?search={username}", headers=auth_headers)
    assert found.status_code == 200
    assert any(item["id"] == user_id for item in found.json()["data"])

    detail = client.get(f"/api/v1/users/{user_id}", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["data"]["username"] == username

    updated = client.patch(
        f"/api/v1/users/{user_id}",
        headers=auth_headers,
        json={"full_name": "Pytest Updated"},
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["full_name"] == "Pytest Updated"

    extensions = client.get(
        f"/api/v1/users/{user_id}/extensions", headers=auth_headers
    )
    assert extensions.status_code == 200
    assert extensions.json()["data"] == []

    reset = client.post(
        f"/api/v1/users/{user_id}/password",
        headers=auth_headers,
        json={"new_password": "Password456!"},
    )
    assert reset.status_code == 200

    login = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "Password456!"},
    )
    assert login.status_code == 200

    deleted = client.delete(f"/api/v1/users/{user_id}", headers=auth_headers)
    assert deleted.status_code == 204
    cleanup.remove(f"/api/v1/users/{user_id}")
    assert client.get(f"/api/v1/users/{user_id}", headers=auth_headers).status_code == 404


def test_extension_and_realtime_mirror(client, auth_headers, cleanup, unique):
    number = "7" + unique[1:]
    sip = "SipPass" + unique
    response = client.post(
        "/api/v1/extensions",
        headers=auth_headers,
        json={
            "number": number,
            "display_name": "Pytest Phone",
            "sip_password": sip,
            "voicemail_enabled": True,
            "voicemail_pin": "4321",
        },
    )
    assert response.status_code == 201, response.text
    extension = response.json()["data"]
    extension_id = extension["id"]
    cleanup.add(f"/api/v1/extensions/{extension_id}")
    assert extension["sip_password"] == sip
    assert extension["voicemail_pin"] == "4321"

    assert scalar(client, "SELECT count(*) FROM ps_endpoints WHERE id = :id", {"id": number}) == 1
    assert (
        scalar(
            client,
            "SELECT count(*) FROM ps_auths WHERE id = :id AND password = :password",
            {"id": number, "password": sip},
        )
        == 1
    )
    assert scalar(client, "SELECT count(*) FROM ps_aors WHERE id = :id", {"id": number}) == 1

    credentials = client.get(
        f"/api/v1/extensions/{extension_id}/credentials", headers=auth_headers
    )
    assert credentials.status_code == 200
    assert credentials.json()["data"]["sip_password"] == sip

    updated = client.patch(
        f"/api/v1/extensions/{extension_id}",
        headers=auth_headers,
        json={"display_name": "Pytest Renamed"},
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["display_name"] == "Pytest Renamed"

    deleted = client.delete(
        f"/api/v1/extensions/{extension_id}", headers=auth_headers
    )
    assert deleted.status_code == 204
    cleanup.remove(f"/api/v1/extensions/{extension_id}")
    assert scalar(client, "SELECT count(*) FROM ps_endpoints WHERE id = :id", {"id": number}) == 0
    assert scalar(client, "SELECT count(*) FROM ps_auths WHERE id = :id", {"id": number}) == 0


def test_voicemail_queue_and_dialplan_realtime(client, auth_headers, cleanup, unique):
    extension_number = "7" + unique[1:]
    mailbox = "4" + unique[1:]
    queue_name = "pytestq" + unique
    context = "pytestctx" + unique

    extension = client.post(
        "/api/v1/extensions",
        headers=auth_headers,
        json={"number": extension_number, "display_name": "Queue Member"},
    )
    assert extension.status_code == 201, extension.text
    extension_id = extension.json()["data"]["id"]
    cleanup.add(f"/api/v1/extensions/{extension_id}")

    voicemail = client.post(
        "/api/v1/voicemail",
        headers=auth_headers,
        json={
            "extension": mailbox,
            "name": "Pytest Mailbox",
            "pin": "8765",
            "max_messages": 30,
        },
    )
    assert voicemail.status_code == 201, voicemail.text
    voicemail_id = voicemail.json()["data"]["id"]
    cleanup.add(f"/api/v1/voicemail/{voicemail_id}")
    assert (
        scalar(
            client,
            "SELECT count(*) FROM voicemail WHERE mailbox = :mailbox AND password = '8765'",
            {"mailbox": mailbox},
        )
        == 1
    )

    queue = client.post(
        "/api/v1/queues",
        headers=auth_headers,
        json={
            "name": queue_name,
            "strategy": "ringall",
            "timeout": 20,
            "members": [{"extension": extension_number, "penalty": 1}],
        },
    )
    assert queue.status_code == 201, queue.text
    queue_id = queue.json()["data"]["id"]
    cleanup.add(f"/api/v1/queues/{queue_id}")
    assert queue.json()["data"]["members_count"] == 1
    assert (
        scalar(
            client,
            "SELECT count(*) FROM queue_members "
            "WHERE queue_name = :queue AND interface = :interface",
            {"queue": queue_name, "interface": f"PJSIP/{extension_number}"},
        )
        == 1
    )

    rule = client.post(
        "/api/v1/dialplan",
        headers=auth_headers,
        json={
            "context": context,
            "pattern": "200",
            "priority": 1,
            "app": "Dial",
            "app_data": "PJSIP/" + extension_number,
        },
    )
    assert rule.status_code == 201, rule.text
    rule_id = rule.json()["data"]["id"]
    cleanup.add(f"/api/v1/dialplan/{rule_id}")
    assert (
        scalar(
            client,
            "SELECT count(*) FROM extensions "
            "WHERE context = :context AND exten = '200' AND appdata = :appdata",
            {"context": context, "appdata": f"PJSIP/{extension_number}"},
        )
        == 1
    )

    for path in (
        f"/api/v1/voicemail/{voicemail_id}",
        f"/api/v1/queues/{queue_id}",
        f"/api/v1/dialplan/{rule_id}",
        f"/api/v1/extensions/{extension_id}",
    ):
        response = client.delete(path, headers=auth_headers)
        assert response.status_code == 204, (path, response.text)
        cleanup.remove(path)

    assert scalar(client, "SELECT count(*) FROM voicemail WHERE mailbox = :mailbox", {"mailbox": mailbox}) == 0
    assert scalar(client, "SELECT count(*) FROM queues WHERE name = :name", {"name": queue_name}) == 0
    assert scalar(client, "SELECT count(*) FROM extensions WHERE context = :context", {"context": context}) == 0


def test_ivr_and_conference(client, auth_headers, cleanup, unique):
    ivr_name = "pytestivr" + unique
    conference_number = "8" + unique[1:]

    ivr = client.post(
        "/api/v1/ivr",
        headers=auth_headers,
        json={
            "name": ivr_name,
            "greeting_sound": "ivr-welcome",
            "options": [
                {
                    "digit": "1",
                    "destination_type": "playback",
                    "destination": "demo-congrats",
                }
            ],
        },
    )
    assert ivr.status_code == 201, ivr.text
    ivr_id = ivr.json()["data"]["id"]
    cleanup.add(f"/api/v1/ivr/{ivr_id}")

    options = client.put(
        f"/api/v1/ivr/{ivr_id}/options",
        headers=auth_headers,
        json={
            "options": [
                {
                    "digit": "1",
                    "destination_type": "playback",
                    "destination": "demo-congrats",
                },
                {
                    "digit": "2",
                    "destination_type": "playback",
                    "destination": "demo-instruct",
                },
            ]
        },
    )
    assert options.status_code == 200
    assert len(options.json()["data"]) == 2

    dialplan = client.get(f"/api/v1/ivr/{ivr_id}/dialplan", headers=auth_headers)
    assert dialplan.status_code == 200
    assert f"[ivr-{ivr_name}]" in dialplan.text

    conference = client.post(
        "/api/v1/conferences",
        headers=auth_headers,
        json={
            "number": conference_number,
            "name": "Pytest Room",
            "pin": "2468",
            "max_members": 15,
        },
    )
    assert conference.status_code == 201, conference.text
    conference_id = conference.json()["data"]["id"]
    cleanup.add(f"/api/v1/conferences/{conference_id}")
    assert (
        scalar(
            client,
            "SELECT count(*) FROM meetme WHERE confno = :confno AND pin = '2468'",
            {"confno": conference_number},
        )
        == 1
    )

    for path in (
        f"/api/v1/conferences/{conference_id}",
        f"/api/v1/ivr/{ivr_id}",
    ):
        response = client.delete(path, headers=auth_headers)
        assert response.status_code == 204, (path, response.text)
        cleanup.remove(path)


def test_backup_create_download_delete(client, auth_headers, cleanup):
    created = client.post(
        "/api/v1/backups",
        headers=auth_headers,
        json={"include_cdr": False},
    )
    assert created.status_code == 201, created.text
    backup = created.json()["data"]
    backup_id = backup["id"]
    cleanup.add(f"/api/v1/backups/{backup_id}")
    assert backup["status"] == "completed"

    listed = client.get("/api/v1/backups", headers=auth_headers)
    assert listed.status_code == 200
    assert any(item["id"] == backup_id for item in listed.json()["data"])

    detail = client.get(f"/api/v1/backups/{backup_id}", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["data"]["size_bytes"] > 0

    download = client.get(
        f"/api/v1/backups/{backup_id}/download", headers=auth_headers
    )
    assert download.status_code == 200
    assert download.content[:2] == b"\x1f\x8b"

    deleted = client.delete(f"/api/v1/backups/{backup_id}", headers=auth_headers)
    assert deleted.status_code == 204
    cleanup.remove(f"/api/v1/backups/{backup_id}")
    assert client.get(f"/api/v1/backups/{backup_id}", headers=auth_headers).status_code == 404


def test_cdr_dashboard_and_monitoring(client, auth_headers, cleanup, unique):
    source = "7" + unique[1:]
    destination = "4" + unique[1:]
    cdr = client.post(
        "/api/v1/cdr",
        headers=auth_headers,
        json={
            "src": source,
            "dst": destination,
            "disposition": "ANSWERED",
            "duration": 42,
            "billsec": 30,
            "dcontext": "internal",
        },
    )
    assert cdr.status_code == 201, cdr.text
    cdr_id = cdr.json()["data"]["id"]
    cleanup.add(f"/api/v1/cdr/{cdr_id}")

    listed = client.get(f"/api/v1/cdr?src={source}", headers=auth_headers)
    assert listed.status_code == 200
    assert any(item["id"] == cdr_id for item in listed.json()["data"])

    stats = client.get(f"/api/v1/cdr/stats?src={source}", headers=auth_headers)
    assert stats.status_code == 200
    assert stats.json()["data"]["total"] == 1
    assert stats.json()["data"]["answered"] == 1

    exported = client.get(f"/api/v1/cdr/export?src={source}", headers=auth_headers)
    assert exported.status_code == 200
    assert source in exported.text

    dashboard = client.get("/api/v1/dashboard/stats", headers=auth_headers)
    assert dashboard.status_code == 200
    assert "calls" in dashboard.json()["data"]

    recent = client.get("/api/v1/dashboard/recent-calls?limit=5", headers=auth_headers)
    assert recent.status_code == 200

    for part in (
        "status",
        "system",
        "asterisk",
        "calls",
        "endpoints",
        "registrations",
        "queues",
        "conferences",
    ):
        response = client.get(f"/api/v1/monitoring/{part}", headers=auth_headers)
        assert response.status_code == 200, (part, response.text)

    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert "asterisk_backend_db_up" in metrics.text

    deleted = client.delete(f"/api/v1/cdr/{cdr_id}", headers=auth_headers)
    assert deleted.status_code == 204
    cleanup.remove(f"/api/v1/cdr/{cdr_id}")


def test_settings_and_audit(client, auth_headers, cleanup, unique):
    key = "pytest.setting." + unique
    response = client.put(
        f"/api/v1/settings/{key}",
        headers=auth_headers,
        json={"value": {"enabled": True, "count": 3}, "description": "pytest"},
    )
    assert response.status_code == 200, response.text
    cleanup.add(f"/api/v1/settings/{key}")
    assert response.json()["data"]["value"] == {"enabled": True, "count": 3}

    fetched = client.get(f"/api/v1/settings/{key}", headers=auth_headers)
    assert fetched.status_code == 200

    listed = client.get("/api/v1/settings?search=" + key, headers=auth_headers)
    assert listed.status_code == 200
    assert len(listed.json()["data"]) == 1

    audit = client.get("/api/v1/audit?limit=1", headers=auth_headers)
    assert audit.status_code == 200
    entries = audit.json()["data"]
    assert entries
    detail = client.get(f"/api/v1/audit/{entries[0]['id']}", headers=auth_headers)
    assert detail.status_code == 200

    deleted = client.delete(f"/api/v1/settings/{key}", headers=auth_headers)
    assert deleted.status_code == 204
    cleanup.remove(f"/api/v1/settings/{key}")


def test_viewer_permissions(client, auth_headers, cleanup, unique):
    username = "pytestviewer" + unique
    created = client.post(
        "/api/v1/users",
        headers=auth_headers,
        json={
            "username": username,
            "password": "Password123!",
            "email": username + "@example.com",
            "role": "viewer",
        },
    )
    assert created.status_code == 201, created.text
    user_id = created.json()["data"]["id"]
    cleanup.add(f"/api/v1/users/{user_id}")

    login = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "Password123!"},
    )
    assert login.status_code == 200
    viewer_headers = {
        "Authorization": "Bearer " + login.json()["data"]["access_token"]
    }

    assert client.get("/api/v1/extensions", headers=viewer_headers).status_code == 200
    denied = client.post(
        "/api/v1/extensions",
        headers=viewer_headers,
        json={"number": "9999"},
    )
    assert denied.status_code == 403

    deleted = client.delete(f"/api/v1/users/{user_id}", headers=auth_headers)
    assert deleted.status_code == 204
    cleanup.remove(f"/api/v1/users/{user_id}")
