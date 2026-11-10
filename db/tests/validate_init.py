#!/usr/bin/env python3
"""Validate fresh initialization using disposable PostgreSQL containers.

Requires Python 3 and Docker. No application services or Asterisk are started.
Only this invocation's containers/volumes/network are removed, even on failure.
No project .env credentials are used; only its PostgreSQL version/host port
are read (falling back to .env.example when .env does not exist).
"""

import os
from pathlib import Path
import secrets
import subprocess
import time
import uuid


ROOT = Path(__file__).resolve().parents[2]
PREFIX = "asterisk-db-check-" + uuid.uuid4().hex[:10]
CONTAINERS = []
VOLUMES = []
NETWORK_CREATED = False


def docker(*args, input=None, check=True):
    result = subprocess.run(
        ["docker", *args], input=input, text=True, capture_output=True
    )
    if check and result.returncode:
        raise RuntimeError(f"docker {args[0]} failed:\n{result.stdout}{result.stderr}")
    return result


def setting(name):
    env_file = ROOT / ".env"
    if not env_file.is_file():
        env_file = ROOT / ".env.example"
    for line in env_file.read_text().splitlines():
        key, separator, value = line.strip().partition("=")
        if separator and key == name:
            return value.strip().strip("'\"")
    raise RuntimeError(f"{name} must be defined in {env_file.name}")


def sql(container, query, *, database="asterisk", check=True):
    return docker(
        "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1",
        "-U", "asterisk", "-d", database, "-At", input=query, check=check
    )


def equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")
    print(f"PASS: {label}", flush=True)


def count(container, table, expected, *, database="asterisk"):
    result = sql(container, f'SELECT count(*) FROM "{table}";', database=database)
    equal(result.stdout.strip(), str(expected), f"{database}.{table} count")


def start(mode, publish=False):
    name = f"{PREFIX}-{mode}"
    volume = name + "-data"
    docker("volume", "create", volume)
    VOLUMES.append(volume)
    CONTAINERS.append(name)
    args = [
        "run", "-d", "--name", name, "--network", PREFIX,
        "--mount", f"type=volume,source={volume},target=/var/lib/postgresql/data",
        "--mount", f"type=bind,source={ROOT / 'db/init'},target=/docker-entrypoint-initdb.d,readonly",
        "-e", "POSTGRES_USER=asterisk", "-e", "POSTGRES_DB=asterisk",
        "-e", "POSTGRES_PASSWORD", "-e", f"DEMO_DATA={mode}",
    ]
    if publish:
        args += ["-p", f"127.0.0.1:{setting('POSTGRES_HOST_PORT')}:5432"]
    args.append(f"postgres:{setting('POSTGRES_VERSION')}-alpine")
    # Supply generated test credentials through the process environment, never
    # through a tracked file or command-line argument.
    old_password = os.environ.get("POSTGRES_PASSWORD")
    os.environ["POSTGRES_PASSWORD"] = secrets.token_urlsafe(24)
    try:
        docker(*args)
    finally:
        if old_password is None:
            os.environ.pop("POSTGRES_PASSWORD", None)
        else:
            os.environ["POSTGRES_PASSWORD"] = old_password
    wait_ready(name)
    return name


def wait_ready(container):
    # Query via TCP: the entrypoint's temporary initialization server is
    # socket-only, so readiness cannot race the final seed scripts.
    for _ in range(90):
        result = docker(
            "exec", container, "pg_isready", "-h", "127.0.0.1",
            "-U", "asterisk", "-d", "asterisk", check=False
        )
        if result.returncode == 0:
            return
        state = docker("inspect", "-f", "{{.State.Running}}", container)
        if state.stdout.strip() != "true":
            break
        time.sleep(1)
    logs = docker("logs", container, check=False)
    raise RuntimeError(f"{container} did not become ready:\n{logs.stdout}{logs.stderr}")


def main():
    global NETWORK_CREATED
    docker("network", "create", PREFIX)
    NETWORK_CREATED = True
    off = start("no")
    on = start("yes", publish=True)
    skipped = start("YES")

    tables = {
        "ps_auths": 500, "ps_aors": 500, "ps_endpoints": 500,
        "voicemail": 505, "queues": 5, "queue_members": 500,
        "extensions": 120, "ps_contacts": 0, "ps_domain_aliases": 0,
        "ps_endpoint_id_ips": 0, "cdr": 0, "audit_log": 0,
        "user_endpoints": 0,
    }
    for container in (off, on, skipped):
        count(container, "users", 1)
        equal(sql(container, "SELECT username || ':' || role FROM users;").stdout.strip(),
              "admin:admin", "single default admin")
        for table, expected in tables.items():
            count(container, table, expected if container == on else 0)
        equal(sql(container, """
            SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
            AND (tablename LIKE 'demo\\_%' ESCAPE '\\' OR tablename = 'departments');
        """).stdout.strip(), "0", "no department/demo tables")

    # Check flag dispatch under both sourced and executed invocation, without
    # executing SQL or reseeding. A mock psql records which branch was taken.
    shell_checks = r"""
set -eu
mkdir /tmp/init-mock
printf '#!/bin/sh\nprintf "mock-psql\\n"\n' > /tmp/init-mock/psql
chmod +x /tmp/init-mock/psql
export PATH="/tmp/init-mock:$PATH" POSTGRES_USER=asterisk POSTGRES_DB=asterisk
for mode in yes no YES true 1 invalid ''; do
    export DEMO_DATA="$mode"
    for invocation in sourced executed; do
        if [ "$invocation" = sourced ]; then
            output="$(. /docker-entrypoint-initdb.d/000_validate.sh
                       . /docker-entrypoint-initdb.d/999_demo.sh
                       printf 'parent-survived\n')"
            case "$output" in *parent-survived*) ;; *) exit 1 ;; esac
        else
            sh /docker-entrypoint-initdb.d/000_validate.sh
            output="$(sh /docker-entrypoint-initdb.d/999_demo.sh)"
        fi
        case "$mode:$output" in
            yes:*mock-psql*) ;;
            yes:*) exit 1 ;;
            *mock-psql*) exit 1 ;;
        esac
    done
done
"""
    docker("exec", "-i", off, "sh", input=shell_checks)
    print("PASS: exact-yes dispatch and sourced/executed guards", flush=True)

    rerun = sql(on, (ROOT / "db/init/seed/demo.sql").read_text(), check=False)
    equal(rerun.returncode != 0, True, "demo rerun fails")
    count(on, "ps_auths", 500)
    count(on, "extensions", tables["extensions"])

    # Force a failure after earlier ranges have been inserted: the entire
    # demo transaction must roll back, leaving only the intentional conflict.
    sql(off, "INSERT INTO ps_auths(id) VALUES ('300');")
    failed_seed = sql(off, (ROOT / "db/init/seed/demo.sql").read_text(), check=False)
    equal(failed_seed.returncode != 0, True, "mid-seed conflict fails")
    count(off, "ps_auths", 1)
    for table in ("ps_aors", "ps_endpoints", "voicemail", "queues", "queue_members", "extensions"):
        count(off, table, 0)
    sql(off, "DELETE FROM ps_auths WHERE id = '300';")

    for query in (
        "INSERT INTO ps_aors(id,max_contacts) VALUES ('bad',-1);",
        "INSERT INTO ps_aors(id,remove_existing) VALUES ('bad','invalid');",
        "INSERT INTO extensions(context,exten,priority,app) VALUES ('internal','bad',0,'Hangup');",
        "INSERT INTO queue_members(queue_name,interface) VALUES ('missing','PJSIP/700');",
    ):
        equal(sql(off, query, check=False).returncode != 0, True, "invalid provisioning rejected")

    indexes = sql(on, """
        SELECT count(*) FROM pg_indexes WHERE schemaname='public'
        AND indexname IN ('ps_contacts_endpoint','ps_contacts_expiration',
                         'cdr_calldate','cdr_uniqueid','cdr_linkedid');
    """)
    equal(indexes.stdout.strip(), "5", "runtime lookup/report indexes exist")
    sql(on, "CREATE TABLE validation_persistence (value integer); INSERT INTO validation_persistence VALUES (42);")
    docker("restart", on)
    wait_ready(on)
    equal(sql(on, "SELECT value FROM validation_persistence;").stdout.strip(),
          "42", "restart preserves data")
    count(on, "users", 1)
    count(on, "ps_endpoints", 500)
    logs = docker("logs", on)
    equal("Skipping initialization" in logs.stdout + logs.stderr, True, "restart skips initialization")
    print("PASS: database initialization validation complete", flush=True)


if __name__ == "__main__":
    try:
        main()
    finally:
        for container in reversed(CONTAINERS):
            docker("rm", "-f", "-v", container, check=False)
        for volume in reversed(VOLUMES):
            docker("volume", "rm", volume, check=False)
        if NETWORK_CREATED:
            docker("network", "rm", PREFIX, check=False)
