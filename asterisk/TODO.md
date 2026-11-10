# PBX TODO

Keep this checklist aligned with PBX changes. It records implementation and
validation separately; a configured feature is not necessarily accepted.
No commit, push, merge, sync or other Git task is authorized in this thread.

## Completed implementation

- [x] Approved regular Asterisk 22.11.0 Debian Trixie amd64 digest pin.
  Dockerfile fallback and `.env.example` use the selected pin; the base supplies
  `pbx_realtime.so`. Abandoned module compilation removed.
- [x] Base-first configuration plus mode overlays. Shared `modules.conf`
  includes mode `modules_custom.conf`; realtime explicitly requires modules,
  standalone retains a placeholder.
- [x] UDP SIP transport plus configured WSS transport; no plain TCP SIP transport.
- [x] Runtime templating for SIP/HTTP/WSS ports, RTP range, ODBC and optional
  AMI/ARI credentials. TLS certificate generated when absent.
- [x] Native realtime PJSIP/contact, dialplan, mailbox and queue mappings.
  Static `000–004` tests and five department handler contexts retained.
- [x] Database IVR steps and dynamic ConfBridge example provisioning.
  This means implementation exists, not that service-call acceptance passed.
- [x] Adaptive ODBC CDR start alias, UTC timestamps and identifier quoting for
  PostgreSQL's reserved `end`.
- [x] Compose host-network Asterisk with hostname/runtime env and persistent
  state mounts; PostgreSQL/backend/frontend on explicit `appnet`.
- [x] Startup sequencing waits for PostgreSQL's final TCP server, not its
  temporary init server. Frontend waits for backend health.
- [x] Backend/frontend native-schema compatibility for SIP accounts, dialplan,
  mailboxes, queues/members, administrators and dashboard queries.
  Managed IVR builder is explicitly unavailable pending design approval.
- [x] Root `make up/down/logs/ps/build` use full-stack Compose. PBX-only targets
  remain separate; no missing backend/dashboard Dockerfile blocker remains.
- [x] PBX-only idempotent lifecycle and named state mounts are implemented.
- [x] Firewalld runtime/permanent helper and disabled mode are implemented.
- [x] README files describe actual static numbering, script paths, transport/
  TLS settings, Compose networking and firewall behavior.

## Validation completed

- [x] Realtime image builds; required realtime modules report Running.
- [x] PostgreSQL ODBC driver executes real queries over host networking;
  Asterisk has an active ODBC connection.
- [x] Fresh demo-off/on initialization, non-`yes` guards, transaction rollback
  and restart persistence checks pass.
- [x] Disposable full Compose startup and API login/provisioning pass.
- [x] API-created `7001/7002` accounts and routes work without reload.
- [x] Two digest registrations and internal call with RTP received in both
  directions pass on loopback, with demo disabled and enabled.
- [x] Answered CDR written through adaptive ODBC is retrieved through the API.

Commands/evidence are in [the database guide](../db/README.md#validation-results)
and [the API/calling guide](../backend/README.md#validation).
Earlier PBX-only lifecycle/firewall/transport checks were recorded before the
current image change; they are not a current standalone/firewall regression pass.

## Remaining acceptance

- [ ] Test real LAN/NAT softphones, signaling/media reachability and human audio.
- [ ] Verify voicemail deposit, playback, shared-mailbox login and PIN writes.
- [ ] Verify queue delivery, multiple agents, overflow, pause/penalty state and
  lookup/cache refresh behavior.
- [ ] Exercise IVR invalid/timeout/nested routes and conference PIN/capacity behavior.
- [ ] Check exact CDR start/answer/end, duration/billsec, UTC interpretation,
  linked IDs, failed calls and multiple legs.
- [ ] Exercise database loss/recovery and consumer cache/session behavior.
- [ ] Test transfer, forwarding and restriction routes when provisioned.
- [ ] Run standalone regression on the approved image using static `100–599`
  accounts and `000–004` tests. Do not use obsolete `1001/1002` examples.
- [ ] Establish operational readiness beyond container health: required modules,
  ODBC and actual routing. Investigate required-module failure not exiting.

## Known startup/configuration findings

- [ ] Fix MOH configured media path/no-files warning and deprecated `random=yes`.
- [ ] Resolve optional Vorbis module's missing `libvorbisenc.so.2`.
- [ ] Resolve voicemail `maxsilence` / `minsecs` warning.
- [ ] Verify base-image healthcheck meaning under host networking; do not equate
  `healthy` with required modules or call readiness.
- [ ] Reconcile image media updates with existing persistent sounds/lib volumes.
- [ ] Define NAT/public-IP/local-net configuration for remote deployment.
- [ ] Review standalone `from_domain`, `disable_multi_domain` and identity policy.
  Native `from_domain` exists in SQL but is not exposed by current endpoint CRUD.
- [ ] Regenerate TLS certificates when identity/IP SANs change; test remote WSS
  trust/calling. Current SANs include `PBX_FQDN`, localhost and 127.0.0.1.

## Remaining integration and operations

- [ ] Approve the managed IVR provisioning design before adding app tables or
  generated-dialplan ownership rules.
- [ ] Wire live AMI/ARI monitoring; credentials/config alone are not integration.
  Host-loopback AMI is not directly reachable as `localhost` from the appnet backend.
- [ ] Organize environment settings and reconcile `DASHBOARD_PORT` with
  `FRONTEND_HOST_PORT`; retain a clear host-port/container-port contract.
- [ ] Validate firewalld policy and hotspot behavior on the target host. Inspect
  previously reported legacy `nm-shared` entries before deliberate cleanup.
- [ ] Document/test equivalent ufw/cloud NSG rules; none were changed in this pass.
- [ ] Decide WSS/mobile requirements; no Flutter softphone exists in this workspace.
- [ ] Implement coordinated DB/spool/AstDB/media/keys/config backup and restore.
- [ ] For old PBX-only containers, apply hostname/image changes with deliberate
  recreation; `up` can warn without applying them.

Endpoint disable/re-enable and active-session revocation are **not** implemented.
The agreed compatibility pass removes unsupported disable controls rather than
pretending a database flag disables SIP. Any future revocation workflow needs a
separate design; it is not a prerequisite silently added to current acceptance.
