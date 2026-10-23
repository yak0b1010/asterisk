#!/bin/sh
# Runtime templating, then hand off to the base image's entrypoint.
set -eu

log() { printf '[entrypoint] %s\n' "$*"; }

MODE="${ASTERISK_MODE:-standalone}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# ---- RTP range: keep in lock-step with the published UDP range -----------
if [ -n "${RTP_RANGE:-}" ] && [ -f /etc/asterisk/rtp.conf ]; then
  rtp_start="${RTP_RANGE%%-*}"
  rtp_end="${RTP_RANGE##*-}"
  sed -i \
    -e "s/^;\{0,1\}[[:space:]]*rtpstart[[:space:]]*=.*/rtpstart=${rtp_start}/" \
    -e "s/^;\{0,1\}[[:space:]]*rtpend[[:space:]]*=.*/rtpend=${rtp_end}/" \
    /etc/asterisk/rtp.conf
  log "rtp.conf: rtpstart=${rtp_start} rtpend=${rtp_end}"
fi

# ---- SIP / HTTP / WSS ports: make .env authoritative ---------------------
if [ -n "${SIP_PORT:-}" ] && [ -f /etc/asterisk/pjsip.conf ]; then
  sed -i "/^\[transport-udp\]/,/^\[/ s|^bind[[:space:]]*=.*|bind = 0.0.0.0:${SIP_PORT}|" /etc/asterisk/pjsip.conf
  log "pjsip.conf: transport-udp bind=0.0.0.0:${SIP_PORT}"
fi
if [ -n "${WSS_PORT:-}" ] && [ -f /etc/asterisk/pjsip.conf ]; then
  sed -i "/^\[transport-wss\]/,/^\[/ s|^bind[[:space:]]*=.*|bind = 0.0.0.0:${WSS_PORT}|" /etc/asterisk/pjsip.conf
fi
if [ -f /etc/asterisk/http.conf ]; then
  if [ -n "${HTTP_PORT:-}" ]; then
    sed -i "s/^bindport[[:space:]]*=.*/bindport = ${HTTP_PORT}/" /etc/asterisk/http.conf
  fi
  if [ -n "${WSS_PORT:-}" ]; then
    sed -i "s/^tlsbindaddr[[:space:]]*=.*/tlsbindaddr = 0.0.0.0:${WSS_PORT}/" /etc/asterisk/http.conf
  fi
  log "http.conf: bindport=${HTTP_PORT:-8088} tlsbindaddr=0.0.0.0:${WSS_PORT:-8089}"
fi

# ---- AMI -----------------------------------------------------------------
if [ -n "${AMI_PASSWORD:-}" ]; then
  cat >/etc/asterisk/manager.conf <<EOF
[general]
enabled = yes
webenabled = no
port = 5038
bindaddr = 127.0.0.1

[backend]
secret = ${AMI_PASSWORD}
read = all
write = all
permit = 0.0.0.0/0.0.0.0
EOF
  log "manager.conf written"
else
  log "AMI_PASSWORD unset - AMI stays disabled"
fi

# ---- ARI -----------------------------------------------------------------
if [ -n "${ARI_PASSWORD:-}" ]; then
  cat >/etc/asterisk/ari.conf <<EOF
[general]
enabled = yes
pretty = yes
allowed_origins = *

[asterisk]
type = user
read_only = no
password = ${ARI_PASSWORD}
EOF
  log "ari.conf written"
else
  log "ARI_PASSWORD unset - ARI stays disabled"
fi

# ---- PostgreSQL realtime over ODBC (realtime mode only) ------------------
if [ "${MODE}" = "realtime" ]; then
  if [ -n "${DB_PASSWORD:-}" ]; then
    cat >/etc/odbc.ini <<EOF
[asterisk-pgsql]
Description = Asterisk realtime datasource
Driver      = PostgreSQL Unicode
Servername  = ${DB_HOST:-postgres}
Port        = ${DB_PORT:-5432}
Database    = ${DB_NAME:-asterisk}
EOF

    cat >/etc/asterisk/res_odbc.conf <<EOF
[asterisk]
enabled         => yes
dsn             => asterisk-pgsql
username        => ${DB_USER:-asterisk}
password        => ${DB_PASSWORD}
pre-connect     => yes
max_connections => 5
sanitysql       => select 1
EOF
    log "rendered odbc.ini + res_odbc.conf (host=${DB_HOST:-postgres} db=${DB_NAME:-asterisk})"
  else
    log "realtime mode but DB_PASSWORD unset - ODBC will not connect"
  fi
else
  log "standalone mode - skipping ODBC realtime configuration"
fi

# ---- Self-signed TLS material for WSS / ARI over HTTPS -------------------
KEYDIR=/var/lib/asterisk/keys
if [ ! -s "${KEYDIR}/asterisk.pem" ]; then
  cn="${PBX_FQDN:-${TLS_COMMON_NAME:-asterisk.local}}"
  mkdir -p "${KEYDIR}"
  if openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "${KEYDIR}/asterisk.key" \
    -out "${KEYDIR}/asterisk.crt" \
    -subj "/CN=${cn}" \
    -addext "subjectAltName=DNS:${cn},DNS:localhost,IP:127.0.0.1" 2>/dev/null; then
    cat "${KEYDIR}/asterisk.crt" "${KEYDIR}/asterisk.key" >"${KEYDIR}/asterisk.pem"
    chmod 600 "${KEYDIR}/asterisk.key"
    chown "${PUID}:${PGID}" "${KEYDIR}/asterisk.pem" "${KEYDIR}/asterisk.key" "${KEYDIR}/asterisk.crt"
    log "generated self-signed TLS certificate (CN=${cn})"
  else
    log "WARNING: could not generate TLS certificate - WSS will be unavailable"
  fi
fi

exec /usr/local/bin/entrypoint.sh "$@"
