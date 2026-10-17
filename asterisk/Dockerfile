# syntax=docker/dockerfile:1

# Fully-qualified base reference, injected from ../.env by the Makefile/compose:
#   ${ASTERISK_IMAGE}:${ASTERISK_TAG}@${ASTERISK_DIGEST}
ARG BASE_IMAGE=andrius/asterisk:22.8-cert4_debian-trixie-8d9e955@sha256:f3bd01300f0c36c8a7ea5bd9472c4b906d0f85410c3ea429166a0fedac6ad3ee

FROM ${BASE_IMAGE}

# ---- Build mode ----------------------------------------------------------
# standalone : static file configuration, no database required
# realtime   : PJSIP/voicemail/queues resolved from PostgreSQL over ODBCARG MODE=standalone
ARG MODE=standalone
ENV ASTERISK_MODE=${MODE}

# ---- Extra packages the base image does not ship -------------------------
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
  odbc-postgresql \
  asterisk-core-sounds-en-gsm \
  asterisk-moh-opsound-wav; \
  rm -rf /var/lib/apt/lists/*

# ---- Register the ODBC driver (path discovered, not hard-coded) ----------
RUN set -eux; \
  drv="$(find /usr/lib -name psqlodbcw.so -print -quit)"; \
  test -n "${drv}"; \
  { echo '[PostgreSQL Unicode]'; \
  echo 'Description = PostgreSQL ODBC driver (Unicode)'; \
  echo "Driver = ${drv}"; \
  echo 'FileUsage = 1'; } > /etc/odbcinst.ini

# ---- Expose apt-installed sounds through Asterisk's astdatadir -----------
RUN set -eux; \
  if [ -d /usr/share/asterisk/sounds ]; then \
  for d in /usr/share/asterisk/sounds/*/; do \
  n="$(basename "${d}")"; \
  [ -e "/var/lib/asterisk/sounds/${n}" ] || ln -sfn "${d%/}" "/var/lib/asterisk/sounds/${n}"; \
  done; \
  [ -e /var/lib/asterisk/sounds/en ] || \
  ln -sfn /usr/share/asterisk/sounds/en_US_f_Allison /var/lib/asterisk/sounds/en; \
  fi; \
  if [ -d /usr/share/asterisk/moh ]; then \
  ln -sfn /usr/share/asterisk/moh /var/lib/asterisk/moh; \
  fi

# ---- Managed configuration: shared base, then the mode overlay -----------
COPY conf/base/ /etc/asterisk/
COPY conf/${MODE}/ /etc/asterisk/

# ---- Runtime templating, then defer to the base image entrypoint ---------
COPY conf/scripts/entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN set -eux; \
  chmod +x /usr/local/bin/entrypoint-wrapper.sh; \
  chown -R asterisk:asterisk /etc/asterisk

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]

CMD ["/usr/sbin/asterisk", "-vvvdddf", "-T", "-W", "-U", "asterisk", "-p"]
