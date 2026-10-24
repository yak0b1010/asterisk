# Asterisk Control Center Dashboard

React dashboard for the Python/FastAPI backend in `../backend`. It manages the
telephony configuration stored in PostgreSQL and degrades cleanly when Asterisk
AMI/ARI is not configured: live call, endpoint, queue and conference panels
explain that the PBX control plane is offline while configuration remains fully
usable.

## Stack

- React 19 + TypeScript 5.9
- Vite 8
- Tailwind CSS 4
- React Router 7
- `lucide-react` icons and the Inter variable font
- No chart library — gauges, spark bars and meters are custom SVG/CSS

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Operations overview, call summary, system health |
| `/extensions` | PJSIP extensions, credentials, registrations, reload |
| `/dialplan` | Dialplan rules, contexts, export and reload |
| `/voicemail` | Mailbox CRUD and reload |
| `/queues` | Queue CRUD, members, live status and reload |
| `/ivr` | IVR menus, options and generated dialplan |
| `/conferences` | Conference rooms and live rooms |
| `/cdr` | Call records, filters, stats, CSV export, delete |
| `/monitoring` | API/PostgreSQL/host health and live telephony state |
| `/backups` | Create, download, restore and delete backups |
| `/users` | Accounts, roles, password resets, assignments |
| `/settings` | Free-form JSON runtime settings |
| `/audit` | Filterable audit trail with event details |
| `/account` | Profile, password, sessions and permissions |

Navigation and actions are permission-gated with the permissions returned by
`GET /api/v1/auth/me`. The backend remains the authority: hiding a control in
the UI is not a security boundary.

## Development

Requirements: Node.js 22.12+ (Vite 8 also accepts 20.19+) and npm.

```bash
cd dashboard
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api`, `/health`, `/ready` and
`/metrics` to `http://127.0.0.1:8080`, where the backend should be running:

```bash
cd ../backend
make run          # or: python -m app
```

The default bootstrap account is `admin` / `admin12345`; change it before
exposing the appliance.

### Configuration

Copy `.env.example` to `.env` only if you need overrides. Vite reads variables
at startup/build time.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | empty | Absolute API origin. Empty means same origin (Vite proxy or nginx). |
| `VITE_API_PROXY` | `http://127.0.0.1:8080` | Development proxy target. |

If `VITE_API_BASE_URL` is set, the backend's `CORS_ORIGINS` must include the
dashboard origin. For a production nginx deployment the default same-origin
proxy is preferred.

## Build and typecheck

```bash
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + production bundle in dist/
npm run preview     # serve dist/ on 127.0.0.1:4173
```

## Docker

The image is a multi-stage build: Node compiles the bundle, nginx serves it and
proxies API traffic. Nginx substitutes `API_UPSTREAM` from the environment at
container start.

### Standalone Compose stack

Start the backend first so its Compose network exists:

```bash
cd ../backend
docker compose up -d --build

cd ../dashboard
docker compose up -d --build
```

The dashboard listens on <http://localhost:3000> by default. It joins the
backend's `asterisk-backend_default` network and reaches the API as
`api:8080`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DASHBOARD_PORT` | `3000` | Published host port. |
| `API_UPSTREAM` | `api:8080` | API `host:port` resolved inside the container. |
| `BACKEND_NETWORK` | `asterisk-backend_default` | External Docker network to join. |

### Build and run manually

```bash
docker build -t asterisk-dashboard .
docker run --rm -p 3000:80 \
  --network asterisk-backend_default \
  -e API_UPSTREAM=api:8080 \
  asterisk-dashboard
```

If the backend stack has a different project name, set `BACKEND_NETWORK` or run
the container on a network where the API hostname resolves. When the API is not
in Docker, use `-e API_UPSTREAM=host.docker.internal:8080` (add
`--add-host=host.docker.internal:host-gateway` on Linux) or the host's LAN
address.

### Adding the dashboard to the backend stack

The backend `docker-compose.yaml` intentionally does not include the dashboard.
To add it there, append a service:

```yaml
  dashboard:
    build:
      context: ../dashboard
    restart: unless-stopped
    depends_on:
      - api
    environment:
      API_UPSTREAM: api:8080
    ports:
      - "3000:80"
```

## Production notes

- `nginx/default.conf.template` serves the SPA with history fallback, hashed
  asset caching, gzip and security headers.
- The default CSP allows same-origin API calls only. If you build with an
  absolute `VITE_API_BASE_URL`, add that origin to `connect-src`.
- `/metrics` is proxied only to loopback and RFC1918 networks by default
  because the backend endpoint is unauthenticated. Adjust the `allow`/`deny`
  rules for your scrape topology.
- `/health` and `/ready` are proxied; `/healthz` is a container-local probe.
- Restores can take longer than a normal request. The API proxy allows up to
  five minutes for a response.
- Access and refresh tokens are stored in `localStorage` and refresh tokens
  rotate on every use. Signing out revokes the browser's refresh token. Password
  changes revoke all sessions and send the user back to the sign-in page.
- If the API is unreachable, the shell still loads and pages show a retryable
  error panel rather than a blank screen.

## Layout

```text
dashboard/
├── src/
│   ├── components/
│   │   ├── layout/          Sidebar, topbar, shell
│   │   └── ui/              Buttons, cards, tables, modals, gauges, ...
│   ├── context/             Auth and toast providers
│   ├── hooks/               API query, interval, debounce, document title
│   ├── lib/                 API client, types, formatting, utilities
│   ├── pages/               One component per route
│   ├── App.tsx              Routes and permission wrappers
│   └── main.tsx             Providers and router
├── nginx/default.conf.template
├── Dockerfile
├── docker-compose.yaml
├── vite.config.ts
└── package.json
```

## Troubleshooting

**The dashboard loads but every page shows “Cannot reach the API”.**
Check that the backend is listening on `127.0.0.1:8080` and that
`VITE_API_PROXY` (development) or `API_UPSTREAM` (Docker) points at it.

**Docker logs show `host not found in upstream "api"`.**
The backend Compose network is missing or has a different name. Start the
backend first, set `BACKEND_NETWORK`, or provide a reachable `API_UPSTREAM`.

**The UI returns to the sign-in page immediately after login.**
The backend may have rotated its `JWT_SECRET`, or the account may have been
removed by a restore. Clear the site's local storage and sign in again.

**Cross-origin login fails with a CORS error.**
Add the dashboard origin to `CORS_ORIGINS` on the backend and include it in the
nginx CSP `connect-src` list.
