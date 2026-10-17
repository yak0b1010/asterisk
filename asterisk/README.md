# Guide

<!--toc:start-->

- [Guide](#guide)
  - [Purpose](#purpose)
  - [Base Image](#base-image)
  - [Directory Layout](#directory-layout)
  - [How It Works](#how-it-works)
  - [Operating Modes](#operating-modes)
  - [Configuration Layout](#configuration-layout)
  - [Base Operation](#base-operation)
    - [Ports](#ports)
    - [Volumes](#volumes)
    - [Environment](#environment)
  - [Runtime Templating](#runtime-templating)
  - [PostgreSQL Realtime (ODBC)](#postgresql-realtime-odbc)
  - [Makefile Targets](#makefile-targets)
  - [Testing The PBX](#testing-the-pbx)
  - [Networking Notes](#networking-notes)
  - [Common Operations](#common-operations)

<!--toc:end-->

## Purpose

This directory owns everything specific to the PBX: the image definition, the
configuration baked into it, the runtime templating, and the tooling around them.

Asterisk's source tree is _not_ vendored here. Tracking it is inconvenient and
unnecessary, so configuration samples are extracted from the base Docker image
instead of cloned from the upstream repository. Everything that ships to production is
authored in `conf/`.

## Base Image

| Field   | Value                                                                     |
| ------- | ------------------------------------------------------------------------- |
| Image   | `andrius/asterisk`                                                        |
| Tag     | `22.8-cert4_debian-trixie-8d9e955`                                        |
| Digest  | `sha256:f3bd01300f0c36c8a7ea5bd9472c4b906d0f85410c3ea429166a0fedac6ad3ee` |
| Base OS | Debian Trixie                                                             |
| Version | Certified Asterisk 22.8-cert4 (LTS, security-fix branch)                  |

The values live in the root `.env` and are injected as a single `--build-arg BASE_IMAGE`.
Pinning by digest is required: the tag alone can be re-pointed upstream by a rebuild.
_If there is a contradiction between the `.env` and this table, the `.env` wins._

## Directory Layout

```txt
asterisk/
├── Dockerfile            # Layers on the pinned base image
├── Makefile              # PBX-only targets (build/run/verify)
├── TODO.md               # Outstanding PBX work
├── scripts/
│   └── entrypoint-wrapper.sh   # Runtime templating, then base entrypoint
└── conf/
    ├── base/             # Always baked (transports, modules, rtp, http)
    ├── standalone/       # Mode overlay: static endpoints + dialplan
    ├── realtime/         # Mode overlay: sorcery/extconfig for PostgreSQL
    └── samples/          # Untouched upstream samples — reference only
```

`conf/samples/` is never copied into the image. It exists so a lost stanza can be
looked up in the version that matches the pinned build. Refresh it with `make samples`.

## How It Works

The `Dockerfile` uses the pinned base image and adds only what the base does not
provide:

1. `odbc-postgresql` — the base ships unixODBC but **not** the PostgreSQL ODBC driver,
   which realtime configuration requires.
2. Core sounds and music-on-hold — the base image is intentionally minimal and ships no
   prompts, so voicemail and IVR would be silent.
3. `conf/base/` plus exactly one mode overlay, baked into `/etc/asterisk`.
4. `scripts/entrypoint-wrapper.sh`, which renders runtime values before starting
   Asterisk and then defers to the base image's entrypoint.

Configuration is therefore split by ownership:

- **Baked** — transports, module list, RTP/HTTP settings, dialplan files. Immutable; a
  change means a rebuild.
- **Realtime** — endpoints, aors, auths, voicemail boxes, queues. Stored in PostgreSQL
  and written by the backend, not by files.
- **Runtime** — credentials, RTP range, ODBC DSN. Rendered at container start from the
  environment.
- **State** — `astdb`, voicemail audio, recordings, TLS keys, logs. Held in named
  volumes.

## Operating Modes

The mode is chosen by `ASTERISK_MODE` in the root `.env` and baked at build time
through `--build-arg MODE`.

|                   | `standalone`                            | `realtime`                       |
| ----------------- | --------------------------------------- | -------------------------------- |
| Database required | no                                      | yes                              |
| Baked overlay     | `conf/standalone/`                      | `conf/realtime/`                 |
| Endpoints         | `pjsip_endpoints.conf` (two test users) | `ps_endpoints` table via sorcery |
| Dialplan          | static `extensions_custom.conf`         | `switch => Realtime/@`           |
| ODBC files        | never created                           | rendered at start from `DB_*`    |
| Built by          | `make build-standalone`                 | `make build-realtime`            |
| Run by            | `make up` (this directory)              | `make -C .. up` (full stack)     |

`odbc show all` returning nothing in `standalone` mode is correct, not a fault.

## Configuration Layout

| File                                     | Mode       | Purpose                                           |
| ---------------------------------------- | ---------- | ------------------------------------------------- |
| `conf/base/asterisk.conf`                | both       | User/group and documentation language             |
| `conf/base/modules.conf`                 | both       | Autoload, ODBC preloads, disabled modules         |
| `conf/base/logger.conf`                  | both       | Console logging for `docker logs`                 |
| `conf/base/rtp.conf`                     | both       | Media range (rewritten at start) and ICE          |
| `conf/base/http.conf`                    | both       | HTTP/ARI on 8088, TLS/WSS block commented         |
| `conf/base/pjsip.conf`                   | both       | UDP transport, includes the mode file             |
| `conf/base/extensions.conf`              | both       | Dialplan general settings, includes the mode file |
| `conf/standalone/pjsip_endpoints.conf`   | standalone | Static endpoints `1001`, `1002`                   |
| `conf/standalone/extensions_custom.conf` | standalone | Dial/Echo/Playback test dialplan                  |
| `conf/realtime/pjsip_endpoints.conf`     | realtime   | Placeholder so the include resolves               |
| `conf/realtime/extensions_custom.conf`   | realtime   | Realtime dialplan switch                          |
| `conf/realtime/sorcery.conf`             | realtime   | Maps PJSIP objects to `ps_*` tables               |
| `conf/realtime/extconfig.conf`           | realtime   | Maps dialplan, voicemail and queues               |

Splitting is done through `#include` rather than file replacement, so the base layer is
identical in both modes and the overlay only adds what differs.

## Base Operation

### Ports

The base image exposes nothing (`ExposedPorts` is empty); ports are published by the
Makefile or the compose service.

| Port          | Protocol | Purpose                                       |
| ------------- | -------- | --------------------------------------------- |
| `5060`        | udp/tcp  | SIP signalling                                |
| `10000-10499` | udp      | RTP media — value comes from `RTP_RANGE`      |
| `8088`        | tcp      | HTTP / ARI                                    |
| `8089`        | tcp      | HTTPS / WSS (WebRTC softphone)                |
| `5038`        | tcp      | AMI — container network only, never published |

### Volumes

The base image declares six volumes. Not all are needed:

| Path                          | Contents                          | Required                   |
| ----------------------------- | --------------------------------- | -------------------------- |
| `/var/spool/asterisk`         | voicemail, recordings, call files | **Yes** — user data        |
| `/var/lib/asterisk`           | `astdb.sqlite3`, sounds, keys     | **Yes** — see note         |
| `/etc/asterisk`               | configuration                     | Only if written at runtime |
| `/var/log/asterisk`           | logs                              | Optional                   |
| `/var/lib/asterisk/sounds`    | prompts, music on hold            | Baked instead              |
| `/var/lib/asterisk/phoneprov` | phone auto-provisioning output    | No                         |

> The base declares `/var/lib/asterisk/{keys,phoneprov,sounds}` as volumes but _not_
> the parent, so `astdb.sqlite3` — which holds device states, hints, parking and DND —
> lives in the container layer and is lost when the container is recreated. Mount
> `/var/lib/asterisk` as a **named volume** so it is seeded from the image and
> survives. A bind-mount of an empty directory would hide the baked sounds.

### Environment

| Variable        | Default       | Purpose                          |
| --------------- | ------------- | -------------------------------- |
| `ASTERISK_MODE` | `standalone`  | Selects the baked overlay        |
| `RTP_RANGE`     | `10000-10499` | Written into `rtp.conf` at start |
| `AMI_PASSWORD`  | —             | Writes `manager.conf` when set   |
| `ARI_PASSWORD`  | —             | Writes `ari.conf` when set       |
| `DB_*`          | —             | ODBC DSN in `realtime` mode      |
| `ASTERISK_UID`  | `1000`        | UID the Asterisk process runs as |
| `ASTERISK_GID`  | `1000`        | GID the Asterisk process runs as |

Any container sharing configuration or state with Asterisk must run as `1000:1000`, or
writes fail with `EACCES`.

## Runtime Templating

`scripts/entrypoint-wrapper.sh` runs before the base entrypoint and only touches files
whose values come from the environment:

| Trigger                                  | Action                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `RTP_RANGE`                              | Rewrites `rtpstart` / `rtpend` in `rtp.conf` so the published UDP range always matches |
| `AMI_PASSWORD`                           | Writes a complete `manager.conf` with a `[backend]` user                               |
| `ARI_PASSWORD`                           | Writes a complete `ari.conf` with an `[asterisk]` user                                 |
| `ASTERISK_MODE=realtime` + `DB_PASSWORD` | Writes `/etc/odbc.ini` and `res_odbc.conf`                                             |
| `ASTERISK_MODE=standalone`               | Logs that ODBC is skipped and leaves no ODBC files behind                              |

The wrapper ends with `exec /usr/local/bin/entrypoint.sh "$@"` so the base image's own
initialisation (privilege drop, environment setup) still applies.

## PostgreSQL Realtime (ODBC)

Asterisk reaches PostgreSQL through ODBC, which is a two-level indirection — a **DSN**,
never a connection URI. A `postgresql://…` string appears only in the Go backend's
`DATABASE_URL`.

| File                           | Role                                      | Written by  |
| ------------------------------ | ----------------------------------------- | ----------- |
| `/etc/odbcinst.ini`            | Registers the psql ODBC driver            | Image build |
| `/etc/odbc.ini`                | Defines the DSN (`Servername = postgres`) | Entrypoint  |
| `/etc/asterisk/res_odbc.conf`  | Declares the ODBC class and credentials   | Entrypoint  |
| `/etc/asterisk/sorcery.conf`   | Maps PJSIP objects to `ps_*` tables       | Baked       |
| `/etc/asterisk/extconfig.conf` | Maps dialplan, voicemail and queues       | Baked       |

`res_odbc.conf`'s `dsn` must match a section name in `odbc.ini`, and the section name
in `res_odbc.conf` is the class referenced by `sorcery.conf` / `extconfig.conf` as
`odbc,<class>`.

Realtime tables come from Asterisk's own SQL (`contrib/realtime/postgresql/*.sql`,
`22` branch) and are applied by PostgreSQL's `docker-entrypoint-initdb.d` on the first
boot of an empty data volume. See `TODO.md` — those files are not in the repository yet.

## Makefile Targets

| Target                                | Description                                                           |
| ------------------------------------- | --------------------------------------------------------------------- |
| `help`                                | List targets                                                          |
| `env`                                 | Create the root `.env` from `.env.example` if missing                 |
| `pull`                                | Pull the digest-pinned base image                                     |
| `samples`                             | Re-extract the base image's `/etc/asterisk` into `conf/samples/`      |
| `build`                               | Build using `MODE` from `.env` (override: `MODE=realtime`)            |
| `build-standalone` / `build-realtime` | Build a specific mode                                                 |
| `up`                                  | Start the container (realtime prints a hint to use the root Makefile) |
| `down` / `rm` / `restart`             | Stop, remove, restart                                                 |
| `logs`                                | Follow container logs                                                 |
| `ps`                                  | Container status                                                      |
| `test`                                | Smoke test: version, ODBC modules, endpoints, RTP, dialplan           |
| `rtp-check`                           | Show the RTP range Asterisk actually bound                            |
| `cli` / `shell`                       | Asterisk console / shell in the container                             |
| `clean`                               | Remove built images and this mode's volumes                           |

## Testing The PBX

`standalone` mode ships two users and three test extensions:

| Extension | Behaviour                                 |
| --------- | ----------------------------------------- |
| `1001`    | Registered endpoint (password `1001pass`) |
| `1002`    | Registered endpoint (password `1002pass`) |
| `999`     | Echo test                                 |
| `600`     | Plays `hello-world`                       |

Register a softphone to `<host>:5060` as `1001`, dial `999` for an echo check, then
dial `1002` from a second client to place a real call. Headless alternative:
`sipp`/`sipsak` against `sip:1001@<host>`.

## Networking Notes

- **Rootful Docker (supported target)**: publish `5060` plus the RTP range, and set
  `external_media_address` to the host's reachable IP.
- **Rootless Docker**: publishing thousands of UDP ports spawns one userland proxy per
  port and fails. Keep `RTP_RANGE` in the low hundreds of ports, and note that
  `--network host` under rootless is _not_ the host network namespace.

## Common Operations

```sh
make env                       # create the root .env
make pull                      # refresh the pinned base image
make build-standalone          # build the standalone image
make up                        # start it
make test                      # smoke-test
make rtp-check                 # confirm the bound media range
make cli                       # Asterisk console
make down && make rm           # stop and remove

make samples                   # refresh conf/samples/ from the base image

docker exec asterisk-standalone asterisk -rx "core show version"
docker exec asterisk-standalone asterisk -rx "pjsip show endpoints"
docker exec asterisk-standalone asterisk -rx "odbc show all"
```
