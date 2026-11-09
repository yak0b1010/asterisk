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
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
import jwt
import psycopg2
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from psycopg2.extras import RealDictCursor


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
        request.current_user = {
            "id": int(payload["sub"]),
            "username": payload["username"],
            "role": payload["role"],
        }
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
        conn.close()
    except Exception:
        pass


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
        "SELECT * FROM users WHERE username = %s AND is_active = TRUE", (username,)
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
    role = data.get("role", "operator")
    if not username or not email or not password:
        return jsonify({"error": "username, email and password required"}), 400
    if role not in ("admin", "operator"):
        role = "operator"

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
        "SELECT id, username, email, role, is_active FROM users WHERE id = %s",
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

    ext_active = query("SELECT COUNT(*) AS c FROM extensions WHERE is_active = TRUE")[
        0
    ]["c"]
    ext_total = count("extensions")
    users_total = count("users")
    queues_total = count("queues")
    ivr_total = count("ivr_menus")
    cdr_today = query(
        "SELECT COUNT(*) AS c FROM cdr WHERE calldate::date = CURRENT_DATE"
    )[0]["c"]

    # Active calls placeholder (Asterisk side populates via AMI later; for now count CDR answered today)
    active_calls = query(
        "SELECT COUNT(*) AS c FROM cdr WHERE disposition = 'ANSWERED' AND calldate > NOW() - INTERVAL '1 hour'"
    )[0]["c"]

    return jsonify(
        {
            "extensions_total": int(ext_total),
            "extensions_active": int(ext_active),
            "users_total": int(users_total),
            "queues_total": int(queues_total),
            "ivr_menus_total": int(ivr_total),
            "cdr_today": int(cdr_today),
            "active_calls": int(active_calls),
            "system_status": "operational",
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
@app.route("/api/extensions", methods=["GET"])
@auth_required
def list_extensions():
    rows, total, page, per_page = paginate("extensions")
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
def create_extension():
    data = request.get_json(silent=True) or {}
    required = ["extension", "name", "secret"]
    for f in required:
        if not data.get(f):
            return jsonify({"error": f"{f} is required"}), 400
    try:
        row = execute(
            """
            INSERT INTO extensions (extension, name, secret, context, technology,
                                    voicemail_enabled, voicemail_password, email, is_active)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
            """,
            (
                data["extension"],
                data["name"],
                data["secret"],
                data.get("context", "from-internal"),
                data.get("technology", "PJSIP"),
                bool(data.get("voicemail_enabled", False)),
                data.get("voicemail_password"),
                data.get("email"),
                bool(data.get("is_active", True)),
            ),
        )
        audit(
            "create_extension",
            "extensions",
            row["id"] if row else None,
            f"extension {data['extension']}",
        )
        return jsonify(
            {"message": "extension created", "id": row["id"] if row else None}
        ), 201
    except psycopg2.IntegrityError:
        return jsonify({"error": "extension already exists"}), 409


@app.route("/api/extensions/<int:ext_id>", methods=["PUT"])
@auth_required
@admin_required
def update_extension(ext_id):
    data = request.get_json(silent=True) or {}
    fields = []
    params = []
    for col in [
        "extension",
        "name",
        "secret",
        "context",
        "technology",
        "voicemail_enabled",
        "voicemail_password",
        "email",
        "is_active",
    ]:
        if col in data:
            fields.append(f"{col} = %s")
            params.append(data[col])
    if not fields:
        return jsonify({"error": "no fields to update"}), 400
    fields.append("updated_at = NOW()")
    params.append(ext_id)
    sql = f"UPDATE extensions SET {', '.join(fields)} WHERE id = %s"
    try:
        query(sql, tuple(params), fetch=False, commit=True)
        audit("update_extension", "extensions", ext_id, str(data))
        return jsonify({"message": "extension updated"})
    except psycopg2.IntegrityError:
        return jsonify({"error": "extension already exists"}), 409


@app.route("/api/extensions/<int:ext_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_extension(ext_id):
    query("DELETE FROM extensions WHERE id = %s", (ext_id,), fetch=False, commit=True)
    audit("delete_extension", "extensions", ext_id, None)
    return jsonify({"message": "extension deleted"})


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
@app.route("/api/users", methods=["GET"])
@auth_required
def list_users():
    rows = query(
        "SELECT id, username, email, role, is_active, created_at FROM users ORDER BY id DESC"
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
    fields = []
    params = []
    for col in ["username", "email", "role", "is_active"]:
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
    audit("update_user", "users", user_id, str(data))
    return jsonify({"message": "user updated"})


@app.route("/api/users/<int:user_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_user(user_id):
    if user_id == request.current_user["id"]:
        return jsonify({"error": "cannot delete yourself"}), 400
    query("DELETE FROM users WHERE id = %s", (user_id,), fetch=False, commit=True)
    audit("delete_user", "users", user_id, None)
    return jsonify({"message": "user deleted"})


# ---------------------------------------------------------------------------
# Dialplan
# ---------------------------------------------------------------------------
@app.route("/api/dialplan", methods=["GET"])
@auth_required
def list_dialplan():
    rows = query("SELECT * FROM dialplan ORDER BY id DESC")
    return jsonify([dict(r) for r in rows])


@app.route("/api/dialplan", methods=["POST"])
@auth_required
@admin_required
def create_dialplan():
    data = request.get_json(silent=True) or {}
    for f in ["pattern", "destination"]:
        if not data.get(f):
            return jsonify({"error": f"{f} is required"}), 400
    row = execute(
        """
        INSERT INTO dialplan (pattern, context, destination, priority, application, description, is_active)
        VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id
        """,
        (
            data["pattern"],
            data.get("context", "from-internal"),
            data["destination"],
            int(data.get("priority", 1)),
            data.get("application", "Dial"),
            data.get("description"),
            bool(data.get("is_active", True)),
        ),
    )
    audit(
        "create_dialplan",
        "dialplan",
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
    data = request.get_json(silent=True) or {}
    fields = []
    params = []
    for col in [
        "pattern",
        "context",
        "destination",
        "priority",
        "application",
        "description",
        "is_active",
    ]:
        if col in data:
            fields.append(f"{col} = %s")
            params.append(data[col])
    if not fields:
        return jsonify({"error": "no fields to update"}), 400
    fields.append("updated_at = NOW()")
    params.append(dp_id)
    query(
        f"UPDATE dialplan SET {', '.join(fields)} WHERE id = %s",
        tuple(params),
        fetch=False,
        commit=True,
    )
    audit("update_dialplan", "dialplan", dp_id, str(data))
    return jsonify({"message": "dialplan entry updated"})


@app.route("/api/dialplan/<int:dp_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_dialplan(dp_id):
    query("DELETE FROM dialplan WHERE id = %s", (dp_id,), fetch=False, commit=True)
    audit("delete_dialplan", "dialplan", dp_id, None)
    return jsonify({"message": "dialplan entry deleted"})


# ---------------------------------------------------------------------------
# Voicemail
# ---------------------------------------------------------------------------
@app.route("/api/voicemail", methods=["GET"])
@auth_required
def list_voicemail():
    rows = query("SELECT * FROM voicemail ORDER BY id DESC")
    return jsonify([dict(r) for r in rows])


@app.route("/api/voicemail", methods=["POST"])
@auth_required
@admin_required
def create_voicemail():
    data = request.get_json(silent=True) or {}
    for f in ["mailbox", "password"]:
        if not data.get(f):
            return jsonify({"error": f"{f} is required"}), 400
    try:
        row = execute(
            """
            INSERT INTO voicemail (mailbox, password, full_name, email, attach, delete_msg, is_active)
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id
            """,
            (
                data["mailbox"],
                data["password"],
                data.get("full_name"),
                data.get("email"),
                bool(data.get("attach", False)),
                bool(data.get("delete_msg", False)),
                bool(data.get("is_active", True)),
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
    data = request.get_json(silent=True) or {}
    fields = []
    params = []
    for col in [
        "mailbox",
        "password",
        "full_name",
        "email",
        "attach",
        "delete_msg",
        "is_active",
    ]:
        if col in data:
            fields.append(f"{col} = %s")
            params.append(data[col])
    if not fields:
        return jsonify({"error": "no fields to update"}), 400
    fields.append("updated_at = NOW()")
    params.append(vm_id)
    try:
        query(
            f"UPDATE voicemail SET {', '.join(fields)} WHERE id = %s",
            tuple(params),
            fetch=False,
            commit=True,
        )
        audit("update_voicemail", "voicemail", vm_id, str(data))
        return jsonify({"message": "voicemail updated"})
    except psycopg2.IntegrityError:
        return jsonify({"error": "mailbox already exists"}), 409


@app.route("/api/voicemail/<int:vm_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_voicemail(vm_id):
    query("DELETE FROM voicemail WHERE id = %s", (vm_id,), fetch=False, commit=True)
    audit("delete_voicemail", "voicemail", vm_id, None)
    return jsonify({"message": "voicemail deleted"})


# ---------------------------------------------------------------------------
# Queues
# ---------------------------------------------------------------------------
@app.route("/api/queues", methods=["GET"])
@auth_required
def list_queues():
    rows = query("""
        SELECT q.*, COUNT(qm.id) AS member_count
        FROM queues q
        LEFT JOIN queue_members qm ON qm.queue_id = q.id AND qm.is_active = TRUE
        GROUP BY q.id ORDER BY q.id DESC
    """)
    return jsonify([dict(r) for r in rows])


@app.route("/api/queues", methods=["POST"])
@auth_required
@admin_required
def create_queue():
    data = request.get_json(silent=True) or {}
    for f in ["name", "number"]:
        if not data.get(f):
            return jsonify({"error": f"{f} is required"}), 400
    try:
        row = execute(
            """
            INSERT INTO queues (name, number, strategy, wrapup_time, max_len, timeout, is_active)
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id
            """,
            (
                data["name"],
                data["number"],
                data.get("strategy", "ringall"),
                int(data.get("wrapup_time", 0)),
                int(data.get("max_len", 0)),
                int(data.get("timeout", 60)),
                bool(data.get("is_active", True)),
            ),
        )
        audit(
            "create_queue",
            "queues",
            row["id"] if row else None,
            f"queue {data['name']}",
        )
        return jsonify(
            {"message": "queue created", "id": row["id"] if row else None}
        ), 201
    except psycopg2.IntegrityError:
        return jsonify({"error": "queue number already exists"}), 409


@app.route("/api/queues/<int:q_id>", methods=["PUT"])
@auth_required
@admin_required
def update_queue(q_id):
    data = request.get_json(silent=True) or {}
    fields = []
    params = []
    for col in [
        "name",
        "number",
        "strategy",
        "wrapup_time",
        "max_len",
        "timeout",
        "is_active",
    ]:
        if col in data:
            fields.append(f"{col} = %s")
            params.append(data[col])
    if not fields:
        return jsonify({"error": "no fields to update"}), 400
    fields.append("updated_at = NOW()")
    params.append(q_id)
    try:
        query(
            f"UPDATE queues SET {', '.join(fields)} WHERE id = %s",
            tuple(params),
            fetch=False,
            commit=True,
        )
        audit("update_queue", "queues", q_id, str(data))
        return jsonify({"message": "queue updated"})
    except psycopg2.IntegrityError:
        return jsonify({"error": "queue number already exists"}), 409


@app.route("/api/queues/<int:q_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_queue(q_id):
    query("DELETE FROM queues WHERE id = %s", (q_id,), fetch=False, commit=True)
    audit("delete_queue", "queues", q_id, None)
    return jsonify({"message": "queue deleted"})


@app.route("/api/queues/<int:q_id>/members", methods=["GET"])
@auth_required
def list_queue_members(q_id):
    rows = query(
        "SELECT * FROM queue_members WHERE queue_id = %s ORDER BY id DESC", (q_id,)
    )
    return jsonify([dict(r) for r in rows])


@app.route("/api/queues/<int:q_id>/members", methods=["POST"])
@auth_required
@admin_required
def add_queue_member(q_id):
    data = request.get_json(silent=True) or {}
    if not data.get("interface"):
        return jsonify({"error": "interface is required"}), 400
    query(
        "INSERT INTO queue_members (queue_id, interface, penalty, is_active) VALUES (%s,%s,%s,%s)",
        (
            q_id,
            data["interface"],
            int(data.get("penalty", 0)),
            bool(data.get("is_active", True)),
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


@app.route("/api/queues/<int:q_id>/members/<int:m_id>", methods=["DELETE"])
@auth_required
@admin_required
def remove_queue_member(q_id, m_id):
    query(
        "DELETE FROM queue_members WHERE id = %s AND queue_id = %s",
        (m_id, q_id),
        fetch=False,
        commit=True,
    )
    audit("remove_queue_member", "queue_members", m_id, f"queue {q_id}")
    return jsonify({"message": "member removed"})


# ---------------------------------------------------------------------------
# IVR
# ---------------------------------------------------------------------------
@app.route("/api/ivr", methods=["GET"])
@auth_required
def list_ivr():
    rows = query("SELECT * FROM ivr_menus ORDER BY id DESC")
    return jsonify([dict(r) for r in rows])


@app.route("/api/ivr", methods=["POST"])
@auth_required
@admin_required
def create_ivr():
    data = request.get_json(silent=True) or {}
    for f in ["name", "extension"]:
        if not data.get(f):
            return jsonify({"error": f"{f} is required"}), 400
    try:
        row = execute(
            """
            INSERT INTO ivr_menus (name, extension, prompt_file, timeout, invalid_prompt_file, is_active)
            VALUES (%s,%s,%s,%s,%s,%s) RETURNING id
            """,
            (
                data["name"],
                data["extension"],
                data.get("prompt_file"),
                int(data.get("timeout", 5)),
                data.get("invalid_prompt_file"),
                bool(data.get("is_active", True)),
            ),
        )
        audit(
            "create_ivr", "ivr_menus", row["id"] if row else None, f"ivr {data['name']}"
        )
        return jsonify(
            {"message": "ivr created", "id": row["id"] if row else None}
        ), 201
    except psycopg2.IntegrityError:
        return jsonify({"error": "ivr extension already exists"}), 409


@app.route("/api/ivr/<int:ivr_id>", methods=["PUT"])
@auth_required
@admin_required
def update_ivr(ivr_id):
    data = request.get_json(silent=True) or {}
    fields = []
    params = []
    for col in [
        "name",
        "extension",
        "prompt_file",
        "timeout",
        "invalid_prompt_file",
        "is_active",
    ]:
        if col in data:
            fields.append(f"{col} = %s")
            params.append(data[col])
    if not fields:
        return jsonify({"error": "no fields to update"}), 400
    fields.append("updated_at = NOW()")
    params.append(ivr_id)
    try:
        query(
            f"UPDATE ivr_menus SET {', '.join(fields)} WHERE id = %s",
            tuple(params),
            fetch=False,
            commit=True,
        )
        audit("update_ivr", "ivr_menus", ivr_id, str(data))
        return jsonify({"message": "ivr updated"})
    except psycopg2.IntegrityError:
        return jsonify({"error": "ivr extension already exists"}), 409


@app.route("/api/ivr/<int:ivr_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_ivr(ivr_id):
    query("DELETE FROM ivr_menus WHERE id = %s", (ivr_id,), fetch=False, commit=True)
    audit("delete_ivr", "ivr_menus", ivr_id, None)
    return jsonify({"message": "ivr deleted"})


@app.route("/api/ivr/<int:ivr_id>/routes", methods=["GET"])
@auth_required
def list_ivr_routes(ivr_id):
    rows = query(
        "SELECT * FROM ivr_routes WHERE ivr_id = %s ORDER BY id DESC", (ivr_id,)
    )
    return jsonify([dict(r) for r in rows])


@app.route("/api/ivr/<int:ivr_id>/routes", methods=["POST"])
@auth_required
@admin_required
def add_ivr_route(ivr_id):
    data = request.get_json(silent=True) or {}
    for f in ["digit", "destination_type", "destination"]:
        if not data.get(f):
            return jsonify({"error": f"{f} is required"}), 400
    query(
        "INSERT INTO ivr_routes (ivr_id, digit, destination_type, destination) VALUES (%s,%s,%s,%s)",
        (ivr_id, data["digit"], data["destination_type"], data["destination"]),
        fetch=False,
        commit=True,
    )
    audit("add_ivr_route", "ivr_routes", None, f"ivr {ivr_id} digit {data['digit']}")
    return jsonify({"message": "route added"}), 201


@app.route("/api/ivr/<int:ivr_id>/routes/<int:r_id>", methods=["DELETE"])
@auth_required
@admin_required
def delete_ivr_route(ivr_id, r_id):
    query(
        "DELETE FROM ivr_routes WHERE id = %s AND ivr_id = %s",
        (r_id, ivr_id),
        fetch=False,
        commit=True,
    )
    audit("delete_ivr_route", "ivr_routes", r_id, f"ivr {ivr_id}")
    return jsonify({"message": "route deleted"})


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
