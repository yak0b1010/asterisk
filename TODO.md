# PostgreSQL / Asterisk realtime plan

Status: schema, seeders, guards, and realtime configuration implemented.
DB/build/ODBC and required-module startup checks pass with the user-approved
22.11.0 Debian Trixie image. Basic Compose/API/SIP/RTP/CDR calling passes;
broader service acceptance remains pending.
No Git-related tasks are authorized. Ask before resolving an ambiguous requirement.
This root checklist tracks this task, not unrelated PBX or application work.

## Working agreement

- Do not commit, push, merge, or sync this work.
- Keep this file uncommitted; do not stage it. Uncommitted does not mean
  ignored by Git or private from other Delta participants.
- Planning is complete; schema, seed, and required realtime configuration
  changes are authorized. User explicitly authorized tests/builds and test
  container startup. Git-related tasks remain prohibited.
- Do not reset existing data or remove volumes. Later validation must use a
  separate, disposable database/Compose project.
- Backend/frontend adaptation is now authorized, limited to schema-induced
  compatibility breaks. Report before ambiguous behavior/schema decisions.
- Keep standalone behavior unchanged. Its module include placeholder is shared
  plumbing requested during review, not a new standalone module policy.

## Sources and confirmed decisions

### Backend/frontend compatibility follow-up

- Dashboard login accounts mean administrators, not employees/SIP callers.
  Administrators are deleted, not disabled. Employee telephone provisioning
  and SIP credentials remain separate from dashboard access.
- [x] Remove unsupported extension active/off display and request fields.
  API create/update explicitly reject `is_active` instead of silently ignoring it.
- [x] Adapt extension CRUD to native PJSIP tables and string endpoint IDs.
  Transactional native provisioning, blank-secret preservation, existing-mailbox
  linking, shared/external auth/AOR protection, and independent-route preservation.
  Endpoint IDs are immutable. UI uses string-safe event handlers and pagination.
  See `backend/README.md` for API contract and reproduction commands.
- [x] Simplify new extension creation: display name, numeric extension/SIP login,
  SIP password, and optional voicemail with an editable `0<number>` PIN/email.
  SIP objects, mailbox, and initial routing commit together; existing data is
  never overwritten. Test with/without voicemail and reject conflicts atomically.
- [ ] Accept the new creation flow in a real browser and verify busy/no-answer/
  unregistered-phone voicemail greetings, deposit, and PIN login on a live PBX.
- [x] Adapt dialplan, voicemail, queues/members, and dashboard queries.
  Native keys/columns, yes/no mailbox options, blank-PIN preservation, string
  queue IDs, and executable dialplan arguments are supported. Nginx proxies
  same-origin API calls independently of the configured host UI port.
- [ ] Rework the Dialplan interface: organize related routes and their ordered
  steps clearly instead of presenting everything as an undifferentiated list.
  Deferred at the user's request; no interface changes in this pass.
- [x] Enforce administrator-only dashboard/API access; remove administrator
  disable controls. Do not introduce employee dashboard accounts.
  Deleted admin JWTs are rejected; operators cannot access protected APIs.
- [ ] IVR schema proposal awaits approval: application menu/route records
  plus ownership of generated native dialplan steps, updated transactionally.
  No IVR schema changes authorized yet.
- [x] Validate adapted API/UI against disposable initialized PostgreSQL.
  Twelve API/database integration tests pass with demo off and twelve on.
  Extension and native PBX page DOM/API harnesses pass (not real browsers).
  Full disposable Compose builds/startup, Nginx login/provisioning, two SIP digest
  registrations, API-created call routes, bidirectional RTP, and answered CDR
  API retrieval pass with demo off and on. See `backend/README.md`.
  Real-browser clicks, LAN/NAT phones, and other telephony services remain untested.
  IVR builder is explicitly unavailable pending its schema design; native IVR
  execution/dialplan inspection are not disabled.

- [x] Read the TP docx:
      `/home/gomboc/Documents/TP_Projet_Appliance_Asterisk.docx`.
- [x] Read the earlier proposal:
      `/home/gomboc/Projects/references/asterisk/MODEL_DECISION.md`.
      Treat it as an unverified proposal, not the requirements authority.
- [x] Inspect the current schema, realtime configuration, Compose definition,
      backend SQL dependencies, and standalone demo configuration.
- [x] TP requirements include PJSIP, numbering/dialplan, voicemail, queues,
      IVR, conferences, and CDR. IVR/conferences cannot simply be discarded.
- [x] Backend compatibility may break. Prefer a usable, simple PBX schema over
      preserving the existing API-shaped tables.
- [x] Fresh initialization creates the schema and one default administrator,
      with no provisioned PBX/demo objects unless demo mode is enabled.
- [x] Demo data should resemble `asterisk/conf/standalone`: extensions 100–599,
      department queues, personal/shared mailboxes, and routing behavior.
- [x] Container restarts are not schema migrations: the PostgreSQL volume
      persists, and entrypoint init scripts run only on an empty data directory.
      This task targets fresh initialization, not conversion of old records.

## Corrections to the earlier proposal

- [x] Compose already defines an Asterisk service.
- [x] Realtime family names can map to different physical table names;
      consumer-compatible fields matter, not an obligatory table name.
- [x] Correct the original file-only dialplan: realtime now fetches executable
      steps from PostgreSQL through `pbx_realtime`.
- [x] Correct the original contact mapping gap: contacts now have a Sorcery
      realtime mapping as well as the extconfig family.
- [x] Do not claim every realtime update needs a reload. Verify behavior for
      each consumer and any configured caches.
- [x] Adaptive ODBC CDR needs `alias start => calldate` if `calldate` is used.
- [x] Upstream warns against dynamic realtime dialplan as a general best
      practice; compare it with static routing plus database lookups before
      choosing the integration.
- [x] Document the supported schema as a subset derived from the original
      `certified-22.8-cert4` migrations, not a "full Asterisk 22 schema".
      Runtime pin later changed to regular 22.11.0. ODBC/basic call checks pass;
      a complete field/type audit against 22.11.0 remains.
- [x] Retain the existing temporary admin hash. A standalone hash-match check
      was declined; subsequent normal API/Compose login as admin/admin123 passes.

## Scope boundary

This task implements database initialization, optional seeding, Asterisk
ODBC/configuration and the subsequently authorized frontend/backend compatibility
work needed for basic calling. The TP defines project requirements; it does not
make this task a full appliance rewrite.

| TP concern                          | Scope for this task                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| SIP extensions and registration     | PJSIP config tables, runtime contacts, ODBC/Sorcery integration                              |
| Dialplan and numbering              | Working DB-backed routing contract; restrictions/forwarding/transfers considered in design   |
| Voicemail                           | Realtime mailbox configuration; message files stay in persistent spool storage               |
| Queues and agents                   | Realtime queue/member configuration and queue dialplan destinations                          |
| IVR                                 | Verified executable routing model; no inert tables presented as working realtime             |
| Conferences                         | Verified ConfBridge integration; do not assume the old `conferences` table is consumed       |
| CDR                                 | Adaptive ODBC writes, actual call timestamps, call linkage, reporting fields                 |
| Users and administration            | Admin-only dashboard, account deletion, audit and independent SIP provisioning; no disable workflow |
| Live supervision / queue statistics | Document DB versus AMI/ARI/event responsibilities; no monitoring implementation              |
| Music on hold and backup            | Document filesystem/config dependencies; no upload or backup UI implementation               |
| Backend/frontend                    | Native-schema compatibility and tested basic calling; IVR builder design remains pending     |

## Design and implementation decisions

- [x] Identify the schema source matching the original image's Asterisk version:
      upstream tag `certified-22.8-cert4` (tag object
      `0524070ebacd46fc22b5002efaa6b11bef5482d6`).
      Source commit: `604dc657cb4fec1e792da9f57a2784dc33946385`.
      Hand-consolidated plain SQL from selected `contrib/ast-db-manage/`
      migration fields; no generation tooling or runtime Alembic dependency.
      The approved runtime is now regular 22.11.0; retain this provenance
      rather than claiming the SQL was rederived from the newer release.
- [x] Specify tables, keys, indexes, allowed values, and read/write ownership
      in `db/init/001_schema.sql` and `db/README.md`. Application associations
      live in `user_endpoints`, not extra PJSIP option columns.
- [x] Choose dynamic realtime dialplan steps for the direct-write small-PBX
      contract; document DB lookup/availability cost and upstream's preference
      for static logic plus data abstraction in production.
- [ ] Verify IVR and ConfBridge support in the pinned release and image.
      Source supports Read/dialplan branching and CONFBRIDGE dynamic profiles;
      implementation is present and required modules load. Service-call
      execution, prompts, PINs, invalid/timeout branches and capacity remain untested.
- [x] Keep the optional app-only admin/endpoint association separate from
      native PJSIP options. It has no current management UI/API.
- [x] Remove unsupported endpoint disable controls rather than inventing an
      Asterisk `is_active` setting. Admin accounts are deleted, not disabled.
      Archival/revocation/re-enable is a possible future design, not an accepted
      requirement of this compatibility pass.
- [x] Use numeric branches; preserve static tests and department contexts;
      ring multiple contacts with an empty-contact guard. IVRs share a fixed
      context with menu-specific extension names, avoiding per-menu config.
- [ ] Verify module availability/load order, ODBC classes, Sorcery mappings,
      queue option names, mailbox lookup semantics, and CDR column mapping.
      Source/config review done; actual installed modules and ODBC types
      were checked in initial validation. All required modules load on the
      approved 22.11.0 image. Requirements are in realtime/modules_custom.conf.
      The original certified image stayed running after a required-module failure;
      do not assume exit 2 or treat process health as module readiness.
- [x] Document lookup/caching behavior and active-session limitations in
      `db/README.md`; do not promise instant changes/revocation.
- [x] Document files/integration and backend provisioning/breaking changes in
      `db/README.md` and `backend/README.md`. Backend/frontend native-schema
      adaptation is now implemented and separately tested.
- [x] Apply base-first module inclusion: shared `modules.conf` includes the
      mode's `modules_custom.conf`; standalone has a comment-only placeholder.
      Add explanatory comments for module, family, Sorcery, and CDR mappings.
- [x] User approved proceeding with this checklist in the current worktree,
      later authorizing builds/tests and disposable containers. Ask about
      ambiguity; Git tasks remain prohibited.

### Implemented integration and acceptance boundary

- Use one native realtime dialplan table for routing, IVR steps, and
  `ConfBridge()` calls, rather than separate IVR/conference tables that no
  Asterisk consumer reads.
- Conference options/PINs can be applied by DB dialplan steps using
  `CONFBRIDGE()`; shared defaults remain in the realtime configuration overlay.
  Confirmed in upstream documentation/source; required modules load.
  Conference calls and runtime options remain untested.
- Dynamic realtime steps fit the requested direct-write database contract but
  depend on `pbx_realtime` and add database lookups during call execution.
  Static helpers plus database lookups are the alternative if that module is
  absent; do not silently change the image pin or integration architecture.

## Initialization and demo contract (implemented and tested)

- [x] Separate schema, always-on administrator seed, and optional demo seed.
- [x] Use `DEMO_DATA=no` by default; explicitly enable with `DEMO_DATA=yes`
      in the root `.env`, passed through Compose to PostgreSQL.
      Only exact `yes` enables seeding; all other values skip, per user feedback.
- [x] Demo selection affects first initialization only. Changing `.env`
      must not silently delete, replace, or reseed an existing database.
- [x] Seed demo objects in a transaction with clear failures.
- [x] Insert directly into native tables without department/demo helper tables.
      Inline seed values define the example ranges; contexts define routing,
      queue membership defines agents, and mailbox contexts provide namespaces.
- [x] Match standalone: 500 endpoint/auth/AOR sets, 500 personal mailboxes,
      five shared department mailboxes, five queues, and 500 queue members.
- [x] Preserve the department routing and services 010–014, 020, and 021.
      Preserve static test numbers 000–004.
- [x] Do not seed fake registrations, CDRs, or extra administrator accounts.
- [x] Identify TP-only additions separately: IVR 030 (stock digit prompts,
      then collect one digit); conference 040 (PIN 0040, 20-participant limit).
- [x] Document default credentials and one replacement-before-exposure note.
      Keep SIP credentials distinct from UI hashes; avoid repetitive warnings.

## Generality and validation status

Approved networking adjustments are applied. User subsequently authorized
tests/builds and test container startup; initial results are recorded below.

- [x] Review the general provisioning contract: `DEMO_DATA` selects initial
      records only, never runtime capabilities or a different schema.
      Identify any baked demo-specific contexts or names, and distinguish
      reusable routing hooks from configuration that restricts new provisioning.
      Five department contexts are intentionally retained per user decision;
      basic non-demo provisioning succeeds through the same tables/runtime.
- [ ] Define a non-demo example provisioned after demo-off initialization:
      two endpoints outside 100–599, a mailbox, a queue with explicit members,
      an IVR, and a conference. All must use the same native tables and general
      configuration; no demo flag or demo-specific seed dependencies.
      API-created 7001/7002 calls pass; mailbox/queue CRUD passes. Complete
      non-demo telephony service examples and call acceptance remain.
- [x] Prepare and execute disposable validation with explicit database/container
      names, isolated storage/networking/ports, expected assertions, and cleanup
      limited to resources created for that plan. Do not use existing volumes
      or compete with an already running PBX.
      Deployment constraint: Asterisk uses host networking; PostgreSQL and
      application services use `appnet`. Asterisk reaches PostgreSQL through a
      host-published port, not Docker service-name DNS. Application services
      use the PostgreSQL service name and container port on `appnet`.
      Plan a loopback-bound published DB port where supported; confirm actual
      host/container platform and existing port usage before execution.
      User confirmed no PBX port-conflict blocker and that development volumes
      are disposable. Keep the host DB port defined by `POSTGRES_HOST_PORT` in
      `.env`; do not infer permission for blanket volume deletion.
- [x] Execute the agreed stages: initialization/guards first, image/modules
      and ODBC second, then registration/calling and general provisioning.
      Ask before changing the image or architecture if required modules are absent.
- [x] Record passed checks and untested boundaries in all guides/checklists.
      Do not turn hypothetical disable/re-enable or broader TP workflows into
      prerequisites silently added to this task.
- [ ] Organize the environment-variable contract and `.env.example`: group
      settings by purpose, explain host-published versus container ports,
      identify shared versus mode-specific variables and consumers, and review
      duplicate/unused names. Do not copy secrets from the local `.env` into
      documentation or tracked files. Actual env-file reorganization is deferred.

### Networking and context decisions (implemented)

- Compose already sets host networking for Asterisk and overrides its DB port
  with `POSTGRES_HOST_PORT`; `.env.example` already defines that variable.
- [x] Declare project-scoped bridge `appnet` and attach PostgreSQL, backend,
  and frontend explicitly. Asterisk remains on host networking without a
  `networks` attachment. Full-stack runtime checks pass.
- [x] Bind PostgreSQL's published port to `127.0.0.1`, retaining the env-defined
  `POSTGRES_HOST_PORT`. Asterisk uses that host port; appnet services use the
  container port. Full-stack runtime checks pass.
- No runtime config branches on `DEMO_DATA`; example queue/IVR/room names are
  confined to the seed. Five department-named handler contexts remain declared
  in the realtime overlay. User rejected the proposed generic service-context
  refactor: retain the existing routing organization and seed unchanged.
  New arbitrary DB contexts still require a static declaration; this is an
  acknowledged configuration boundary, not a pending refactor.
  Routing and seed data remain unchanged by the networking adjustment.

## Validation / acceptance (execution authorized)

- [x] Initialize isolated fresh databases with demo off and demo on.
      Assert one admin in both; no provisioned PBX objects with demo off.
- [x] Verify non-`yes` DEMO_DATA values skip, both sourced/executed shell entry,
      demo rerun failure without overwrites, and SQL error rollback.
- [ ] Assert schema, constraints, indexes, seed counts, and references.
      Counts, representative domain/check/FK rejection, no helper tables, and
      runtime indexes pass. Exhaustive type/reference/consumer checks remain.
- [x] Restart PostgreSQL; confirm persisted objects and no repeated seeding.
- [x] Build realtime image and verify ODBC connectivity. Host-network `isql`
      queries pass; Asterisk reports one active connection; adaptive CDR backend
      is registered. All required modules now report Running on 22.11.0.
- [x] Resolve missing `pbx_realtime.so` via a user-approved image/build decision.
      User selected `22.11.0_debian-trixie-amd64` with digest
      `sha256:887595176c64d3bc10387f198b6248347cb5a91969f377b1b64641aeaf11acea`.
      Removed the abandoned compilation stage; use the base image's module.
      Routing and module requirements remain unchanged.
- [ ] Investigate required-module fail-closed behavior: image logs failure but
      stays running. Runtime tests now assert actual required-module state.
- [ ] Resolve observed MOH path/no-files warning, deprecated `random=yes`,
      optional Vorbis module's missing library, and voicemail silence warning.
- Extra volume naming dropped at user request. Leave Compose mounts unchanged
  and do not introduce a persistent config volume. Removed test-only overrides
  for inherited Asterisk volumes; retain existing named DB volumes and scoped
  cleanup, including removal of test containers' anonymous volumes.
- [x] Register two synthetic SIP peers through digest authentication; successful
      calls use Asterisk-managed contacts. Human softphone/LAN checks remain.
- [x] Provision endpoints and call routes through the API after startup and
      call without a reload or editing Asterisk files.
- [x] Exercise basic internal calling with bidirectional loopback PCMU RTP and
      answered CDR visible through the API, with demo disabled and enabled.
      Fixed adaptive ODBC identifier quoting for PostgreSQL's reserved `end`;
      fixed init health-check race by waiting for the final TCP server.
- [ ] Exercise remaining services: voicemail, queue delivery/overflow, IVR,
      conference entry, and detailed CDR timestamps/linkage. Basic internal
      calling and answered CDR retrieval already pass.
- [ ] Exercise relevant transfer/forwarding/restriction paths when provisioned,
      and loss/recovery of database connectivity. Disable/re-enable is not
      implemented or required for this pass.
- [ ] Confirm standalone behavior is unchanged.
- [x] Document checks actually run, limitations and compatibility boundaries.
      See `README.md`, `asterisk/README.md`, `db/README.md`, `backend/README.md`
      and `asterisk/TODO.md`. DB/init/runtime checks, API integration, Node
      page harnesses and full Compose calling checks have passed.
      Normal configured images were also built. Test projects/storage were
      separate; pre-existing volumes were not reset. No Git commands.
- [ ] Audit the complete supported schema subset against regular 22.11.0;
      basic call success is not exhaustive field/type/consumer validation.
- [ ] Test real-browser page flows and human softphones across LAN/NAT.
- [ ] Add live active-call tracking through AMI (planned, not implemented):
      - Provide private connectivity from the appnet backend to host-network PBX
        AMI; current host-loopback binding is not reachable as backend localhost.
      - Use least-privilege read-only AMI credentials, kept server-side.
      - Take an initial channel/bridge snapshot, follow call events, and
        resynchronize after reconnects; group related channels into calls.
      - Expose caller, destination, ringing/answered state, and duration through
        an authenticated backend API; start with frontend polling every few seconds.
      - Distinguish unavailable monitoring from zero active calls; do not infer
        live state from completed-call CDRs.
      - Test multi-channel calls, hangups, reconnects, and stale-state recovery.
- [ ] Implement live AMI/ARI monitoring and broader TP management/backup work
      only as separately scoped features. Current statistics do not claim live
      call counts or reachability.
