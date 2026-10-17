# TODO

<!--toc:start-->

- [TODO](#todo)
  - [1. Configuration](#1-configuration)
  - [2. Image](#2-image)
  - [3. Runtime](#3-runtime)
  - [4. Backend integration](#4-backend-integration)
  - [5. Verification](#5-verification)

<!--toc:end-->

Outstanding work for the PBX directory. Ordered by what blocks what.

## 1. Configuration

- [ ] **Populate `db/init/`** — Asterisk's realtime SQL is not in the repository, so
      `realtime` mode has no tables. Needed: `ps_endpoints.sql`, `ps_auths.sql`,
      `ps_aors.sql`, `ps_endpoint_id_ips.sql`, `extensions.sql`, `voicemail.sql`,
      `queues.sql`, `cdr.sql` (source: Asterisk `contrib/realtime/postgresql/`, `22`
      branch). Mounted by the `postgres` service and only applied to an empty volume.
- [ ] **TLS / WSS for the softphone** — `conf/base/http.conf` has the TLS block
      commented out and `pjsip.conf` has `transport-wss` commented out, so the Flutter
      softphone cannot connect over WSS yet. Requires a certificate in
      `/var/lib/asterisk/keys` and a decision on whether it is issued by the entrypoint
      or mounted in.
- [ ] **Confirm prompt coverage** — `conf/base/extensions.conf`/`standalone` reference
      `hello-world`; verify the apt-installed sounds actually resolve under
      `/var/lib/asterisk/sounds/en` inside the built image.
- [ ] **Trim `conf/samples/`** — 106 reference files. Either keep as-is with the
      reference-only caveat, or drop to a shortlist to shrink the repository.

## 2. Image

- [ ] **Verify the digest pin still resolves** — `andrius/asterisk` rebuilds on every
      upstream release; confirm `make pull` still finds the pinned digest and bump
      `.env` deliberately when upgrading.
- [ ] **Automate the version bump** — currently the tag and digest must be edited by hand
      in `.env`; a small target could resolve the newest certified digest.
- [ ] **Image size pass** — check whether `odbc-postgresql` and sounds can be dropped for
      `standalone` builds to keep the test image small.
- [ ] **Healthcheck** — the base image ships `healthcheck.sh`; confirm it is inherited
      and behaving in both modes.

## 3. Runtime

- [ ] **AMI/ARI bind scope** — `manager.conf` is generated with
      `permit = 0.0.0.0/0.0.0.0` because the compose subnet is unknown. Narrow it once
      the network layout is fixed.
- [ ] **Certificate-free first run** — decide how `manager.conf`/`ari.conf` behave when
      `AMI_PASSWORD`/`ARI_PASSWORD` are unset (currently: files are not written and the
      interfaces stay disabled). Confirm that is the intended default.
- [ ] **`external_media_address` injection** — RTP behind NAT still needs the host's
      reachable address; not handled anywhere yet.

## 4. Backend integration

- [ ] **Define the AMI/ARI contract** — which events the backend consumes (registration,
      channel state, queue stats) versus which commands it issues (reload, originate).
- [ ] **Realtime write path** — confirm the backend owns inserts/updates for
      `ps_endpoints` and friends, and that a reload is triggered after each change.
- [ ] **CDR/CEL to ODBC** — `extconfig.conf` covers dialplan, voicemail and queues;
      `cdr_adaptive_odbc.conf` / `cel_adaptive_odbc.conf` are not authored yet, so call
      records are not yet persisted.

## 5. Verification

- [ ] **Standalone smoke test in CI or by hand** — `make test` plus a real call between
      `1001` and `1002`.
- [ ] **Realtime smoke test** — insert one `ps_endpoints` row, reload, and confirm the
      endpoint appears via `pjsip show endpoint`.
- [ ] **Port range check** — confirm the published UDP range matches `rtp show settings`
      after start (the entrypoint is meant to guarantee this).
