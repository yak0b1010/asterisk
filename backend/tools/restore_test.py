#!/usr/bin/env python3
"""Backup/restore and Asterisk realtime verification.

The test creates users, extensions, voicemail, queues, dialplan, a conference
and a backup, deletes the configuration objects, restores the backup, and then
checks that credentials, PINs and realtime rows came back.

By default the test removes everything it created.  Use ``--keep`` to leave the
objects and the backup in place for manual inspection; the printed JSON lists
the IDs and names.

Environment variables:
    API_BASE_URL       default http://127.0.0.1:8080
    ADMIN_USERNAME     default admin
    ADMIN_PASSWORD     default admin12345
    REQUIRE_DB_CHECK   set to 1 to fail when PostgreSQL cannot be inspected
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import urllib.error
import urllib.request
from pathlib import Path

# When this file is executed directly, Python puts tools/ (not backend/) on
# sys.path.  Add the backend root so the optional realtime inspection can
# import the application's configuration and database helpers.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE = os.getenv("API_BASE_URL", "http://127.0.0.1:8080").rstrip("/")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin12345")
TOKEN: str | None = None
FAILS: list[str] = []


def req(method: str, path: str, body=None, token: bool = True):
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
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, raw


def check(name: str, condition: bool, detail="") -> None:
    print(f"  {'ok  ' if condition else 'FAIL'} {name}" + ("" if condition else f" {detail}"))
    if not condition:
        FAILS.append(name)


def call(name: str, method: str, path: str, status: int, body=None):
    code, data = req(method, path, body)
    check(f"{name} ({method} {path} -> {status})", code == status, data)
    return data


def db_rows(statement: str, parameters: dict | None = None) -> list[tuple] | None:
    """Run a read-only query, returning None when the database is unreachable."""
    try:
        from sqlalchemy import text

        from app.config import load_config
        from app.database import build_engine

        engine = build_engine(load_config())
        try:
            with engine.connect() as connection:
                return list(connection.execute(text(statement), parameters or {}))
        finally:
            engine.dispose()
    except Exception as exc:  # pragma: no cover - depends on host setup
        print(f"  warn database inspection unavailable: {exc}")
        return None


def verify_realtime(
    ext: str,
    vm: str,
    queue: str,
    context: str,
    conference: str,
    sip: str,
) -> None:
    checks = [
        (
            "ps_endpoints",
            "SELECT count(*) FROM ps_endpoints WHERE id = :id",
            {"id": ext},
        ),
        (
            "ps_auths",
            "SELECT count(*) FROM ps_auths WHERE id = :id AND password = :password",
            {"id": ext, "password": sip},
        ),
        (
            "ps_aors",
            "SELECT count(*) FROM ps_aors WHERE id = :id",
            {"id": ext},
        ),
        (
            "voicemail",
            "SELECT count(*) FROM voicemail "
            "WHERE mailbox = :mailbox AND password = :password",
            {"mailbox": vm, "password": "8765"},
        ),
        (
            "queues",
            "SELECT count(*) FROM queues WHERE name = :name",
            {"name": queue},
        ),
        (
            "queue_members",
            "SELECT count(*) FROM queue_members "
            "WHERE queue_name = :queue AND interface = :interface",
            {"queue": queue, "interface": f"PJSIP/{ext}"},
        ),
        (
            "extensions",
            "SELECT count(*) FROM extensions "
            "WHERE context = :context AND exten = '200' AND appdata = :appdata",
            {"context": context, "appdata": f"PJSIP/{ext}"},
        ),
        (
            "meetme",
            "SELECT count(*) FROM meetme "
            "WHERE confno = :conference AND pin = :pin",
            {"conference": conference, "pin": "2468"},
        ),
    ]
    for name, statement, parameters in checks:
        rows = db_rows(statement, parameters)
        if rows is None:
            if os.getenv("REQUIRE_DB_CHECK") == "1":
                check(f"realtime {name}", False, "database unavailable")
            else:
                print(f"  skip realtime {name} (database unavailable)")
            continue
        check(f"realtime {name}", int(rows[0][0]) == 1, rows)


def main() -> int:
    global TOKEN
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--keep",
        action="store_true",
        help="leave the restored objects and backup for manual inspection",
    )
    args = parser.parse_args()

    unique = str(random.randint(1000, 9999))
    ext = "5" + unique[1:]
    vm = "4" + unique[1:]
    queue = "rq" + unique
    context = "rctx" + unique
    conference = "9" + unique[1:]
    sip = "SipPass" + unique + "x"
    username = "restore" + unique
    user_password = "ViewerPass" + unique + "!"
    created: list[tuple[str, str]] = []

    try:
        code, data = req(
            "POST",
            "/api/v1/auth/login",
            {"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
            token=False,
        )
        check("login", code == 200, data)
        if code != 200:
            return 1
        TOKEN = data["data"]["access_token"]

        user = call(
            "create viewer",
            "POST",
            "/api/v1/users",
            201,
            {
                "username": username,
                "password": user_password,
                "email": username + "@example.com",
                "full_name": "Restore Viewer",
                "role": "viewer",
            },
        )
        user_id = user["data"]["id"]
        created.append(("viewer", f"/api/v1/users/{user_id}"))

        ext_data = call(
            "create extension",
            "POST",
            "/api/v1/extensions",
            201,
            {
                "number": ext,
                "display_name": "Restore Test",
                "sip_password": sip,
                "voicemail_enabled": True,
                "voicemail_pin": "4321",
            },
        )
        ext_id = ext_data["data"]["id"]
        created.append(("extension", f"/api/v1/extensions/{ext_id}"))

        vm_data = call(
            "create voicemail",
            "POST",
            "/api/v1/voicemail",
            201,
            {"extension": vm, "pin": "8765", "name": "Restore Mailbox"},
        )
        vm_id = vm_data["data"]["id"]
        created.append(("voicemail", f"/api/v1/voicemail/{vm_id}"))

        q_data = call(
            "create queue",
            "POST",
            "/api/v1/queues",
            201,
            {"name": queue, "members": [{"extension": ext}]},
        )
        q_id = q_data["data"]["id"]
        created.append(("queue", f"/api/v1/queues/{q_id}"))

        rule = call(
            "create rule",
            "POST",
            "/api/v1/dialplan",
            201,
            {
                "context": context,
                "pattern": "200",
                "priority": 1,
                "app": "Dial",
                "app_data": "PJSIP/" + ext,
            },
        )
        rule_id = rule["data"]["id"]
        created.append(("dialplan", f"/api/v1/dialplan/{rule_id}"))

        conf = call(
            "create conference",
            "POST",
            "/api/v1/conferences",
            201,
            {"number": conference, "name": "Restore Room", "pin": "2468"},
        )
        conf_id = conf["data"]["id"]
        created.append(("conference", f"/api/v1/conferences/{conf_id}"))

        backup = call(
            "create backup",
            "POST",
            "/api/v1/backups",
            201,
            {"include_cdr": False},
        )
        backup_id = backup["data"]["id"]
        created.append(("backup", f"/api/v1/backups/{backup_id}"))

        # Remove everything that the backup should bring back.
        for label, path in reversed(created[:-1]):
            call(f"delete {label} before restore", "DELETE", path, 204)

        restored = call(
            "restore backup",
            "POST",
            f"/api/v1/backups/{backup_id}/restore",
            200,
        )
        check(
            "restore realtime synced",
            restored["data"].get("realtime_synced") is True,
            restored,
        )

        creds = call(
            "restored credentials",
            "GET",
            f"/api/v1/extensions/{ext}/credentials",
            200,
        )
        check("sip password restored", creds["data"]["sip_password"] == sip, creds)
        check(
            "voicemail pin restored",
            creds["data"]["voicemail_pin"] == "4321",
            creds,
        )

        box = call("restored voicemail", "GET", f"/api/v1/voicemail/{vm_id}", 200)
        check("voicemail box pin restored", box["data"].get("pin") == "8765", box)

        restored_queue = call("restored queue", "GET", f"/api/v1/queues/{queue}", 200)
        check(
            "queue member restored",
            restored_queue["data"]["members_count"] == 1,
            restored_queue,
        )

        restored_conf = call(
            "restored conference",
            "GET",
            f"/api/v1/conferences/{conference}",
            200,
        )
        check(
            "conference pin restored",
            restored_conf["data"].get("pin") == "2468",
            restored_conf,
        )

        code, viewer_login = req(
            "POST",
            "/api/v1/auth/login",
            {"username": username, "password": user_password},
            token=False,
        )
        check("user password hash restored", code == 200, viewer_login)

        verify_realtime(ext, vm, queue, context, conference, sip)

        if args.keep:
            print(
                json.dumps(
                    {
                        "viewer": username,
                        "viewer_id": user_id,
                        "ext_id": ext_id,
                        "ext": ext,
                        "vm_id": vm_id,
                        "vm": vm,
                        "q_id": q_id,
                        "queue": queue,
                        "rule_id": rule_id,
                        "context": context,
                        "conf_id": conf_id,
                        "conference": conference,
                        "backup_id": backup_id,
                    },
                    indent=2,
                )
            )
            print("Keeping test objects because --keep was supplied.")
        return 1 if FAILS else 0
    finally:
        if TOKEN and not args.keep:
            print("\n== Cleanup ==")
            for label, path in reversed(created):
                code, _ = req("DELETE", path)
                print(f"  {'ok  ' if code in (204, 404) else 'warn'} delete {label} -> {code}")


if __name__ == "__main__":
    sys.exit(main())
