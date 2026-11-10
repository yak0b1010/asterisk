# PostgreSQL realtime initialization

Database initialization, ODBC and required-module checks pass on the approved
Asterisk 22.11.0 image. The backend/frontend now use the native schema for
SIP accounts, dialplan, mailboxes, queues/members, administrators and dashboard
queries. Disposable full-stack checks also pass registration, internal calling,
bidirectional loopback RTP and answered CDR retrieval, with demo off/on.
Managed IVR editing remains unavailable pending its provisioning design.
See [validation results](#validation-results) and
[the calling guide](../backend/README.md#start-and-make-a-call).

## Initialization contract

The official PostgreSQL image processes `db/init/` in filename order, only when
its data directory is empty:

1. `000_validate.sh` logs when demo data is disabled.
2. `001_schema.sql` creates the schema in a transaction.
3. `002_admin.sql` inserts the existing temporary administrator.
4. `999_demo.sh` runs `seed/demo.sql` only when `DEMO_DATA=yes`.

The shell files deliberately work when **sourced** as non-executable files.
They wrap their work in subshells so their options/exit do not replace or exit
the PostgreSQL entrypoint. They also work if executable. No chmod or Git mode
change is necessary. The entrypoint does not recurse into `seed/`.

In the root `.env`:

```dotenv
DEMO_DATA=no
```

Unset/empty also means `no`. With demo off, the database contains its schema and
one administrator; all PBX configuration, associations, contacts, CDR, and audit
tables are empty. Static Asterisk test numbers `000–004` still exist.

Only the exact value `DEMO_DATA=yes` enables the dataset below. All other values,
including `true`, `1`, and `YES`, skip demo seeding without failing initialization.

Changing this flag does **not** reseed an existing database. Container restarts
preserve the named PostgreSQL volume; they do not require a migration or rerun
init scripts. This is fresh initialization, **not** an upgrade of the old
application schema. The DDL intentionally fails if objects already exist rather
than masking an incompatible schema with `IF NOT EXISTS`.

Each SQL file fails on errors and uses a transaction. The entire entrypoint
sequence is not one transaction: a later failure can leave earlier files
committed. PostgreSQL may already have initialized its data directory, so a
restart is not an initialization retry. Diagnose failures before recovery;
never delete an existing volume automatically. Later validation must use
separate disposable storage, not the existing project volume.

## Schema source and deliberate differences

Reference: Asterisk tag
[`certified-22.8-cert4`](https://github.com/asterisk/asterisk/tree/604dc657cb4fec1e792da9f57a2784dc33946385/contrib/ast-db-manage),
commit `604dc657cb4fec1e792da9f57a2784dc33946385`, matching the version named in
the original image. The runtime pin is now regular Asterisk 22.11.0 on Debian
Trixie: build, ODBC, required-module and basic provisioning/calling checks pass.
The schema has not been rederived from that release. A complete field/type audit
and remaining service-call acceptance must not be inferred from the basic call.

The SQL is a hand-consolidated **simple-PBX subset**, not a generated copy of
every upstream table/option and not an Alembic-managed database. In particular:

- PJSIP base fields: migration `43956d550a44`; current ID widths:
  `dac2b4c328b8`; contact URI width: `1d3ed26d9978`; contact runtime fields and
  expiration type: `a845e4d8ade8`, `ef7efc2d3964`, `81b01a191a46`,
  `1ae0609b6646`, `f3d1c5d38b56`; qualify flags: `44bd6dd914fa`;
  digest algorithm fields: `abdc9ede147d`.
- Native dialplan layout: `581a4264e537`.
- Mailbox configuration: `4da0c5f79a9c`. The separate upstream `voicemail/`
  migration tree describes **message storage**, not mailbox configuration;
  this setup keeps message audio on disk.
- Queue options: `28887f25a46f`; numeric member IDs: `5139253c0423`;
  member wrap-up, ring-in-use, pause reason: `e2f04d309071`, `8915fcc5766f`,
  `4042a0ff4d9f`.
- CDR fields: `210693f3123d`, with expanded account fields per
  `54cde9847798`.

Deliberate application choices:

- Primary keys on PJSIP IDs; no redundant second ID index.
- Shared text domains with checks instead of PostgreSQL enums/booleans for
  Asterisk option fields. PJSIP booleans accept upstream textual boolean
  spellings, including values Asterisk may write.
- PJSIP endpoint and queue provisioning columns cover the simple PBX use case,
  not every upstream option. Add optional columns deliberately when needed.
  Auth, AOR, and contact fields include the referenced release's relevant
  runtime/provisioning fields. Transport/global objects remain static.
- Dialplan priorities must be positive; mailbox `(context, mailbox)` pairs
  and queue member `(queue_name, interface)` pairs must be unique.
- Queue members reference queues with cascade deletion. Keep queue names at
  most 80 characters when provisioning members (the native member width).
- CDR adds an application surrogate ID and uses `calldate` instead of `start`.
  `alias start => calldate` supplies the actual call-start time, not an insert
  timestamp. `answer` and `end` preserve the other timestamps. `lastdata` is
  widened to 256 characters.
  Adaptive ODBC enables `quoted_identifiers` because PostgreSQL reserves `end`.
  Compose waits for PostgreSQL's final TCP server, not the temporary init server,
  before Asterisk loads and discovers the CDR table metadata.
- CDR timestamps are UTC, stored as timestamp without time zone. Reporting
  must interpret them as UTC. `linkedid` groups related call legs;
  neither it nor `uniqueid` is a unique row key.
- `users`, `audit_log`, and `user_endpoints` are app-only. Dashboard accounts
  are administrators, not employees/SIP callers. Admins are deleted, not
  disabled; legacy `role`/`is_active` schema fields do not provide a supported
  operator or disable workflow. No fake SIP `is_active` column.

## Tables and ownership

| Tables                                    | Provisioning / runtime behavior                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ps_endpoints`, `ps_auths`, `ps_aors`     | Backend provisions endpoint, credentials, and address-of-record                             |
| `ps_domain_aliases`, `ps_endpoint_id_ips` | Optional native provisioning tables; not exposed by current CRUD APIs                     |
| `ps_contacts`                             | Asterisk writes registration state; backend may observe it                                  |
| `extensions`                              | Backend writes executable dialplan steps, including IVR and conference entry                |
| `voicemail`                               | Backend provisions mailboxes; Asterisk can update PINs through VoiceMailMain                |
| `queues`, `queue_members`                 | Backend provisions queues/members; Asterisk can update member pause/penalty/ringinuse state |
| `cdr`                                     | Asterisk writes call detail records through adaptive ODBC, not extconfig                    |
| `users`, `audit_log`, `user_endpoints`    | Admin authentication/deletion and audit; association table exists but has no management UI/API |

Do not deny Asterisk all writes except contacts/CDR: mailbox PIN changes and
queue member control also write to PostgreSQL. The current single DB role
owns these objects. Separate least-privilege roles are future hardening, not
implemented here.

## Department grouping: default versus demo

The TP's department number ranges are examples, not a requirement for a
`departments` table. No department or demo helper tables are created.

- **Default initialization:** no department ranges, queue memberships, shared
  mailboxes, or DB routes are provisioned. Static handler contexts are just
  empty routing hooks until their dialplan rows are provisioned.
- **Demo numbering:** `100–199` Administration, `200–299` Finance, `300–399` IT,
  `400–499` Customer Service, and `500–599` Management. These are dialplan
  patterns, not organizational records.
- **Contexts:** endpoints enter `internal`; the `handle-*` contexts contain
  call-handling rules. A context controls routing/access, not department
  membership. The demo does not impose inter-department calling restrictions.
- **Queues:** `queue_members` defines actual agent membership, independently
  of number ranges. An agent can belong to several queues.
- **Shared voicemail:** `departments` is a mailbox namespace, not a department
  registry or a dialplan context.

The seeder keeps its five range definitions as inline values and inserts
directly into the native PBX tables. There is no persistent grouping entity
for the backend to maintain.

## Demo data

All demo objects are inserted in **one transaction**, without upserts.
An accidental rerun fails on existing keys instead of overwriting provisioning.
No contacts, CDRs, app-user associations, or additional admin users are faked.

| Data                     | Contents                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Endpoints / auths / AORs | 500 each, `100–599`; UDP, two contacts per AOR                                     |
| SIP passwords            | `<extension>pass` - demo credentials                                               |
| Personal mailboxes       | 500 in `default`; PIN `0<extension>`                                               |
| Shared mailboxes         | `010–014` in `departments`; PIN `0<mailbox>`                                       |
| Queues                   | `q-admin`, `q-finance`, `q-it`, `q-support`, `q-management`                        |
| Queue members            | 500, one department queue per endpoint                                             |
| Queue parameters         | `rrmemory`, 20s agent timeout, 1s retry, 20 waiting callers, 300s caller timeout   |
| Services                 | `010–014` queues, `020` prompted personal voicemail login, `021` voicemail deposit |
| Department routing       | `_1XX`, `_2XX`, `_3XX`, `_5XX`: person-first, busy/unavailable voicemail           |
| Customer Service         | `_4XX`: `q-support`, then shared mailbox on configured overflow statuses           |
| TP addition: `030`       | IVR: 1 → Admin, 2 → Finance, 3 → Customer Service; invalid/timeout exits           |
| TP addition: `040`       | ConfBridge `demo-room`, temporary PIN `0040`, maximum 20 participants              |

IVR/conference examples are additions required by the TP docx, **not** copied
from standalone. The demo IVR plays the stock digit prompts “1, 2, 3” and then
collects one digit after a beep; it has no barge-in during playback. Replace its
`Playback` argument with a descriptive uploaded recording when the management/
media layer exists.
`020` uses the default voicemail context; department mailbox login needs
`VoiceMailMain(@departments)` in an explicitly provisioned service.

The existing admin hash is retained. Normal login as `admin` / `admin123`
passed the API and full Compose tests; no separate hash-only check was required.
Change default admin/SIP/mailbox/conference credentials before exposure.
An automatic forced-first-login flow is not implemented by these init scripts.

## Dialplan, IVR, and conference provisioning contract

`extensions` now means **dialplan steps**, not SIP accounts:

```sql
BEGIN;
INSERT INTO ps_auths (id, auth_type, username, password)
VALUES ('600', 'userpass', '600', '<supply-a-new-SIP-secret>');
INSERT INTO ps_aors (id, max_contacts, remove_existing)
VALUES ('600', 2, 'yes');
INSERT INTO ps_endpoints
    (id, auth, aors, context, disallow, allow, direct_media)
VALUES ('600', '600', '600', 'internal', 'all', 'ulaw,alaw', 'no');
INSERT INTO extensions (context, exten, priority, app, appdata) VALUES
    ('internal', '600', 1, 'Dial', '${PJSIP_DIAL_CONTACTS(600)},20'),
    ('internal', '600', 2, 'Hangup', '');
COMMIT;
```

This is illustrative provisioning, not a command executed during implementation.
The backend supplies a real secret through its normal secure request path.
Its extension creation API now writes this initial routing automatically and
can create a `default` mailbox plus busy/no-answer/unavailable routing in the
same transaction. New extension IDs are numeric and also serve as SIP usernames.
The optional mailbox PIN defaults to the plain string `0<number>`, preserving
leading zeros; PINs are not returned by the API or included in action logs.
Existing routing/mailbox collisions are rejected rather than overwritten.
`user_endpoints` can associate an admin with
an endpoint but has no current management workflow; it does not grant dashboard
access to employees. Existing extension edits do not regenerate routing, and
deletion still preserves routing/mailboxes. The standalone dialplan editor writes
one priority per request, not a whole-route transaction.

- The realtime overlay declares `internal` and department handler contexts.
  Static base test numbers `000–004` take precedence over DB rows.
- Use numeric priorities and numeric `Goto`/`GotoIf` branch targets.
  Static labels, `n`, and realtime hints are not supported by this schema.
  For coordinated live route changes, use a transaction across priorities.
  The current row editor does not provide that guarantee; avoid partial edits
  to in-use routes or use a coordinated provisioning transaction.
- Native realtime lookup checks exact extensions before patterns. It does not
  promise the static dialplan's full “most specific pattern” ordering; avoid
  overlapping DB patterns. The demo patterns are disjoint.
- `PJSIP_DIAL_CONTACTS` rings multiple registrations; the demo guards an empty
  result before `Dial`. DB appdata is limited to 256 characters, and upstream
  pbx_realtime also limits expanded application arguments.
- For a new IVR, use unique menu-prefixed extension names inside the fixed
  `realtime-ivr` context. An entry number uses
  `Goto(realtime-ivr,<menu-name>,1)`. `Read` collects a digit, then `GotoIf`/
  `DIALPLAN_EXISTS` selects a menu-specific destination or the invalid/timeout
  route. Nested menus jump to another menu's entry extension. No per-menu
  static context is needed. Avoid multiplexing DB contexts with an `eswitch`:
  pbx_realtime's cache key would not distinguish the selected DB contexts.
- Conferences use `Set(CONFBRIDGE(user,pin)=...)` and, if needed,
  `Set(CONFBRIDGE(bridge,max_members)=...)` followed by `ConfBridge(room-name)`.
  Do not pass explicit profiles if channel-built profiles should apply.
  Use one consistent bridge configuration per room. Live room lock/mute/kick
  operations belong to AMI; deleting the entry route does not eject callers.
- There are no inert `ivr_menus`, `ivr_routes`, `conferences`, or legacy
  `dialplan` tables. Their executable behavior lives in `extensions`.

Dynamic realtime dialplan is chosen for this small PBX's direct-write contract.
Upstream recommends static dialplan with data abstraction for larger/production
systems. Here DB availability and lookup latency affect call execution; this
tradeoff is explicit, not a claim that dynamic realtime is universally best.

### Disable/delete and other TP requirements

Do not equate `users.is_active=false` with disabling a SIP endpoint. A true
disable must prevent identification/registration **and** new dialing, not just
change its incoming context. A reversible management workflow must durably
archive its provisioning rows and association before removing the active
endpoint and relevant IP-identify/dialplan/queue-member references; re-enable
restores them transactionally. Shared auths/AORs must not be deleted blindly.
The schema does not implement that archive/workflow. Per the agreed scope,
unsupported extension disable controls were removed; an archive/revoke/re-enable
workflow is a possible future design, not a required feature of this pass.
Existing contacts/active channels also need an operational policy.

Current endpoint deletion preserves shared/external auth/AOR objects and
independent mailboxes, routes and queue references. The API reports known
remaining references for review; it does not terminate active calls or guarantee
that every indirect dialplan reference has been found.

Transfer is allowed for demo endpoints through PJSIP. Restrictions and
forwarding must be authored as dialplan rules; no PSTN trunk, outbound policy,
feature-code transfer UI, or forwarding workflow is provisioned by this seed.
These remain TP application work, not silently completed by adding tables.

### Updates and caches

No Sorcery memory-cache wizard is configured here. Newly retrieved PJSIP
configuration comes from realtime; objects already referenced by registrations,
qualify tasks, subscriptions, or active calls can outlive a DB edit. Do not
promise instantaneous revocation or assume a generic reload terminates calls.

`pbx_realtime` has a short match cache (roughly seconds); route edits are not a
static `dialplan reload` operation. Mailboxes are retrieved on lookup; ongoing
voicemail sessions keep their user state. Queue definitions/members have
in-memory runtime state and realtime refresh behavior; use the supported
queue/AMI member actions for immediate pause changes, then reconcile DB state.
The tested endpoint/route creation path works after startup without a reload.
Queue refresh, mailbox writes, credential revocation and outage-recovery
semantics still need image-specific runtime checks.

Reload baked config only after changing it/rebuilding the image. In particular,
adaptive CDR column metadata needs a module reload after schema changes.

## Integration files and remaining work

- `docker-compose.yaml` passes `DEMO_DATA` into PostgreSQL.
- `asterisk/conf/realtime/` maps PJSIP/contact/mailbox/queue/dialplan families,
  enables CDR writing, supplies global voicemail/queue/MOH/ConfBridge defaults,
  and explicitly requires the needed modules.
- The Dockerfile copies shared base files first, then the selected mode.
  Base `modules.conf` includes `modules_custom.conf` at the bottom: realtime
  appends its requirements; standalone supplies a comment-only placeholder.
  The shared autoload/noload policy remains in one place.
- Declaring `require` does not install a missing module. The original image logged
  the required-module failure but remained running; do not rely on exit status
  or "Asterisk Ready" as a readiness check. The runtime validator checks actual
  module state; all required modules pass with the approved 22.11.0 image.
- Backend/frontend compatibility is implemented for the PJSIP trio,
  `extensions` dialplan, native mailboxes, name-keyed queues/members, admin
  accounts and dashboard queries. See `../backend/README.md` for API mappings,
  default `internal` context and calling setup.
- The managed IVR editor returns HTTP 501 rather than querying removed tables.
  Its replacement provisioning design remains unapproved; existing IVR routes
  can still be inspected/edited as dialplan steps.
- Contacts are registration records, **not** a substitute for live reachability,
  active calls, queue statistics, or conference membership. Use AMI/ARI/events
  and queue logs where appropriate. CDR call type is not automatically inferred.
- Backups must include PostgreSQL plus spool, AstDB, media, keys, and relevant
  configuration. An SQL dump alone is not a full appliance backup.

## Validation results

Run from the repository root with Docker and Python 3:

```sh
docker compose --env-file .env.example config --no-env-resolution --quiet
sh -n db/init/000_validate.sh db/init/999_demo.sh asterisk/conf/scripts/entrypoint-wrapper.sh
docker build --build-arg MODE=realtime -t asterisk-realtime-validation:local ./asterisk
python3 db/tests/validate_init.py
python3 db/tests/validate_runtime.py
```

All five commands passed with the approved 22.11.0 image. The abandoned
module-compilation stage was removed; the base image supplies `pbx_realtime.so`.
Both the Dockerfile fallback and `.env.example` use the user-selected pin.

- Fresh PostgreSQL 16 initialization: demo off and `YES` leave PBX tables
  empty, with exactly one administrator. Demo on creates 500 auths/AORs/
  endpoints, 505 mailboxes, five queues, 500 members, and 120 dialplan steps.
- Exact-`yes` dispatch works in sourced and executed shell invocation.
  Guard dispatch uses a mock `psql`; real initialization separately executes
  SQL through the official PostgreSQL entrypoint.
- Duplicate seeding fails without overwriting objects; a conflict in a later
  range rolls back earlier inserts in the same seed transaction.
- Representative domain/check/FK constraints reject invalid provisioning.
  Runtime lookup/report indexes exist. These are not exhaustive schema tests.
- Restart preserves data and skips initialization.
- Compose's rendered topology was asserted: Asterisk host networking, other
  services explicitly on `appnet`, loopback PostgreSQL publishing, matching
  published/ODBC host ports. Later full-stack smoke tests also started all four
  services with a separate project and volumes.
- The built image's PostgreSQL ODBC driver executes real SQL over host
  networking to the env-defined loopback-published port. Asterisk's own
  `odbc show` reports one active connection; Adaptive ODBC is registered as a
  CDR backend. The later full-stack smoke test also proves an answered
  call-generated CDR reaches PostgreSQL and the API.

Test scripts use uniquely named containers, a bridge network, and fresh named
database volumes, cleaning up only resources they created. Asterisk's inherited
image volumes remain anonymous and are removed with the test containers.
An interrupted/killed test may need scoped cleanup of its remaining resources.
PostgreSQL version and host port come from `.env` if present, otherwise
`.env.example`; PBX test settings
come from `.env.example`. Credentials are generated for the disposable DB,
not copied from the project. These two DB/PBX test scripts do not start the
backend/frontend; the separate Compose smoke test does.
The locally built image and normal Docker build/pull caches remain.

### Blockers and additional findings

- **Resolved:** adaptive ODBC initially emitted unquoted `end`, breaking
  PostgreSQL CDR inserts. `quoted_identifiers` fixes the generated INSERT.
- **Resolved:** the Unix-socket health check could pass on PostgreSQL's temporary
  init server. Waiting for the final TCP listener prevents premature Asterisk
  startup and empty CDR metadata discovery.

- **Resolved:** the original certified image lacked `pbx_realtime.so`.
  The user-approved regular 22.11.0 image supplies it, and the module runs
  with the existing realtime configuration. No routing change was needed.
- Required-module failure was logged but did not terminate the original image;
  fail-closed startup behavior needs investigation.
- MOH reports no files in `/var/lib/asterisk/moh`; packaged WAV files exist
  under `/usr/share/asterisk/moh`. `random=yes` is also deprecated in favor of
  `sort=random`. No media-path change has been made.
- Optional `format_ogg_vorbis.so` cannot load because `libvorbisenc.so.2` is
  missing. No package/module-policy change has been made.
- Voicemail warns that `maxsilence` should be less than `minsecs`.

### Application and calling validation

Reproduction commands are in
[the backend/frontend guide](../backend/README.md#validation).

- Twelve backend integration tests pass with demo off and twelve with demo on:
  native provisioning, shared-object protection, validation, admin-only policy,
  deleted-token rejection, seeded login and dashboard/resource queries.
- Node DOM/API harnesses pass for the extension, administrator, dialplan,
  mailbox and queue pages. These are not real-browser tests.
- Disposable Compose tests pass with demo off/on: Nginx proxy/admin login,
  API-created `7001/7002` endpoints and dialplan, digest registration, internal
  call, RTP received in both directions and answered CDR retrieval. Both use
  the same runtime configuration, not demo-only routing capabilities.
- The full-stack harness uses a unique project, generated credentials, temporary
  env file and random DB/API/UI host ports. SIP uses host port 5060, so it must
  not run alongside another PBX. Cleanup is scoped to its project storage.

Remaining: real-browser/LAN/NAT phone checks, voicemail PIN/message workflows,
queue call delivery/overflow/runtime updates, IVR/conference calls, precise CDR
timestamps/linkage, database loss/recovery and standalone regression.
The root `TODO.md` tracks these. No pre-existing volumes were modified or removed.
