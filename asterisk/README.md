# Asterisk PBX guide

This directory owns the PBX image, baked configuration, runtime templating and
PBX-only tooling. Use the [root guide](../README.md#quick-start) for the full
Compose stack and [the API guide](../backend/README.md#start-and-make-a-call)
for dashboard provisioning and a calling example.

## Contents

- [Image and layout](#image-and-layout)
- [Configuration ownership and modes](#configuration-ownership-and-modes)
- [Runtime environment](#runtime-environment)
- [Networking and storage](#networking-and-storage)
- [Realtime integration](#realtime-integration)
- [Running and inspecting](#running-and-inspecting)
- [Firewall helper](#firewall-helper)
- [Validation and remaining work](#validation-and-remaining-work)

## Image and layout

The approved base is Certified Asterisk **22.8-cert4 on Alpine 3.24 amd64**:

```text
andrius/asterisk:22.8-cert4_alpine-3.24-amd64@sha256:ff8cf9fca1d24633566873f918f37ef35b2a245a69d7c75fa8da6953d15639ca
```

Compose and the PBX Makefile construct `BASE_IMAGE` from the root `.env`
image/tag/digest settings. The Dockerfile has the same fallback pin.
This base includes ODBC modules but **does not supply `pbx_realtime.so`**:
database-backed dialplan switching remains blocked. No compilation or foreign
binary modules are added. Earlier validation below describes the previous image,
not validation of this Alpine pin.
The Dockerfile installs PostgreSQL ODBC, OpenSSL, core GSM prompts and WAV hold
music using `apk`, exposing media at the existing persistent volume paths.

```text
Dockerfile
Makefile
README.md
TODO.md
conf/
  base/          Shared transports, modules, test dialplan, RTP/HTTP settings
  standalone/    Static department endpoints, mailboxes, queues and dialplan
  realtime/      ODBC/Sorcery mappings and service configuration
  scripts/       entrypoint-wrapper.sh and firewall.sh
```

`make samples` can extract the base image's `/etc/asterisk` into `conf/samples/`
for reference. That directory is not currently part of this workspace and is
never copied into the appliance image. Asterisk source is not vendored.

## Configuration ownership and modes

| Concern | Source / update behavior |
| --- | --- |
| Shared infrastructure | `conf/base/`, baked into the image |
| Mode-specific settings | `conf/standalone/` or `conf/realtime/`, copied after the base |
| Realtime provisioning | PostgreSQL native endpoint, auth, AOR, dialplan, mailbox and queue tables |
| Runtime values | Root env, rendered by `conf/scripts/entrypoint-wrapper.sh` |
| Persistent state | PostgreSQL data, AstDB, voicemail/spool, keys, media and logs |

`ASTERISK_MODE` selects the build overlay, not a runtime conversion between
static and database configuration. Rebuild when switching modes.

| Mode | Phone/routing source | Start path |
| --- | --- | --- |
| `realtime` | PostgreSQL native tables via ODBC | Root `docker compose up --build` |
| `standalone` | Static files, including extensions `100–599` | PBX-only Makefile with `ASTERISK_MODE=standalone` |

Standalone needs no database. Dashboard DB edits do not affect its static phones.
Its static services include queues `010–014` and voicemail `020/021`.
The realtime demo uses corresponding database records and adds IVR `030` and
conference `040`; these two additions are not standalone equivalents.

Base `modules.conf` loads first and includes `modules_custom.conf` at its end.
Realtime appends explicit required modules; standalone supplies a comment-only
placeholder. Declaring a module does not install it or prove that it loaded.

Both modes retain these **static test numbers**, ahead of DB routes:

| Number | Purpose |
| --- | --- |
| `000` | Echo |
| `001` | `hello-world` playback |
| `002` | DTMF collection/readback |
| `003` | Record/playback |
| `004` | Music on hold |

These are configured capabilities, not a claim that every test has been exercised
on the current image.

## Runtime environment

The wrapper validates required settings, renders the following files, then
executes `/usr/local/bin/entrypoint.sh` with the original container command.

| Setting | Effect |
| --- | --- |
| `SIP_PORT` | UDP PJSIP transport bind |
| `RTP_RANGE` | `rtpstart` / `rtpend` |
| `HTTP_PORT`, `WSS_PORT` | HTTP bind and TLS/WSS bind |
| `PBX_FQDN` | Container hostname in Compose/Makefile and generated certificate CN/SAN |
| `PUID`, `PGID` | Ownership of generated TLS files, not a general process UID/GID switch |
| `AMI_PASSWORD` | Nonempty writes AMI config with a `backend` user, bound to loopback on 5038 |
| `ARI_PASSWORD` | Nonempty writes ARI config; empty AMI/ARI passwords leave those services disabled |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Required for realtime ODBC rendering |

TLS/WSS is **enabled in configuration**, not commented out. The wrapper creates
a self-signed certificate when absent, using `PBX_FQDN`, `localhost` and
`127.0.0.1` SANs. It does not regenerate an existing certificate on identity/IP
changes. WebRTC calling and remote certificate trust still need acceptance.
Setting AMI/ARI credentials does not implement backend supervision.

## Networking and storage

The supported/tested deployment uses rootful Linux Docker and
`network_mode: host` for Asterisk. There are no PBX Compose port mappings:
listeners bind directly on the host. Rootless/Docker Desktop host-network
behavior has not been validated.

| Setting / example port | Protocol | Purpose |
| --- | --- | --- |
| `SIP_PORT=5060` | UDP | SIP signaling; no plain TCP SIP transport configured |
| `RTP_RANGE=10000-10199` | UDP | Media |
| `HTTP_PORT=8088` | TCP | Asterisk HTTP / ARI when enabled |
| `WSS_PORT=8089` | TCP | TLS HTTP / WSS |
| `5038` | TCP loopback | AMI when enabled |

PostgreSQL/backend/frontend use `appnet`. Compose overrides Asterisk's DB host
to `127.0.0.1` and port to `POSTGRES_HOST_PORT`, published loopback-only.
The backend instead uses `postgres:5432`. Do not use Docker service-name DNS
from host-network Asterisk. LAN/NAT clients need firewall and media-address
configuration; public-IP/local-net settings are not provisioned automatically.

Compose has project-scoped named volumes for PostgreSQL and Asterisk's:

- `/var/lib/asterisk` (including AstDB);
- `/var/lib/asterisk/keys`, `/sounds`, and `/phoneprov`;
- `/var/spool/asterisk`;
- `/var/log/asterisk`.

There is no persistent `/etc/asterisk` mount: configuration stays image-owned
and runtime-rendered. The base image can create inherited anonymous volumes;
disposable tests remove those with their containers. Named volumes survive
normal `docker compose down`. Existing media volumes can mask newer image
content, so rebuilding does not necessarily refresh their files.

## Realtime integration

ODBC uses a DSN and class, not a PostgreSQL connection URI:

| File | Role |
| --- | --- |
| `/etc/odbcinst.ini` | PostgreSQL Unicode driver registration, discovered at build time |
| `/etc/odbc.ini` | Runtime DSN `asterisk-pgsql` |
| `/etc/asterisk/res_odbc.conf` | Runtime ODBC class `asterisk`, credentials and connection options |
| `conf/realtime/sorcery.conf` | Native PJSIP object mappings, including writable contacts |
| `conf/realtime/extconfig.conf` | Realtime dialplan/mailbox/queue families |
| `conf/realtime/cdr_adaptive_odbc.conf` | CDR writes, start-to-calldate alias, UTC and quoted identifiers |

Fresh initialization is in `../db/init/`. The schema is a hand-consolidated
simple-PBX subset derived from `certified-22.8-cert4` upstream migrations;
it has not been fully rederived/audited against every 22.11.0 field.
Basic native provisioning/registration/calling/CDR now pass on 22.11.0.
See [schema provenance](../db/README.md#schema-source-and-deliberate-differences).

With demo off, only one administrator is seeded; no PBX objects are provisioned.
Exact `DEMO_DATA=yes` adds the documented dataset on first initialization only.
The flag does not select different runtime capabilities. Existing volumes are
neither migrated nor reseeded.

Dynamic dialplan steps use `switch => Realtime/@` in `internal`, the five
department `handle-*` contexts and `realtime-ivr`. Those contexts remain as
agreed; arbitrary new contexts need a static declaration. DB routes contain
the IVR branching and `CONFBRIDGE()`/`ConfBridge()` steps; actual service-call
acceptance remains. The managed IVR builder is unavailable pending its design,
but it does not disable execution of existing dialplan.

CDR writes alias `start` to `calldate` and quote identifiers because PostgreSQL
reserves `end`. Compose waits for PostgreSQL's final TCP server before starting
Asterisk, preventing CDR metadata discovery during temporary initialization.
Mailbox settings are realtime; message audio remains in the spool.

The tested endpoint/route creation path works without a reload. Do not infer
instant revocation, live-call termination or uniform queue/mailbox refresh from
that result. See [updates and caches](../db/README.md#updates-and-caches).

## Running and inspecting

For the full stack, run from the repository root:

```sh
docker compose up --build
docker compose exec asterisk asterisk -rx "core show version"
docker compose exec asterisk asterisk -rx "pjsip show endpoints"
docker compose exec asterisk asterisk -rx "odbc show all"
docker compose exec asterisk asterisk -rx "cdr show status"
docker compose logs -f asterisk
```

For PBX-only standalone development, set root `.env` to
`ASTERISK_MODE=standalone`, then:

```sh
make -C asterisk build
make -C asterisk up
make -C asterisk test
make -C asterisk cli
make -C asterisk down
```

Do not run the PBX-only container beside the host-network Compose PBX. Register
`100` / `100pass` and `101` / `101pass` for a static department example;
the old `1001/1002`, `999` and `600` examples are not the current standalone setup.
Standalone regression on the new image is still pending.

| PBX-only target | Behavior |
| --- | --- |
| `help`, `env`, `check-pin` | List targets, bootstrap missing root env, report pin drift |
| `pull`, `samples` | Pull pin or extract reference configuration |
| `build`, `build-standalone`, `build-realtime` | Build selected overlay |
| `up` | Standalone lifecycle; realtime prints a hint to start the root stack |
| `down`, `rm`, `restart`, `recreate`, `rebuild` | PBX-only lifecycle; named state volumes retained |
| `logs`, `ps`, `cli`, `shell`, `rtp-check`, `test` | Inspect the Makefile-managed container, not Compose's service container |
| `firewall`, `firewall-off`, `firewall-status`, `run` | Explicit host firewall helpers; `run` applies firewall then `up` |
| `clean` | Destructive development cleanup: removes container, built mode images and this mode's named volumes |

The CLI smoke target inspects status/configuration; it does not place calls or
replace the Python/Node/full-stack tests.

## Firewall helper

`conf/scripts/firewall.sh` is invoked explicitly by the PBX Makefile, not by
`docker compose up`.

- `FIREWALL_ENABLED=no`: on/off leave host firewall rules untouched.
- `FIREWALL_MODE=runtime`: add ports to active non-Docker firewalld zones;
  changes disappear on reload/reboot.
- `FIREWALL_MODE=permanent`: maintain the named `FIREWALL_POLICY` with
  ingress `ANY`, egress `HOST`, target `CONTINUE`, priority `-100`. Applying or
  removing it can reload firewalld.
- The helper opens configured SIP/RTP UDP and HTTP/WSS/dashboard TCP ports.
  It still uses `DASHBOARD_PORT`, while Compose publishes `FRONTEND_HOST_PORT`;
  keep those aligned until environment cleanup.
- Without firewalld, use `FIREWALL_ENABLED=no` and arrange equivalent host/cloud
  rules separately. Azure NSG/ufw validation remains.

Older development notes reported permanent `nm-shared` zone openings alongside
the policy. Their current host state has not been rechecked. Inspect active
zones/policy and test hotspot registration before deliberately removing
redundant rules; do not assume the helper cleans legacy entries.

## Validation and remaining work

Passed on the approved image:

- Realtime image build, real host-network ODBC queries, active Asterisk ODBC
  connection, adaptive CDR registration and required modules Running.
- Fresh initialization/seed guards/rollback/persistence.
- Disposable full Compose stacks with demo off/on: same-origin login,
  API-created endpoints/routes, two digest registrations, internal calling,
  bidirectional loopback PCMU RTP and answered CDR API retrieval.

Reproduce using [database tests](../db/README.md#validation-results) and
[full-stack tests](../backend/README.md#validation). Test PBXs bind real host
ports; do not run them alongside another PBX.

Remaining findings:

- Process/container health is not proof of required-module readiness. The
  original image stayed running after a required-module failure; fail-closed
  behavior still needs investigation.
- MOH reports no files at its configured path; packaged WAV files exist
  elsewhere. `random=yes` also needs review against `sort=random`.
- Optional Vorbis format loading lacks `libvorbisenc.so.2`.
- Voicemail silence settings emit a warning.
- LAN/NAT phones, real-browser clicks, voicemail/queue/IVR/conference calls,
  detailed CDR semantics, outage recovery and standalone regression remain.

See [TODO.md](TODO.md) for PBX-specific remaining work.
