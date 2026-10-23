#!/bin/sh
# Host firewall management for the Asterisk appliance.
#
#   FIREWALL_ENABLED=yes|no
#   FIREWALL_MODE=permanent|runtime
#
# permanent: firewalld policy (ingress ANY, egress HOST). Zone-independent;
#            survives reboot; evaluated before zone reject rules. Policies are
#            permanent-only in firewalld, hence --permanent + --reload.
# runtime:   ports added to every active zone; lost on reload/reboot.
#
# Usage: firewall.sh on|off|status

set -eu

POLICY="${FIREWALL_POLICY:-asterisk-appliance}"
MODE="${FIREWALL_MODE:-runtime}"
ENABLED="${FIREWALL_ENABLED:-yes}"

log() { printf '[firewall] %s\n' "$*"; }
warn() { printf '[firewall] warning: %s\n' "$*" >&2; }
die() {
  printf '[firewall] error: %s\n' "$*" >&2
  exit 1
}

case "$MODE" in
permanent | runtime) ;;
*) die "FIREWALL_MODE must be 'permanent' or 'runtime' (got '$MODE')" ;;
esac

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "root or sudo is required to change firewalld"
  SUDO="sudo"
fi

case "${RTP_RANGE:-10000-10199}" in
*-*) ;;
*) die "RTP_RANGE must be start-end (got '${RTP_RANGE:-}')" ;;
esac

PORTS=""
add_port() {
  if [ -n "$1" ]; then
    if [ -n "$PORTS" ]; then
      PORTS="$PORTS $1"
    else
      PORTS="$1"
    fi
  fi
}
add_port "${SIP_PORT:-5060}/udp"
add_port "${RTP_RANGE:-10000-10199}/udp"
add_port "${HTTP_PORT:-8088}/tcp"
add_port "${WSS_PORT:-8089}/tcp"
add_port "${DASHBOARD_PORT:-8080}/tcp"

firewalld_running() {
  [ "$(firewall-cmd --state 2>/dev/null || true)" = "running" ]
}

require_firewalld() {
  command -v firewall-cmd >/dev/null 2>&1 || {
    warn "firewall-cmd not found"
    warn "set FIREWALL_ENABLED=no and open these ports in ufw instead: $PORTS"
    exit 1
  }
  firewalld_running || die "firewalld is not running"
}

policies_supported() {
  firewall-cmd --get-policies >/dev/null 2>&1
}

policy_exists() {
  firewall-cmd --permanent --get-policies 2>/dev/null | tr ' ' '\n' | grep -qx "$POLICY"
}

active_zones() {
  firewall-cmd --get-active-zones | awk 'NF && $0 !~ /^[[:space:]]/ {print $1}'
}

all_zones() {
  firewall-cmd --get-zones | tr ' ' '\n' | sed '/^$/d'
}

require_enabled() {
  if [ "$ENABLED" != "yes" ]; then
    log "FIREWALL_ENABLED=$ENABLED - not touching the host firewall"
    exit 0
  fi
}

do_on_permanent() {
  changed=0

  if ! policy_exists; then
    log "creating policy $POLICY"
    $SUDO firewall-cmd --permanent --new-policy="$POLICY" >/dev/null
    changed=1
  fi

  ingress="$(firewall-cmd --permanent --policy="$POLICY" --list-ingress-zones)"
  if ! printf '%s\n' "$ingress" | tr ' ' '\n' | grep -qx ANY; then
    log "policy ingress -> ANY"
    $SUDO firewall-cmd --permanent --policy="$POLICY" --add-ingress-zone=ANY >/dev/null
    changed=1
  fi

  egress="$(firewall-cmd --permanent --policy="$POLICY" --list-egress-zones)"
  if ! printf '%s\n' "$egress" | tr ' ' '\n' | grep -qx HOST; then
    log "policy egress -> HOST"
    $SUDO firewall-cmd --permanent --policy="$POLICY" --add-egress-zone=HOST >/dev/null
    changed=1
  fi

  target="$(firewall-cmd --permanent --policy="$POLICY" --get-target)"
  if [ "$target" != "CONTINUE" ]; then
    log "policy target -> CONTINUE"
    $SUDO firewall-cmd --permanent --policy="$POLICY" --set-target=CONTINUE >/dev/null
    changed=1
  fi

  priority="$(firewall-cmd --permanent --policy="$POLICY" --get-priority)"
  if [ "$priority" != "-100" ]; then
    log "policy priority -> -100"
    $SUDO firewall-cmd --permanent --policy="$POLICY" --set-priority=-100 >/dev/null
    changed=1
  fi

  for p in $PORTS; do
    if firewall-cmd --permanent --policy="$POLICY" --query-port="$p" >/dev/null 2>&1; then
      :
    else
      log "opening $p"
      $SUDO firewall-cmd --permanent --policy="$POLICY" --add-port="$p" >/dev/null
      changed=1
    fi
  done

  if [ "$changed" -eq 1 ]; then
    $SUDO firewall-cmd --reload >/dev/null
    log "applied permanently; firewalld reloaded"
  else
    log "already up to date (policy $POLICY)"
  fi
}

do_off_permanent() {
  if policy_exists; then
    log "removing policy $POLICY"
    $SUDO firewall-cmd --permanent --delete-policy="$POLICY" >/dev/null
    $SUDO firewall-cmd --reload >/dev/null
    log "removed permanently; firewalld reloaded"
  else
    log "policy $POLICY not present"
  fi
}

do_on_runtime() {
  zones="$(active_zones)"
  [ -n "$zones" ] || die "no active firewalld zones"
  changed=0
  for z in $zones; do
    if [ "$z" = "docker" ]; then
      continue
    fi
    for p in $PORTS; do
      if firewall-cmd --zone="$z" --query-port="$p" >/dev/null 2>&1; then
        :
      else
        log "opening $p in zone $z"
        $SUDO firewall-cmd --zone="$z" --add-port="$p" >/dev/null
        changed=1
      fi
    done
  done
  if [ "$changed" -eq 1 ]; then
    log "applied at runtime (lost on reload/reboot)"
  else
    log "already up to date in active zones"
  fi
}

do_off_runtime() {
  removed=0
  for z in $(all_zones); do
    if [ "$z" = "docker" ]; then
      continue
    fi
    listed="$(firewall-cmd --zone="$z" --list-ports 2>/dev/null || true)"
    for p in $PORTS; do
      if printf '%s\n' "$listed" | tr ' ' '\n' | grep -qx "$p"; then
        log "removing $p from zone $z"
        $SUDO firewall-cmd --zone="$z" --remove-port="$p" >/dev/null
        removed=1
      fi
    done
  done
  if [ "$removed" -eq 1 ]; then
    log "removed runtime rules"
  else
    log "no matching runtime rules"
  fi
}

do_status() {
  log "FIREWALL_ENABLED=$ENABLED"
  log "FIREWALL_MODE=$MODE"
  log "ports: $PORTS"

  if ! command -v firewall-cmd >/dev/null 2>&1; then
    warn "firewall-cmd not found"
    return 0
  fi
  if ! firewalld_running; then
    warn "firewalld is not running"
    return 0
  fi

  if policies_supported && policy_exists; then
    log "policy $POLICY:"
    printf '  ingress:  %s\n' "$(firewall-cmd --permanent --policy="$POLICY" --list-ingress-zones)"
    printf '  egress:   %s\n' "$(firewall-cmd --permanent --policy="$POLICY" --list-egress-zones)"
    printf '  target:   %s\n' "$(firewall-cmd --permanent --policy="$POLICY" --get-target)"
    printf '  priority: %s\n' "$(firewall-cmd --permanent --policy="$POLICY" --get-priority)"
    printf '  ports:    %s\n' "$(firewall-cmd --permanent --policy="$POLICY" --list-ports)"
  elif policies_supported; then
    log "policy $POLICY: not present"
  fi

  log "active zones: $(active_zones | tr '\n' ' ')"
  for z in $(active_zones); do
    if [ "$z" = "docker" ]; then
      continue
    fi
    printf '  %s:' "$z"
    for p in $PORTS; do
      if firewall-cmd --zone="$z" --query-port="$p" >/dev/null 2>&1; then
        printf ' %s=yes' "$p"
      else
        printf ' %s=no' "$p"
      fi
    done
    printf '\n'
  done
}

case "${1:-}" in
on)
  require_enabled
  require_firewalld
  if [ "$MODE" = "permanent" ]; then
    if policies_supported; then
      do_on_permanent
    else
      warn "firewalld has no policy support; falling back to runtime mode"
      do_on_runtime
    fi
  else
    do_on_runtime
  fi
  ;;
off)
  if [ "$ENABLED" != "yes" ]; then
    log "FIREWALL_ENABLED=$ENABLED - not touching the host firewall"
    log "set FIREWALL_ENABLED=yes and re-run to remove existing rules"
    exit 0
  fi
  if ! command -v firewall-cmd >/dev/null 2>&1; then
    log "firewall-cmd not found - nothing to remove"
    exit 0
  fi
  if ! firewalld_running; then
    log "firewalld is not running - nothing to remove"
    exit 0
  fi
  if [ "$MODE" = "permanent" ]; then
    if policies_supported; then
      do_off_permanent
    else
      warn "firewalld has no policy support; removing runtime fallback rules"
      do_off_runtime
    fi
  else
    do_off_runtime
  fi
  ;;
status)
  do_status
  ;;
*)
  echo "usage: $0 on|off|status" >&2
  exit 2
  ;;
esac
