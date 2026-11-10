#!/usr/bin/env python3
"""Run Flask integration checks on fresh demo-off/on PostgreSQL databases.

First build: docker build -t asterisk-backend-validation:local ./backend
Uses only disposable databases; no HTTP server, PBX, or frontend is started.
"""
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "db/tests"))
import validate_init as init


def main():
    init.docker("network", "create", init.PREFIX)
    init.NETWORK_CREATED = True
    for mode in ("no", "yes"):
        postgres = init.start(mode)
        os.environ["DB_PASSWORD"] = init.docker(
            "exec", postgres, "printenv", "POSTGRES_PASSWORD"
        ).stdout.strip()
        client = init.PREFIX + "-backend-" + mode
        init.CONTAINERS.append(client)
        try:
            result = init.docker(
                "run", "--rm", "--name", client, "--network", init.PREFIX,
                "-e", f"DB_HOST={postgres}", "-e", "DB_PORT=5432",
                "-e", "DB_NAME=asterisk", "-e", "DB_USER=asterisk", "-e", "DB_PASSWORD",
                "-e", "PROVISIONING_TEST_DB=yes",
                "asterisk-backend-validation:local",
                "python", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v",
            )
            print(result.stdout + result.stderr, flush=True)
            print(f"PASS: extension API/database integration, DEMO_DATA={mode}", flush=True)
        finally:
            os.environ.pop("DB_PASSWORD", None)


if __name__ == "__main__":
    try:
        main()
    finally:
        for container in reversed(init.CONTAINERS):
            init.docker("rm", "-f", "-v", container, check=False)
        for volume in reversed(init.VOLUMES):
            init.docker("volume", "rm", volume, check=False)
        if init.NETWORK_CREATED:
            init.docker("network", "rm", init.PREFIX, check=False)
