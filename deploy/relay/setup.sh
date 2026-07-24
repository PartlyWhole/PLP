#!/usr/bin/env bash
# PLP collab relay — one-shot server setup.
# Target: a FRESH Ubuntu 24.04 VPS. Run as root:
#   scp -r deploy/relay root@<server-ip>:/root/ && ssh root@<server-ip> 'bash /root/relay/setup.sh'
# Idempotent: safe to re-run after a failure.
#
# What it installs (see deploy/relay/README.md for the full runbook):
#   - base hardening: ufw (22/80/443), unattended-upgrades
#   - Caddy (auto-TLS front door) serving ${RELAY_HOST}
#   - Node 22 + @automerge/automerge-repo-sync-server (pinned) as systemd unit
#   - weekly prune of rooms untouched for ${PRUNE_DAYS} days
set -euo pipefail

RELAY_HOST="${RELAY_HOST:-sync.partlywhole.org}"
SYNC_VERSION="${SYNC_VERSION:-0.2.8}"   # matches the version the PLP test suite exercises
PRUNE_DAYS="${PRUNE_DAYS:-90}"
DATA_CAP_MB="${DATA_CAP_MB:-2048}"   # disk guard: cap on the room store

echo "== PLP relay setup: ${RELAY_HOST} (sync-server ${SYNC_VERSION}) =="

# ---- base packages + hardening --------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ufw unattended-upgrades curl gnupg ca-certificates

# `limit` throttles repeated SSH connection attempts (6/30s per source).
ufw limit OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# SSH: keys only. Hetzner disables root password login when a key is
# supplied, but password auth stays enabled for any account created later —
# close it now so adding a user can never open a guessable door.
sshd_set() {
  sed -i "s/^#\?${1}.*/${1} ${2}/" /etc/ssh/sshd_config
  grep -q "^${1} ${2}$" /etc/ssh/sshd_config || echo "${1} ${2}" >> /etc/ssh/sshd_config
}
sshd_set PasswordAuthentication no
sshd_set KbdInteractiveAuthentication no
sshd_set PermitRootLogin prohibit-password
# Drop-in files ship their own defaults on Ubuntu 24.04 and win by order.
if [ -d /etc/ssh/sshd_config.d ]; then
  cat >/etc/ssh/sshd_config.d/00-plp-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
fi
sshd -t && systemctl restart ssh

# ---- Caddy (official apt repo) --------------------------------------------
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get -y install caddy
fi

# ---- Node 22 (NodeSource) --------------------------------------------------
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get -y install nodejs
fi

# ---- sync server under a dedicated no-login user ---------------------------
id plpsync >/dev/null 2>&1 || useradd -r -m -d /opt/plp-sync -s /usr/sbin/nologin plpsync
sudo -u plpsync bash -c "
  cd /opt/plp-sync
  [ -f package.json ] || npm init -y >/dev/null
  npm install --no-fund --no-audit @automerge/automerge-repo-sync-server@${SYNC_VERSION}
  mkdir -p data
"

cat >/etc/systemd/system/plp-sync.service <<EOF
[Unit]
Description=Automerge sync relay for PLP collab
After=network.target

[Service]
User=plpsync
WorkingDirectory=/opt/plp-sync
Environment=PORT=3030
Environment=DATA_DIR=/opt/plp-sync/data
ExecStart=/usr/bin/node node_modules/@automerge/automerge-repo-sync-server/src/index.js
Restart=always
RestartSec=3
# containment: this unit never needs more than its own directory
ProtectSystem=strict
ReadWritePaths=/opt/plp-sync
PrivateTmp=true
NoNewPrivileges=true
ProtectHome=true
PrivateDevices=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryMax=1G
TasksMax=256
# The sync server calls app.listen(PORT) with no host argument, so it binds
# 0.0.0.0. Confine it at the kernel level instead: only loopback may reach
# (or be reached by) this service, so Caddy is the sole path in even if the
# firewall is ever disabled.
IPAddressDeny=any
IPAddressAllow=localhost

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable plp-sync
# restart, not `enable --now`: on a re-run the unit file may have changed
# (sandboxing directives) and an already-running service would keep the old one.
systemctl restart plp-sync

# ---- Caddy front door ------------------------------------------------------
# Our site lives in its own drop-in, rewritten on every run: appending to the
# main Caddyfile "only if absent" would silently keep an outdated block
# (that is how the first version shipped without the origin allowlist).
# Other apps get their own files in the same directory and are untouched.
mkdir -p /etc/caddy/sites.d
grep -q 'import /etc/caddy/sites.d/\*.caddy' /etc/caddy/Caddyfile 2>/dev/null \
  || echo 'import /etc/caddy/sites.d/*.caddy' >> /etc/caddy/Caddyfile
# Drop any legacy inline block for this host (pre-drop-in installs).
if grep -q "^${RELAY_HOST} {" /etc/caddy/Caddyfile 2>/dev/null; then
  awk -v host="${RELAY_HOST} {" '
    $0 == host {skip=1; next}
    skip && /^}/ {skip=0; next}
    !skip {print}
  ' /etc/caddy/Caddyfile > /etc/caddy/Caddyfile.new && mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
fi

cat >/etc/caddy/sites.d/plp-relay.caddy <<EOF
${RELAY_HOST} {
    # Browser-origin allowlist. The relay itself is unauthenticated (any
    # client that knows the URL can sync any document), so this is not an
    # access control against a determined attacker — a non-browser client
    # forges Origin freely. What it does buy: no OTHER website can quietly
    # use this relay as free storage from visitors' browsers.
    @foreign {
        header_regexp origin ^https?://
        not header_regexp origin ^https://([a-z0-9-]+\\.)?partlywhole\\.org(:[0-9]+)?\$
        not header_regexp origin ^https://partlywhole\\.github\\.io\$
        not header_regexp origin ^http://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?\$
    }
    respond @foreign "origin not allowed" 403

    # Bound how much a single client can push in one request.
    request_body {
        max_size 32MB
    }
    reverse_proxy 127.0.0.1:3030
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy

# ---- weekly room prune -----------------------------------------------------
cat >/etc/cron.weekly/plp-sync-prune <<EOF
#!/bin/sh
# Rooms are link-access-only; untouched for ${PRUNE_DAYS} days = abandoned.
find /opt/plp-sync/data -type f -mtime +${PRUNE_DAYS} -delete
find /opt/plp-sync/data -type d -empty -delete
EOF
chmod +x /etc/cron.weekly/plp-sync-prune

# Disk guard: the relay accepts writes from anyone who knows the URL, so an
# abusive (or merely enthusiastic) client could otherwise fill the disk and
# take the service down. Hourly: if the store exceeds the cap, drop the
# least-recently-touched rooms until it fits, and log what was dropped.
cat >/etc/cron.hourly/plp-sync-diskguard <<EOF
#!/bin/sh
CAP_MB=${DATA_CAP_MB}
DIR=/opt/plp-sync/data
used() { du -sm "\$DIR" 2>/dev/null | cut -f1; }
[ "\$(used)" -le "\$CAP_MB" ] 2>/dev/null && exit 0
logger -t plp-sync-diskguard "store \$(used)MB exceeds \${CAP_MB}MB — pruning oldest rooms"
find "\$DIR" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | while read -r _ f; do
  [ "\$(used)" -le "\$CAP_MB" ] 2>/dev/null && break
  rm -f "\$f"
done
find "\$DIR" -type d -empty -delete
logger -t plp-sync-diskguard "store now \$(used)MB"
EOF
chmod +x /etc/cron.hourly/plp-sync-diskguard

# ---- report ----------------------------------------------------------------
echo
echo "== done =="
systemctl --no-pager --lines 0 status plp-sync | head -3
echo
echo "Next: confirm DNS A record for ${RELAY_HOST} points at this server, then from anywhere:"
echo "  curl -sI https://${RELAY_HOST} | head -1     # expect HTTP/2 200 (TLS may take ~1 min on first request)"
