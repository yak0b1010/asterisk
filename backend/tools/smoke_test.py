#!/usr/bin/env python3
"""End-to-end smoke test for the Asterisk backend API.

The test creates a temporary set of configuration objects, exercises every
public API area, takes a backup, restores it, and removes its own data again.
It is safe to run against a development appliance but it does replace the
configuration tables with the snapshot it just created, so do not run it while
somebody is editing the same instance.

Environment variables:
    API_BASE_URL       default http://127.0.0.1:8080
    ADMIN_USERNAME     default admin
    ADMIN_PASSWORD     default admin12345
"""

from __future__ import annotations

import json
import os
import random
import sys
import urllib.error
import urllib.request

BASE = os.getenv("API_BASE_URL", "http://127.0.0.1:8080").rstrip("/")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin12345")
TOKEN: str | None = None
FAILS: list[str] = []
CLEANUP: list[tuple[str, str]] = []


def req(
    method: str,
    path: str,
    body=None,
    token: bool = True,
    raw: bool = False,
):
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token and TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    request = urllib.request.Request(
        BASE + path, data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
            content_type = response.headers.get("Content-Type", "")
            if raw:
                return response.status, response.headers, payload
            if "json" in content_type and payload:
                return response.status, response.headers, json.loads(payload)
            return response.status, response.headers, payload
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        try:
            parsed = json.loads(payload)
        except Exception:
            parsed = payload
        return exc.code, exc.headers, parsed


def check(name: str, condition: bool, detail="") -> None:
    if condition:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILS.append(name)


def expect(
    name: str,
    method: str,
    path: str,
    status: int,
    body=None,
    token: bool = True,
    raw: bool = False,
):
    code, headers, data = req(method, path, body, token=token, raw=raw)
    detail = data if not raw else data[:200]
    check(f"{method} {path} -> {status}", code == status, f"(got {code}: {detail!r})")
    return code, headers, data


def section(title: str) -> None:
    print(f"\n== {title} ==")


def track(label: str, path: str) -> None:
    CLEANUP.append((label, path))


def remove(label: str, path: str, status: int = 204) -> None:
    code, _, _ = expect(f"delete {label}", "DELETE", path, status)
    if code == status:
        for index, (_, tracked) in enumerate(CLEANUP):
            if tracked == path:
                del CLEANUP[index]
                break


def best_effort_cleanup() -> None:
    if not TOKEN:
        return
    leftovers = list(reversed(CLEANUP))
    CLEANUP.clear()
    if not leftovers:
        return
    print("\n== Cleanup after interruption ==")
    for label, path in leftovers:
        code, _, _ = req("DELETE", path)
        print(f"  {'ok  ' if code in (204, 404) else 'warn'} cleanup {label} -> {code}")


def main() -> int:
    global TOKEN
    unique = str(random.randint(1000, 9999))
    username = "smoke" + unique
    ext_number = "7" + unique[1:]
    vm_ext = "6" + unique[1:]
    queue_name = "smokeq" + unique
    ivr_name = "smokeivr" + unique
    conf_number = "8" + unique[1:]
    context = "smokectx" + unique
    setting_key = "smoke.setting." + unique

    try:
        section("Health and auth")
        expect("health", "GET", "/health", 200, token=False)
        expect("ready", "GET", "/ready", 200, token=False)
        code, _, data = expect(
            "login",
            "POST",
            "/api/v1/auth/login",
            200,
            {"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
            token=False,
        )
        if code != 200:
            print("\nCannot continue without a valid administrator login.")
            return 1
        TOKEN = data["data"]["access_token"]
        refresh_token = data["data"]["refresh_token"]
        check(
            "login permission list",
            "extensions.write" in data["data"]["permissions"],
        )
        expect("me", "GET", "/api/v1/auth/me", 200)
        expect("permissions", "GET", "/api/v1/auth/permissions", 200)
        expect("sessions", "GET", "/api/v1/auth/sessions", 200)
        expect(
            "bad login",
            "POST",
            "/api/v1/auth/login",
            401,
            {"username": ADMIN_USERNAME, "password": "wrong-password"},
            token=False,
        )
        expect("no token", "GET", "/api/v1/auth/me", 401, token=False)

        section("Users")
        _, _, created_user = expect(
            "create user",
            "POST",
            "/api/v1/users",
            201,
            {
                "username": username,
                "password": "Password123!",
                "email": username + "@example.com",
                "full_name": "Smoke User",
                "role": "viewer",
            },
        )
        user_id = created_user["data"]["id"]
        track("user", f"/api/v1/users/{user_id}")
        expect("list users", "GET", "/api/v1/users?search=" + username, 200)
        expect("get user", "GET", f"/api/v1/users/{user_id}", 200)
        expect(
            "update user",
            "PATCH",
            f"/api/v1/users/{user_id}",
            200,
            {"full_name": "Smoke Updated"},
        )
        expect("user extensions", "GET", f"/api/v1/users/{user_id}/extensions", 200)
        expect(
            "reset password",
            "POST",
            f"/api/v1/users/{user_id}/password",
            200,
            {"new_password": "Password456!"},
        )

        section("Extensions")
        _, _, created_ext = expect(
            "create extension",
            "POST",
            "/api/v1/extensions",
            201,
            {
                "number": ext_number,
                "display_name": "Smoke Phone",
                "codecs": "ulaw,alaw",
                "voicemail_enabled": True,
                "voicemail_pin": "1234",
                "user_id": user_id,
            },
        )
        ext_id = created_ext["data"]["id"]
        track("extension", f"/api/v1/extensions/{ext_id}")
        check(
            "sip password returned for admin",
            bool(created_ext["data"].get("sip_password")),
        )
        check(
            "voicemail pin returned for admin",
            created_ext["data"].get("voicemail_pin") == "1234",
        )
        expect("list extensions", "GET", "/api/v1/extensions?search=" + ext_number, 200)
        expect("get extension", "GET", f"/api/v1/extensions/{ext_number}", 200)
        expect(
            "extension credentials",
            "GET",
            f"/api/v1/extensions/{ext_id}/credentials",
            200,
        )
        expect("extension status", "GET", f"/api/v1/extensions/{ext_id}/status", 200)
        expect("extension statuses", "GET", "/api/v1/extensions/status", 200)
        expect("registrations", "GET", "/api/v1/extensions/registrations", 200)
        expect(
            "update extension",
            "PATCH",
            f"/api/v1/extensions/{ext_id}",
            200,
            {"display_name": "Smoke Renamed"},
        )
        expect(
            "enable voicemail without pin rejected",
            "PATCH",
            f"/api/v1/extensions/{ext_id}",
            400,
            {"voicemail_enabled": True, "voicemail_pin": ""},
        )
        expect("reload extensions", "POST", f"/api/v1/extensions/{ext_id}/reload", 200)

        section("Dialplan")
        _, _, created_rule = expect(
            "create dialplan",
            "POST",
            "/api/v1/dialplan",
            201,
            {
                "context": context,
                "pattern": "123",
                "priority": 1,
                "app": "Dial",
                "app_data": "PJSIP/" + ext_number,
            },
        )
        rule_id = created_rule["data"]["id"]
        track("dialplan", f"/api/v1/dialplan/{rule_id}")
        expect("list dialplan", "GET", "/api/v1/dialplan?context=" + context, 200)
        expect("dialplan contexts", "GET", "/api/v1/dialplan/contexts", 200)
        expect(
            "dialplan export",
            "GET",
            "/api/v1/dialplan/export?context=" + context,
            200,
            raw=True,
        )
        expect(
            "update dialplan",
            "PATCH",
            f"/api/v1/dialplan/{rule_id}",
            200,
            {"priority": 2},
        )
        expect("reload dialplan", "POST", "/api/v1/dialplan/reload", 200)

        section("Voicemail")
        _, _, created_vm = expect(
            "create voicemail",
            "POST",
            "/api/v1/voicemail",
            201,
            {
                "extension": vm_ext,
                "context": "internal",
                "name": "Smoke Mailbox",
                "email": "vm@example.com",
                "pin": "5678",
                "max_messages": 25,
            },
        )
        vm_id = created_vm["data"]["id"]
        track("voicemail", f"/api/v1/voicemail/{vm_id}")
        expect("list voicemail", "GET", "/api/v1/voicemail?search=" + vm_ext, 200)
        expect("get voicemail", "GET", f"/api/v1/voicemail/{vm_id}", 200)
        expect(
            "update voicemail",
            "PATCH",
            f"/api/v1/voicemail/{vm_id}",
            200,
            {"max_messages": 30},
        )
        expect("reload voicemail", "POST", "/api/v1/voicemail/reload", 200)

        section("Queues")
        _, _, created_queue = expect(
            "create queue",
            "POST",
            "/api/v1/queues",
            201,
            {
                "name": queue_name,
                "strategy": "ringall",
                "timeout": 20,
                "members": [{"extension": ext_number, "penalty": 1}],
            },
        )
        queue_id = created_queue["data"]["id"]
        track("queue", f"/api/v1/queues/{queue_id}")
        check("queue member count", created_queue["data"]["members_count"] == 1)
        expect("list queues", "GET", "/api/v1/queues?search=" + queue_name, 200)
        expect("get queue", "GET", f"/api/v1/queues/{queue_name}", 200)
        expect("queue members", "GET", f"/api/v1/queues/{queue_id}/members", 200)
        _, _, members = req("GET", f"/api/v1/queues/{queue_id}/members")
        member_id = members["data"][0]["id"]
        expect(
            "update member",
            "PATCH",
            f"/api/v1/queues/{queue_id}/members/{member_id}",
            200,
            {"paused": True, "penalty": 2},
        )
        expect(
            "add member",
            "POST",
            f"/api/v1/queues/{queue_id}/members",
            201,
            {"extension": vm_ext},
        )
        expect("queue status", "GET", "/api/v1/queues/status", 200)
        expect("reload queues", "POST", "/api/v1/queues/reload", 200)

        section("IVR")
        _, _, created_ivr = expect(
            "create ivr",
            "POST",
            "/api/v1/ivr",
            201,
            {
                "name": ivr_name,
                "greeting_sound": "ivr-welcome",
                "timeout": 5,
                "options": [
                    {
                        "digit": "1",
                        "destination_type": "extension",
                        "destination": ext_number,
                    }
                ],
            },
        )
        ivr_id = created_ivr["data"]["id"]
        track("ivr", f"/api/v1/ivr/{ivr_id}")
        expect("list ivr", "GET", "/api/v1/ivr?search=" + ivr_name, 200)
        expect("get ivr", "GET", f"/api/v1/ivr/{ivr_name}", 200)
        expect(
            "replace ivr options",
            "PUT",
            f"/api/v1/ivr/{ivr_id}/options",
            200,
            {
                "options": [
                    {
                        "digit": "1",
                        "destination_type": "extension",
                        "destination": ext_number,
                    },
                    {
                        "digit": "2",
                        "destination_type": "queue",
                        "destination": queue_name,
                    },
                ]
            },
        )
        expect("ivr dialplan", "GET", f"/api/v1/ivr/{ivr_id}/dialplan", 200, raw=True)
        expect("reload ivr", "POST", f"/api/v1/ivr/{ivr_id}/reload", 200)

        section("Conferences")
        _, _, created_conf = expect(
            "create conference",
            "POST",
            "/api/v1/conferences",
            201,
            {
                "number": conf_number,
                "name": "Smoke Room",
                "pin": "9999",
                "max_members": 20,
            },
        )
        conf_id = created_conf["data"]["id"]
        track("conference", f"/api/v1/conferences/{conf_id}")
        expect("list conferences", "GET", "/api/v1/conferences?search=" + conf_number, 200)
        expect("get conference", "GET", f"/api/v1/conferences/{conf_number}", 200)
        expect(
            "conference dialplan",
            "GET",
            f"/api/v1/conferences/{conf_id}/dialplan",
            200,
            raw=True,
        )
        expect("live conferences", "GET", "/api/v1/conferences/live", 200)

        section("CDR")
        _, _, created_cdr = expect(
            "ingest cdr",
            "POST",
            "/api/v1/cdr",
            201,
            {
                "src": ext_number,
                "dst": vm_ext,
                "disposition": "ANSWERED",
                "duration": 42,
                "billsec": 30,
                "dcontext": "internal",
                "accountcode": "smoke",
            },
        )
        cdr_id = created_cdr["data"]["id"]
        track("cdr", f"/api/v1/cdr/{cdr_id}")
        expect("list cdr", "GET", "/api/v1/cdr?src=" + ext_number, 200)
        expect("cdr stats", "GET", "/api/v1/cdr/stats?src=" + ext_number, 200)
        expect(
            "cdr export",
            "GET",
            "/api/v1/cdr/export?src=" + ext_number,
            200,
            raw=True,
        )
        expect("get cdr", "GET", f"/api/v1/cdr/{cdr_id}", 200)

        section("Monitoring")
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
            expect("monitoring " + part, "GET", "/api/v1/monitoring/" + part, 200)
        expect("metrics", "GET", "/metrics", 200, token=False, raw=True)

        section("Audit")
        expect("audit list", "GET", "/api/v1/audit?limit=5", 200)
        _, _, audits = req("GET", "/api/v1/audit?limit=1")
        if audits["data"]:
            expect("audit get", "GET", f"/api/v1/audit/{audits['data'][0]['id']}", 200)

        section("Settings")
        expect("settings list", "GET", "/api/v1/settings", 200)
        expect("setting get", "GET", "/api/v1/settings/pbx.name", 200)
        expect(
            "setting update",
            "PUT",
            f"/api/v1/settings/{setting_key}",
            200,
            {"value": {"enabled": True, "count": 3}, "description": "smoke"},
        )
        track("setting", f"/api/v1/settings/{setting_key}")
        expect("setting get new", "GET", f"/api/v1/settings/{setting_key}", 200)

        section("Backups")
        _, _, backup = expect(
            "create backup",
            "POST",
            "/api/v1/backups",
            201,
            {"include_cdr": True},
        )
        backup_id = backup["data"]["id"]
        track("backup", f"/api/v1/backups/{backup_id}")
        expect("list backups", "GET", "/api/v1/backups", 200)
        expect("get backup", "GET", f"/api/v1/backups/{backup_id}", 200)
        _, _, blob = expect(
            "download backup",
            "GET",
            f"/api/v1/backups/{backup_id}/download",
            200,
            raw=True,
        )
        check("backup gzip magic", blob[:2] == b"\x1f\x8b", blob[:10])
        _, _, restored = expect(
            "restore backup",
            "POST",
            f"/api/v1/backups/{backup_id}/restore",
            200,
        )
        check(
            "restore rebuilt realtime tables",
            restored["data"].get("realtime_synced") is True,
            restored,
        )

        section("Authorization (viewer)")
        code, _, login_viewer = req(
            "POST",
            "/api/v1/auth/login",
            {"username": username, "password": "Password456!"},
            token=False,
        )
        check("viewer login with reset password", code == 200, login_viewer)
        if code == 200:
            viewer_token = login_viewer["data"]["access_token"]
            old = TOKEN
            TOKEN = viewer_token
            expect(
                "viewer cannot create extension",
                "POST",
                "/api/v1/extensions",
                403,
                {"number": "9999"},
            )
            expect("viewer can read extensions", "GET", "/api/v1/extensions", 200)
            TOKEN = old

        section("Refresh and logout")
        code, _, refreshed = req(
            "POST",
            "/api/v1/auth/refresh",
            {"refresh_token": refresh_token},
            token=False,
        )
        check("refresh token", code == 200, refreshed)
        if code == 200:
            expect(
                "logout specific session",
                "POST",
                "/api/v1/auth/logout",
                204,
                {"refresh_token": refreshed["data"]["refresh_token"]},
            )
        expect("logout", "POST", "/api/v1/auth/logout", 204)

        section("Cleanup")
        remove("cdr", f"/api/v1/cdr/{cdr_id}")
        remove("conference", f"/api/v1/conferences/{conf_id}")
        remove("ivr", f"/api/v1/ivr/{ivr_id}")
        remove("queue", f"/api/v1/queues/{queue_id}")
        remove("voicemail", f"/api/v1/voicemail/{vm_id}")
        remove("dialplan", f"/api/v1/dialplan/{rule_id}")
        remove("extension", f"/api/v1/extensions/{ext_id}")
        remove("setting", f"/api/v1/settings/{setting_key}")
        remove("backup", f"/api/v1/backups/{backup_id}")
        remove("user", f"/api/v1/users/{user_id}")

        section("Dashboard")
        expect("dashboard stats", "GET", "/api/v1/dashboard/stats", 200)
        expect("dashboard recent calls", "GET", "/api/v1/dashboard/recent-calls?limit=5", 200)

        print(
            "\n"
            + (
                "ALL CHECKS PASSED"
                if not FAILS
                else f"{len(FAILS)} FAILURES: {FAILS}"
            )
        )
        return 1 if FAILS else 0
    finally:
        best_effort_cleanup()


if __name__ == "__main__":
    sys.exit(main())
