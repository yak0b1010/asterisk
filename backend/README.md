# Backend (FastAPI)

The backend is the source of truth for users, extensions and audit history. It
serves the JSON API used by the React frontend, talks to Asterisk over **AMI**,
and generates the Asterisk configuration files from the database.

The code is deliberately small and beginner-friendly:

```txt
backend/
├── app/
│   ├── main.py            # FastAPI app, error handlers, startup
│   ├── config.py          # all settings (read from environment/.env)
│   ├── database.py        # SQLAlchemy engine + session
│   ├── models.py          # User, Extension, AuditLog tables
│   ├── schemas.py         # request/response shapes (camelCase for React)
│   ├── security.py        # bcrypt + JWT
│   ├── deps.py            # logged-in user + role checks
│   ├── seed.py            # first-start data (admin, 500 extensions, demo)
│   ├── asterisk.py        # tiny AMI client
│   ├── pbx.py             # writes pjsip_endpoints/queues/voicemail files
│   ├── cdr.py             # reads the PostgreSQL cdr table
│   ├── system_metrics.py  # CPU / RAM / disk
│   └── routers/           # one file per API area
├── tests/                 # pytest + FastAPI TestClient
├── requirements.txt
├── requirements-dev.txt
└── Dockerfile
```

## API

Every route is under `/api`:

| Method | Path | Who | Purpose |
| ------ | ---- | --- | ------- |
| POST | `/api/auth/login` | public | returns `{token, user}` |
| GET | `/api/auth/me` | signed in | current user |
| POST | `/api/auth/logout` | signed in | audit entry |
| GET | `/api/users` | signed in | directory list |
| POST | `/api/users` | admin, operator | create person |
| PUT | `/api/users/{id}` | admin, operator | update person |
| DELETE | `/api/users/{id}` | admin | delete person, unassign extensions |
| GET | `/api/extensions` | signed in | list + live registration |
| POST | `/api/extensions` | admin, operator | create one extension |
| POST | `/api/extensions/bulk` | admin, operator | create a number range |
| PUT/PATCH | `/api/extensions/{number}` | admin, operator | update / enable / disable |
| DELETE | `/api/extensions/{number}` | admin | delete extension |
| GET | `/api/dashboard/summary` | signed in | dashboard cards + recent CDR |
| GET | `/api/system/metrics` | signed in | one CPU/RAM/disk sample |
| GET | `/api/asterisk/status` | signed in | AMI status + registrations |
| POST | `/api/asterisk/reload` | admin | regenerate + reload config |
| GET | `/api/audit` | admin | latest audit entries |
| GET | `/api/health` | public | Docker healthcheck |

Swagger UI: `http://localhost:8000/api/docs` (or
`http://localhost:8080/api/docs` through the frontend nginx).

Errors always use the shape the frontend expects:

```json
{ "message": "Extension 600 is not valid" }
```

## Asterisk integration

The backend never edits Asterisk files by hand. After every user/extension
change it:

1. writes `pjsip_endpoints.conf`, `queues.conf` and `voicemail.conf` into
   `PBX_CONFIG_DIR` (inside Compose: `/generated`, mounted from
   `./asterisk/generated`);
2. asks Asterisk to reload `res_pjsip`, `app_queue` and `app_voicemail` over
   AMI (if Asterisk is reachable).

Asterisk reads those files through `#tryinclude generated/...`. AMI is also
used for:

- `core show version` / `core show uptime` → dashboard status
- `core show channels count` → active calls
- `pjsip show contacts` → registered extensions and contact IPs

When Asterisk is offline the API still works; the dashboard simply shows
`stopped`, no active calls and no registrations.

## Local development (no Docker, SQLite)

```sh
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

With no database settings the backend uses `backend/data/app.db`. To connect
the React dev server:

```sh
cd frontend
cp .env.example .env          # VITE_USE_MOCK=false
npm install
npm run dev                   # proxies /api to http://localhost:8000
```

Useful local settings (`backend/.env` is optional):

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `DATABASE_URL` | empty | full SQLAlchemy URL; overrides the `DB_*` values |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | localhost/… | PostgreSQL connection |
| `JWT_SECRET` | `dev-secret-change-me` | token signing key |
| `JWT_EXPIRE_MINUTES` | `480` | session length |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | `admin` / `admin` | first administrator |
| `SEED_DEMO_DATA` | `true` | operator/viewer accounts + demo directory |
| `AMI_HOST` | empty | Asterisk host; empty = AMI disabled |
| `AMI_PORT`, `AMI_USERNAME`, `AMI_PASSWORD` | `5038`, `backend`, empty | AMI login |
| `PBX_CONFIG_DIR` | `../asterisk/generated` | where configs are written |
| `PBX_RELOAD_ENABLED` | `true` | reload Asterisk after changes |

## First start / seeding

- The administrator account is created if its username does not exist.
- When the `extensions` table is empty, all 500 numbers (`100`–`599`) are
  created with the demo password `<number>pass`, matching the original static
  PBX configuration.
- With `SEED_DEMO_DATA=true`, `operator/operator`, `viewer/viewer` and ten
  sample people are added. A few sample people get an extension assigned.

Seeding never overwrites existing records.

## Tests

```sh
cd backend
.venv/bin/python -m pytest -q
```

The tests set `DATABASE_URL=sqlite:///...` and an empty `AMI_HOST`, so they do
not need PostgreSQL, Asterisk or Docker. They cover auth, roles, users,
extensions, bulk creation, dashboard shape, metrics and audit.

From the repository root:

```sh
make test          # docker compose config -q + backend tests
make frontend-build
```

## Notes

- DELETE endpoints return `204 No Content`; all other responses are JSON.
- The SIP secret is write-only: it is stored in the database and written to
  `pjsip_endpoints.conf`, but never returned by the API.
- Extension numbers must be `100`–`599`; passwords must be at least 8
  characters with no spaces.
- `cdr_odbc` uses the classic `calldate` schema (see
  `db/init/001_cdr.sql`), and times are stored in UTC.
- If you change `db/init/*.sql` after the database volume was created, apply
  the change manually or recreate the volume with `make clean`.
