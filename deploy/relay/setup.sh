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

echo "== PLP relay setup: ${RELAY_HOST} (sync-server ${SYNC_VERSION}) =="

# ---- base packages + hardening --------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install ufw unattended-upgrades curl gnupg ca-certificates

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

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

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now plp-sync

# ---- Caddy front door ------------------------------------------------------
# Append our block only if absent; keeps future app blocks intact.
if ! grep -q "${RELAY_HOST}" /etc/caddy/Caddyfile 2>/dev/null; then
  cat >>/etc/caddy/Caddyfile <<EOF

${RELAY_HOST} {
    reverse_proxy 127.0.0.1:3030
}
EOF
fi
systemctl reload caddy

# ---- weekly room prune -----------------------------------------------------
cat >/etc/cron.weekly/plp-sync-prune <<EOF
#!/bin/sh
# Rooms are link-access-only; untouched for ${PRUNE_DAYS} days = abandoned.
find /opt/plp-sync/data -type f -mtime +${PRUNE_DAYS} -delete
find /opt/plp-sync/data -type d -empty -delete
EOF
chmod +x /etc/cron.weekly/plp-sync-prune

# ---- report ----------------------------------------------------------------
echo
echo "== done =="
systemctl --no-pager --lines 0 status plp-sync | head -3
echo
echo "Next: confirm DNS A record for ${RELAY_HOST} points at this server, then from anywhere:"
echo "  curl -sI https://${RELAY_HOST} | head -1     # expect HTTP/2 200 (TLS may take ~1 min on first request)"
