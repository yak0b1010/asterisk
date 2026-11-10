# Asterisk Management Appliance

A Docker Compose PBX with a browser-based administrator dashboard. The current
stack is **Asterisk 22.11.0, PostgreSQL 16, Flask/Gunicorn, and vanilla
JavaScript served by Nginx**.

## Contents

- [Current status](#current-status)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Operating modes](#operating-modes)
- [Common commands](#common-commands)
- [Validation](#validation)
- [Repository and documentation](#repository-and-documentation)
- [Team and license](#team-and-license)

## Current status

| Area | Implemented | Evidence / remaining work |
| --- | --- | --- |
| Database initialization | Native simple-PBX schema, one admin, optional demo seed and guards | Fresh demo-off/on initialization, rollback and persistence checks pass; no old-schema migration |
| SIP accounts | Transactional native PJSIP provisioning; string endpoint IDs | API tests and two digest registrations pass |
| Dialplan | DB-backed application steps; existing static contexts and test numbers retained | API-created internal call passes without a reload; multi-step UI edits are not atomic |
| Calling and CDR | Adaptive ODBC records with UTC timestamps | Loopback call, bidirectional synthetic PCMU RTP and answered CDR retrieval pass |
| Voicemail and queues | Native mailbox, queue and member CRUD | API tests pass; actual voicemail/queue call acceptance remains |
| IVR and conferences | Executable dialplan model and optional demo routes | Required modules load; actual IVR/conference calls remain untested |
| Managed IVR builder | Deferred pending provisioning-design approval | UI explains its unavailability; API returns HTTP 501 |
| Administration | Admin-only dashboard/API, account deletion, JWT/bcrypt, audit records | Login, admin policy and deleted-token rejection pass; employees have SIP accounts, not dashboard accounts |
| Live monitoring | Placeholder only | AMI/ARI integration, live registration/reachability, call counts and queue statistics remain |
| Other TP features | Not claimed complete | LAN/NAT phones, transfer/forwarding/restrictions, backup/restore and mobile softphone remain |

The automated call checks are not real-browser tests or human audio-quality
tests. See [TODO.md](TODO.md) for the remaining acceptance work.

## Architecture

```text
Browser
  → Nginx frontend /api proxy
    → Flask / Gunicorn backend
      → PostgreSQL native provisioning tables
        ↔ Asterisk through ODBC
          ↔ SIP / RTP clients
```

- PostgreSQL, backend and frontend use the explicit project-scoped `appnet`
  bridge.
- Asterisk uses **host networking**, connecting to PostgreSQL at
  `127.0.0.1:<POSTGRES_HOST_PORT>`. It does not resolve Docker service-name DNS.
- The backend uses `postgres:5432` on `appnet` (`DB_PORT=5432`).
- Browser requests use the frontend's same-origin `/api/` proxy; the UI does
  not assume a backend host port.
- Asterisk writes runtime contacts and CDRs; mailbox/queue consumers can also
  write configuration state. Audio, AstDB, keys and logs remain filesystem state.
- AMI/ARI supervision is **not** wired into the backend yet.

## Quick start

From the repository root:

```sh
make env
```

This creates `.env` only if it is missing. Edit it before starting:

```dotenv
ASTERISK_MODE=realtime
DEMO_DATA=yes
POSTGRES_HOST_PORT=5432
BACKEND_HOST_PORT=5000
FRONTEND_HOST_PORT=8080
```

`DEMO_DATA=yes` is optional. The example file defaults to `standalone` and
`DEMO_DATA=no`; select realtime explicitly for database-managed calling.
Keep the other required image, database, identity and authentication settings
from `.env.example`, adjusting them for your environment.

```sh
docker compose up --build
```

After building, `docker compose up` reuses the images. Open
`http://localhost:8080` (or your configured `FRONTEND_HOST_PORT`).
Fresh-database administrator credentials are **`admin` / `admin123`**.
Replace default credentials before exposing the appliance.

- **Demo enabled on a fresh volume:** register UDP softphones `100` and `101`
  with auth usernames matching the extensions and passwords `100pass` and
  `101pass`, against the PBX host IP and `SIP_PORT` (default 5060).
  Call between them.
- **Demo disabled:** create extensions with a display name and SIP password;
  the number is also the SIP login. Call routing is created automatically,
  with optional voicemail and an editable PIN defaulting to `0<number>`.
  Follow [the two-extension example](backend/README.md#without-demo-data).
  Existing extensions/routes are not rewritten by this new creation flow.

Do not run another PBX on the same host SIP/RTP ports. Remote phones require
host firewall access to UDP SIP and the configured RTP range; Compose does not
configure the host firewall or NAT.

### Existing data

PostgreSQL init scripts run only on an **empty data directory**. Neither
`up --build` nor changing `DEMO_DATA` migrates, resets or reseeds an existing
volume. An old application-shaped database needs an explicit migration or a
deliberately chosen fresh development volume. Do not delete volumes as a
routine startup step.

## Configuration

The root `.env` supplies Compose and the Makefiles. The Asterisk overlay is
baked at build time; changing `ASTERISK_MODE` requires rebuilding the image.

| Concern | Settings / behavior |
| --- | --- |
| Base image | `ASTERISK_IMAGE`, `ASTERISK_TAG`, `ASTERISK_DIGEST`; approved regular `22.11.0_debian-trixie-amd64` digest pin |
| Appliance image/mode | `ASTERISK_APP_IMAGE`, `ASTERISK_MODE` |
| SIP/media | `SIP_PORT=5060`, `RTP_RANGE=10000-10199` in the example |
| PBX HTTP/TLS | `HTTP_PORT=8088`, `WSS_PORT=8089`; TLS is configured, WebRTC calling acceptance remains |
| Identity/files | `PBX_FQDN`, `PUID`, `PGID`; the latter control generated certificate ownership |
| Database | `POSTGRES_VERSION=16`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; backend `DB_PORT=5432` |
| Host DB access | `POSTGRES_HOST_PORT`; published on loopback only and used by host-network Asterisk |
| UI/API host ports | `FRONTEND_HOST_PORT`, `BACKEND_HOST_PORT`; internal Nginx/Flask ports remain 80/5000 |
| Demo | Only exact `DEMO_DATA=yes` seeds PBX examples, on first initialization only |
| Admin sessions | `JWT_SECRET_KEY`, `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`; `CORS_ORIGINS` applies to direct API access |
| AMI/ARI | Empty `AMI_PASSWORD` / `ARI_PASSWORD` leave them disabled; setting credentials does not implement dashboard monitoring |
| Firewall helper | `FIREWALL_ENABLED`, `FIREWALL_MODE`, `FIREWALL_POLICY`; only the explicit PBX helper changes host rules |

Environment-file organization and duplicate/unused settings remain tracked in
`TODO.md`; for example, `DASHBOARD_PORT` is not Compose's frontend port setting.
For an alternate Compose env file, set `APPLIANCE_ENV_FILE` to the same file
passed to `--env-file`, so Asterisk's runtime environment matches interpolation.

## Operating modes

| Mode | Configuration source | Intended use |
| --- | --- | --- |
| `realtime` | Native PostgreSQL tables via ODBC; shared static infrastructure | Full Compose stack and dashboard provisioning |
| `standalone` | Static files in `asterisk/conf/standalone/` | PBX-only development; database/dashboard edits do not change its phones or routing |

Both overlays retain shared test numbers `000–004`. Realtime demo data
resembles the static department configuration; the demo flag selects initial
records, not special runtime capabilities. Department contexts remain as
agreed; arbitrary new contexts require a static declaration.

## Common commands

Run these from the root:

```sh
make env                      # create .env only if missing
docker compose up --build     # build/start full stack, foreground
docker compose up -d          # start using built images, background
docker compose ps
docker compose logs -f
docker compose down           # stop/remove stack containers; keep named volumes
```

Root `make up/down/logs/ps/build` alias the full-stack Compose operations.
`make up` uses `up -d`, without forcing a rebuild. `make test` is a PBX-only
CLI smoke check, **not** the complete validation suite.

For PBX-only targets, use `make -C asterisk help`. Root `make run` delegates
to the PBX firewall/start helper; it is not the recommended realtime full-stack
entrypoint. `make clean` delegates to destructive PBX development cleanup:
do not confuse it with `docker compose down`.

## Validation

Completed checks include:

- Fresh database initialization, seed guards/rollback and restart persistence.
- Approved Asterisk image build, ODBC connectivity and required-module state.
- Twelve backend integration tests in each demo mode.
- Extension and native PBX page JavaScript DOM/API harnesses and syntax checks.
- Disposable full Compose stacks with demo off/on, same-origin admin login,
  API provisioning, two SIP digest registrations, internal calling with RTP
  received in both directions, and answered CDR retrieval.
- Normal configured Compose image builds.

Reproduction commands and limitations:
[database checks](db/README.md#validation-results) and
[API/UI/full-stack checks](backend/README.md#validation).
Full-stack smoke tests bind host SIP port 5060; do not run them alongside the PBX
you are testing manually. They use separate project storage and scoped cleanup.

Still unverified: real-browser interactions, LAN/NAT phones, voicemail PIN/message
workflows, queue delivery/overflow, IVR/conference execution, detailed CDR
timestamp/linkage semantics, database outage recovery and standalone regression.
Known startup warnings remain documented in the PBX/database guides.

## Planned live call tracking

Live active-call tracking is possible through Asterisk Manager Interface (AMI),
but is **not implemented**. Completed-call CDRs are not a source of live call state.
The proposed approach is a private, read-only backend AMI connection that takes
an initial channel/bridge snapshot, follows events, and resynchronizes after
reconnects. Group related channels into calls rather than counting channels as
calls. Show caller, destination, ringing/answered state, and duration through an
authenticated backend API, initially polled by the frontend every few seconds.
Show monitoring as unavailable when disconnected, not as zero active calls.

AMI must not be exposed to browsers. Connectivity needs deliberate configuration:
the PBX uses host networking and loopback AMI, while the backend runs on appnet.
This is planned work tracked in [TODO.md](TODO.md), not enabled functionality.

## Repository and documentation

```text
asterisk/            PBX Dockerfile, Makefile, shared/mode configs and scripts
backend/             Flask API, Dockerfile and integration/calling test harnesses
frontend/            Static HTML/CSS/JavaScript, Nginx config and DOM/API tests
db/init/             Native schema, admin seed, optional demo seed and guards
db/tests/            Disposable initialization and ODBC/module checks
docker-compose.yaml  Four-service stack and project-scoped volumes/network
Makefile             Full-stack aliases and legacy PBX delegates
.env.example         Environment template; local .env is not documentation
```

- [PBX guide](asterisk/README.md): image/config ownership, networking, firewall,
  PBX-only commands and known limitations.
- [Database guide](db/README.md): schema provenance, ownership, demo data and
  native provisioning contract.
- [Backend/frontend guide](backend/README.md): API mappings and calling setup.
- [Root TODO](TODO.md): current task status and remaining acceptance.
- [PBX TODO](asterisk/TODO.md): PBX-specific implementation and operational work.

No React/Go or Flutter implementation is present in this workspace.

## Team and license

4 students — NAS2, Department of Computer Science, University Kasdi Merbah Ouargla.

| Member | Role |
| --- | --- |
| — | Telephony / Asterisk |
| — | Backend / API / DB |
| — | Web frontend |
| — | Mobile softphone |

Academic project — Université Kasdi Merbah Ouargla, 2026–2027.
