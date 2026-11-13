# syntax=docker/dockerfile:1

# Fully-qualified base reference, injected from ../.env by the Makefile/compose:
#   ${ASTERISK_IMAGE}:${ASTERISK_TAG}@${ASTERISK_DIGEST}
#ARG BASE_IMAGE=andrius/asterisk:22.8-cert4_alpine-3.24-amd64@sha256:ff8cf9fca1d24633566873f918f37ef35b2a245a69d7c75fa8da6953d15639ca
ARG BASE_IMAGE=mlan/asterisk:full-1.1.13@sha256:c7b0b09903eec29f54601d32d7cd9aca859043144062db49e5054ae8f513745d
ARG MODE=standalone

FROM ${BASE_IMAGE} AS appliance

# ---- Build mode ----------------------------------------------------------
# standalone : static file configuration, no database required
# realtime   : PJSIP/voicemail/queues/dialplan resolved over PostgreSQL ODBC
ARG MODE
ENV ASTERISK_MODE=${MODE}

# ---- Extra packages the base image does not ship -------------------------
RUN set -eux; \
    apk add --no-cache \
    psqlodbc unixodbc openssl \
    asterisk-odbc \
    asterisk-sounds-en \
    asterisk-sounds-moh

# ---- Register the ODBC driver (path discovered, not hard-coded) ----------
RUN set -eux; \
    drv="$(find /usr/lib -name psqlodbcw.so -print -quit)"; \
    test -n "${drv}"; \
    { echo '[PostgreSQL Unicode]'; \
    echo 'Description = PostgreSQL ODBC driver (Unicode)'; \
    echo "Driver = ${drv}"; \
    echo 'FileUsage = 1'; } > /etc/odbcinst.ini

# ---- Expose Alpine media through the existing persistent volume paths ----
RUN set -eux; \
    mkdir -p /var/lib/asterisk/sounds; \
    ln -sfn /usr/share/asterisk/sounds/en /var/lib/asterisk/sounds/en; \
    ln -sfn /usr/share/asterisk/moh /var/lib/asterisk/moh; \
    ln -sfn /usr/share/asterisk/rest-api /var/lib/asterisk/rest-api

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
