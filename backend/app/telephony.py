"""Asterisk AMI and ARI clients used by the API.

Every method degrades to an explanatory exception when the control plane is not
configured.  PostgreSQL remains the source of truth for configuration, so CRUD
endpoints keep working without Asterisk.
"""

from __future__ import annotations

import json
import logging
import socket
import threading
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

from .config import AsteriskConfig

log = logging.getLogger("asterisk.telephony")


class NotConfigured(Exception):
    pass


class AMIUnavailable(Exception):
    pass


class ARINotFound(Exception):
    pass


class AMIClient:
    def __init__(self, cfg: AsteriskConfig) -> None:
        self.cfg = cfg
        self._lock = threading.Lock()
        self._sock: socket.socket | None = None
        self._file: Any = None

    def configured(self) -> bool:
        return bool(self.cfg.ami_username and self.cfg.ami_password)

    def close(self) -> None:
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        if self._file is not None:
            try:
                self._file.close()
            except Exception:
                pass
        if self._sock is not None:
            try:
                self._sock.close()
            except Exception:
                pass
        self._sock = None
        self._file = None

    def _connect_locked(self) -> None:
        if not self.configured():
            raise NotConfigured("asterisk control plane is not configured")
        if self._sock is not None:
            return
        try:
            sock = socket.create_connection(
                (self.cfg.ami_host, self.cfg.ami_port), timeout=3
            )
            sock.settimeout(5)
            self._sock = sock
            self._file = sock.makefile("rwb", buffering=0)
            login = (
                "Action: Login\r\n"
                f"Username: {self.cfg.ami_username}\r\n"
                f"Secret: {self.cfg.ami_password}\r\n"
                "Events: off\r\n\r\n"
            )
            self._file.write(login.encode("utf-8"))
            message = self._read_message_locked()
            if message.get("Response", "").lower() == "error":
                self._close_locked()
                raise AMIUnavailable(message.get("Message", "AMI login failed"))
            if message.get("Response", "").lower() != "success":
                self._close_locked()
                raise AMIUnavailable("unexpected AMI login response")
        except NotConfigured:
            raise
        except (OSError, ValueError) as exc:
            self._close_locked()
            raise AMIUnavailable(f"asterisk AMI is unavailable: {exc}") from exc

    def _read_message_locked(self) -> dict[str, str]:
        message: dict[str, str] = {}
        output: list[str] = []
        if self._file is None:
            raise AMIUnavailable("asterisk AMI is unavailable")
        while True:
            raw = self._file.readline()
            if not raw:
                raise AMIUnavailable("asterisk AMI connection closed")
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if line == "":
                if output:
                    message["_output"] = "\n".join(output) + "\n"
                return message
            if line == "--END COMMAND--":
                message["_end"] = "1"
                continue
            if ":" in line:
                key, value = line.split(":", 1)
                message[key.strip()] = value.strip()
            else:
                output.append(line)

    def _action_locked(
        self,
        action: dict[str, str],
        collect: bool,
        timeout: float,
    ) -> tuple[dict[str, str] | None, list[dict[str, str]]]:
        self._connect_locked()
        action_id = str(uuid.uuid4())
        payload = dict(action)
        payload["ActionID"] = action_id
        lines: list[str] = []
        for key, value in payload.items():
            lines.append(f"{key}: {value}")
        lines.append("")
        lines.append("")
        try:
            if self._file is None or self._sock is None:
                raise AMIUnavailable("asterisk AMI is unavailable")
            self._file.write("\r\n".join(lines).encode("utf-8"))
            self._sock.settimeout(timeout)
        except OSError as exc:
            self._close_locked()
            raise AMIUnavailable(f"asterisk AMI is unavailable: {exc}") from exc

        response: dict[str, str] | None = None
        events: list[dict[str, str]] = []
        while True:
            try:
                message = self._read_message_locked()
            except (OSError, AMIUnavailable) as exc:
                self._close_locked()
                if isinstance(exc, AMIUnavailable):
                    raise
                raise AMIUnavailable(f"asterisk AMI is unavailable: {exc}") from exc
            message_id = message.get("ActionID", "")
            if message_id and message_id != action_id:
                continue
            event = message.get("Event", "")
            if event:
                if collect:
                    events.append(message)
                    if event.endswith("Complete"):
                        return response, events
                continue
            if response is None and message.get("Response", ""):
                if message.get("Response", "").lower() == "error":
                    self._close_locked()
                    raise AMIUnavailable(
                        f"AMI {action.get('Action', '')} failed: "
                        f"{message.get('Message', '')}"
                    )
                response = message
                if not collect:
                    return response, events
                continue
            if collect and message.get("_end") == "1":
                return response, events

    def action(self, action: dict[str, str], timeout: float = 5.0) -> dict[str, str]:
        with self._lock:
            response, _ = self._action_locked(action, False, timeout)
            return response or {}

    def collect(
        self, action: dict[str, str], timeout: float = 8.0
    ) -> list[dict[str, str]]:
        with self._lock:
            _, events = self._action_locked(action, True, timeout)
            return events

    def command(self, command: str) -> str:
        with self._lock:
            self._connect_locked()
            action_id = str(uuid.uuid4())
            payload = (
                f"Action: Command\r\nActionID: {action_id}\r\n"
                f"Command: {command}\r\n\r\n"
            )
            try:
                if self._file is None or self._sock is None:
                    raise AMIUnavailable("asterisk AMI is unavailable")
                self._file.write(payload.encode("utf-8"))
                self._sock.settimeout(8)
            except OSError as exc:
                self._close_locked()
                raise AMIUnavailable(f"asterisk AMI is unavailable: {exc}") from exc
            chunks: list[str] = []
            while True:
                try:
                    message = self._read_message_locked()
                except (OSError, AMIUnavailable) as exc:
                    self._close_locked()
                    if isinstance(exc, AMIUnavailable):
                        raise
                    raise AMIUnavailable(f"asterisk AMI is unavailable: {exc}") from exc
                if message.get("ActionID") and message.get("ActionID") != action_id:
                    continue
                if message.get("_output"):
                    chunks.append(message["_output"])
                if message.get("Output"):
                    chunks.append(message["Output"] + "\n")
                if message.get("_end") == "1":
                    return "".join(chunks)
                if message.get("Response", "").lower() == "error":
                    self._close_locked()
                    raise AMIUnavailable(
                        f"AMI command failed: {message.get('Message', '')}"
                    )

    def ping(self) -> None:
        response = self.action({"Action": "Ping"})
        if response.get("Response", "").lower() != "success":
            raise AMIUnavailable("asterisk AMI is unavailable")

    def core_status(self) -> dict[str, str]:
        return self.action({"Action": "CoreStatus"})

    def core_show_channels(self) -> list[dict[str, str]]:
        events = self.collect({"Action": "CoreShowChannels"}, 6)
        return [event for event in events if event.get("Event") == "CoreShowChannel"]

    def pjsip_show_endpoints(self) -> list[dict[str, str]]:
        events = self.collect({"Action": "PJSIPShowEndpoints"}, 8)
        return [event for event in events if event.get("Event") == "EndpointList"]

    def pjsip_show_endpoint(self, endpoint: str) -> list[dict[str, str]]:
        return self.collect(
            {"Action": "PJSIPShowEndpoint", "Endpoint": endpoint}, 8
        )

    def pjsip_show_registrations(self) -> list[dict[str, str]]:
        events = self.collect({"Action": "PJSIPShowRegistrationsInbound"}, 8)
        return [
            event
            for event in events
            if event.get("Event") == "InboundRegistrationDetail"
        ]

    def queue_status(self) -> list[dict[str, str]]:
        return self.collect({"Action": "QueueStatus"}, 6)

    def confbridge_list(self, room: str = "") -> list[dict[str, str]]:
        action = {"Action": "ConfbridgeList"}
        if room:
            action["Conference"] = room
        events = self.collect(action, 6)
        return [event for event in events if event.get("Event") == "ConfbridgeList"]


class ARIClient:
    def __init__(self, cfg: AsteriskConfig) -> None:
        self.base = cfg.ari_url.rstrip("/")
        self.user = cfg.ari_username
        self.password = cfg.ari_password
        self._client = httpx.Client(timeout=5.0)

    def configured(self) -> bool:
        return bool(self.base and self.password)

    def close(self) -> None:
        self._client.close()

    def _get(self, path: str) -> Any:
        if not self.configured():
            raise NotConfigured("asterisk control plane is not configured")
        try:
            response = self._client.get(
                self.base + path,
                auth=(self.user, self.password),
                headers={"Accept": "application/json"},
            )
        except httpx.HTTPError as exc:
            raise AMIUnavailable(f"asterisk ARI is unavailable: {exc}") from exc
        if response.status_code == 404:
            raise ARINotFound("ARI resource not found")
        if response.status_code < 200 or response.status_code >= 300:
            body = response.text[:1024].strip()
            raise AMIUnavailable(f"ARI {path}: {response.status_code}: {body}")
        try:
            return response.json()
        except ValueError as exc:
            raise AMIUnavailable(f"ARI {path}: invalid JSON response") from exc

    def ping(self) -> None:
        self._get("/asterisk/info")

    def info(self) -> dict[str, Any]:
        return self._get("/asterisk/info")

    def channels(self) -> list[dict[str, Any]]:
        return self._get("/channels")

    def endpoints(self) -> list[dict[str, Any]]:
        return self._get("/endpoints")

    def endpoint(self, technology: str, resource: str) -> dict[str, Any]:
        return self._get(f"/endpoints/{technology}/{resource}")


@dataclass
class Call:
    channel: str
    unique_id: str
    linked_id: str
    caller_id_num: str
    caller_id_name: str
    connected_num: str
    connected_name: str
    context: str
    extension: str
    priority: str
    application: str
    data: str
    state: str
    duration: str
    source: str

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "channel": self.channel,
            "caller_id_num": self.caller_id_num,
            "caller_id_name": self.caller_id_name,
            "source": self.source,
        }
        for key, value in (
            ("unique_id", self.unique_id),
            ("linked_id", self.linked_id),
            ("connected_num", self.connected_num),
            ("connected_name", self.connected_name),
            ("context", self.context),
            ("extension", self.extension),
            ("priority", self.priority),
            ("application", self.application),
            ("data", self.data),
            ("state", self.state),
            ("duration", self.duration),
        ):
            if value:
                out[key] = value
        return out


class TelephonyService:
    def __init__(self, cfg: AsteriskConfig) -> None:
        self.cfg = cfg
        self.ami = AMIClient(cfg)
        self.ari = ARIClient(cfg)

    def close(self) -> None:
        self.ami.close()
        self.ari.close()

    def status(self) -> dict[str, Any]:
        ami = {
            "configured": self.ami.configured(),
            "connected": False,
            "host": self.cfg.ami_host,
            "port": self.cfg.ami_port,
        }
        ari = {
            "configured": self.ari.configured(),
            "connected": False,
            "url": self.ari.base,
        }
        if ami["configured"]:
            try:
                self.ami.ping()
                ami["connected"] = True
            except Exception as exc:
                ami["error"] = str(exc)
        if ari["configured"]:
            try:
                self.ari.ping()
                ari["connected"] = True
            except Exception as exc:
                ari["error"] = str(exc)
        return {"ami": ami, "ari": ari}

    def reload(self, component: str) -> None:
        commands = {
            "pjsip": "pjsip reload",
            "dialplan": "dialplan reload",
            "queues": "queue reload all",
            "voicemail": "voicemail reload",
            "core": "core reload",
        }
        command = commands.get(component)
        if command is None:
            raise ValueError("unknown reload component")
        self.ami.command(command)

    def core_status(self) -> dict[str, str]:
        response = self.ami.core_status()
        version = parse_version(response.get("CoreVersion", ""))
        if not version:
            try:
                version = self.version()
            except Exception:
                version = ""
        return {
            "version": version,
            "startup_time": (
                response.get("CoreStartupDate", "")
                + " "
                + response.get("CoreStartupTime", "")
            ).strip(),
            "reload_time": (
                response.get("CoreReloadDate", "")
                + " "
                + response.get("CoreReloadTime", "")
            ).strip(),
            "current_time": (
                response.get("CoreCurrentDateTime", "")
                + " "
                + response.get("CoreCurrentTime", "")
            ).strip(),
            "uptime": response.get("CoreUptime", ""),
            "current_calls": response.get("CoreCurrentCalls", ""),
        }

    def version(self) -> str:
        if self.ami.configured():
            try:
                version = parse_version(self.ami.command("core show version"))
                if version:
                    return version
            except Exception:
                pass
        if self.ari.configured():
            try:
                info = self.ari.info()
                system = info.get("system")
                if isinstance(system, dict) and system.get("version"):
                    return str(system["version"])
            except Exception:
                pass
        raise NotConfigured("asterisk control plane is not configured")

    def calls(self) -> tuple[list[dict[str, Any]], str]:
        if self.ari.configured():
            try:
                channels = self.ari.channels()
                out: list[dict[str, Any]] = []
                for channel in channels:
                    caller = channel.get("caller") or {}
                    connected = channel.get("connected") or {}
                    dialplan = channel.get("dialplan") or {}
                    out.append(
                        Call(
                            channel=str(channel.get("name", "")),
                            unique_id=str(channel.get("id", "")),
                            linked_id="",
                            caller_id_num=str(caller.get("number", "")),
                            caller_id_name=str(caller.get("name", "")),
                            connected_num=str(connected.get("number", "")),
                            connected_name=str(connected.get("name", "")),
                            context=str(dialplan.get("context", "")),
                            extension=str(dialplan.get("exten", "")),
                            priority=str(dialplan.get("priority", "")),
                            application="",
                            data="",
                            state=str(channel.get("state", "")),
                            duration="",
                            source="ari",
                        ).as_dict()
                    )
                return out, "ari"
            except Exception as exc:
                log.debug("ARI channel listing failed, falling back to AMI: %s", exc)
        if not self.ami.configured():
            raise NotConfigured("asterisk control plane is not configured")
        events = self.ami.core_show_channels()
        out = []
        for event in events:
            out.append(
                Call(
                    channel=event.get("Channel", ""),
                    unique_id=event.get("Uniqueid", ""),
                    linked_id=event.get("Linkedid", ""),
                    caller_id_num=event.get("CallerIDNum", ""),
                    caller_id_name=event.get("CallerIDName", ""),
                    connected_num=event.get("ConnectedLineNum", ""),
                    connected_name=event.get("ConnectedLineName", ""),
                    context=event.get("Context", ""),
                    extension=event.get("Exten", ""),
                    priority=event.get("Priority", ""),
                    application=event.get("Application", ""),
                    data=event.get("ApplicationData", ""),
                    state=event.get("State", ""),
                    duration=event.get("Duration", ""),
                    source="ami",
                ).as_dict()
            )
        return out, "ami"

    def endpoints(self) -> tuple[list[dict[str, Any]], str]:
        if self.ari.configured():
            try:
                endpoints = self.ari.endpoints()
                out = []
                for endpoint in endpoints:
                    if endpoint.get("technology") != "PJSIP":
                        continue
                    out.append(
                        {
                            "resource": endpoint.get("resource", ""),
                            "state": endpoint.get("state", ""),
                            "channel_ids": endpoint.get("channel_ids") or [],
                            "source": "ari",
                        }
                    )
                return out, "ari"
            except Exception as exc:
                log.debug("ARI endpoint listing failed, falling back to AMI: %s", exc)
        if not self.ami.configured():
            raise NotConfigured("asterisk control plane is not configured")
        events = self.ami.pjsip_show_endpoints()
        out = [
            {
                "resource": event.get("ObjectName", ""),
                "state": event.get("DeviceState", ""),
                "source": "ami",
            }
            for event in events
        ]
        return out, "ami"

    def endpoint_status(self, number: str) -> dict[str, Any]:
        out: dict[str, Any] = {
            "resource": number,
            "state": "unknown",
            "source": "none",
        }
        if self.ari.configured():
            try:
                endpoint = self.ari.endpoint("PJSIP", number)
                out["state"] = endpoint.get("state", "unknown")
                out["channel_ids"] = endpoint.get("channel_ids") or []
                out["source"] = "ari"
                return out
            except ARINotFound:
                pass
            except Exception as exc:
                log.debug("ARI endpoint lookup failed for %s: %s", number, exc)
        if not self.ami.configured():
            raise NotConfigured("asterisk control plane is not configured")
        events = self.ami.pjsip_show_endpoint(number)
        contacts = []
        for event in events:
            if event.get("Event") == "EndpointDetail":
                if event.get("DeviceState"):
                    out["state"] = event["DeviceState"]
                out["source"] = "ami"
            elif event.get("Event") == "ContactStatusDetail":
                contacts.append(
                    {
                        "aor": event.get("AOR", ""),
                        "uri": event.get("URI", ""),
                        "status": event.get("Status", ""),
                        "user_agent": event.get("UserAgent", ""),
                        "reg_expire": event.get("RegExpire", ""),
                        "roundtrip_usec": event.get("RoundtripUsec", ""),
                    }
                )
        if contacts:
            out["contacts"] = contacts
        return out

    def registrations(self) -> list[dict[str, Any]]:
        events = self.ami.pjsip_show_registrations()
        return [
            {
                "endpoint": event.get("Endpoint", ""),
                "aor": event.get("AOR", ""),
                "contact": event.get("Contact", ""),
                "status": event.get("Status", ""),
                "user_agent": event.get("UserAgent", ""),
                "reg_expire": event.get("RegExpire", ""),
            }
            for event in events
        ]

    def queues(self) -> list[dict[str, Any]]:
        events = self.ami.queue_status()
        index: dict[str, dict[str, Any]] = {}
        order: list[str] = []

        def get(name: str) -> dict[str, Any]:
            if name not in index:
                index[name] = {
                    "name": name,
                    "members": [],
                    "entries": [],
                }
                order.append(name)
            return index[name]

        for event in events:
            kind = event.get("Event")
            name = event.get("Queue", "")
            if not name:
                continue
            queue = get(name)
            if kind == "QueueParams":
                queue.update(
                    {
                        "strategy": event.get("Strategy", ""),
                        "max": atoi(event.get("Max")),
                        "calls": atoi(event.get("Calls")),
                        "hold_time": atoi(event.get("Holdtime")),
                        "talk_time": atoi(event.get("TalkTime")),
                        "completed": atoi(event.get("Completed")),
                        "abandoned": atoi(event.get("Abandoned")),
                        "service_level": atoi(event.get("ServiceLevel")),
                        "service_level_perf": event.get("ServicelevelPerf", ""),
                    }
                )
            elif kind == "QueueMember":
                queue["members"].append(
                    {
                        "name": event.get("Name", ""),
                        "location": event.get("Location", ""),
                        "membership": event.get("Membership", ""),
                        "status": event.get("Status", ""),
                        "paused": atoi(event.get("Paused")) != 0,
                        "penalty": atoi(event.get("Penalty")),
                        "calls_taken": atoi(event.get("CallsTaken")),
                        "in_call": atoi(event.get("InCall")) != 0,
                    }
                )
            elif kind == "QueueEntry":
                queue["entries"].append(
                    {
                        "position": atoi(event.get("Position")),
                        "channel": event.get("Channel", ""),
                        "caller_id_num": event.get("CallerIDNum", ""),
                        "caller_id_name": event.get("CallerIDName", ""),
                        "wait": event.get("Wait", ""),
                    }
                )
        return [index[name] for name in order]

    def conferences(self, room: str = "") -> list[dict[str, Any]]:
        events = self.ami.confbridge_list(room)
        index: dict[str, dict[str, Any]] = {}
        order: list[str] = []
        for event in events:
            name = event.get("Conference", "")
            if not name:
                continue
            if name not in index:
                index[name] = {"room": name, "members": []}
                order.append(name)
            index[name]["members"].append(
                {
                    "channel": event.get("Channel", ""),
                    "caller_id_num": event.get("CallerIDNum", ""),
                    "caller_id_name": event.get("CallerIDName", ""),
                    "admin": atoi(event.get("Admin")) != 0,
                    "marked": atoi(event.get("Marked")) != 0,
                    "muted": atoi(event.get("Muted")) != 0,
                    "answered_time": event.get("AnsweredTime", ""),
                    "join_time": event.get("JoinTime", ""),
                }
            )
        return [index[name] for name in order]


def parse_version(text: str) -> str:
    fields = text.split()
    for index, field in enumerate(fields):
        if field.lower() == "asterisk" and index + 1 < len(fields):
            return fields[index + 1].strip(",")
    if fields and fields[0].startswith("Asterisk") and len(fields) > 1:
        return fields[1].strip(",")
    return ""


def atoi(value: Any) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return 0
