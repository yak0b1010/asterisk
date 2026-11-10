# Backend schema compatibility

The PostgreSQL schema is defined in `../db/init/001_schema.sql`. Extension,
dialplan, voicemail, queue/member, administrator and dashboard APIs now use this
schema. Browser API requests use the frontend Nginx `/api/` proxy, so changing
`FRONTEND_HOST_PORT` does not require JavaScript edits.

The **managed IVR builder remains unavailable** (HTTP 501), pending approval of
its provisioning design. Existing IVR dialplan records remain available to
Asterisk and visible on the Dialplan page; actual IVR call acceptance remains.
Live AMI/ARI monitoring is not implemented; active-call counts are unavailable,
not inferred from historical CDRs.

The frontend is static HTML/CSS/JavaScript in `../frontend/`, served by Nginx.
The backend is Python/Flask under Gunicorn, not Go. For the overall deployment,
see [the root guide](../README.md); remaining tasks are in [the root TODO](../TODO.md).

## Backend logs

Every completed HTTP request emits a JSON log line with its timestamp, generated
request ID, authenticated administrator ID (when available), method, route,
status, and elapsed milliseconds. The response includes `X-Request-ID`.
Existing provisioning audit calls also emit action/table/record metadata after
the operation succeeds; an audit-table write failure is logged rather than
silently ignored. These logs go to the container output:

```sh
docker compose logs -f backend
```

For extension creation, look for `action: create_extension` followed by the
`POST /api/extensions` request with status `201` and the same request ID.
The action is emitted after the endpoint/auth/AOR transaction commits.
This is operational logging, not an independent database readback or a
durable audit replacement. Request bodies, query strings, authorization headers,
passwords, and audit detail text are not included in these structured logs.
Unauthenticated requests have no administrator ID; login itself is unauthenticated.

After changing backend code, rebuild/recreate only that service:
`docker compose up -d --no-deps --build backend`.

## Start and make a call

Use the root `.env` (copy `.env.example` only if you do not already have one).
Set `ASTERISK_MODE=realtime`. Choose `POSTGRES_HOST_PORT`,
`FRONTEND_HOST_PORT`, and `BACKEND_HOST_PORT` before starting.
The example file defaults to standalone, so copying it alone does not enable
database-backed phone provisioning. Keep backend `DB_PORT=5432` for appnet;
Asterisk's host DB port is overridden by Compose.

```sh
docker compose up --build
```

After rebuilding once, `docker compose up` reuses those images. Open
`http://localhost:<FRONTEND_HOST_PORT>` (default 8080) and sign in as
`admin` / `admin123` on a freshly initialized database.

Asterisk uses **host networking**; the other services use `appnet`.
PostgreSQL's host-published port is loopback-only. Browser calls go through
Nginx to `backend:5000`; the backend connects to `postgres:5432`.

### With demo data

Set `DEMO_DATA=yes` **before first initialization of the PostgreSQL volume**.
Register two UDP softphones, for example `100` and `101`, against the PBX
host's IP and `SIP_PORT` (default 5060). Auth username equals the extension;
passwords are `100pass` and `101pass`. Call one extension from the other.
Other demo service numbers are documented in `../db/README.md`.

### Without demo data

The database starts with only the administrator. In **Extensions**, create
`7001` and `7002`, each with a display name and SIP password. The extension
number is also the SIP account and authentication username.
Context defaults to `internal`; call routing is created automatically.
With voicemail off, the generated entries are shown below for reference;
**do not add them again** on the Dialplan page:

| Pattern | Context    | Priority | Application | Application arguments             |
| ------- | ---------- | -------- | ----------- | --------------------------------- |
| `7001`  | `internal` | 1        | `Dial`      | `${PJSIP_DIAL_CONTACTS(7001)},20` |
| `7001`  | `internal` | 2        | `Hangup`    | empty                             |
| `7002`  | `internal` | 1        | `Dial`      | `${PJSIP_DIAL_CONTACTS(7002)},20` |
| `7002`  | `internal` | 2        | `Hangup`    | empty                             |

Enable **Create voicemail** to reveal its PIN and optional email fields.
The editable, digits-only PIN defaults to `0` + the extension number (for example
`07001`). It is stored as a plain string for Asterisk compatibility, preserving
leading zeros, but masked in the form and excluded from API responses/logs.
The mailbox is `<number>@default`; busy, unanswered (20 seconds), and unavailable
phones route to the appropriate voicemail greeting. Email delivery depends on
the PBX host's mail configuration; entering an address does not configure SMTP.
SIP records, the optional mailbox, and all routing priorities commit together.

Register each softphone with its matching auth username/password, then dial
the other number. No Asterisk reload is needed for this tested provisioning path.
The CDR page shows the completed call after hangup.

This was verified on loopback with synthetic PCMU RTP, not with physical phones
across a LAN/NAT. Allow the configured UDP SIP and RTP ports in the host firewall
for remote phones; Compose does not configure that firewall or public-IP/NAT settings.

Existing volumes are preserved. Init scripts do not migrate/reseed an existing
database, and changing `DEMO_DATA` does not add data to one. If an existing volume
contains an older schema, stop and arrange a migration or explicitly choose a fresh
development volume; do not assume `up --build` rewrites it.

## Native resource contracts

- Dashboard accounts are administrators only; they are not employees or SIP
  identities. Delete an administrator rather than disabling it. Self-deletion
  is blocked; deleted accounts' JWTs are rejected on the next API request.
  Legacy operator records cannot log in or use protected APIs.
- Dialplan UI/API names map to native columns: `pattern → exten`,
  `application → app`, `destination → appdata`. Context defaults to `internal`.
  Empty arguments are valid (for example `Hangup`). Each row is one priority;
  multi-step edits are not an atomic route compiler. Only statically declared
  realtime contexts are executable; base test numbers `000–004` retain precedence.
- Mailboxes use native `uniqueid` as their API `id`, and `mailbox@context` as
  their Asterisk address. `full_name → fullname`, `delete_msg → deletevoicemail`.
  API booleans become native `yes/no`. PINs are not returned; blank edit PINs
  preserve the existing value. Messages remain in the Asterisk spool volume.
- Queues use **string names as IDs**. Names are immutable through the API.
  Names are limited to 80 characters to fit member keys and cannot contain `/`.
  `wrapup_time → wrapuptime`, `max_len → maxlen`; members reference `queue_name`
  and expose native `uniqueid` as `id`. There is no queue-number column:
  use a dialplan `Queue` application entry with the queue name as arguments.
  Deleting a queue removes its members, not dialplan references to that queue.
- Native PBX CRUD rejects unsupported `is_active` flags. It does not implement
  endpoint disable/re-enable, registration revocation, or live-call termination.

Admin-only protection applies to all management APIs, not just mutation routes.
Health and login are public. Native dialplan/mailbox/queue writes reject unknown
fields and invalid JSON types. Missing records on update/delete return 404;
database conflicts return 409 and database field-size/value errors return 400.
Queue membership keys remain native; removing a queue does not rewrite dialplan.
The optional `user_endpoints` association table is not exposed by a management
API and is not an employee-access mechanism.

## Extension API

`/api/extensions` manages SIP accounts and provisions their initial call routing
in the native `extensions` dialplan table. These routes require administrator authorization.

- `GET`: paginated endpoint records (`items`, `total`, `page`, `per_page`).
  IDs are strings, including leading zeros. Passwords are not returned.
- `POST`: `extension` (1–32 ASCII digits) and `secret` are required. The form
  also requires `display_name`; the API formats it as `"Alice" <101>`.
  Formatted caller ID must fit the native 40-character column.
  Optional `voicemail: {"pin": "0101", "email": "alice@example.test"}` creates
  a mailbox; omit the object to leave voicemail off. An omitted PIN defaults
  to `0<number>`. Existing-mailbox linking via `mailboxes`, direct `callerid`
  (instead of `display_name`), and `context` remain available to API clients.
  Creates same-ID `ps_auths`, `ps_aors`, `ps_endpoints`, optional voicemail,
  and executable routing in one transaction. Defaults: `internal`, UDP,
  two contacts, `ulaw,alaw`, 20-second ringing. Without voicemail, routing is
  Dial/Hangup; with voicemail it checks for missing contacts before dialing
  and branches on busy/no-answer/unavailable status.
  Existing number/context routes, mailbox collisions, and internal static test
  numbers `000–004` are rejected, never overwritten.
- `PUT /<id>`: updates caller ID, context, mailbox references, or SIP password.
  IDs cannot be renamed. An omitted/blank secret preserves existing credentials.
  Password changes require same-ID, unshared `userpass` credentials.
- `DELETE /<id>`: deletes the endpoint. Removes same-ID auth/AOR records only
  when referenced by that endpoint and not shared by another endpoint.
  Externally named and shared objects are preserved. The response reports
  retained shared objects and remaining direct queue/IP/contact references.
  Dialplan text matches are only review candidates: patterns, variables, and
  indirect references cannot be exhaustively resolved this way.
- Unsupported fields, including `is_active`, produce HTTP 400. Missing endpoints
  produce 404; provisioning conflicts produce 409.

Mailbox references must identify existing `mailbox@context` records, separated
by commas if needed, within the native endpoint field's 40-character limit.
They cannot be combined with creating a new mailbox in the same request.
After creation, change mailbox PINs/email on the separate Voicemail page/API.
Extension edit/delete does not change/delete mailbox configuration or messages.

Existing endpoint edits do not regenerate routing or create voicemail.
Contexts must exist in the Asterisk configuration; this API does not
declare new contexts. Independent routes and queue memberships remain unchanged
on endpoint deletion. Registration/contact cleanup and termination of active
calls are not implemented by database deletion.

Endpoint writes use one transaction and a PostgreSQL endpoint-table write lock;
creation also locks the dialplan table while checking/creating initial routing.
These serialize shared-reference checks and provisioning conflicts. Normal Asterisk
SELECTs are not blocked by that lock. Audit entries identify the endpoint without
copying SIP passwords into the audit log. The legacy audit table has an integer
record ID, so endpoint IDs are recorded in `details`, not coerced to integers.

## Validation

From the repository root:

```sh
docker build -t asterisk-backend-validation:local ./backend
python3 backend/tests/validate_extensions.py
node frontend/tests/extensions.test.mjs
node frontend/tests/pbx.test.mjs
python3 backend/tests/validate_compose.py
PBX_SMOKE_DEMO=yes python3 backend/tests/validate_compose.py
```

The Python harness uses fresh demo-off/on PostgreSQL databases on an isolated
bridge network with generated credentials, runs Flask's test client inside the
backend image, and cleans up only its own containers/network/volumes. It does
not start an HTTP server, Asterisk, or the frontend. It checks native row contents,
rollback, shared/external-object protection, mailbox preservation, string IDs,
API validation, dashboard queries, admin-only policy/deleted-token revocation,
and dialplan/mailbox/queue CRUD. Twelve tests pass with demo off and twelve on.

The Node test runs the actual extension-page script against a small DOM/API
harness. It checks rendering and create/edit/delete/pagination wiring; it is
**not** a real-browser test. The additional page harness checks administrator,
dialplan, mailbox and string-keyed queue rendering/edit requests.

The Compose smoke test builds and starts all four services with a unique project,
generated test credentials, a temporary env file, random host DB/API/UI ports,
and separate volumes. It logs in through Nginx, provisions two endpoints and
routes through the API, registers two loopback SIP digest peers, establishes a
call with RTP received in both directions, and asserts an answered ODBC CDR.
Both demo modes pass. It removes only its project containers/network/volumes.
It **does use host SIP port 5060**, so do not run it alongside another PBX.
No browser automation, human audio-quality assessment, or voicemail/queue/IVR/
conference call acceptance is included in that smoke test.

## Remaining work and boundaries

| Area | Remaining |
| --- | --- |
| Browser acceptance | Test login/session redirects and page forms in a real browser; Node doubles do not prove browser behavior |
| Remote phones | LAN/NAT signaling/media, host firewall and human audio-quality checks |
| Telephony services | Actual mailbox/PIN/message flows, queue delivery/overflow/runtime refresh, IVR and conference calls |
| Managed IVR builder | Approve app metadata/generated-dialplan ownership before adding tables or a compiler |
| Coordinated routes | Current editor writes individual priorities; safe whole-route transactions/versioning are not implemented |
| Supervision | AMI/ARI events, live calls/reachability, queue/conference state and resource monitoring |
| Provisioning breadth | IP identification/domain aliases, admin-endpoint associations and other native options are not exposed by current CRUD |
| Administration | No forced-first-login/password-reset workflow; no employee dashboard or admin-disable feature |
| Lifecycle/recovery | No old-schema migration, session revocation on phone deletion, or DB-outage recovery acceptance |
| Broader TP management | Transfer/forwarding/restrictions, media uploads, backups/restore and mobile client remain outside this compatibility pass |

Native schema columns are not automatically API features. Startup/calling
success is not acceptance of every TP requirement. Existing defaults, static
context boundaries and the user-approved routing organization remain unchanged.
