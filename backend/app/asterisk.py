"""A small Asterisk Manager Interface (AMI) client.

The web UI must keep working when Asterisk is offline, so every public helper
in this module returns an empty/default value instead of raising an exception.

Only the handful of AMI actions the dashboard needs are implemented:

* `Command`              - run an Asterisk CLI command such as `core show version`
* `CoreShowChannels`     - list current channels (used to count active calls)
* `module reload ...`    - apply freshly generated configuration files

A new TCP connection is opened for each snapshot.  That is simple and safe for
the poll rate of this appliance (once every few seconds).
"""

from __future__ import annotations

import re
import socket
import threading
import time

from .config import settings

# How long a snapshot is reused before asking Asterisk again.
CACHE_SECONDS = 5.0

_lock = threading.Lock()
_cache: dict[str, tuple[float, dict]] = {}


class AmiError(Exception):
    """Raised when AMI is disabled, unreachable, or rejects a login."""


class AmiConnection:
    """One short-lived AMI connection."""

    def __init__(self) -> None:
        if not settings.ami_host or not settings.ami_password:
            raise AmiError("AMI is not configured")

        self.sock = socket.create_connection(
            (settings.ami_host, settings.ami_port),
            timeout=settings.ami_timeout,
        )
        self.sock.settimeout(settings.ami_timeout)
        self.reader = self.sock.makefile("r", encoding="utf-8", errors="replace")

        # The first line is the banner ("Asterisk Call Manager/x.y").
        self._read_message()
        response = self._action(
            "Login",
            Username=settings.ami_username,
            Secret=settings.ami_password,
            Events="off",
        )
        if _value(response, "Response") != "Success":
            raise AmiError(_value(response, "Message") or "AMI login failed")

    def __enter__(self) -> "AmiConnection":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def close(self) -> None:
        try:
            self.reader.close()
        finally:
            self.sock.close()

    # ── Low-level protocol ────────────────────────────────────────────────
    def _send(self, action: str, **fields: str) -> None:
        lines = [f"Action: {action}"]
        lines.extend(f"{key}: {value}" for key, value in fields.items())
        # AMI messages end with an empty line.
        payload = "\r\n".join(lines) + "\r\n\r\n"
        self.sock.sendall(payload.encode("utf-8"))

    def _read_message(self) -> list[tuple[str, str]]:
        """Read one AMI message (a block of `Key: Value` lines)."""
        fields: list[tuple[str, str]] = []
        while True:
            raw = self.reader.readline()
            if raw == "":
                raise AmiError("AMI closed the connection")
            line = raw.rstrip("\r\n")
            if not line:
                if fields:
                    return fields
                continue

            key, separator, value = line.partition(":")
            if separator:
                fields.append((key.strip(), value.lstrip(" ")))
            else:
                # Banner and `--END COMMAND--` lines have no colon.
                fields.append(("_line", line))

    def _action(self, action: str, **fields: str) -> list[tuple[str, str]]:
        self._send(action, **fields)
        return self._read_message()

    def _events(self, action: str, complete_event: str) -> list[dict[str, str]]:
        """Send an action and return every event until `complete_event`."""
        self._send(action)
        events: list[dict[str, str]] = []
        while True:
            message = self._read_message()
            data = _as_dict(message)
            if data.get("Event") == complete_event:
                return events
            if data.get("Response") == "Error":
                raise AmiError(data.get("Message") or f"AMI action {action} failed")
            if data.get("Event"):
                events.append(data)

    def command(self, command: str) -> str:
        """Run an Asterisk CLI command and return its text output."""
        message = self._action("Command", Command=command)
        if _value(message, "Response") not in ("Follows", "Success"):
            raise AmiError(_value(message, "Message") or f"Command failed: {command}")
        return "\n".join(value for key, value in message if key == "Output")


# ── Parsing helpers ───────────────────────────────────────────────────────
def _value(message: list[tuple[str, str]], key: str) -> str:
    for field, value in message:
        if field == key:
            return value
    return ""


def _as_dict(message: list[tuple[str, str]]) -> dict[str, str]:
    return {key: value for key, value in message}


def _parse_version(text: str) -> str:
    match = re.search(r"Asterisk\s+([^\s,]+)", text)
    return match.group(1) if match else ""


def _parse_uptime(text: str) -> int:
    """Turn "1 day, 2 hours, 3 minutes, 4 seconds" into seconds."""
    units = {
        "year": 365 * 24 * 3600,
        "week": 7 * 24 * 3600,
        "day": 24 * 3600,
        "hour": 3600,
        "minute": 60,
        "second": 1,
    }
    total = 0
    for amount, unit in re.findall(
        r"(\d+)\s+(year|week|day|hour|minute|second)s?", text
    ):
        total += int(amount) * units[unit]
    return total


def _parse_active_calls(text: str) -> int:
    match = re.search(r"(\d+)\s+active\s+calls?", text)
    if match:
        return int(match.group(1))
    # Older/odd builds may only print channels.
    match = re.search(r"(\d+)\s+active\s+channels?", text)
    return int(match.group(1)) if match else 0


def _parse_registrations(text: str) -> dict[str, str]:
    """Extract `extension -> IP` pairs from `pjsip show contacts`."""
    registrations: dict[str, str] = {}
    for line in text.splitlines():
        # Example: Contact:  100/sip:100@192.168.1.20:5060  hash  Avail  1.02
        match = re.search(r"Contact:\s+(\d{3})/\S+@([^:\s;]+)", line)
        if match:
            registrations[match.group(1)] = match.group(2)
    return registrations


# ── Public API ────────────────────────────────────────────────────────────
def _empty_snapshot() -> dict:
    return {
        "reachable": False,
        "version": "",
        "uptime_sec": 0,
        "active_calls": 0,
        "registrations": {},
    }


def _load_snapshot() -> dict:
    snapshot = _empty_snapshot()
    try:
        with AmiConnection() as ami:
            snapshot["version"] = _parse_version(ami.command("core show version"))
            snapshot["uptime_sec"] = _parse_uptime(ami.command("core show uptime"))
            snapshot["active_calls"] = _parse_active_calls(
                ami.command("core show channels count")
            )
            snapshot["registrations"] = _parse_registrations(
                ami.command("pjsip show contacts")
            )
            snapshot["reachable"] = True
    except (AmiError, OSError):
        # Offline Asterisk is a normal state: return the empty snapshot.
        pass
    return snapshot


def snapshot(force: bool = False) -> dict:
    """Return cached Asterisk status, contacts and active call count."""
    now = time.monotonic()
    if not force:
        with _lock:
            cached = _cache.get("snapshot")
            if cached and cached[0] > now:
                return cached[1]

    value = _load_snapshot()
    with _lock:
        _cache["snapshot"] = (time.monotonic() + CACHE_SECONDS, value)
    return value


def reload_config() -> bool:
    """Ask Asterisk to reload the generated PJSIP/queue/voicemail files."""
    try:
        with AmiConnection() as ami:
            for module in ("res_pjsip.so", "app_queue.so", "app_voicemail.so"):
                ami.command(f"module reload {module}")
    except (AmiError, OSError):
        return False

    # Registration data may change after a reload.
    with _lock:
        _cache.pop("snapshot", None)
    return True
