"""Generate Asterisk configuration from the database.

The database is the source of truth.  Whenever a user or extension changes,
this module writes three files into `PBX_CONFIG_DIR`:

* `pjsip_endpoints.conf` - one endpoint/auth/aor per enabled extension
* `queues.conf`          - the five department call-center queues
* `voicemail.conf`       - one mailbox per extension + department mailboxes

In Docker the directory is mounted at `/etc/asterisk/generated`, and the baked
Asterisk configuration includes those files.  After writing, the backend asks
AMI to reload the modules so changes apply without restarting Asterisk.
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy.orm import Session, selectinload

from . import asterisk
from .config import settings
from .models import Extension

logger = logging.getLogger(__name__)

# Keep this list in sync with frontend/src/utils/sip.ts.
DEPARTMENTS = [
    {
        "id": "administration",
        "label": "Administration",
        "from": 100,
        "to": 199,
        "queue": "q-admin",
    },
    {"id": "finance", "label": "Finance", "from": 200, "to": 299, "queue": "q-finance"},
    {"id": "it", "label": "IT", "from": 300, "to": 399, "queue": "q-it"},
    {
        "id": "support",
        "label": "Customer Service",
        "from": 400,
        "to": 499,
        "queue": "q-support",
    },
    {
        "id": "management",
        "label": "Management",
        "from": 500,
        "to": 599,
        "queue": "q-management",
    },
]

DEPARTMENT_MAILBOXES = {
    "010": ("0010", "Administration"),
    "011": ("0011", "Finance"),
    "012": ("0012", "IT"),
    "013": ("0013", "Customer Service"),
    "014": ("0014", "Management"),
}

GENERAL_QUEUE_SETTINGS = """\
[general]
persistentmembers = yes
autofill = yes
monitor-type = MixMonitor
"""

GENERAL_VOICEMAIL_SETTINGS = """\
[general]
format = wav49|gsm|wav
maxmsg = 100
maxsecs = 180
minsecs = 3
maxgreet = 60
skipms = 3000
maxsilence = 10
silencethreshold = 128
maxlogins = 3
"""

PJSIP_TEMPLATES = """\
; ============================================================================
; GENERATED FILE - do not edit by hand.
; Source of truth: backend database (extension records).
; ============================================================================

[dept-endpoint](!)
type = endpoint
context = internal
disallow = all
allow = ulaw,alaw,opus,g722
direct_media = no
force_rport = yes
rewrite_contact = yes
rtp_symmetric = yes

[dept-auth](!)
type = auth
auth_type = userpass

[dept-aor](!)
type = aor
max_contacts = 2
remove_existing = yes
"""


def _clean_name(name: str) -> str:
    """Remove characters that would break an Asterisk config line."""
    return " ".join(name.replace(",", " ").replace('"', "").split())


def _extension_name(extension: Extension) -> str:
    if extension.user is not None:
        return _clean_name(extension.user.full_name)
    department = _department_for(extension.number)
    label = department["label"] if department else "Extension"
    return f"{label} {extension.number}"


def _department_for(number: str) -> dict | None:
    value = int(number)
    return next(
        (dept for dept in DEPARTMENTS if dept["from"] <= value <= dept["to"]),
        None,
    )


# ── File builders ─────────────────────────────────────────────────────────
def build_pjsip(extensions: list[Extension]) -> str:
    blocks = [PJSIP_TEMPLATES]

    for extension in extensions:
        if not extension.enabled:
            continue
        number = extension.number
        caller_name = _extension_name(extension).replace("<", "").replace(">", "")
        blocks.append(
            f"""
; {caller_name}
[{number}](dept-endpoint)
auth = {number}
aors = {number}
callerid = "{caller_name}" <{number}>
mailboxes = {number}@default

[{number}](dept-auth)
username = {number}
password = {extension.secret}

[{number}](dept-aor)
"""
        )

    return "".join(blocks)


def build_queues(extensions: list[Extension]) -> str:
    enabled = [extension for extension in extensions if extension.enabled]
    blocks = [
        "; ============================================================================\n"
        "; GENERATED FILE - do not edit by hand.\n"
        "; Department queues. Dial 010-014 from the dialplan to reach them.\n"
        "; ============================================================================\n\n",
        GENERAL_QUEUE_SETTINGS,
    ]

    descriptions = {
        "q-admin": "Administration call-center queue",
        "q-finance": "Finance call-center queue",
        "q-it": "IT call-center queue",
        "q-support": "Customer Service call-center queue",
        "q-management": "Management call-center queue",
    }

    for department in DEPARTMENTS:
        members = [
            extension
            for extension in enabled
            if department["from"] <= int(extension.number) <= department["to"]
        ]
        blocks.append(
            f"""
; ---------------------------------------------------------------------------
; {descriptions[department["queue"]]}
; ---------------------------------------------------------------------------
[{department["queue"]}]
strategy = rrmemory
timeout = 20
retry = 1
maxlen = 20
musicclass = default
ringinuse = no
servicelevel = 60
"""
        )
        for extension in members:
            blocks.append(f"member => PJSIP/{extension.number}\n")

    return "".join(blocks)


def build_voicemail(extensions: list[Extension]) -> str:
    blocks = [
        "; ============================================================================\n"
        "; GENERATED FILE - do not edit by hand.\n"
        "; Personal mailboxes use PIN 0<extension>; change it from the phone menu.\n"
        "; ============================================================================\n\n",
        GENERAL_VOICEMAIL_SETTINGS,
        "\n[default]\n",
    ]

    for extension in extensions:
        name = _extension_name(extension)
        # PIN 0<number>: 100 -> 0100, 599 -> 0599.
        blocks.append(f"{extension.number} => 0{extension.number},{name}\n")

    blocks.append("\n[departments]\n")
    for mailbox, (pin, label) in DEPARTMENT_MAILBOXES.items():
        blocks.append(f"{mailbox} => {pin},{label}\n")

    return "".join(blocks)


# ── Public API ────────────────────────────────────────────────────────────
def write_configs(db: Session) -> list[Path]:
    """Write all generated files.  Call `db.flush()` before this."""
    extensions = (
        db.query(Extension)
        .options(selectinload(Extension.user))
        .order_by(Extension.number)
        .all()
    )
    files = {
        "pjsip_endpoints.conf": build_pjsip(extensions),
        "queues.conf": build_queues(extensions),
        "voicemail.conf": build_voicemail(extensions),
    }

    directory = settings.config_directory
    directory.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    for name, content in files.items():
        target = directory / name
        # Write to a temporary file, then rename: Asterisk never reads a
        # half-written file.
        temporary = target.with_name(f".{name}.tmp")
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(target)
        written.append(target)

    logger.info("generated %s in %s", ", ".join(files), directory)
    return written


def reload_asterisk() -> bool:
    """Reload Asterisk, unless reloading is disabled in the settings."""
    if not settings.pbx_reload_enabled:
        return False
    return asterisk.reload_config()
