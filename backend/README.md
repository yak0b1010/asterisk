# Asterisk Appliance Backend

Python/FastAPI replacement for the previous Go backend.  It keeps the same
`/api/v1` routes, `data`/`meta`/`error` response envelopes, JWT/refresh-token
flow, role permissions, backup format and Asterisk realtime mirroring.

## Features

- FastAPI application with synchronous SQLAlchemy 2.x and psycopg 3.
- PostgreSQL schema migrations and an idempotent bootstrap administrator.
- JWT access tokens, rotating refresh tokens, session revocation and bcrypt
  password hashes.
- CRUD APIs for users, extensions, dialplan rules, voicemail boxes, queues,
  IVR menus, conference rooms, CDRs, settings and backups.
- Dashboard, monitoring, audit-log, metrics and health endpoints.
- Asterisk realtime mirroring for `ps_endpoints`, `ps_auths`, `ps_aors`,
  `voicemail`, `queues`, `queue_members`, `extensions` and `meetme`.
- Version 2 gzip/JSON backups that include password hashes, SIP secrets,
  voicemail PINs and conference PINs, plus optional CDR rows.
- Dockerfile, Docker Compose stack, Makefile, pytest suite and end-to-end
  smoke/restore scripts.

## Requirements

- Python 3.11 or newer (tested with 3.13 in Docker and 3.14 on the host).
- PostgreSQL 14 or newer (tested with PostgreSQL 18).
- Docker and Docker Compose are optional but recommended for a local database.

## Layout

```text
backend/
├── app/
│   ├── main.py              FastAPI application and lifespan
│   ├── config.py            environment/.env configuration
│   ├── database.py          engine, migrations, seed data
│   ├── models.py            SQLAlchemy models (legacy table/column names)
│   ├── auth.py              hashing, JWT and role permissions
│   ├── responses.py         envelopes, serializers and request helpers
│   ├── deps.py              FastAPI dependencies
│   ├── realtime.py          Asterisk realtime table mirroring
│   ├── telephony.py         AMI/ARI clients
│   ├── backup.py            version 2 backup/restore
│   ├── middleware.py        request IDs, audit log, CORS, body limits
│   ├── monitor.py           host/process statistics
│   ├── metrics.py           Prometheus exposition
│   ├── migrations/          001_asterisk_realtime.sql, 002_app_schema.sql
│   ├── routers/             one module per API area
│   └── openapi.yaml         API specification served by the application
├── tools/
│   ├── smoke_test.py        end-to-end API smoke test
│   └── restore_test.py      backup/restore + realtime verification
├── tests/                   pytest unit and PostgreSQL integration tests
├── Dockerfile
├── docker-compose.yaml      PostgreSQL 18 + API
├── Makefile
├── requirements.txt
├── requirements-dev.txt
└── .env.example
```

## Quick start: API on the host, PostgreSQL in Docker

```bash
cd backend
cp .env.example .env          # optional; the repository root .env is also read
docker compose up -d postgres # PostgreSQL 18 on host port 5232
make install                  # creates .venv and installs dependencies
make run                      # python -m app, HTTP_ADDR from the environment
```

Check it:

```bash
curl -s http://127.0.0.1:8080/health
curl -s http://127.0.0.1:8080/ready
curl -s http://127.0.0.1:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin12345"}'
```

The default bootstrap administrator is `admin` / `admin12345`.  Change it before
exposing the service.  `make run` binds to `0.0.0.0:8080`; use
`HTTP_ADDR=127.0.0.1:8080 make run` to listen on loopback only.

If port `5232` is already used by another PostgreSQL container, publish a
different host port and point the API at it:

```bash
DB_PORT=5233 docker compose up -d postgres
DB_PORT=5233 make run
```

If you use the repository's existing `asterisk-postgres` container instead,
`DB_HOST=127.0.0.1 DB_PORT=5232 make run` is enough.  The root `.env` sets
`DB_HOST=postgres`; the backend automatically maps that to `127.0.0.1` when it
runs outside a container.

## Full Docker stack

```bash
cd backend
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

- API: <http://localhost:8080>
- PostgreSQL: `localhost:5232`
- API data/backups: named volume `api-data`
- PostgreSQL data: named volume `pgdata`

The API container always talks to `postgres:5432` on the Compose network.  The
published PostgreSQL port is controlled by `DB_PORT` (default `5232`).  To use
values from the repository root `.env`, run Compose with
`--env-file ../.env`; the API service still overrides `DB_HOST` and `DB_PORT`
for the internal network.

`docker compose down` stops the stack but keeps both volumes.  `docker compose
down -v` also deletes the database and backup volumes.

## Configuration

Configuration is read from the process environment first, then from the
nearest `.env` file found while walking up from the working directory.  When
running from `backend/`, `backend/.env` is loaded and then the repository root
`.env`; values already present in `backend/.env` or the process environment win.
Set `ENV_FILE=/path/to/file` to load one explicit file instead.

Important variables (see `.env.example` for the full list):

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_ENV` | `development` | `production` enforces a non-default JWT secret |
| `HTTP_ADDR` | `:8080` | Bind address for `python -m app` |
| `LOG_LEVEL` | `info` | Python logging level |
| `DATA_DIR` | `./data` | Backup storage directory |
| `AUTO_MIGRATE` | `true` | Apply idempotent SQL migrations at startup |
| `DATABASE_URL` | empty | Full SQLAlchemy URL; wins over `DB_*` |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5232` | PostgreSQL port (published host port for host runs) |
| `DB_NAME` | `astrisk` | Database name |
| `DB_USER` | `astrisk_user` | Database user |
| `DB_PASSWORD` | empty | Database password |
| `DB_SSLMODE` | `disable` | PostgreSQL SSL mode |
| `JWT_SECRET` | `change-me-in-production` | HS256 signing secret |
| `JWT_ISSUER` | `asterisk-backend` | JWT issuer |
| `JWT_AUDIENCE` | `asterisk-dashboard` | JWT audience |
| `ACCESS_TOKEN_TTL` | `15m` | Access-token lifetime |
| `REFRESH_TOKEN_TTL` | `168h` | Refresh-token lifetime |
| `ADMIN_USERNAME` | `admin` | Bootstrap administrator username |
| `ADMIN_PASSWORD` | `admin12345` | Bootstrap administrator password |
| `ADMIN_EMAIL` | `admin@asterisk.local` | Bootstrap administrator e-mail |
| `CORS_ORIGINS` | localhost origins | Comma-separated allowed origins |
| `ASTERISK_AMI_*` | see `.env.example` | Optional AMI control plane |
| `ASTERISK_ARI_*` | see `.env.example` | Optional ARI control plane |
| `ASTERISK_TRANSPORT` | `transport-udp` | PJSIP transport written to realtime |

Durations accept Go-style suffixes (`s`, `m`, `h`, `d`) or plain seconds.
`APP_ENV=production` rejects the default `JWT_SECRET`; generate one with
`openssl rand -hex 32`.  The bootstrap user is only created when the user table
is empty, so changing `ADMIN_PASSWORD` later does not reset an existing account.

## Database and migrations

Migrations are plain idempotent SQL files in `app/migrations/`:

- `001_asterisk_realtime.sql` creates/updates the Asterisk realtime tables.
- `002_app_schema.sql` creates the application tables using the historical
  GORM names, including `app_extensions.s_ip_password`.

They run automatically at startup when `AUTO_MIGRATE=true`.  To apply them
without starting the API:

```bash
make migrate
```

The application deliberately uses explicit SQL rather than ORM `create_all`, so
existing appliance databases keep their data.  PostgreSQL 18 changed the default
data directory; the Compose volume is mounted at `/var/lib/postgresql` for that
reason.

Inspect the database with:

```bash
# Compose stack from this directory:
docker compose exec postgres psql -U astrisk_user -d astrisk

# Existing root project container:
docker exec -e PGPASSWORD=12345678 asterisk-postgres \
  psql -U astrisk_user -d astrisk
```

## API

All application routes are under `/api/v1`.  Successful responses use:

```json
{"data": ...}
```

Collection responses add pagination metadata:

```json
{"data": [], "meta": {"page": 1, "limit": 50, "total": 0, "pages": 0}}
```

Errors use:

```json
{"error": {"code": "bad_request", "message": "...", "details": null}}
```

Authenticate with `POST /api/v1/auth/login`, then send
`Authorization: Bearer <access_token>`.  Access tokens are short-lived; use
`POST /api/v1/auth/refresh` with the refresh token.  `POST /api/v1/auth/logout`
revokes the current user's refresh sessions.

Route groups:

- `/auth` — login, refresh, logout, profile, password, sessions, permissions
- `/users` — users, password resets, user extensions
- `/extensions` — PJSIP extensions, credentials, registration/status views
- `/dialplan` — rules, contexts, export, reload
- `/voicemail` — mailbox CRUD and reload
- `/queues` — queues, members, status, reload
- `/ivr` — menus, options, generated dialplan, reload
- `/conferences` — rooms, generated dialplan, live view
- `/cdr` — list, stats, CSV export, ingest, delete
- `/monitoring` — status, system, Asterisk, calls, endpoints, registrations
- `/audit` — audit log list/detail
- `/settings` — runtime settings
- `/backups` — create/list/download/restore/delete
- `/dashboard` — summary stats and recent calls

System endpoints are outside `/api/v1`: `/health`, `/ready`, `/metrics`.
The API specification is served at `/api/v1/openapi.yaml` and a small HTML
landing page at `/api/v1/docs` (FastAPI's built-in Swagger/ReDoc UI is
intentionally disabled).

Roles are `admin`, `supervisor`, `agent` and `viewer`.  Administrators have all
permissions; the other roles are defined in `app/auth.py`.  Credential fields
(`sip_password`, `voicemail_pin`, conference `pin`) are returned only to callers
with the relevant read/credential permission.

## Asterisk integration

AMI and ARI are optional.  When they are not configured, CRUD operations still
write to PostgreSQL and reload endpoints return a successful response explaining
that only the database was updated.  When configured, reload endpoints invoke
the appropriate AMI action (`dialplan reload`, `pjsip reload`, etc.).

Every extension/voicemail/queue/IVR/conference/dialplan change is mirrored into
the Asterisk realtime tables used by the appliance:

| Application data | Realtime table(s) |
| --- | --- |
| Extension | `ps_endpoints`, `ps_auths`, `ps_aors` |
| Voicemail box | `voicemail` |
| Queue and members | `queues`, `queue_members` |
| Dialplan rule | `extensions` |
| Conference room | `meetme` |

The backend mirrors `queues`, `extensions` and `meetme` even though the
appliance's current `extconfig.conf` only maps the `ps_*` and `voicemail`
tables.  This keeps the database authoritative if those mappings are enabled
later.

## Backup and restore

Backups are gzip-compressed JSON documents with format version 2.  They contain:

- users, including bcrypt password hashes;
- extensions, including SIP passwords and voicemail PINs;
- dialplan rules, voicemail boxes, queues/members, IVR menus/options,
  conference rooms (including PINs) and settings;
- CDR rows when `include_cdr` is true.

The restore endpoint replaces the application configuration tables with the
snapshot, preserves existing CDRs unless the backup includes CDRs, and then
rebuilds all Asterisk realtime tables.  A restore invalidates the practical
session of a user who no longer exists in the snapshot, but does not delete
refresh-token rows; restart sessions or change passwords if that matters.

Backups contain secrets.  They are written with mode `0600` into a `0700`
directory (`DATA_DIR/backups`), and the Docker stack keeps them in the `api-data`
volume.  Protect that volume and any downloaded files accordingly.

```text
POST   /api/v1/backups                    create ({"include_cdr": false})
GET    /api/v1/backups                    list
GET    /api/v1/backups/{id}               metadata
GET    /api/v1/backups/{id}/download      download gzip file
POST   /api/v1/backups/{id}/restore       restore
DELETE /api/v1/backups/{id}               delete file and metadata
```

## Testing

Unit and integration tests:

```bash
cd backend
make test
# or: python3 -m pytest
```

The integration tests start the real FastAPI lifespan, run migrations and use
PostgreSQL.  They are skipped automatically when the database is unreachable;
unit tests still run.  Tests create uniquely named resources and delete them
afterwards.

End-to-end scripts require a running API:

```bash
# Start the API first, then:
make smoke
make restore-test
```

The scripts default to `http://127.0.0.1:8080` and the default administrator
credentials.  Override with environment variables:

```bash
API_BASE_URL=http://127.0.0.1:8080 \
ADMIN_USERNAME=admin ADMIN_PASSWORD=admin12345 \
python3 tools/smoke_test.py

DB_HOST=127.0.0.1 DB_PORT=5232 \
python3 tools/restore_test.py
```

`smoke_test.py` exercises every API area, takes a backup, restores it, verifies
that realtime tables were rebuilt and removes its data.  `restore_test.py`
additionally verifies SIP passwords, voicemail PINs, conference PINs, user
password hashes and the realtime rows directly in PostgreSQL.  Use
`python3 tools/restore_test.py --keep` to leave the objects and backup in
place for manual inspection; the printed JSON contains the IDs and names.

Both scripts replace configuration with the snapshot they just created, so do
not run them against a production appliance while changes are being made.
Set `REQUIRE_DB_CHECK=1` to make the restore script fail instead of skipping
when it cannot inspect PostgreSQL.

Useful Make targets:

```text
make help          list targets
make install       create .venv and install dependencies
make run           run the API with HTTP_ADDR
make dev           run with autoreload on 127.0.0.1:8080
make test          pytest
make compile       byte-compile app, tools and tests
make migrate       apply SQL migrations only
make db-up         start only PostgreSQL
make smoke         run the smoke test
make restore-test  run the backup/restore test
make docker-up     start the full Compose stack
make clean         remove Python caches
```

## Troubleshooting

**`connection refused` / `database did not become ready`**
Start PostgreSQL (`make db-up` or `docker compose up -d postgres`) and confirm
the published port with `docker compose ps`.  A host-run API uses the published
port (`5232` by default), not the container-internal `5432`.

**`password authentication failed`**
The Compose defaults are `astrisk_user` / `12345678` / database `astrisk`.  If
you changed the root `.env`, use the same values for the API or recreate the
database volume (which deletes its data).

**`Permission denied: /data/backups`**
The container runs as an unprivileged user.  The provided Compose file uses the
`api-data` named volume so Docker initializes ownership correctly.  If you
replace it with a host bind mount, make the directory writable by the container
user or run the API as a matching UID.

**JWT warning about key length**
The default `change-me-in-production` secret is intentionally short and only
for development.  Set a 32+ byte random `JWT_SECRET`.

**Changing the bootstrap administrator**
The administrator is created only when the user table is empty.  Use the users
API or a password-reset request to change an existing account.

## Compatibility notes

The following behavior is intentionally preserved from the Go backend:

- route names and trailing/non-trailing slash handling;
- `data`/`meta`/`error` envelopes and Go-style RFC3339 timestamps;
- role names and permission strings;
- access/refresh JWT claims and refresh-token rotation/revocation;
- `app_` table prefix, `app_extensions.s_ip_password`, and the existing schema;
- backup format version 2 and credential-safe restore;
- Asterisk realtime mirroring and best-effort AMI/ARI degradation.
