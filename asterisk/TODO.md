# TODO

<!--toc:start-->

- [TODO](#todo)
  - [Rule](#rule)
  - [1. Configuration](#1-configuration)
  - [2. Image](#2-image)
  - [3. Runtime](#3-runtime)
  - [4. Firewall](#4-firewall)
  - [5. Backend integration](#5-backend-integration)
  - [6. Verification](#6-verification)
  - [7. Documentation](#7-documentation)

<!--toc:end-->

Outstanding work for the PBX directory.

## Rule

- [x] **Keep this file current.** Every change under `asterisk/` updates the
      matching item here in the same commit. A PBX change is not finished
      until this file reflects what was done and what remains.

## 1. Configuration

- [x] **UDP-only SIP.** Removed `transport-tcp`; `transport-udp` and
      `transport-wss` remain. SIP/RTP firewall rules are UDP only.
- [x] **Ports from `.env`.** `entrypoint-wrapper.sh` templates `SIP_PORT`,
      `HTTP_PORT`, `WSS_PORT`, and `RTP_RANGE`; values no longer drift from
      the firewall.
- [ ] **Identity (`PBX_FQDN`).** Drives the container hostname and TLS CN.
      Still missing: `from_domain` on standalone endpoints,
      `disable_multi_domain`, and certificate SAN regeneration.
- [ ] **TLS SANs.** Certificate includes CN, localhost and 127.0.0.1 only.
      Add current host IPv4 SANs and a `.stamp` marker so a changed FQDN/IP
      set regenerates the cert.
- [ ] **AMI / ARI.** `AMI_PASSWORD` and `ARI_PASSWORD` are empty in
      `.env.example`; both services stay disabled until set.
- [ ] **RTP / NAT.** `PUBLIC_IP`, `external_media_address` and `local_net`
      are unset; required for clients behind NAT or non-host networking.
- [ ] **Realtime schema.** `realtime` mode has no `db/init` schema; tables are
      Alembic-managed in `contrib/ast-db-manage/`.
- [ ] **Realtime `from_domain`.** Add `ps_endpoints.from_domain` handling for
      PostgreSQL-backed endpoints.

## 2. Image

- [x] **Pinned base image.** `ARG BASE_IMAGE` matches `.env`; `check-pin`
      warns on drift.
- [x] **Mode overlays.** `conf/base` + `conf/standalone` or `conf/realtime`.
- [ ] **Dockerfile comment.** Line 11 has `ODBCARG MODE=standalone` fused into
      the comment; split it into two lines.
- [ ] **Healthcheck.** Confirm the base image still reports `healthy` with
      host networking.

## 3. Runtime

- [x] **Idempotent lifecycle.** `up` starts an existing stopped container,
      no-ops when running, creates when missing, recreates when dead.
      `restart` uses `docker restart`; `recreate` removes with `-v` and
      creates; `rebuild` builds then recreates.
- [x] **No name conflict.** `make up` no longer fails with
      `container name already in use`.
- [x] **Host networking.** `--network host`, `--hostname`, `--add-host`.
- [ ] **Hostname migration.** Existing containers created before
      `--hostname` need one `make recreate`; `up` only warns.

## 4. Firewall

- [x] **Stable firewalld policy.** `FIREWALL_MODE=permanent` creates
      `asterisk-appliance` with `ingress=ANY`, `egress=HOST`,
      `target=CONTINUE`, priority `-100`. Zone-independent.
- [x] **Temporary mode.** `FIREWALL_MODE=runtime` adds only to active zones;
      lost on reload/reboot.
- [x] **Kill switch.** `FIREWALL_ENABLED=no` makes `firewall`/`firewall-off`
      no-ops.
- [ ] **Legacy zone entries.** `nm-shared` still has permanent
      `5060/tcp 5060/udp 8088-8089/tcp 10000-10199/udp` from the earlier
      manual fix. Remove them after the policy is verified.
- [ ] **Azure / ufw.** Provide the NSG/ufw equivalent; on Azure set
      `FIREWALL_ENABLED=no` and open the ports in the NSG.
- [ ] **WSS/TCP decision.** SIP/RTP are UDP-only, but 8088/8089/8080 remain
      TCP for HTTP/WSS. Drop WSS if the Flutter app moves to UDP SIP.

## 5. Backend integration

- [ ] `backend/Dockerfile` and `dashboard/Dockerfile` are empty; the full
      compose stack cannot build yet.
- [ ] `docker-compose.yaml` still references a commented `postgres` service
      in `depends_on`, publishes ports that conflict with host networking,
      and lacks `hostname`, `extra_hosts`, `env_file`, and the keys/sounds/
      phoneprov volumes.
- [ ] Root `make up` currently delegates to the PBX; restore the full-stack
      compose path when the backend/dashboard images exist.
- [ ] `softphone/` is empty.

## 6. Verification

- [x] **Idempotency checks.** `up` twice, `down`/`up`, `restart`, `recreate`,
      `firewall` twice, `firewall-off` twice.
- [x] **UDP-only check.** `pjsip show transports` lists `transport-udp` and
      `transport-wss`, no `transport-tcp`; `ss` shows 5060/udp only.
- [ ] **Policy check.** `firewall-cmd --info-policy=asterisk-appliance` and
      `--get-active-policies` after `make firewall`.
- [ ] **Registration/audio.** Softphone Domain `asterisk.local`, Proxy
      `10.42.0.1`; register 1001 and call 600.
- [ ] **Hotspot test.** Remove the legacy `nm-shared` entries, reload, and
      confirm registration still works through the policy.

## 7. Documentation

- [ ] `asterisk/README.md` is stale: says TLS/WSS are commented, lists
      `5060/tcp`, and documents the old `scripts/` layout.
- [ ] Root `README.md` still describes the full stack as the default
      `make up`.
- [ ] Add a firewall section: `FIREWALL_ENABLED`, `FIREWALL_MODE`,
      permanent vs runtime, and the one-time `nm-shared` cleanup.
