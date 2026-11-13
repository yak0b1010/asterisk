#!/bin/sh

set -eu

log() { printf '[entrypoint] %s\n' "$*"; }

# ---- Required environment ------------------------------------------------
# ASTERISK_MODE - configuration overlay baked into the image.
#   standalone - static configuration, no database
#   realtime   - PJSIP, voicemail and queues read from PostgreSQL over ODBC
: "${ASTERISK_MODE:?ASTERISK_MODE is required (standalone|realtime)}"
case "${ASTERISK_MODE}" in
  standalone|realtime) MODE="${ASTERISK_MODE}" ;;
  *)
    log "ASTERISK_MODE must be 'standalone' or 'realtime' (got '${ASTERISK_MODE}')"
    exit 1
    ;;
esac

# PUID - numeric user ID assigned to files generated at runtime (TLS key and certificate).
# PGID - numeric group ID assigned to files generated at runtime (TLS key and certificate).
: "${PUID:?PUID is required}"
: "${PGID:?PGID is required}"

# RTP_RANGE - contiguous UDP media port range in "start-end" form.
: "${RTP_RANGE:?RTP_RANGE is required (start-end)}"
# SIP_PORT - PJSIP signalling port.
: "${SIP_PORT:?SIP_PORT is required}"
# HTTP_PORT - Asterisk HTTP server port.
: "${HTTP_PORT:?HTTP_PORT is required}"
# WSS_PORT - TLS/WSS port used by the HTTP server and the WSS transport.
: "${WSS_PORT:?WSS_PORT is required}"
# PBX_FQDN - container hostname and TLS certificate common name.
: "${PBX_FQDN:?PBX_FQDN is required}"

# AMI_PASSWORD - AMI secret for the backend user. An empty value disables AMI.
# ARI_PASSWORD - ARI password for the backend user. An empty value disables ARI.
: "${AMI_PASSWORD?AMI_PASSWORD must be defined (empty disables AMI)}"
: "${ARI_PASSWORD?ARI_PASSWORD must be defined (empty disables ARI)}"

# ---- RTP range -----------------------------------------------------------
# rtpstart is the text before the hyphen; rtpend is the text after it.
case "${RTP_RANGE}" in
  *-*) ;;
  *)
    log "RTP_RANGE must be in form of start-end (got '${RTP_RANGE}')"
    exit 1
    ;;
esac

if [ -f /etc/asterisk/rtp.conf ]; then
  rtp_start="${RTP_RANGE%%-*}"
  rtp_end="${RTP_RANGE##*-}"
  sed -i \
    -e "s/^;\{0,1\}[[:space:]]*rtpstart[[:space:]]*=.*/rtpstart=${rtp_start}/" \
    -e "s/^;\{0,1\}[[:space:]]*rtpend[[:space:]]*=.*/rtpend=${rtp_end}/" \
    /etc/asterisk/rtp.conf
  log "rtp.conf: rtpstart=${rtp_start} rtpend=${rtp_end}"
fi

# ---- PJSIP transports ----------------------------------------------------
# The UDP transport bind address uses SIP_PORT.
if [ -f /etc/asterisk/pjsip.conf ]; then
  sed -i "/^\[transport-udp\]/,/^\[/ s|^bind[[:space:]]*=.*|bind = 0.0.0.0:${SIP_PORT}|" /etc/asterisk/pjsip.conf
  log "pjsip.conf: transport-udp bind=0.0.0.0:${SIP_PORT}"

  # The WSS transport bind address uses WSS_PORT.
  sed -i "/^\[transport-wss\]/,/^\[/ s|^bind[[:space:]]*=.*|bind = 0.0.0.0:${WSS_PORT}|" /etc/asterisk/pjsip.conf
  log "pjsip.conf: transport-wss bind=0.0.0.0:${WSS_PORT}"
fi

# ---- HTTP server ---------------------------------------------------------
# bindport uses HTTP_PORT; tlsbindaddr uses WSS_PORT.
if [ -f /etc/asterisk/http.conf ]; then
  sed -i "s/^bindport[[:space:]]*=.*/bindport = ${HTTP_PORT}/" /etc/asterisk/http.conf
  sed -i "s/^tlsbindaddr[[:space:]]*=.*/tlsbindaddr = 0.0.0.0:${WSS_PORT}/" /etc/asterisk/http.conf
  log "http.conf: bindport=${HTTP_PORT} tlsbindaddr=0.0.0.0:${WSS_PORT}"
fi

# ---- AMI -----------------------------------------------------------------
# manager.conf is written only when AMI_PASSWORD is non-empty.
if [ -n "${AMI_PASSWORD}" ]; then
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
  log "AMI_PASSWORD empty - AMI stays disabled"
fi

# ---- ARI -----------------------------------------------------------------
# ari.conf is written only when ARI_PASSWORD is non-empty.
if [ -n "${ARI_PASSWORD}" ]; then
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
  log "ARI_PASSWORD empty - ARI stays disabled"
fi

# ---- PostgreSQL realtime over ODBC --------------------------------------
# Active only in realtime mode. All five DB_* variables are required.
if [ "${MODE}" = "realtime" ]; then
  : "${DB_HOST:?realtime requires DB_HOST}"
  : "${DB_PORT:?realtime requires DB_PORT}"
  : "${DB_NAME:?realtime requires DB_NAME}"
  : "${DB_USER:?realtime requires DB_USER}"
  : "${DB_PASSWORD:?realtime requires DB_PASSWORD}"

  # odbc.ini defines the DSN referenced by res_odbc.conf as dsn => asterisk-pgsql.
  cat >/etc/odbc.ini <<EOF
[asterisk-pgsql]
Description = Asterisk realtime datasource
Driver      = PostgreSQL Unicode
Servername  = ${DB_HOST}
Port        = ${DB_PORT}
Database    = ${DB_NAME}
EOF

  # res_odbc.conf defines the [asterisk] class used by extconfig.conf and sorcery.conf.
  cat >/etc/asterisk/res_odbc.conf <<EOF
[asterisk]
enabled         => yes
dsn             => asterisk-pgsql
username        => ${DB_USER}
password        => ${DB_PASSWORD}
pre-connect     => yes
max_connections => 5
sanitysql       => select 1
EOF
  log "rendered odbc.ini + res_odbc.conf (host=\"${DB_HOST}\" db=\"${DB_NAME}\")"
else
  log "standalone mode - skipping ODBC realtime configuration"
fi

# ---- TLS certificate -----------------------------------------------------
# A self-signed certificate is generated when none exists. PBX_FQDN is the
# common name; localhost and 127.0.0.1 are additional DNS and IP SANs.
KEYDIR=/var/lib/asterisk/keys
if [ ! -s "${KEYDIR}/asterisk.pem" ]; then
  mkdir -p "${KEYDIR}"
  if openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "${KEYDIR}/asterisk.key" \
    -out "${KEYDIR}/asterisk.crt" \
    -subj "/CN=${PBX_FQDN}" \
    -addext "subjectAltName=DNS:${PBX_FQDN},DNS:localhost,IP:127.0.0.1"; then
    cat "${KEYDIR}/asterisk.crt" "${KEYDIR}/asterisk.key" >"${KEYDIR}/asterisk.pem"
    chmod 600 "${KEYDIR}/asterisk.key"
    chown "${PUID}:${PGID}" "${KEYDIR}/asterisk.pem" "${KEYDIR}/asterisk.key" "${KEYDIR}/asterisk.crt"
    log "generated self-signed TLS certificate (CN=${PBX_FQDN})"
  else
    log "WARNING: could not generate TLS certificate - WSS will be unavailable"
  fi
fi

# Hand off to the base image entrypoint with the original container command.
exec "$@"
