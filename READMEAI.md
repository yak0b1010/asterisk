# Asterisk Control Center: Backend, Dashboard, and Asterisk Integration

This guide explains what the backend and dashboard do and how to deploy them on
a machine that already runs Asterisk 22.8-cert4 with the configuration found in
[`asterisk/`](asterisk/).

It does **not** install or upgrade Asterisk. The existing PBX keeps running; the
backend and dashboard are added beside it.

Related documentation:

- [`backend/README.md`](backend/README.md) — backend features, API, environment
  variables, backup format and tests
- [`dashboard/README.md`](dashboard/README.md) — dashboard development and
  production deployment
- [`asterisk/README.md`](asterisk/README.md) — PBX image and configuration
  reference

> The root `README.md` still describes the original Go backend and the old
> all-in-one Compose stack. For the current Python backend and dashboard, use
> this guide and the component READMEs.

---

## 1. Read this first

There are two very different levels of integration. Choose deliberately:

| Level | What it gives you | What Asterisk needs |
| --- | --- | --- |
| **Monitoring/control only** | Dashboard login, configuration inventory, backups, audit log, live calls/endpoints/queues/conferences, reload buttons | AMI and/or ARI enabled |
| **Full realtime configuration** | Dashboard-created SIP endpoints, voicemail boxes, queues, dialplan and conference rows are read by Asterisk from PostgreSQL (after the mappings in section 9) | AMI/ARI **plus** PostgreSQL ODBC/realtime configuration on Asterisk |

AMI/ARI do **not** make Asterisk read the backend database. They are the control
and monitoring channel. Realtime is a separate integration.

> **Current repository caveats**
>
> - `asterisk/Dockerfile` copies `conf/scripts/entrypoint-wrapper.sh`, which is
>   missing from this tree. Building the PBX image from this repository
>   currently fails. Use the already-running Asterisk installation instead.
> - The root `docker-compose.yaml` has the `postgres` service commented out while
>   the `asterisk` service still has `depends_on: postgres`. Do **not** use root
>   `make up` or root `docker compose up`.
> - `asterisk/conf/realtime/extconfig.conf` currently maps only `ps_*` and
>   `voicemail`. It does not map `queues`, `queue_members`, `extensions` or
>   `meetme`.
> - There is no `manager.conf`, `ari.conf`, `res_odbc.conf`, `odbc.ini` or CDR
>   configuration in the repository. The snippets below must be added on the
>   Asterisk machine.
> - The dashboard's IVR page stores data and generates dialplan, but does not
>   install that dialplan into Asterisk automatically. Conference rooms are
>   mirrored to `meetme`, while the generated dialplan uses `ConfBridge`; see
>   [section 9.9](#99-dialplan-queue-and-conference-caveats).

The backend and dashboard are usable without Asterisk. Without AMI/ARI, live
telephony panels report that the control plane is offline, but login,
configuration CRUD, backups and audit still work.

**Minimal path (monitoring/control):**

1. Start PostgreSQL and the backend — section 6.1.
2. Start the dashboard — section 7.1.
3. Enable AMI and ARI on Asterisk — sections 8.1 and 8.2.
4. Point the backend at Asterisk — section 8.3.
5. Verify the control plane — section 8.5.

For Asterisk to read dashboard-created configuration, continue with section 9.

---

## 2. Architecture

```text
┌──────────┐      HTTP       ┌────────────────────┐
│ Browser  │ ──────────────> │ Dashboard (nginx)  │
└──────────┘                 │ React SPA :3000    │
                             └─────────┬──────────┘
                                       │ /api, /health, /ready, /metrics
                                       v
                             ┌────────────────────┐
                             │ FastAPI backend    │
                             │ :8080              │
                             └───┬────────┬───────┘
                                 │        │
                      SQL        │        │ AMI 5038 / ARI 8088
                                 v        v
                       ┌──────────────┐  ┌──────────────────┐
                       │ PostgreSQL   │  │ Asterisk 22.8    │
                       │ app + cdr +  │  │ SIP, dialplan,   │
                       │ realtime     │  │ voicemail, ARI   │
                       └──────┬───────┘  └────────▲─────────┘
                              │                   │
                              └───── ODBC ────────┘
                                   realtime
                                   (optional)
```

- The browser talks only to the dashboard and the API. It does not call SIP,
  WebRTC, AMI or ARI directly.
- The API talks to PostgreSQL, and optionally to Asterisk over AMI and ARI.
- Asterisk talks to PostgreSQL only when realtime is enabled. The backend writes
  realtime rows; Asterisk reads them through ODBC.
- Call media never passes through the backend or dashboard.

### Components

| Directory | Role |
| --- | --- |
| `backend/` | Python/FastAPI API, PostgreSQL schema, authentication, realtime mirroring, backups |
| `dashboard/` | React SPA, nginx production image, same-origin API proxy |
| `asterisk/` | Reference PBX configuration and PBX image definition; not required to run the backend/dashboard |

---

## 3. What the backend does

### 3.1 Stack

- Python 3.11+ (the Docker image uses Python 3.13)
- FastAPI
- SQLAlchemy 2.x with psycopg 3
- PostgreSQL 14+ (PostgreSQL 18 is the default in Compose)
- PyJWT access/refresh tokens
- bcrypt password hashes
- Idempotent SQL migrations at startup

### 3.2 Responsibilities

- Login, refresh tokens, logout, session revocation
- Users, roles and permissions
- PJSIP extensions and credentials
- Dialplan rules and contexts
- Voicemail boxes
- Queues and queue members
- IVR menus/options and generated dialplan
- Conference rooms and live conference listing
- CDR listing, statistics, CSV export, ingest and deletion
- Monitoring, audit log, runtime settings
- Backup/restore
- Asterisk realtime mirroring
- Optional AMI/ARI control and monitoring

### 3.3 API and authentication

All application routes are under `/api/v1`. Successful responses use:

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

Log in with `POST /api/v1/auth/login`, then send
`Authorization: Bearer <access_token>`. Access tokens are short-lived; refresh
tokens rotate. The default access lifetime is 15 minutes and the refresh
lifetime is 7 days.

Useful system endpoints:

| Endpoint | Purpose |
| --- | --- |
| `/health` | Liveness |
| `/ready` | Database readiness |
| `/metrics` | Prometheus metrics (unauthenticated) |
| `/api/v1/docs` | Small API landing page |
| `/api/v1/openapi.yaml` | OpenAPI document |

Roles are `admin`, `supervisor`, `agent` and `viewer`. Administrators receive
all permissions. The dashboard hides controls the user cannot use, but the
backend is the authority.

### 3.4 Database

The backend creates two groups of tables:

- Application tables: `app_users`, `app_refresh_tokens`, `app_extensions`,
  `app_dialplan_rules`, `app_voicemail_boxes`, `app_queues`,
  `app_queue_members`, `app_ivr_*`, `app_conference_rooms`, `app_audit_logs`,
  `app_settings`, `app_backups`
- Asterisk/CDR tables: `ps_endpoints`, `ps_auths`, `ps_aors`, `ps_contacts`,
  `ps_domain_aliases`, `ps_endpoint_id_ips`, `voicemail`, `queues`,
  `queue_members`, `extensions`, `meetme`, `cdr`

Migrations run automatically when `AUTO_MIGRATE=true` (the default). The
bootstrap administrator is created only when the user table is empty.

### 3.5 Realtime mirroring

Every extension, voicemail, queue, dialplan or conference change is written to
the application table and mirrored into Asterisk realtime tables:

| Dashboard data | Application table | Realtime table(s) |
| --- | --- | --- |
| Extension | `app_extensions` | `ps_endpoints`, `ps_auths`, `ps_aors` |
| Voicemail box | `app_voicemail_boxes` | `voicemail` |
| Queue and members | `app_queues`, `app_queue_members` | `queues`, `queue_members` |
| Dialplan rule | `app_dialplan_rules` | `extensions` |
| Conference room | `app_conference_rooms` | `meetme` |

This mirroring happens even if Asterisk is not configured to read those tables.
The rows are ready for Asterisk, but they have no effect until Asterisk's
`extconfig.conf`/`sorcery.conf` point at them.

### 3.6 AMI and ARI

AMI and ARI are optional and lazy: the API does not require either at startup.

- **AMI** is used for reloads (`pjsip reload`, `dialplan reload`,
  `queue reload all`, `voicemail reload`, `core reload`), core status, channel
  listing, PJSIP endpoints/registrations, queue status and conference listing.
- **ARI** is preferred for live calls and endpoints when configured; AMI is the
  fallback.
- Reload endpoints use AMI only.
- If AMI or ARI is configured but unreachable, monitoring reports `degraded` and
  live endpoints return an Asterisk-unavailable error.
- Without AMI, reload endpoints still return success but report that only the
  database was updated.

The relevant environment variables are:

```text
ASTERISK_AMI_HOST
ASTERISK_AMI_PORT
ASTERISK_AMI_USERNAME
ASTERISK_AMI_PASSWORD
ASTERISK_ARI_URL
ASTERISK_ARI_USERNAME
ASTERISK_ARI_PASSWORD
ASTERISK_TRANSPORT
```

`ASTERISK_TRANSPORT` is written into `ps_endpoints.transport`. It must match a
transport in Asterisk's `pjsip.conf`. The repository uses `transport-udp`.

> The root `.env` variables `AMI_PASSWORD` and `ARI_PASSWORD` belong to the
> missing Asterisk entrypoint wrapper. The backend does **not** read them. Use
> `ASTERISK_AMI_PASSWORD` and `ASTERISK_ARI_PASSWORD` for the backend.

### 3.7 Backups

Backups are gzip-compressed JSON documents (format version 2). They include
users and password hashes, extension SIP passwords, voicemail PINs, conference
PINs, configuration and optionally CDR rows.

- Stored under `DATA_DIR/backups` (container default `/data/backups`)
- Files are mode `0600` in a `0700` directory
- Restore replaces application configuration and rebuilds realtime tables
- Backups contain secrets; protect the `api-data` volume and downloads

### 3.8 What the backend does not do

- It is not a SIP registrar, media server or WebRTC softphone.
- It does not originate calls from the browser.
- It does not start or stop the Asterisk process.
- It does not apply IVR generated dialplan automatically.
- It does not configure Asterisk files by itself.

---

## 4. What the dashboard does

### 4.1 Pages

| Route | Purpose |
| --- | --- |
| `/` | Operations overview, call summary, system health |
| `/extensions` | PJSIP extensions, credentials, registrations, reload |
| `/dialplan` | Dialplan rules, contexts, export, reload |
| `/voicemail` | Mailbox CRUD and reload |
| `/queues` | Queue CRUD, members, live status, reload |
| `/ivr` | IVR menus, options, generated dialplan |
| `/conferences` | Conference rooms and live rooms |
| `/cdr` | Call records, filters, stats, CSV export, delete |
| `/monitoring` | API/PostgreSQL/host health and live telephony state |
| `/backups` | Create, download, restore, delete |
| `/users` | Accounts, roles, password resets, assignments |
| `/settings` | JSON runtime settings |
| `/audit` | Filterable audit trail |
| `/account` | Profile, password, sessions, permissions |

### 4.2 API connection

- **Development:** Vite serves the SPA on `127.0.0.1:5173` and proxies `/api`,
  `/health`, `/ready` and `/metrics` to `http://127.0.0.1:8080`.
- **Production:** nginx serves the SPA and proxies the same paths to
  `API_UPSTREAM` (default `api:8080`). This keeps the browser on one origin, so
  no CORS configuration is needed by default.
- `VITE_API_BASE_URL` can point at an absolute API origin, but then the backend
  `CORS_ORIGINS` and the nginx CSP `connect-src` must include that origin.

The dashboard does not connect to Asterisk or PostgreSQL directly.

---

## 5. Before deployment

### 5.1 Target assumptions

- Asterisk 22.8-cert4 is already installed and working.
- Its configuration is based on `asterisk/conf/base`, plus either the
  `standalone` or `realtime` overlay.
- You can edit `/etc/asterisk` on the Asterisk host, or bind-mount equivalent
  files into the Asterisk container.
- Docker and Docker Compose are available on the machine that will run the
  backend and dashboard. A host-run Python deployment is also supported.

If the Asterisk machine uses the `standalone` overlay, it has static endpoints
`1001` and `1002` and no ODBC/realtime configuration. Full realtime therefore
requires switching to the `realtime` overlay or removing those static objects.
The monitoring-only path works with either overlay.

### 5.2 Ports

| Component | Port | Exposure |
| --- | --- | --- |
| Dashboard | `3000` (default) | Users/browser |
| Backend API | `8080` | Dashboard; private if possible |
| PostgreSQL | host `5232`, container `5432` | Backend and Asterisk only |
| Asterisk AMI | `5038` | Backend only |
| Asterisk ARI/HTTP | `8088` | Backend only |
| Asterisk WSS | `8089` | Softphones, not this dashboard |
| SIP | `5060` | Phones |
| RTP | value of `RTP_RANGE` (root `.env` uses `10000-10199`) | Phones |

Do not expose PostgreSQL, AMI or ARI to the public internet. Restrict them with a
firewall and, for AMI, the `permit` ACL.

### 5.3 Default values

| Setting | Default |
| --- | --- |
| Dashboard URL | `http://<host>:3000` |
| API URL | `http://<host>:8080` |
| PostgreSQL host port | `5232` |
| Database | `astrisk` |
| Database user | `astrisk_user` |
| Database password | `12345678` |
| Bootstrap admin | `admin` / `admin12345` |
| AMI user | `backend` |
| ARI user | `asterisk` |
| PJSIP transport | `transport-udp` |

Change the database password, JWT secret and administrator password before
exposing the service.

### 5.4 What to copy

Copy at least `backend/` and `dashboard/` to the target machine. The `asterisk/`
tree is useful as configuration reference but is not needed to start the API or
dashboard.

A convenient layout is:

```text
/opt/asterisk-control/
├── backend/
├── dashboard/
└── asterisk/        # optional reference
```

The commands below assume the repository is at `/opt/asterisk-control`. Replace
that path with your actual location.

---

## 6. Deploy the backend and PostgreSQL

### 6.1 Recommended: Docker Compose

```bash
cd /opt/asterisk-control/backend
cp .env.example .env
$EDITOR .env
docker compose up -d --build
docker compose ps
```

Create a production `.env` with at least:

```dotenv
APP_ENV=production
JWT_SECRET=REPLACE_WITH_OUTPUT_OF_openssl_rand_hex_32
ADMIN_PASSWORD=REPLACE_WITH_A_STRONG_PASSWORD
ADMIN_EMAIL=admin@example.com

POSTGRES_VERSION=18
DB_NAME=astrisk
DB_USER=astrisk_user
DB_PASSWORD=REPLACE_WITH_A_STRONG_DATABASE_PASSWORD
BACKEND_PORT=8080

# Use 127.0.0.1 only when the API runs directly on the Asterisk host.
# For the Docker API, see section 8.4.
ASTERISK_AMI_HOST=host.docker.internal
ASTERISK_AMI_PORT=5038
ASTERISK_AMI_USERNAME=backend
ASTERISK_AMI_PASSWORD=REPLACE_WITH_AMI_SECRET
ASTERISK_ARI_URL=http://host.docker.internal:8088/ari
ASTERISK_ARI_USERNAME=asterisk
ASTERISK_ARI_PASSWORD=REPLACE_WITH_ARI_SECRET
ASTERISK_TRANSPORT=transport-udp

# Only needed if the dashboard uses an absolute API origin.
# CORS_ORIGINS=http://192.0.2.10:3000
```

Generate the JWT secret with:

```bash
openssl rand -hex 32
```

The Compose stack publishes PostgreSQL on host port `5232` and the API on
`8080`. The API container talks to `postgres:5432` internally. If `5232` is
already in use, read section 6.3 before starting this stack.

Verify:

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/ready
curl -fsS http://127.0.0.1:8080/api/v1/docs
```

Log in:

```bash
curl -sS http://127.0.0.1:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin12345"}'
```

If you changed `ADMIN_PASSWORD` before the first start, use that value instead.
The bootstrap account is created only when the user table is empty; changing
`ADMIN_PASSWORD` later does not reset an existing account.

### 6.2 Alternative: API on the host

Use this when you want the API to reach a native Asterisk on `127.0.0.1`
without Docker networking, or when you prefer a Python virtual environment.

```bash
cd /opt/asterisk-control/backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
$EDITOR .env

# Start the backend's own PostgreSQL in Docker:
docker compose up -d postgres

# Run the API on the host against the published database port:
DB_HOST=127.0.0.1 DB_PORT=5232 python -m app
```

Or use the Makefile:

```bash
make install
make db-up      # starts only the postgres service
make run
```

`make db-up` starts the Compose PostgreSQL, not the API container. When the API
runs outside Docker, the backend maps a `DB_HOST` of `postgres` or `db` to
`127.0.0.1`. The database port is the published host port, `5232` by default.

### 6.3 Reuse an existing PostgreSQL

If a PostgreSQL server already runs on the host, or port `5232` is already in
use, do **not** run `docker compose up -d postgres`; that starts a second server
and fails to bind the port.

Point the backend at the existing database instead. With the API running on the
host, put this in `backend/.env`:

```dotenv
DB_HOST=127.0.0.1
DB_PORT=5232
DB_NAME=astrisk
DB_USER=astrisk_user
DB_PASSWORD=REPLACE_WITH_EXISTING_DATABASE_PASSWORD
DB_SSLMODE=disable
```

Then start only the API (`python -m app` or `make run`). The database and role
must already exist. `AUTO_MIGRATE=true` creates the backend tables inside that
database; it does not create the database or role.

For a Dockerized API against an external database, the shipped Compose file
always starts its own `postgres` and `api` depends on it. Use an override that
removes the dependency and points the API elsewhere:

```yaml
# backend/docker-compose.external-db.yaml
services:
  api:
    depends_on: !reset []
    environment:
      DB_HOST: 192.0.2.10
      DB_PORT: "5432"
      DB_NAME: astrisk
      DB_USER: astrisk_user
      DB_PASSWORD: REPLACE_WITH_EXISTING_DATABASE_PASSWORD
```

```bash
docker compose -f docker-compose.yaml \
  -f docker-compose.external-db.yaml up -d --build api
```

Replace `192.0.2.10` and `5432` with the existing server's address and port.
`depends_on: !reset []` requires Docker Compose 2.24 or newer. On older
versions, remove the `depends_on` block from a local copy of
`docker-compose.yaml`, or run the API container manually. Do not start the
`postgres` service from this stack when reusing an external database.

For **realtime**, Asterisk and the backend must use the same database. Back it
up before pointing either side at it. For **monitoring-only**, any database is
fine.

**Alternative for monitoring-only:** keep the backend's own PostgreSQL and move
its published host port instead of reusing the existing server:

```bash
DB_PORT=5233 docker compose up -d postgres
DB_PORT=5233 python -m app
```

For the Compose API, set `DB_PORT=5233` in `backend/.env` and recreate the
stack; the API container still uses `postgres:5432` internally. This avoids the
port conflict but does not share data with the existing database, so it cannot
be used for realtime.

> If the existing database was created by Asterisk, it may already contain
> `ps_*`, `cdr` or other tables with different columns. The backend uses
> `CREATE TABLE IF NOT EXISTS` and will not alter them. Compare schemas or use a
> dedicated database before enabling realtime; see section 9.2.

### 6.4 Port conflicts

If `8080` or `3000` is already in use, change `BACKEND_PORT` or
`DASHBOARD_PORT`.

> The repository root `.env` belongs to the PBX stack, not the backend Compose
> stack. It also sets `DASHBOARD_PORT=8080`, which would collide with the API.
> Run the dashboard with its own environment (default `3000`) or explicitly set
> `DASHBOARD_PORT=3000`; do not pass the root `.env` to the dashboard stack
> without changing that value.

To reuse root values with the backend stack, pass `--env-file ../.env` and
verify `DB_*`, `BACKEND_PORT` and `DASHBOARD_PORT` first.

> `docker compose down -v` deletes the PostgreSQL and backup volumes. Do not use
> it casually on a production deployment.

---

## 7. Deploy the dashboard

### 7.1 Docker Compose on the same host as the backend

Start the backend first so the `asterisk-backend_default` network exists.

```bash
cd /opt/asterisk-control/dashboard
docker compose up -d --build
docker compose ps
```

The dashboard listens on `http://<host>:3000` by default and reaches the API as
`api:8080` over the backend network.

> The dashboard Compose stack reads `dashboard/.env` or the shell environment,
> not the repository root `.env`. The root `.env` sets `DASHBOARD_PORT=8080`,
> which would collide with the API; if you pass that file explicitly, also set
> `DASHBOARD_PORT=3000`.

If the backend project uses a different network name:

```bash
BACKEND_NETWORK=my-backend_default docker compose up -d --build
```

If the API is not reachable as `api:8080`, set `API_UPSTREAM`:

```bash
API_UPSTREAM=192.0.2.10:8080 docker compose up -d
```

### 7.2 Dashboard on a different machine from the API

The provided `dashboard/docker-compose.yaml` joins an external backend Docker
network, so it cannot start on a machine that does not have that network. Use a
manual container instead:

```bash
cd /opt/asterisk-control/dashboard
docker build -t asterisk-dashboard .
docker run -d --name asterisk-dashboard \
  -p 3000:80 \
  -e API_UPSTREAM=192.0.2.10:8080 \
  --restart unless-stopped \
  asterisk-dashboard
```

Replace `192.0.2.10` with the backend host. Allow the dashboard host to reach the
API port through the firewall.

### 7.3 Development mode

Requires Node.js 22.12+ (Vite 8 also accepts 20.19+) and npm.

```bash
cd /opt/asterisk-control/dashboard
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to
`http://127.0.0.1:8080` by default. Override with `VITE_API_PROXY` if needed.

### 7.4 TLS

The dashboard container serves HTTP on port 80/3000. For a production deployment,
put it behind a TLS reverse proxy (Caddy, nginx, Traefik or an existing ingress)
and use HTTPS for the dashboard URL. Login credentials and bearer tokens should
not travel over plain HTTP on an untrusted network.

The nginx container already sets security headers and a same-origin CSP. If you
build with an absolute `VITE_API_BASE_URL`, add that origin to the CSP
`connect-src` list in `dashboard/nginx/default.conf.template`.

---

## 8. Connect the backend to Asterisk (AMI/ARI)

This section gives the dashboard its live telephony data and reload controls. It
does **not** make Asterisk read the backend database. For that, continue to
[section 9](#9-optional-full-realtime-configuration).

> **Native vs Docker configuration:** on a native install, edit files under
> `/etc/asterisk` directly. If Asterisk runs in Docker and its configuration is
> baked into the image, add read-only bind mounts for the files you change (or
> rebuild the image). Files copied into a running container with `docker exec`
> are lost when that container is recreated. The repository's PBX image cannot
> currently be rebuilt from this tree because the entrypoint wrapper is missing,
> so bind mounts are the practical option.

### 8.1 Enable AMI on Asterisk

The repository does not ship a `manager.conf`. On the Asterisk machine, create or
edit `/etc/asterisk/manager.conf`:

```ini
[general]
enabled = yes
port = 5038
bindaddr = 0.0.0.0

[backend]
secret = REPLACE_WITH_A_LONG_RANDOM_SECRET
read = all
write = command
permit = 127.0.0.1/32
permit = 172.16.0.0/12
permit = 10.0.0.0/8
permit = 192.168.0.0/16
```

Notes:

- `read = all` is needed for live channel, endpoint, queue, registration and
  conference listings.
- `write = command` is enough for the backend's reload commands. If you prefer,
  `write = all` also works but grants more authority.
- Restrict `permit` to the backend's actual address. The broad private ranges
  above are convenient for Docker/LAN deployments; tighten them for production.
- AMI is plaintext. Never expose port `5038` to the internet.

Reload or restart Asterisk:

```bash
# Native install
sudo asterisk -rx "manager reload"
# If manager reload is not enough:
sudo systemctl restart asterisk

# Docker
docker restart <asterisk-container>
```

Verify:

```bash
sudo asterisk -rx "manager show user backend"
sudo asterisk -rx "manager show connected"
```

For a container:

```bash
docker exec -it <asterisk-container> asterisk -rx "manager show user backend"
```

### 8.2 Enable ARI on Asterisk

`asterisk/conf/base/http.conf` already enables HTTP on `8088` (and TLS/WSS on
`8089`). The repository does not ship `ari.conf`; create or edit
`/etc/asterisk/ari.conf`:

```ini
[general]
enabled = yes
pretty = yes
allowed_origins = *

[asterisk]
type = user
read_only = yes
password = REPLACE_WITH_A_LONG_RANDOM_SECRET
password_format = plain
```

`read_only = yes` is sufficient because the dashboard only reads ARI
information. Do not expose ARI directly to users; the backend calls it
server-side.

Restart Asterisk after changing `ari.conf` or `http.conf`:

```bash
sudo systemctl restart asterisk
# or: docker restart <asterisk-container>
```

Verify HTTP/ARI:

```bash
curl -u asterisk:REPLACE_WITH_ARI_SECRET \
  http://127.0.0.1:8088/ari/asterisk/info

sudo asterisk -rx "http show status"
sudo asterisk -rx "ari show status"
```

If the ARI port is not published from a container, test from a container on the
same Docker network, or publish `8088` only to the backend host.

### 8.3 Point the backend at Asterisk

Set these in `backend/.env` and recreate the API container:

```dotenv
ASTERISK_AMI_HOST=<ami-host>
ASTERISK_AMI_PORT=5038
ASTERISK_AMI_USERNAME=backend
ASTERISK_AMI_PASSWORD=<AMI secret from manager.conf>

ASTERISK_ARI_URL=http://<ari-host>:8088/ari
ASTERISK_ARI_USERNAME=asterisk
ASTERISK_ARI_PASSWORD=<ARI secret from ari.conf>

ASTERISK_TRANSPORT=transport-udp
```

The username/password values must match the Asterisk files exactly. Avoid
trailing spaces and newlines in the secrets.

Apply the change:

```bash
cd /opt/asterisk-control/backend
docker compose up -d --force-recreate api
docker compose logs --tail=100 api
```

### 8.4 Network scenarios

| API runs... | Asterisk runs... | `ASTERISK_AMI_HOST` | `ASTERISK_ARI_URL` |
| --- | --- | --- | --- |
| On the host | On the host | `127.0.0.1` | `http://127.0.0.1:8088/ari` |
| In Docker | On the host | `host.docker.internal` | `http://host.docker.internal:8088/ari` |
| In Docker | In Docker, same host | Asterisk service/container name | `http://<asterisk-service>:8088/ari` |
| On a different machine | On a different machine | Asterisk LAN IP | `http://<asterisk-ip>:8088/ari` |

#### API in Docker, Asterisk native on the host

Docker Desktop provides `host.docker.internal` automatically. On Linux, add the
host gateway explicitly with a Compose override:

```yaml
# backend/docker-compose.host-asterisk.yaml
services:
  api:
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      ASTERISK_AMI_HOST: host.docker.internal
      ASTERISK_ARI_URL: http://host.docker.internal:8088/ari
```

Run:

```bash
cd /opt/asterisk-control/backend
docker compose -f docker-compose.yaml \
  -f docker-compose.host-asterisk.yaml up -d
```

Ensure `manager.conf` permits the Docker bridge subnet (for example
`172.16.0.0/12`) and that Asterisk listens on an address reachable from Docker.

#### API and Asterisk both in Docker on the same host

Put the API on the Asterisk container's Docker network and use its service name:

```yaml
# backend/docker-compose.shared-pbx.yaml
services:
  api:
    networks:
      - default
      - pbx
    environment:
      ASTERISK_AMI_HOST: asterisk
      ASTERISK_AMI_PORT: "5038"
      ASTERISK_ARI_URL: http://asterisk:8088/ari

networks:
  pbx:
    external: true
    name: asterisk-appliance_default
```

Adjust `asterisk` and `asterisk-appliance_default` to the actual container
service and network names. Find the network with:

```bash
docker inspect <asterisk-container> \
  --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}'
```

Run:

```bash
docker compose -f docker-compose.yaml \
  -f docker-compose.shared-pbx.yaml up -d
```

Do not publish AMI/ARI publicly just to make this work; a shared Docker network
is safer.

#### Asterisk on another machine

Use the Asterisk host's LAN address:

```dotenv
ASTERISK_AMI_HOST=192.0.2.20
ASTERISK_ARI_URL=http://192.0.2.20:8088/ari
```

Allow only the backend host through the firewall to `5038` and `8088`. Set AMI
`permit` to the backend's IP.

### 8.5 Verify the control plane

Log in and call the monitoring endpoint:

```bash
TOKEN=$(curl -fsS http://127.0.0.1:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin12345"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["access_token"])')

curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/api/v1/monitoring/status \
  | python3 -m json.tool
```

Expected results:

- `database.connected` is `true`
- `asterisk.ami.configured` and/or `asterisk.ari.configured` is `true`
- The configured channel(s) show `"connected": true`
- The dashboard's **Monitoring** page shows live data
- The **Extensions** page's registrations tab can list PJSIP registrations
- Reload buttons succeed if AMI is configured

If AMI is configured but not connected, the API status becomes `degraded`; this
is intentional.

---

## 9. Optional: full realtime configuration

Only do this if you want Asterisk to read configuration from the backend's
PostgreSQL database. Back up `/etc/asterisk` and the database first.

> The examples below assume the backend Compose stack from section 6.1. If you
> reused an external PostgreSQL (section 6.3), substitute the equivalent `psql`
> command against that server wherever `docker compose exec postgres` appears.

### 9.1 What changes

When realtime is enabled:

- Asterisk reads PJSIP endpoints/auths/AORs/contacts from `ps_*` tables.
- Asterisk reads voicemail boxes from the `voicemail` table.
- If you add the missing mappings, Asterisk can read queues, dialplan rules and
  `meetme` rows too.
- Dashboard configuration changes affect live Asterisk behavior after a reload.
- Mistakes can affect production call routing. Test on a maintenance window.

If you only want monitoring, skip this entire section and leave Asterisk's
configuration files alone.

### 9.2 Prepare the database

Start the backend first and let migrations run. With the backend Compose stack:

```bash
cd /opt/asterisk-control/backend
docker compose up -d --build
docker compose logs api | grep -i migration
```

If you reused an external PostgreSQL (section 6.3), start only the API and use
`psql` against that server instead of `docker compose exec postgres`.

Confirm the realtime tables exist. For the Compose database:

```bash
docker compose exec postgres \
  psql -U astrisk_user -d astrisk -c '\dt'
```

Confirm that `ps_endpoints`, `ps_auths`, `ps_aors`, `ps_contacts`, `voicemail`,
`queues`, `queue_members`, `extensions`, `meetme` and `cdr` are present.

Asterisk's ODBC user needs DML access to those tables. If you use a separate
ODBC user rather than `astrisk_user`, create that role first and grant it
(replace `asterisk_rt` with your ODBC username):

```sql
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO asterisk_rt;
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public TO asterisk_rt;
```

The backend's migration uses `CREATE TABLE IF NOT EXISTS`. If the target
database already has Asterisk-created tables with different columns, the
migration will not alter them. Use a fresh backend database or compare schemas
before enabling realtime.

### 9.3 Install the PostgreSQL ODBC driver

On a native Asterisk host (Debian/Ubuntu):

```bash
sudo apt-get update
sudo apt-get install -y odbc-postgresql unixodbc
```

Verify the driver is registered:

```bash
odbcinst -q -d
```

You should see a section such as `[PostgreSQL Unicode]`. If the driver is not
registered, find the library and register it:

```bash
find /usr/lib -name psqlodbcw.so
```

Create `/etc/odbcinst.ini` with the path that exists:

```ini
[PostgreSQL Unicode]
Description = PostgreSQL ODBC driver (Unicode)
Driver = /usr/lib/x86_64-linux-gnu/odbc/psqlodbcw.so
FileUsage = 1
```

The repository's PBX Dockerfile already installs `odbc-postgresql` and registers
the driver. A native install needs the package above.

### 9.4 Configure the ODBC DSN

Create `/etc/odbc.ini`:

```ini
[asterisk-pgsql]
Description = Asterisk realtime PostgreSQL
Driver = PostgreSQL Unicode
Servername = 127.0.0.1
Port = 5232
Database = astrisk
Username = astrisk_user
Password = REPLACE_WITH_DATABASE_PASSWORD
```

Set `Servername` and `Port` for your topology:

| Asterisk runs... | Backend PostgreSQL is... | `Servername` | `Port` |
| --- | --- | --- | --- |
| Native, same host | Docker, published | `127.0.0.1` | `5232` |
| Docker, same host | Docker, published | `host.docker.internal` (with host-gateway) | `5232` |
| Docker, shared backend network | Backend Compose | `postgres` | `5432` |
| Another machine | On the backend host | backend host IP | `5232` |

Create `/etc/asterisk/res_odbc.conf`:

```ini
[asterisk]
enabled => yes
dsn => asterisk-pgsql
username => astrisk_user
password => REPLACE_WITH_DATABASE_PASSWORD
pre-connect => yes
```

The section name `[asterisk]` is the ODBC class referenced by `extconfig.conf`
and `sorcery.conf` as `odbc,asterisk`. It is not the DSN name; the DSN is
`asterisk-pgsql` in `/etc/odbc.ini`.

Protect both files:

```bash
sudo chown root:asterisk /etc/odbc.ini /etc/asterisk/res_odbc.conf
sudo chmod 640 /etc/odbc.ini /etc/asterisk/res_odbc.conf
```

Test the DSN from the Asterisk host:

```bash
isql -v asterisk-pgsql astrisk_user 'REPLACE_WITH_DATABASE_PASSWORD'
```

If `isql` is unavailable, install `unixodbc` or use `psql` to confirm the same
host/port/credentials.

### 9.5 Configure Asterisk realtime

Create or replace `/etc/asterisk/extconfig.conf`:

```ini
[settings]
ps_endpoints       => odbc,asterisk
ps_auths           => odbc,asterisk
ps_aors            => odbc,asterisk
ps_domain_aliases  => odbc,asterisk
ps_endpoint_id_ips => odbc,asterisk
ps_contacts        => odbc,asterisk
voicemail          => odbc,asterisk

; Enable these only if you want the dashboard to manage them:
queues             => odbc,asterisk
queue_members      => odbc,asterisk
extensions         => odbc,asterisk
meetme             => odbc,asterisk
```

Create or replace `/etc/asterisk/sorcery.conf`:

```ini
[res_pjsip]
endpoint     = realtime,ps_endpoints
auth         = realtime,ps_auths
aor          = realtime,ps_aors
domain_alias = realtime,ps_domain_aliases
contact      = realtime,ps_contacts

[res_pjsip_endpoint_identifier_ip]
identify = realtime,ps_endpoint_id_ips
```

The repository's `sorcery.conf` does not map `contact`; add
`contact = realtime,ps_contacts` if registrations do not persist or qualify
correctly.

Ensure the ODBC modules are loaded:

```bash
sudo asterisk -rx "module show like res_odbc"
sudo asterisk -rx "module show like res_config_odbc"
```

If they are not loaded, add preload lines to `/etc/asterisk/modules.conf`:

```ini
[modules]
preload => res_odbc.so
preload => res_config_odbc.so
autoload = yes
```

Do not add the same module twice if it is already preloaded.

Restart Asterisk so `extconfig.conf` and `sorcery.conf` are read at startup:

```bash
sudo systemctl restart asterisk
# or: docker restart <asterisk-container>
```

### 9.6 Verify realtime

```bash
sudo asterisk -rx "odbc show all"
sudo asterisk -rx "pjsip show endpoints"
sudo asterisk -rx "pjsip show endpoint 1001"
sudo asterisk -rx "voicemail show users"
```

`odbc show all` should show the `asterisk` connection as connected. `pjsip show
endpoints` should include the extensions stored in `ps_endpoints`.

From PostgreSQL:

```bash
docker compose exec postgres \
  psql -U astrisk_user -d astrisk \
  -c 'select id, transport, context, aors, auth from ps_endpoints order by id;'
```

If `pjsip show endpoints` is empty:

- Check `extconfig.conf` and `sorcery.conf` paths.
- Check that the API migrations created the tables.
- Check that the dashboard actually created an extension.
- Check that the Asterisk process can reach the database.
- If the standalone overlay is still installed, remove/disable its static
  `pjsip_endpoints.conf` objects or use the realtime overlay. Static and
  realtime objects with the same IDs can conflict.

### 9.7 Enable queues, dialplan and conferences

The repository's current `extconfig.conf` only maps `ps_*` and `voicemail`. To
make the dashboard's queue, dialplan and conference data visible to Asterisk,
add the extra mappings shown in section 9.5, then restart Asterisk.

#### Dialplan

Adding `extensions => odbc,asterisk` is not enough by itself. Dynamic realtime
dialplan must be activated with a `switch` statement. Add this to
`/etc/asterisk/extensions_custom.conf`:

```ini
[internal]
switch => Realtime/internal@extensions
```

The base `extensions.conf` includes this file at the end of `[internal]`. The
static `1001`, `1002`, `999` and `600` extensions remain available; the switch
handles other extensions from the database.

After adding a dialplan rule in the dashboard, run:

```bash
sudo asterisk -rx "dialplan reload"
```

#### Queues

The extra `queues` and `queue_members` mappings let Asterisk read queue
definitions and members. Queue members should use interfaces such as
`PJSIP/1001`. After changes:

```bash
sudo asterisk -rx "queue reload all"
sudo asterisk -rx "queue show"
```

The dashboard stores queues and members, but you still need a dialplan route
that calls `Queue(<name>)`. You can create that route as a dialplan rule (with
the realtime switch enabled) or as an IVR option.

#### Conferences

Conference records are mirrored to `meetme`. However, the generated conference
dialplan uses `ConfBridge`:

```asterisk
exten => 3000,1,Answer()
 same => n,ConfBridge(3000)
```

`ConfBridge` does not read the `meetme` table. A dynamically created ConfBridge
room will still work with defaults when the generated dialplan is installed, but
the room's dashboard PIN, max-members, mute and record settings are not applied
automatically. For full conference behavior, use the generated dialplan as a
starting point and maintain a proper `confbridge.conf`, or adapt the integration
to `MeetMe`. See [section 9.9](#99-dialplan-queue-and-conference-caveats).

### 9.8 CDR

The backend creates the `cdr` table, but the repository does not configure
Asterisk CDR logging. To write call records directly from Asterisk into the same
database, enable `cdr_adaptive_odbc` (reusing the `[asterisk]` ODBC class) or
`cdr_pgsql`.

#### Option A: `cdr_adaptive_odbc` (recommended if realtime ODBC is already working)

Create `/etc/asterisk/cdr_adaptive_odbc.conf`:

```ini
[asterisk]
connection = asterisk
table = cdr
schema = public
usegmtime = yes
```

Ensure CDR is enabled in `/etc/asterisk/cdr.conf`:

```ini
[general]
enable = yes
unanswered = yes
```

Check the module:

```bash
sudo asterisk -rx "module show like cdr_adaptive_odbc"
sudo asterisk -rx "module load cdr_adaptive_odbc.so"
```

Restart or reload Asterisk, place a test call, then check:

```bash
docker compose exec postgres \
  psql -U astrisk_user -d astrisk \
  -c 'select id, calldate, src, dst, disposition, billsec from cdr order by id desc limit 5;'
```

The dashboard's **CDR** page reads the same table.

#### Option B: `cdr_pgsql`

If the Asterisk build includes `cdr_pgsql.so`, configure
`/etc/asterisk/cdr_pgsql.conf`:

```ini
[global]
hostname = 127.0.0.1
port = 5232
dbname = astrisk
user = astrisk_user
password = REPLACE_WITH_DATABASE_PASSWORD
table = cdr
```

Use the host and port that Asterisk can reach; see the topology table in
section 9.4. Use only one CDR backend for the same table; otherwise you may get
duplicate records.

The backend also exposes `POST /api/v1/cdr` for external ingestion. That endpoint
requires an authenticated user with the `cdr.delete` permission (administrators
have it) and is intended for external collectors, not as the normal Asterisk CDR
path.

### 9.9 Dialplan, queue and conference caveats

- **IVR is not mirrored to Asterisk.** The IVR page stores menus/options in
  `app_ivr_*` and generates a dialplan file for download. It does not install
  that file. Copy the generated dialplan into Asterisk (and include it from
  `extensions.conf`) or create equivalent dialplan rules.
- **Queues need a route.** Storing a queue and members is not enough; calls must
  reach `Queue(<name>)` through dialplan or an IVR option.
- **Conference settings are partial.** The generated dialplan uses
  `ConfBridge`, while the realtime mirror writes `meetme`. Per-room dashboard
  settings are not automatically applied to ConfBridge.
- **Static dialplan can shadow realtime rules.** The base `[internal]` context
  contains static `1001` and `1002` routes. Those numbers continue to use the
  static routes; dynamic rules apply to other extensions.
- **Reload after changes.** Database rows are read on demand, but PJSIP,
  dialplan, queue and voicemail caches may need the corresponding reload.

---

## 10. Integration matrix

| Dashboard capability | Backend storage | Asterisk reads it by default? | What to add |
| --- | --- | --- | --- |
| Login, users, audit, backups | `app_*` | N/A | Nothing |
| Live calls/endpoints/queues/conferences | AMI/ARI | N/A | AMI and/or ARI |
| SIP extensions | `ps_endpoints`, `ps_auths`, `ps_aors` | Yes, with realtime overlay | ODBC + extconfig/sorcery |
| Voicemail boxes | `voicemail` | Yes, with realtime overlay | ODBC + extconfig |
| Queues | `queues`, `queue_members` | **No** in current repo | Add extconfig mappings + dialplan route |
| Dialplan rules | `extensions` | **No** in current repo | Add extconfig mapping + realtime switch |
| Conference rooms | `meetme` | **No** in current repo | Add mapping; note ConfBridge mismatch |
| IVR menus | `app_ivr_*` | **No** | Export/install generated dialplan |
| CDR | `cdr` | **No** | Configure a CDR backend |

---

## 11. Verification checklist

### Backend

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/ready
curl -fsS http://127.0.0.1:8080/api/v1/docs
```

- [ ] `/ready` returns `{"status":"ready","checks":{"database":"up"}}`
- [ ] Login succeeds
- [ ] Dashboard loads and stays logged in
- [ ] `Monitoring` shows database connected

### Dashboard

```bash
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

- [ ] Login page renders
- [ ] Login succeeds with the bootstrap account
- [ ] All navigation routes render without a blank page
- [ ] API errors show a retryable panel, not a crash

### AMI/ARI

```bash
sudo asterisk -rx "manager show connected"
sudo asterisk -rx "http show status"
sudo asterisk -rx "ari show status"
```

- [ ] AMI user exists and the backend can connect
- [ ] ARI responds with basic auth
- [ ] Monitoring status is not `degraded` when AMI/ARI are configured

### Realtime

```bash
sudo asterisk -rx "odbc show all"
sudo asterisk -rx "pjsip show endpoints"
sudo asterisk -rx "dialplan show internal"
sudo asterisk -rx "queue show"
sudo asterisk -rx "voicemail show users"
```

- [ ] ODBC connection is connected
- [ ] PJSIP endpoint created in the dashboard appears
- [ ] A phone can register
- [ ] A call can be placed
- [ ] Dialplan/queue/voicemail behavior matches the dashboard data
- [ ] CDR rows appear after a test call

---

## 12. Security

- Change `admin/admin12345` immediately through **Account** or **Users**.
- Use a random `JWT_SECRET`; `APP_ENV=production` rejects the default.
- Use a strong database password; do not expose PostgreSQL port `5232`.
- Restrict AMI `5038` and ARI `8088` to the backend host.
- AMI is plaintext. Use a private network or tunnel; do not expose it publicly.
- `write = command` on AMI is powerful. Grant only what you need.
- Backups contain password hashes, SIP secrets, voicemail PINs and conference
  PINs. Protect the `api-data` volume and downloaded backup files.
- `/metrics` is unauthenticated. The dashboard nginx allows it only from private
  networks by default; keep that restriction or add authentication.
- Put the dashboard behind HTTPS for production.
- Keep the backend, dashboard, PostgreSQL and Asterisk patched.

---

## 13. Troubleshooting

### The dashboard loads but every page says it cannot reach the API

- Check the API: `curl -fsS http://127.0.0.1:8080/ready`
- In Docker, check `API_UPSTREAM`. The default `api:8080` requires the dashboard
  to be on the backend's `asterisk-backend_default` network.
- If the API is on another host, set `API_UPSTREAM=<api-host>:8080` and ensure
  the firewall allows it.
- Check `docker compose logs dashboard` and `docker compose logs api`.

### Login fails with `invalid_credentials`

- The default account is `admin` / `admin12345` only on first boot.
- If the user table was already populated, `ADMIN_PASSWORD` did not reset it.
- Use the Users page (if another admin exists) or reset the password through the
  API/database.
- Check the API logs for `bootstrap administrator created`.

### The dashboard immediately returns to the login page

- The JWT secret may have changed. Clear the site's local storage and sign in.
- The account may have been removed by a restore.
- Check that the browser clock is correct; JWT validation uses time claims.

### AMI is configured but not connected

- Confirm `manager.conf` is in the path Asterisk actually reads.
- Confirm `enabled = yes`, `port = 5038`, and the bind address.
- Check the `permit` ACL includes the backend's source IP.
- Confirm the username/password match `ASTERISK_AMI_*`.
- Test from the Asterisk host: `asterisk -rx "manager show connected"`.
- If the API is in Docker, use `host.docker.internal` or a shared Docker network;
  `127.0.0.1` inside the API container is the API container itself.

### ARI returns 401/404 or connection refused

- Confirm `ari.conf` has `enabled = yes` and the `[asterisk]` user.
- Confirm `http.conf` has `enabled = yes` and port `8088`.
- Confirm `ASTERISK_ARI_URL` ends with `/ari`.
- Confirm the ARI username/password match.
- Restart Asterisk after changing `ari.conf`/`http.conf`.
- Test: `curl -u asterisk:<password> http://<host>:8088/ari/asterisk/info`.

### `odbc show all` shows no connection

- Confirm `odbc-postgresql` is installed and `odbcinst -q -d` lists the driver.
- Confirm `/etc/odbc.ini` has the DSN and `/etc/asterisk/res_odbc.conf` points to
  the same DSN.
- Confirm `res_odbc.so` and `res_config_odbc.so` are loaded.
- Confirm the database host/port is reachable from the Asterisk host/container.
- Confirm the database user/password and that the tables exist.
- Check `isql -v asterisk-pgsql <user> <password>`.

### `pjsip show endpoints` is empty after creating an extension

- Confirm `extconfig.conf` maps `ps_endpoints`, `ps_auths`, `ps_aors`.
- Confirm `sorcery.conf` maps the PJSIP objects.
- Confirm the backend migrations created the tables and the dashboard row exists.
- If the standalone overlay is still active, static objects may be shadowing or
  conflicting with realtime. Switch to the realtime overlay or remove the static
  endpoints.
- Restart Asterisk after changing `extconfig.conf`/`sorcery.conf`.

### Dashboard changes do not affect Asterisk

- Are you in monitoring-only mode? Then changes are stored only in PostgreSQL.
- Is the relevant table mapped in `extconfig.conf`?
- For dialplan, did you add `switch => Realtime/internal@extensions`?
- Did you reload the relevant Asterisk component?
- Is a static configuration file overriding the realtime row?

### Queues do not appear or cannot be called

- Add `queues` and `queue_members` mappings, then `queue reload all`.
- Confirm members use interfaces such as `PJSIP/1001`.
- Add a dialplan route to `Queue(<name>)`.
- Check `queue show` for the queue and members.

### CDR is empty

- Confirm a CDR backend is configured; the repository does not enable one.
- Check `module show like cdr_adaptive_odbc` or `cdr_pgsql`.
- Confirm `cdr.conf` has `enable = yes`.
- Confirm the `cdr` table exists and the ODBC user can insert.
- Check the Asterisk logs for CDR/ODBC errors.

### Port already in use

- `5232`: an existing PostgreSQL is already running. Change `DB_PORT` or stop
  the duplicate.
- `8080`: change `BACKEND_PORT`.
- `3000`: change `DASHBOARD_PORT`.
- `5038`/`8088`: another Asterisk or service is using them; check
  `ss -ltnp`.

### The Asterisk image will not build

This is a known repository issue: `asterisk/Dockerfile` copies
`conf/scripts/entrypoint-wrapper.sh`, which is absent. Do not rebuild the PBX
image from this tree until that file is restored. Use the existing Asterisk
installation.

### Root `docker compose up` fails

The root `docker-compose.yaml` has `postgres` commented out but the `asterisk`
service still depends on it. Use the `backend/` and `dashboard/` Compose stacks
instead.

### A restore times out in the dashboard

The nginx proxy allows up to 5 minutes for a restore. Check the API logs and
database load. Do not refresh repeatedly while a restore is running.

### CORS error after setting `VITE_API_BASE_URL`

Add the dashboard origin to the backend's `CORS_ORIGINS`, rebuild the dashboard,
and add the same origin to the nginx CSP `connect-src` list. Same-origin nginx
proxying avoids this entirely.

---

## 14. Known limitations

1. **Asterisk image build is broken in this tree.** The missing
   `asterisk/conf/scripts/entrypoint-wrapper.sh` is required by the Dockerfile.
2. **Root Compose is broken.** The `postgres` service is commented out while
   `asterisk` still depends on it.
3. **Realtime mappings are partial.** `extconfig.conf` maps only `ps_*` and
   `voicemail`; queues, queue members, dialplan and `meetme` are not mapped.
4. **No `manager.conf` or `ari.conf`.** They must be supplied on the target
   Asterisk machine.
5. **No ODBC or CDR configuration.** The snippets in this guide are required.
6. **No `contact` mapping in the provided `sorcery.conf`.** Add
   `contact = realtime,ps_contacts` if registrations do not persist.
7. **IVR is not automatically installed.** The UI stores data and generates
   dialplan for download; it does not write Asterisk configuration.
8. **Conference configuration is partial.** The mirror writes `meetme`, while
   generated dialplan uses `ConfBridge`.
9. **Static standalone endpoints can conflict with realtime.** The standalone
   overlay defines `1001`/`1002`; use the realtime overlay or remove them before
   switching.
10. **Live Asterisk integration was not exercised in this repository's test
    environment.** The backend tests, smoke test and restore test run without
    Asterisk. Verify AMI/ARI, ODBC and call flow on the target machine.

---

## Appendix A: default settings

| Setting | Default |
| --- | --- |
| `APP_ENV` | `development` |
| API bind | `:8080` |
| Dashboard port | `3000` |
| PostgreSQL host port | `5232` |
| PostgreSQL container port | `5432` |
| Database | `astrisk` |
| Database user | `astrisk_user` |
| Database password | `12345678` |
| Admin username | `admin` |
| Admin password | `admin12345` |
| JWT secret | `change-me-in-production` (rejected in production) |
| Access token TTL | `15m` |
| Refresh token TTL | `168h` |
| AMI host/port | `127.0.0.1:5038` |
| ARI URL | `http://127.0.0.1:8088/ari` |
| PJSIP transport | `transport-udp` |
| Backup directory | `DATA_DIR/backups` (`/data/backups` in Docker) |

## Appendix B: Asterisk file checklist

| File | Purpose | In this repo? |
| --- | --- | --- |
| `/etc/asterisk/manager.conf` | AMI user and ACL | No |
| `/etc/asterisk/ari.conf` | ARI user | No |
| `/etc/asterisk/http.conf` | HTTP/ARI port | Yes, `conf/base/http.conf` |
| `/etc/asterisk/res_odbc.conf` | ODBC class | No |
| `/etc/odbc.ini` | PostgreSQL DSN | No |
| `/etc/odbcinst.ini` | PostgreSQL ODBC driver | No (the PBX Dockerfile generates it) |
| `/etc/asterisk/extconfig.conf` | Realtime table mappings | Partial, `conf/realtime/extconfig.conf` |
| `/etc/asterisk/sorcery.conf` | PJSIP realtime mappings | Partial, `conf/realtime/sorcery.conf` |
| `/etc/asterisk/extensions_custom.conf` | Realtime dialplan switch | Comments only, `conf/realtime/extensions_custom.conf` |
| `/etc/asterisk/cdr_adaptive_odbc.conf` | CDR to PostgreSQL | No |
| `/etc/asterisk/cdr.conf` | CDR engine settings | No |
| `/etc/asterisk/modules.conf` | Module loading | Yes, `conf/base/modules.conf` |

## Appendix C: useful commands

```bash
# Backend logs
cd /opt/asterisk-control/backend
docker compose logs -f api

# Database shell
docker compose exec postgres psql -U astrisk_user -d astrisk

# Dashboard logs
cd /opt/asterisk-control/dashboard
docker compose logs -f dashboard

# Asterisk CLI (native)
sudo asterisk -rx "core show version"
sudo asterisk -rx "manager show connected"
sudo asterisk -rx "http show status"
sudo asterisk -rx "ari show status"
sudo asterisk -rx "odbc show all"
sudo asterisk -rx "pjsip show endpoints"
sudo asterisk -rx "dialplan show internal"
sudo asterisk -rx "queue show"
sudo asterisk -rx "voicemail show users"

# Asterisk CLI (Docker)
docker exec -it <asterisk-container> asterisk -rx "core show version"
docker exec -it <asterisk-container> asterisk -rx "odbc show all"

# Backend tests (do not run against production data)
cd /opt/asterisk-control/backend
make test
# make smoke
# make restore-test
```

The smoke and restore tests replace configuration with a snapshot and are
intended for development/test systems, not a live production PBX.
