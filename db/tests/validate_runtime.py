#!/usr/bin/env python3
"""Check host-network ODBC and startup of the locally built realtime image.

Run validate_init.py first. This check starts only disposable PostgreSQL and
Asterisk containers, using .env.example's PBX settings. Host SIP/HTTP/RTP ports
must be available. Missing required modules are failures, not bypassed.
"""

import os
import re
import time

import validate_init as init


IMAGE = "asterisk-realtime-validation:local"


def main():
    init.docker("network", "create", init.PREFIX)
    init.NETWORK_CREATED = True
    postgres = init.start("no", publish=True)
    password = init.docker("exec", postgres, "printenv", "POSTGRES_PASSWORD").stdout.strip()
    connection = (
        "DRIVER={PostgreSQL Unicode};SERVER=127.0.0.1;"
        f"PORT={init.setting('POSTGRES_HOST_PORT')};"
        f"DATABASE=asterisk;UID=asterisk;PWD={password}"
    )
    client = init.PREFIX + "-odbc"
    os.environ["VALIDATION_ODBC_CONNECTION"] = connection
    try:
        result = init.docker(
            "run", "--rm", "-i", "--name", client, "--network", "host",
            "-e", "VALIDATION_ODBC_CONNECTION", "--entrypoint", "/bin/sh", IMAGE,
            "-c", 'isql -b -v -k "$VALIDATION_ODBC_CONNECTION"',
            input="SELECT current_database(), current_user;\nSELECT count(*) FROM ps_endpoints;\n"
        )
    finally:
        os.environ.pop("VALIDATION_ODBC_CONNECTION", None)
    print(result.stdout, flush=True)
    print("PASS: host-network PostgreSQL ODBC queries through env-defined published port", flush=True)

    name = init.PREFIX + "-pbx"
    init.CONTAINERS.append(name)
    os.environ["DB_PASSWORD"] = password
    try:
        init.docker(
            "run", "-d", "--name", name, "--network", "host",
            "--env-file", str(init.ROOT / ".env.example"),
            "-e", "ASTERISK_MODE=realtime", "-e", "DB_HOST=127.0.0.1",
            "-e", f"DB_PORT={init.setting('POSTGRES_HOST_PORT')}",
            "-e", "DB_USER=asterisk", "-e", "DB_NAME=asterisk",
            "-e", "DB_PASSWORD", IMAGE
        )
    finally:
        os.environ.pop("DB_PASSWORD", None)
    # Stay within a bounded startup window; do not mask failures by disabling
    # required modules or changing the image's entrypoint.
    booted = False
    for _ in range(30):
        state = init.docker("inspect", "-f", "{{.State.Running}}", name).stdout.strip()
        if state != "true":
            break
        result = init.docker(
            "exec", name, "asterisk", "-rx", "core waitfullybooted", check=False
        )
        if result.returncode == 0:
            booted = True
            break
        time.sleep(1)
    logs = init.docker("logs", name)
    print(logs.stdout + logs.stderr, flush=True)
    state = init.docker("inspect", "-f", "{{.State.Running}} {{.State.ExitCode}}", name).stdout.strip()
    if state != "true 0":
        raise RuntimeError(f"Asterisk startup failed (running/exit status: {state})")
    if not booted:
        raise RuntimeError("Asterisk did not finish booting within the startup window")
    outputs = {}
    for command in ("module show like pbx_realtime", "odbc show", "cdr show status"):
        result = init.docker("exec", name, "asterisk", "-rx", command)
        outputs[command] = result.stdout
        print(result.stdout, flush=True)
    if not re.search(r"Number of active connections:\s*[1-9]", outputs["odbc show"]):
        raise RuntimeError("Asterisk has no active ODBC connection")
    print("PASS: Asterisk res_odbc has an active connection", flush=True)
    if "Adaptive ODBC" not in outputs["cdr show status"]:
        raise RuntimeError("Adaptive ODBC CDR backend is not registered")
    print("PASS: adaptive ODBC CDR backend registered (call writes not tested)", flush=True)
    # CLI process exit status and 'Asterisk Ready' do not prove module success:
    # module show exits zero even when it reports '0 modules loaded'.
    missing = []
    module_file = init.ROOT / "asterisk/conf/realtime/modules_custom.conf"
    for module in re.findall(r"^require\s*=\s*(\S+)", module_file.read_text(), re.MULTILINE):
        result = init.docker("exec", name, "asterisk", "-rx", f"module show like {module}")
        if not any(
            line.startswith(module + " ") and "Running" in line
            for line in result.stdout.splitlines()
        ):
            missing.append(module)
    if missing:
        raise RuntimeError(f"Required modules are not running: {', '.join(missing)}")
    print("PASS: required realtime modules running (registration/calls require further checks)", flush=True)


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
