"""Asterisk Management Appliance — Backend API (Flask)

Owned by the frontend/backend team. Writes provisioning data into PostgreSQL.
Asterisk (other developer) reads these tables via ODBC realtime.

Endpoints:
  Auth:       /api/auth/login, /api/auth/register, /api/auth/me, /api/auth/logout
  Dashboard:  /api/dashboard/stats
  Extensions: /api/extensions, /api/extensions/<id>
  Users:      /api/users, /api/users/<id>
  Dialplan:   /api/dialplan, /api/dialplan/<id>
  Voicemail:  /api/voicemail, /api/voicemail/<id>
  Queues:     /api/queues, /api/queues/<id>, /api/queues/<id>/members
  IVR:        /api/ivr, /api/ivr/<id>, /api/ivr/<id>/routes
  CDR:        /api/cdr, /api/cdr/export
  Monitoring: /api/monitoring/asterisk
  Audit:      /api/audit
"""

import csv
import io
import json
import logging
import os
import re
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
import jwt
import psycopg2
from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS
from psycopg2.extras import RealDictCursor
from werkzeug.exceptions import BadRequest, Conflict, HTTPException, NotFound


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
def get_env(name, default=None):
    return os.environ.get(name, default)


DB_CONFIG = {
    "host": get_env("DB_HOST", "localhost"),
    "port": int(get_env("DB_PORT", "5432")),
    "dbname": get_env("DB_NAME", "asterisk"),
    "user": get_env("DB_USER", "postgres"),
    "password": get_env("DB_PASSWORD", "postgres"),
}

JWT_SECRET = get_env("JWT_SECRET_KEY", "dev-secret-change-me")
JWT_EXPIRE_MINUTES = int(get_env("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

CORS_ORIGINS = [o.strip() for o in get_env("CORS_ORIGINS", "*").split(",")]

ADMIN_ROLE = "admin"

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder=None)
CORS(app, origins=CORS_ORIGINS, supports_credentials=True)

action_logger = logging.getLogger("backend.actions")
action_logger.setLevel(logging.INFO)
if not action_logger.handlers:
    action_logger.addHandler(logging.StreamHandler())
action_logger.propagate = False


def log_action(event, level=logging.INFO, **fields):
    """Only log explicitly selected metadata, never payloads or credentials."""
    user = getattr(request, "current_user", None)
    action_logger.log(level, json.dumps({
        "timestamp": now_iso(),
        "event": event,
        "request_id": g.request_id,
        "user_id": user["id"] if user else None,
        **fields,
    }))


@app.before_request
def start_request_log():
    g.request_id = uuid.uuid4().hex
    g.request_started = time.monotonic()


@app.after_request
def finish_request_log(response):
    log_action(
        "request",
        level=logging.ERROR if response.status_code >= 500 else (
            logging.WARNING if response.status_code >= 400 else logging.INFO
        ),
        method=request.method,
        route=request.url_rule.rule if request.url_rule else "<unmatched>",
        status=response.status_code,
        duration_ms=round((time.monotonic() - g.request_started) * 1000, 2),
    )
    response.headers["X-Request-ID"] = g.request_id
    return response


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def get_conn():
    return psycopg2.connect(**DB_CONFIG)


def query(sql, params=None, fetch=True, commit=False):
    """Execute a SQL statement. Returns list of dict rows when fetch=True."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params or ())
            if commit:
                conn.commit()
            rows = cur.fetchall() if fetch else None
            if commit:
                conn.commit()
            return rows
    finally:
        conn.close()


def execute(sql, params=None):
    """Execute write statement, return last inserted id when available."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params or ())
            # try to grab RETURNING id if present
            try:
                row = cur.fetchone()
                conn.commit()
                return row
            except Exception:
                conn.commit()
                return None
    finally:
        conn.close()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password, hash_value):
    return bcrypt.checkpw(password.encode("utf-8"), hash_value.encode("utf-8"))


def make_token(user):
    payload = {
        "sub": str(user["id"]),  # PyJWT requires sub to be a string
        "username": user["username"],
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_token(token):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "missing or invalid authorization header"}), 401
        token = auth_header.split(" ", 1)[1]
        payload = decode_token(token)
        if not payload:
            return jsonify({"error": "token expired or invalid"}), 401
        if payload.get("role") != ADMIN_ROLE:
            return jsonify({"error": "admin access required"}), 403
        rows = query("SELECT id, username, role FROM users WHERE id=%s", (payload["sub"],))
        if not rows:
            return jsonify({"error": "administrator account no longer exists"}), 401
        if rows[0]["role"] != ADMIN_ROLE:
            return jsonify({"error": "admin access required"}), 403
        request.current_user = dict(rows[0])
        return f(*args, **kwargs)

    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if (
            getattr(request, "current_user", None) is None
            or request.current_user["role"] != ADMIN_ROLE
        ):
            return jsonify({"error": "admin access required"}), 403
        return f(*args, **kwargs)

    return decorated


def audit(action, table_name=None, record_id=None, details=None):
    """Write an audit log entry (best-effort, never breaks the main response)."""
    user = getattr(request, "current_user", None)
    ip = request.remote_addr
    log_action("action", action=action, table=table_name, record_id=record_id)
    conn = None
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO audit_log (user_id, action, table_name, record_id, details, ip, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    user["id"] if user else None,
                    action,
                    table_name,
                    record_id,
                    details,
                    ip,
                    datetime.now(timezone.utc),
                ),
            )
            conn.commit()
    except Exception as error:
        log_action(
            "audit_write_failed", level=logging.ERROR,
            action=action, error_type=type(error).__name__,
        )
    finally:
        if conn is not None:
            conn.close()


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        return jsonify({"error": "username and password required"}), 400

    rows = query(
        "SELECT * FROM users WHERE username = %s AND role = 'admin'", (username,)
    )
    user = rows[0] if rows else None
    if not user or not verify_password(password, user["password_hash"]):
        return jsonify({"error": "invalid credentials"}), 401

    return jsonify(
        {
            "token": make_token(user),
            "user": {
                "id": user["id"],
                "username": user["username"],
                "email": user["email"],
                "role": user["role"],
            },
        }
    )


@app.route("/api/auth/register", methods=["POST"])
@auth_required
@admin_required
def register():
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    email = data.get("email")
    password = data.get("password")
    role = data.get("role", "admin")
    if not username or not email or not password:
        return jsonify({"error": "username, email and password required"}), 400
    if role != "admin" or "is_active" in data:
        return jsonify({"error": "dashboard accounts are administrators; disabling is not supported"}), 400

    try:
        query(
            "INSERT INTO users (username, email, password_hash, role) VALUES (%s, %s, %s, %s)",
            (username, email, hash_password(password), role),
            fetch=False,
            commit=True,
        )
        audit("create_user", "users", None, f"created user {username}")
        return jsonify({"message": "user created"}), 201
    except psycopg2.IntegrityError:
        return jsonify({"error": "username or email already exists"}), 409


@app.route("/api/auth/me", methods=["GET"])
@auth_required
def me():
    rows = query(
        "SELECT id, username, email, role FROM users WHERE id = %s",
        (request.current_user["id"],),
    )
    user = rows[0] if rows else None
    if not user:
        return jsonify({"error": "user not found"}), 404
    return jsonify(dict(user))


@app.route("/api/auth/logout", methods=["POST"])
@auth_required
def logout():
    # Stateless JWT: client discards token. Audit logged server side.
    audit("logout", None, None, "user logged out")
    return jsonify({"message": "logged out"})


# ---------------------------------------------------------------------------
# Dashboard stats
# ---------------------------------------------------------------------------
@app.route("/api/dashboard/stats", methods=["GET"])
@auth_required
def dashboard_stats():
    def count(table):
        rows = query(f"SELECT COUNT(*) AS c FROM {table}")
        return int(rows[0]["c"])

    ext_total = count("ps_endpoints")
    users_total = query("SELECT COUNT(*) AS c FROM users WHERE role='admin'")[0]["c"]
    queues_total = count("queues")
    cdr_today = query(
        "SELECT COUNT(*) AS c FROM cdr WHERE calldate::date = CURRENT_DATE"
    )[0]["c"]

    return jsonify(
        {
            "extensions_total": int(ext_total),
            "users_total": int(users_total),
            "queues_total": int(queues_total),
            "cdr_today": int(cdr_today),
            "active_calls": None,
            "system_status": "monitoring_unavailable",
            "generated_at": now_iso(),
        }
    )


@app.route("/api/monitoring/asterisk", methods=["GET"])
@auth_required
def monitoring_asterisk():
    """Placeholder endpoint for the Asterisk developer to populate with AMI/ARI data."""
    return jsonify(
        {
            "status": "unknown",
            "version": "placeholder",
            "registered_phones": 0,
            "active_calls": 0,
            "channels": 0,
            "message": "Asterisk AMI/ARI integration is owned by the Asterisk developer. "
            "This endpoint returns placeholder data until wired.",
        }
    )


# ---------------------------------------------------------------------------
# Generic CRUD helper
# ---------------------------------------------------------------------------
def paginate(table, order_by="id DESC"):
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))
    offset = (page - 1) * per_page
    rows = query(
        f"SELECT * FROM {table} ORDER BY {order_by} LIMIT %s OFFSET %s",
        (per_page, offset),
    )
    total = query(f"SELECT COUNT(*) AS c FROM {table}")[0]["c"]
    return [dict(r) for r in rows], int(total), page, per_page


# ---------------------------------------------------------------------------
# Extensions
# ---------------------------------------------------------------------------
def extension_errors(f):
    """Keep validation/constraint failures in the API's JSON error format."""
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except HTTPException as error:
            return jsonify({"error": error.description}), error.code
        except psycopg2.IntegrityError:
            return jsonify({"error": "provisioning conflicts with existing records"}), 409
    return decorated


@contextmanager
def extension_cursor():
    conn = get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Provisioning is infrequent in this small PBX. Serialize endpoint
                # writes so reference checks and shared-object cleanup are atomic.
                # Asterisk's normal endpoint reads remain unblocked.
                cur.execute("LOCK TABLE ps_endpoints IN SHARE ROW EXCLUSIVE MODE")
                yield cur
    finally:
        conn.close()


def extension_payload(*, creating=False, endpoint_id=None):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadRequest("a JSON object is required")
    if "is_active" in data:
        raise BadRequest("extension disabling is not supported; omit is_active")
    allowed = {"extension", "callerid", "secret", "context", "mailboxes"}
    if creating:
        allowed |= {"display_name", "voicemail"}
    if set(data) - allowed:
        raise BadRequest("unsupported extension fields: " + ", ".join(sorted(set(data) - allowed)))
    if not data:
        raise BadRequest("no fields to update")
    for key, value in data.items():
        if creating and key == "voicemail":
            continue
        if not isinstance(value, str):
            raise BadRequest(f"{key} must be a string")
    number = data.get("extension", endpoint_id)
    if not number or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,39}", number):
        raise BadRequest("extension must be a 1–40 character SIP identifier")
    if endpoint_id is not None and number != endpoint_id:
        raise BadRequest("extension IDs cannot be renamed; provision a new endpoint")
    if creating and not data.get("secret"):
        raise BadRequest("secret is required")
    if len(data.get("secret", "")) > 80:
        raise BadRequest("secret must not exceed 80 characters")
    for field in ("callerid", "context", "mailboxes"):
        if len(data.get(field, "")) > 40:
            raise BadRequest(f"{field} must not exceed 40 characters")
    context = data.get("context", "internal" if creating else None)
    if context is not None and not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", context):
        raise BadRequest("context must name a configured dialplan context")
    if creating:
        if not re.fullmatch(r"[0-9]{1,32}", number):
            raise BadRequest("extension number must contain 1–32 digits")
        name = None
        if "display_name" in data:
            name = data.pop("display_name").strip()
            if not name or any(char in name for char in '"<>\\\r\n'):
                raise BadRequest("display name is required and cannot contain quotes, angle brackets or backslashes")
            if "callerid" in data:
                raise BadRequest("send display_name or callerid, not both")
            data["callerid"] = f'"{name}" <{number}>'
            if len(data["callerid"]) > 40:
                raise BadRequest("display name and formatted extension number must fit 40 characters")
        data.setdefault("context", "internal")
        data.setdefault("callerid", number)
        data.setdefault("mailboxes", "")
        voicemail = data.pop("voicemail", None)
        if voicemail is not None:
            if not isinstance(voicemail, dict) or set(voicemail) - {"pin", "email"}:
                raise BadRequest("voicemail must be an object containing only pin and optional email")
            if data["mailboxes"]:
                raise BadRequest("cannot create voicemail and link existing mailboxes together")
            pin = voicemail.get("pin", "0" + number)
            email = voicemail.get("email", "")
            if not isinstance(pin, str) or not re.fullmatch(r"[0-9]{1,80}", pin):
                raise BadRequest("voicemail PIN must contain 1–80 digits")
            if not isinstance(email, str) or len(email) > 80 or (
                email and not re.fullmatch(r"[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+", email)
            ):
                raise BadRequest("voicemail email must be a valid address of at most 80 characters")
            data["voicemail"] = {"pin": pin, "email": email, "fullname": name or data["callerid"]}
            data["mailboxes"] = number + "@default"
    return number, data


def check_mailboxes(cur, mailboxes):
    for reference in filter(None, mailboxes.split(",")):
        parts = reference.split("@")
        if len(parts) != 2 or not all(parts):
            raise BadRequest("mailboxes must contain mailbox@context references")
        mailbox, context = parts
        cur.execute(
            "SELECT uniqueid FROM voicemail WHERE mailbox=%s AND context=%s FOR SHARE",
            (mailbox, context),
        )
        if not cur.fetchone():
            raise BadRequest(f"mailbox {reference} does not exist; create it on the Voicemail page")


def shared_endpoint_object(cur, field, object_id, endpoint_id):
    # field is internal, never request input. Asterisk references are comma lists.
    cur.execute(
        f"""SELECT id FROM ps_endpoints WHERE id <> %s AND
        %s = ANY(regexp_split_to_array(COALESCE({field}, ''),
                                      '[[:space:]]*,[[:space:]]*')) LIMIT 1""",
        (endpoint_id, object_id),
    )
    return cur.fetchone() is not None


@app.route("/api/extensions", methods=["GET"])
@auth_required
@admin_required
@extension_errors
def list_extensions():
    try:
        page = int(request.args.get("page", 1))
        per_page = int(request.args.get("per_page", 50))
    except ValueError:
        raise BadRequest("page and per_page must be integers")
    if page < 1 or not 1 <= per_page <= 500:
        raise BadRequest("page must be positive; per_page must be between 1 and 500")
    rows = query(
        """SELECT id, id AS extension, callerid, context, mailboxes, auth, aors
           FROM ps_endpoints ORDER BY id LIMIT %s OFFSET %s""",
        (per_page, (page - 1) * per_page),
    )
    total = query("SELECT count(*) AS c FROM ps_endpoints")[0]["c"]
    return jsonify(
        {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "per_page": per_page,
        }
    )


@app.route("/api/extensions", methods=["POST"])
@auth_required
@admin_required
@extension_errors
def create_extension():
    number, data = extension_payload(creating=True)
    with extension_cursor() as cur:
        # Do not overwrite service numbers or independently managed routing.
        # Lock the routing table so concurrent API dialplan inserts cannot race
        # this whole-number check (the DB's unique key is only per priority).
        cur.execute("LOCK TABLE extensions IN SHARE ROW EXCLUSIVE MODE")
        if data["context"] == "internal" and number in {"000", "001", "002", "003", "004"}:
            raise Conflict("extension number is reserved for a built-in test service")
        cur.execute(
            "SELECT id FROM extensions WHERE context=%s AND exten=%s LIMIT 1",
            (data["context"], number),
        )
        if cur.fetchone():
            raise Conflict("dialplan already exists for this number and context; choose another number")
        voicemail = data.get("voicemail")
        if voicemail is not None:
            cur.execute(
                """INSERT INTO voicemail (context, mailbox, password, fullname, email)
                   VALUES ('default',%s,%s,%s,%s)""",
                (number, voicemail["pin"], voicemail["fullname"], voicemail["email"]),
            )
        else:
            check_mailboxes(cur, data["mailboxes"])
        cur.execute(
            "INSERT INTO ps_auths (id, auth_type, username, password) VALUES (%s,'userpass',%s,%s)",
            (number, number, data["secret"]),
        )
        cur.execute(
            "INSERT INTO ps_aors (id, max_contacts, remove_existing) VALUES (%s,2,'yes')",
            (number,),
        )
        cur.execute(
            """INSERT INTO ps_endpoints
               (id, auth, aors, transport, context, callerid, mailboxes,
                disallow, allow, direct_media, force_rport, rewrite_contact,
                rtp_symmetric, dtmf_mode, allow_transfer)
               VALUES (%s,%s,%s,'transport-udp',%s,%s,%s,
                       'all','ulaw,alaw','no','yes','yes','yes','rfc4733','yes')""",
            (number, number, number, data["context"], data["callerid"], data["mailboxes"]),
        )
        steps = [("Dial", "${PJSIP_DIAL_CONTACTS(" + number + ")},20")]
        if voicemail is not None or data["mailboxes"]:
            mailbox = data["mailboxes"].split(",")[0]
            # Dial with an empty contact list can abort the dialplan. Route an
            # unregistered phone directly to its unavailable greeting instead.
            steps.insert(0, ("GotoIf", '$["${PJSIP_DIAL_CONTACTS(' + number + ')}" = ""]?8'))
            steps += [
                ("GotoIf", '$["${DIALSTATUS}" = "BUSY"]?6'),
                ("GotoIf", '$["${DIALSTATUS}" = "NOANSWER" | "${DIALSTATUS}" = "CHANUNAVAIL"]?8'),
                ("Hangup", ""),
                ("VoiceMail", mailbox + ",b"),
                ("Hangup", ""),
                ("VoiceMail", mailbox + ",u"),
                ("Hangup", ""),
            ]
        else:
            steps.append(("Hangup", ""))
        for priority, (application, arguments) in enumerate(steps, start=1):
            cur.execute(
                """INSERT INTO extensions (context, exten, priority, app, appdata)
                   VALUES (%s,%s,%s,%s,%s)""",
                (data["context"], number, priority, application, arguments),
            )
    audit("create_extension", "ps_endpoints", None, f"endpoint {number}")
    return jsonify({"message": "extension and call routing created", "id": number}), 201


@app.route("/api/extensions/<string:ext_id>", methods=["PUT"])
@auth_required
@admin_required
@extension_errors
def update_extension(ext_id):
    _, data = extension_payload(endpoint_id=ext_id)
    with extension_cursor() as cur:
        cur.execute("SELECT auth FROM ps_endpoints WHERE id=%s FOR UPDATE", (ext_id,))
        endpoint = cur.fetchone()
        if not endpoint:
            raise NotFound("extension not found")
        if "mailboxes" in data:
            check_mailboxes(cur, data["mailboxes"])
        # Blank secret on edit preserves credentials. Never return passwords to UI.
        if data.get("secret"):
            if endpoint["auth"] != ext_id or any(
                shared_endpoint_object(cur, field, ext_id, ext_id)
                for field in ("auth", "outbound_auth")
            ):
                raise Conflict("credentials are external or shared; cannot replace them here")
            cur.execute(
                "UPDATE ps_auths SET password=%s WHERE id=%s AND auth_type='userpass'",
                (data["secret"], ext_id),
            )
            if cur.rowcount != 1:
                raise Conflict("matching userpass credentials are missing")
        fields = [field for field in ("callerid", "context", "mailboxes") if field in data]
        if fields:
            cur.execute(
                "UPDATE ps_endpoints SET " + ", ".join(f"{field}=%s" for field in fields)
                + " WHERE id=%s", tuple(data[field] for field in fields) + (ext_id,),
            )
    audit("update_extension", "ps_endpoints", None, f"endpoint {ext_id}")
    return jsonify({"message": "extension updated"})


@app.route("/api/extensions/<string:ext_id>", methods=["DELETE"])
@auth_required
@admin_required
@extension_errors
def delete_extension(ext_id):
    retained = []
    with extension_cursor() as cur:
        cur.execute("SELECT id, auth, aors FROM ps_endpoints WHERE id=%s FOR UPDATE", (ext_id,))
        endpoint = cur.fetchone()
        if not endpoint:
            raise NotFound("extension not found")
        # Only clean same-ID objects actually referenced by this endpoint.
        if endpoint["auth"] == ext_id:
            if any(shared_endpoint_object(cur, field, ext_id, ext_id)
                   for field in ("auth", "outbound_auth")):
                retained.append("ps_auths")
            else:
                cur.execute("DELETE FROM ps_auths WHERE id=%s", (ext_id,))
        if endpoint["aors"] == ext_id:
            if shared_endpoint_object(cur, "aors", ext_id, ext_id):
                retained.append("ps_aors")
            else:
                cur.execute("DELETE FROM ps_aors WHERE id=%s", (ext_id,))
        cur.execute("DELETE FROM ps_endpoints WHERE id=%s", (ext_id,))
        remaining = {}
        for table, condition, params in (
            ("queue_members", "interface=%s OR state_interface=%s", (f"PJSIP/{ext_id}",) * 2),
            ("ps_endpoint_id_ips", "endpoint=%s", (ext_id,)),
            ("ps_contacts", "endpoint=%s", (ext_id,)),
            ("dialplan_text_matches", "strpos(appdata,%s)>0", (ext_id,)),
        ):
            source = "extensions" if table == "dialplan_text_matches" else table
            cur.execute(f"SELECT count(*) AS c FROM {source} WHERE {condition}", params)
            remaining[table] = cur.fetchone()["c"]
    audit("delete_extension", "ps_endpoints", None, f"endpoint {ext_id}")
    return jsonify({
        "message": "extension deleted; mailboxes, routing and active calls are unchanged",
        "retained_shared_objects": retained,
        "remaining_references": remaining,
        "warning": "Review queue/IP rules and dialplan patterns/expressions separately. "
                   "Dialplan text matches are candidates, not an exhaustive reference check.",
    })


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
@app.route("/api/users", methods=["GET"])
@auth_required
def list_users():
    rows = query(
        "SELECT id, username, email, role, created_at FROM users WHERE role='admin' ORDER BY id DESC"
    )
    return jsonify([dict(r) for r in rows])


@app.route("/api/users", methods=["POST"])
@auth_required
@admin_required
def create_user():
    return register()


@app.route("/api/users/<int:user_id>", methods=["PUT"])
@auth_required
@admin_required
def update_user(user_id):
    data = request.get_json(silent=True) or {}
    if "is_active" in data or data.get("role", "admin") != "admin":
        return jsonify({"error": "dashboard accounts are administrators; disabling is not supported"}), 400
    if not query("SELECT id FROM users WHERE id=%s AND role='admin'", (user_id,)):
        return jsonify({"error": "administrator not found"}), 404
    fields = []
    params = []
    for col in ["username", "email"]:
        if col in data:
            fields.append(f"{col} = %s")
            params.append(data[col])
    if "password" in data and data["password"]:
        fields.append("password_hash = %s")
        params.append(hash_password(data["password"]))
    if not fields:
        return jsonify({"error": "no fields to update"}), 400
    params.append(user_id)
    query(
        f"UPDATE users SET {', '.join(fields)} WHERE id = %s",
        tuple(params),
        fetch=False,
        commit=True,
    )
    audit("update_user", "users", user_id, "administrator updated")
    return jsonify({"message": "user updated"})


@app.route("/api/users/<int:user_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_user(user_id):
    if user_id == request.current_user["id"]:
        return jsonify({"error": "cannot delete yourself"}), 400
    write_existing("DELETE FROM users WHERE id = %s AND role='admin'", (user_id,))
    audit("delete_user", "users", user_id, None)
    return jsonify({"message": "user deleted"})


# ---------------------------------------------------------------------------
# Dialplan
# ---------------------------------------------------------------------------
def write_existing(sql, params):
    rows = query(sql + " RETURNING 1", params, commit=True)
    if not rows:
        raise NotFound("record not found")


def pbx_payload(allowed, *, required=(), integers=(), booleans=()):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadRequest("JSON object required")
    unknown = set(data) - set(allowed)
    if unknown:
        raise BadRequest("unsupported fields: " + ", ".join(sorted(unknown)))
    for field in required:
        if not data.get(field):
            raise BadRequest(f"{field} is required")
    for field, value in data.items():
        if field in integers:
            if type(value) is not int or value < (1 if field == "priority" else 0):
                raise BadRequest(f"{field} must be a valid nonnegative integer (priority starts at 1)")
        elif field in booleans:
            if type(value) is not bool:
                raise BadRequest(f"{field} must be a JSON boolean")
        elif not isinstance(value, str):
            raise BadRequest(f"{field} must be text")
        elif field in ("pattern", "context", "application", "mailbox", "name", "interface") and not value.strip():
            raise BadRequest(f"{field} cannot be blank")
    if "name" in data and ("/" in data["name"] or len(data["name"]) > 80):
        raise BadRequest("queue names must fit the 80-character member key and cannot contain /")
    return data


@app.errorhandler(HTTPException)
def http_error(error):
    return jsonify({"error": error.description}), error.code


@app.errorhandler(psycopg2.IntegrityError)
def constraint_error(error):
    return jsonify({"error": "record conflicts with an existing record or reference"}), 409


@app.errorhandler(psycopg2.DataError)
def field_error(error):
    return jsonify({"error": "field exceeds the database size or value limits"}), 400


@app.route("/api/dialplan", methods=["GET"])
@auth_required
def list_dialplan():
    rows = query("""SELECT id, exten AS pattern, context, appdata AS destination,
                    priority, app AS application FROM extensions
                    ORDER BY context, exten, priority""")
    return jsonify([dict(r) for r in rows])


@app.route("/api/dialplan", methods=["POST"])
@auth_required
@admin_required
def create_dialplan():
    data = pbx_payload(("pattern", "context", "destination", "priority", "application"),
                       required=("pattern", "application"), integers=("priority",))
    for f in ["pattern", "application"]:
        if not data.get(f):
            return jsonify({"error": f"{f} is required"}), 400
    row = execute(
        """
        INSERT INTO extensions (exten, context, appdata, priority, app)
        VALUES (%s,%s,%s,%s,%s) RETURNING id
        """,
        (
            data["pattern"],
            data.get("context", "internal"),
            data.get("destination", ""),
            int(data.get("priority", 1)),
            data.get("application", "Dial"),
        ),
    )
    audit(
        "create_dialplan",
        "extensions",
        row["id"] if row else None,
        f"pattern {data['pattern']}",
    )
    return jsonify(
        {"message": "dialplan entry created", "id": row["id"] if row else None}
    ), 201


@app.route("/api/dialplan/<int:dp_id>", methods=["PUT"])
@auth_required
@admin_required
def update_dialplan(dp_id):
    data = pbx_payload(("pattern", "context", "destination", "priority", "application"),
                       integers=("priority",))
    fields = []
    params = []
    columns = {"pattern": "exten", "context": "context", "destination": "appdata",
               "priority": "priority", "application": "app"}
    for col, native in columns.items():
        if col in data:
            fields.append(f"{native} = %s")
            params.append(data[col])
    if not fields:
        return jsonify({"error": "no fields to update"}), 400
    params.append(dp_id)
    write_existing(
        f"UPDATE extensions SET {', '.join(fields)} WHERE id = %s",
        tuple(params),
    )
    audit("update_dialplan", "extensions", dp_id, "dialplan entry updated")
    return jsonify({"message": "dialplan entry updated"})


@app.route("/api/dialplan/<int:dp_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_dialplan(dp_id):
    write_existing("DELETE FROM extensions WHERE id = %s", (dp_id,))
    audit("delete_dialplan", "extensions", dp_id, None)
    return jsonify({"message": "dialplan entry deleted"})


# ---------------------------------------------------------------------------
# Voicemail
# ---------------------------------------------------------------------------
@app.route("/api/voicemail", methods=["GET"])
@auth_required
def list_voicemail():
    rows = query("""SELECT uniqueid AS id, context, mailbox, fullname AS full_name,
                    email, attach, deletevoicemail AS delete_msg
                    FROM voicemail ORDER BY context, mailbox""")
    return jsonify([dict(r) for r in rows])


@app.route("/api/voicemail", methods=["POST"])
@auth_required
@admin_required
def create_voicemail():
    data = pbx_payload(("mailbox", "password", "full_name", "email", "context", "attach", "delete_msg"),
                       required=("mailbox", "password"), booleans=("attach", "delete_msg"))
    for f in ["mailbox", "password"]:
        if not data.get(f):
            return jsonify({"error": f"{f} is required"}), 400
    try:
        row = execute(
            """
            INSERT INTO voicemail (mailbox, password, fullname, email, attach, deletevoicemail, context)
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING uniqueid AS id
            """,
            (
                data["mailbox"],
                data["password"],
                data.get("full_name"),
                data.get("email"),
                "yes" if data.get("attach", False) else "no",
                "yes" if data.get("delete_msg", False) else "no",
                data.get("context", "default"),
            ),
        )
        audit(
            "create_voicemail",
            "voicemail",
            row["id"] if row else None,
            f"mailbox {data['mailbox']}",
        )
        return jsonify(
            {"message": "voicemail created", "id": row["id"] if row else None}
        ), 201
    except psycopg2.IntegrityError:
        return jsonify({"error": "mailbox already exists"}), 409


@app.route("/api/voicemail/<int:vm_id>", methods=["PUT"])
@auth_required
@admin_required
def update_voicemail(vm_id):
    data = pbx_payload(("mailbox", "password", "full_name", "email", "context", "attach", "delete_msg"),
                       booleans=("attach", "delete_msg"))
    fields = []
    params = []
    columns = {"mailbox": "mailbox", "password": "password", "full_name": "fullname",
               "email": "email", "attach": "attach", "delete_msg": "deletevoicemail",
               "context": "context"}
    for col, native in columns.items():
        if col in data:
            if col == "password" and not data[col]:
                continue
            fields.append(f"{native} = %s")
            params.append(("yes" if data[col] else "no")
                          if col in ("attach", "delete_msg") else data[col])
    if not fields:
        return jsonify({"error": "no fields to update"}), 400
    params.append(vm_id)
    try:
        write_existing(
            f"UPDATE voicemail SET {', '.join(fields)} WHERE uniqueid = %s",
            tuple(params),
        )
        audit("update_voicemail", "voicemail", vm_id, "mailbox updated")
        return jsonify({"message": "voicemail updated"})
    except psycopg2.IntegrityError:
        return jsonify({"error": "mailbox already exists"}), 409


@app.route("/api/voicemail/<int:vm_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_voicemail(vm_id):
    write_existing("DELETE FROM voicemail WHERE uniqueid = %s", (vm_id,))
    audit("delete_voicemail", "voicemail", vm_id, None)
    return jsonify({"message": "voicemail deleted"})


# ---------------------------------------------------------------------------
# Queues
# ---------------------------------------------------------------------------
@app.route("/api/queues", methods=["GET"])
@auth_required
def list_queues():
    rows = query("""
        SELECT q.*, q.name AS id, q.wrapuptime AS wrapup_time,
               q.maxlen AS max_len, COUNT(qm.uniqueid) AS member_count
        FROM queues q
        LEFT JOIN queue_members qm ON qm.queue_name = q.name
        GROUP BY q.name ORDER BY q.name
    """)
    return jsonify([dict(r) for r in rows])


@app.route("/api/queues", methods=["POST"])
@auth_required
@admin_required
def create_queue():
    data = pbx_payload(("name", "strategy", "wrapup_time", "max_len", "timeout"),
                       required=("name",), integers=("wrapup_time", "max_len", "timeout"))
    for f in ["name"]:
        if not data.get(f):
            return jsonify({"error": f"{f} is required"}), 400
    try:
        row = execute(
            """
            INSERT INTO queues (name, strategy, wrapuptime, maxlen, timeout)
            VALUES (%s,%s,%s,%s,%s) RETURNING name AS id
            """,
            (
                data["name"],
                data.get("strategy", "ringall"),
                int(data.get("wrapup_time", 0)),
                int(data.get("max_len", 0)),
                int(data.get("timeout", 60)),
            ),
        )
        audit(
            "create_queue",
            "queues",
            None,
            f"queue {data['name']}",
        )
        return jsonify(
            {"message": "queue created", "id": row["id"] if row else None}
        ), 201
    except psycopg2.IntegrityError:
        return jsonify({"error": "queue name or configuration conflicts with the schema"}), 409


@app.route("/api/queues/<string:q_id>", methods=["PUT"])
@auth_required
@admin_required
def update_queue(q_id):
    data = pbx_payload(("name", "strategy", "wrapup_time", "max_len", "timeout"),
                       integers=("wrapup_time", "max_len", "timeout"))
    if "name" in data and data["name"] != q_id:
        return jsonify({"error": "queue name cannot be changed; create another queue"}), 400
    fields = []
    params = []
    columns = {"strategy": "strategy", "wrapup_time": "wrapuptime",
               "max_len": "maxlen", "timeout": "timeout"}
    for col, native in columns.items():
        if col in data:
            fields.append(f"{native} = %s")
            params.append(data[col])
    if not fields:
        return jsonify({"error": "no fields to update"}), 400
    params.append(q_id)
    try:
        write_existing(
            f"UPDATE queues SET {', '.join(fields)} WHERE name = %s",
            tuple(params),
        )
        audit("update_queue", "queues", None, f"queue {q_id} updated")
        return jsonify({"message": "queue updated"})
    except psycopg2.IntegrityError:
        return jsonify({"error": "queue name or configuration conflicts with the schema"}), 409


@app.route("/api/queues/<string:q_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_queue(q_id):
    write_existing("DELETE FROM queues WHERE name = %s", (q_id,))
    audit("delete_queue", "queues", None, f"queue {q_id}")
    return jsonify({"message": "queue deleted"})


@app.route("/api/queues/<string:q_id>/members", methods=["GET"])
@auth_required
def list_queue_members(q_id):
    rows = query(
        "SELECT *, uniqueid AS id FROM queue_members WHERE queue_name = %s ORDER BY uniqueid", (q_id,)
    )
    return jsonify([dict(r) for r in rows])


@app.route("/api/queues/<string:q_id>/members", methods=["POST"])
@auth_required
@admin_required
def add_queue_member(q_id):
    data = pbx_payload(("interface", "penalty"), required=("interface",), integers=("penalty",))
    if not data.get("interface"):
        return jsonify({"error": "interface is required"}), 400
    query(
        "INSERT INTO queue_members (queue_name, interface, penalty) VALUES (%s,%s,%s)",
        (
            q_id,
            data["interface"],
            int(data.get("penalty", 0)),
        ),
        fetch=False,
        commit=True,
    )
    audit(
        "add_queue_member",
        "queue_members",
        None,
        f"queue {q_id} interface {data['interface']}",
    )
    return jsonify({"message": "member added"}), 201


@app.route("/api/queues/<string:q_id>/members/<int:m_id>", methods=["DELETE"])
@auth_required
@admin_required
def remove_queue_member(q_id, m_id):
    write_existing(
        "DELETE FROM queue_members WHERE uniqueid = %s AND queue_name = %s",
        (m_id, q_id),
    )
    audit("remove_queue_member", "queue_members", m_id, f"queue {q_id}")
    return jsonify({"message": "member removed"})


# ---------------------------------------------------------------------------
# IVR
# ---------------------------------------------------------------------------
@app.route("/api/ivr", methods=["GET", "POST"])
@app.route("/api/ivr/<path:unused>", methods=["GET", "POST", "PUT", "DELETE"])
@auth_required
def unavailable_ivr(unused=None):
    # The removed menu tables were not Asterisk consumers. Their replacement
    # provisioning design remains unapproved; do not pretend writes succeed.
    return jsonify({"error": "Managed IVR editor is not available with this schema. "
                    "Existing IVRs run from dialplan records; use the Dialplan page."}), 501


# ---------------------------------------------------------------------------
# CDR
# ---------------------------------------------------------------------------
@app.route("/api/cdr", methods=["GET"])
@auth_required
def list_cdr():
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))
    offset = (page - 1) * per_page

    conditions = []
    params = []
    src = request.args.get("src")
    dst = request.args.get("dst")
    disposition = request.args.get("disposition")
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")

    if src:
        conditions.append("src ILIKE %s")
        params.append(f"%{src}%")
    if dst:
        conditions.append("dst ILIKE %s")
        params.append(f"%{dst}%")
    if disposition:
        conditions.append("disposition = %s")
        params.append(disposition)
    if date_from:
        conditions.append("calldate::date >= %s")
        params.append(date_from)
    if date_to:
        conditions.append("calldate::date <= %s")
        params.append(date_to)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    rows = query(
        f"SELECT * FROM cdr {where} ORDER BY calldate DESC LIMIT %s OFFSET %s",
        tuple(params + [per_page, offset]),
    )
    total = query(f"SELECT COUNT(*) AS c FROM cdr {where}", tuple(params))[0]["c"]
    return jsonify(
        {
            "items": [dict(r) for r in rows],
            "total": int(total),
            "page": page,
            "per_page": per_page,
        }
    )


@app.route("/api/cdr/export", methods=["GET"])
@auth_required
def export_cdr():
    rows = query("SELECT * FROM cdr ORDER BY calldate DESC LIMIT 10000")
    output = io.StringIO()
    writer = csv.writer(output)
    if rows:
        writer.writerow(rows[0].keys())
        for r in rows:
            writer.writerow(r.values())
    csv_data = output.getvalue()
    return (
        csv_data,
        200,
        {
            "Content-Type": "text/csv",
            "Content-Disposition": 'attachment; filename="cdr_export.csv"',
        },
    )


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------
@app.route("/api/audit", methods=["GET"])
@auth_required
@admin_required
def list_audit():
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))
    offset = (page - 1) * per_page
    rows = query(
        "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT %s OFFSET %s",
        (per_page, offset),
    )
    total = query("SELECT COUNT(*) AS c FROM audit_log")[0]["c"]
    return jsonify(
        {
            "items": [dict(r) for r in rows],
            "total": int(total),
            "page": page,
            "per_page": per_page,
        }
    )


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.route("/api/health", methods=["GET"])
def health():
    try:
        query("SELECT 1")
        return jsonify({"status": "ok", "db": "connected"}), 200
    except Exception as e:
        return jsonify({"status": "error", "db": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
