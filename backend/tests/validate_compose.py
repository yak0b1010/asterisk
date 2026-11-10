#!/usr/bin/env python3
"""Build and smoke-test the actual Compose stack with disposable project storage.

Uses the host SIP ports, so stop other PBXs first. Never uses the local .env.
Runs API provisioning, SIP registration/calling, and checks adaptive ODBC CDR.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

from sip_call import exercise_call

ROOT = Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    project = "pbx-smoke-" + uuid.uuid4().hex[:8]
    ports = [free_port() for _ in range(3)]
    secret = uuid.uuid4().hex
    overrides = {
        "ASTERISK_MODE": "realtime", "DEMO_DATA": os.environ.get("PBX_SMOKE_DEMO", "no"),
        "ASTERISK_APP_IMAGE": project + "-asterisk",
        "DB_PASSWORD": secret, "JWT_SECRET_KEY": uuid.uuid4().hex,
        "POSTGRES_HOST_PORT": str(ports[0]), "BACKEND_HOST_PORT": str(ports[1]),
        "FRONTEND_HOST_PORT": str(ports[2]),
    }
    with tempfile.TemporaryDirectory(prefix=project, dir=os.environ.get("DELTA_SCRATCH_DIR")) as temp:
        env_path = Path(temp) / "compose.env"
        lines = (ROOT / ".env.example").read_text().splitlines()
        lines = [line for line in lines if line.partition("=")[0] not in overrides]
        env_path.write_text("\n".join(lines + [f"{key}={value}" for key, value in overrides.items()]) + "\n")
        env = {**os.environ, **overrides, "APPLIANCE_ENV_FILE": str(env_path)}
        compose = ["docker", "compose", "--env-file", str(env_path), "-p", project]

        def run(*args, capture=False):
            return subprocess.run(compose + list(args), cwd=ROOT, env=env, check=True,
                                  text=True, capture_output=capture).stdout

        token = None

        def api(path, data=None, method=None):
            headers = {"Content-Type": "application/json"}
            if token:
                headers["Authorization"] = "Bearer " + token
            req = urllib.request.Request(
                f"http://127.0.0.1:{ports[2]}/api{path}", headers=headers,
                data=json.dumps(data).encode() if data is not None else None,
                method=method,
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                raise AssertionError(f"{path}: HTTP {error.code}: {error.read().decode()}") from error

        try:
            run("up", "--build", "-d")
            deadline = time.monotonic() + 90
            while True:
                try:
                    assert api("/health")["status"] == "ok"
                    break
                except Exception:
                    if time.monotonic() > deadline:
                        raise
                    time.sleep(1)
            token = api("/auth/login", {"username": "admin", "password": "admin123"})["token"]
            for path in ("/dashboard/stats", "/users", "/extensions", "/dialplan", "/voicemail", "/queues", "/cdr"):
                api(path)
            print("PASS: Compose startup, nginx API proxy, admin login and native-schema pages", flush=True)
            for number in ("7001", "7002"):
                api("/extensions", {"extension": number, "secret": secret})
            # Wait for the PBX CLI, then prove it resolves API-created endpoints.
            while True:
                try:
                    output = run("exec", "-T", "asterisk", "asterisk", "-rx",
                                 "pjsip show endpoint 7001", capture=True)
                    assert "7001" in output and "Unable to find" not in output
                    break
                except Exception:
                    if time.monotonic() > deadline:
                        raise
                    time.sleep(1)
            exercise_call(secret)
            print("PASS: two SIP digest registrations and 7001 → 7002 call with bidirectional RTP", flush=True)
            deadline = time.monotonic() + 20
            while True:
                cdr = api("/cdr")["items"]
                if any(row["dst"] == "7002" and row["disposition"] == "ANSWERED" for row in cdr):
                    break
                if time.monotonic() > deadline:
                    raise AssertionError("answered call did not reach adaptive ODBC CDR")
                time.sleep(1)
            print("PASS: answered call visible through CDR API", flush=True)
        except BaseException:
            run("logs", "--no-color", "--tail", "100")
            raise
        finally:
            run("down", "-v", "--remove-orphans")


if __name__ == "__main__":
    main()
