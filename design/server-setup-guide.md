# Personal backend server — step-by-step setup guide

One small VPS that backs all your static (GitHub Pages) apps: the PLP
collab sync relay, per-app PocketBase backends (database + auth + files +
realtime), wildcard TLS via Caddy, and off-site backups. Cost: ~$8–12/mo
all-in. Time: ~2 hours the first time.

Conventions used below — substitute your own:
- Domain: `example.dev` (apps live at `*.example.dev`)
- Server user: `alan`
- Provider: Hetzner (any VPS provider works the same way)

---

## Step 0 — Shopping list (15 min)

1. **Domain** (~$12/yr): Porkbun/Cloudflare/Namecheap. Pick something short.
2. **VPS**: Hetzner Cloud → create project → add your **SSH public key**
   (`cat ~/.ssh/id_ed25519.pub`; if you have none: `ssh-keygen -t ed25519`)
   → create server: **Ubuntu 24.04**, **CX22** (2 vCPU/4 GB, ~€3.8/mo;
   CX32 for headroom), any EU/US location near you. Note the IPv4.
3. **Backblaze B2 account** (backups; free under 10 GB, pennies after).

## Step 1 — DNS (5 min, do first: propagation runs while you work)

At your DNS panel create two records pointing at the server IP:

```
A  @              -> <server-ip>      (optional; the bare domain)
A  *              -> <server-ip>      (wildcard: every subdomain)
```

## Step 2 — First login + hardening (15 min)

```sh
ssh root@<server-ip>

adduser alan                      # your daily-driver user
usermod -aG sudo alan
rsync -a ~/.ssh /home/alan/ && chown -R alan:alan /home/alan/.ssh

apt update && apt -y upgrade
apt -y install ufw unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades   # answer Yes

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable

# disable password logins entirely
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
exit
# from now on: ssh alan@<server-ip>
```

## Step 3 — Caddy, the front door (10 min)

Caddy terminates TLS for every subdomain (certificates are automatic) and
proxies to local ports.

```sh
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
```

`/etc/caddy/Caddyfile` (start small; one block per app forever after):

```caddy
plp-sync.example.dev {
    reverse_proxy 127.0.0.1:3030      # WebSockets proxy automatically
}

# added in Step 5:
# myapp.example.dev {
#     reverse_proxy 127.0.0.1:8090
# }
```

```sh
sudo systemctl reload caddy
```

## Step 4 — PLP sync relay (20 min)

```sh
# Node LTS (Ubuntu's node is fine too if >= 18; this pins current LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs

sudo useradd -r -m -d /opt/plp-sync -s /usr/sbin/nologin plpsync
sudo -u plpsync bash -c 'cd /opt/plp-sync && npm init -y && npm install @automerge/automerge-repo-sync-server@0.2.8'
```

`/etc/systemd/system/plp-sync.service` — the package has no bin entry;
run its entry module directly. It honors `PORT` (default 3030) and
`DATA_DIR` (where room docs persist):

```ini
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

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now plp-sync
curl -sI https://plp-sync.example.dev | head -1     # expect an HTTP response
```

**Room cleanup** (docs persist forever otherwise) —
`/etc/cron.weekly/plp-sync-prune`, executable:

```sh
#!/bin/sh
# rooms untouched for 90 days are unreachable-in-practice (link-only access)
find /opt/plp-sync/data -type f -mtime +90 -delete
find /opt/plp-sync/data -type d -empty -delete
```

**Point PLP at it** (in the PLP repo): in `app/collab.mjs` change
`SYNC_SERVER` to `wss://plp-sync.example.dev` (or set
`window.__collabSyncServerUrl` before `main.mjs` loads). Share links with
`?transports=ws` to drop the public Nostr/WebRTC leg entirely. The collab
suite's fault-injection tests already exercise this exact server binary.

## Step 5 — PocketBase per app (15 min per app)

One instance per app = isolated users/data. Each is a single binary with
SQLite, auth, file storage, realtime, and an admin UI.

```sh
sudo useradd -r -m -d /srv/pb -s /usr/sbin/nologin pocketbase
cd /tmp && curl -LO https://github.com/pocketbase/pocketbase/releases/latest/download/pocketbase_linux_amd64.zip
sudo mkdir -p /srv/pb/myapp && sudo unzip pocketbase_linux_amd64.zip -d /srv/pb/myapp
sudo chown -R pocketbase:pocketbase /srv/pb
```

`/etc/systemd/system/pb-myapp.service`:

```ini
[Unit]
Description=PocketBase (myapp)
After=network.target

[Service]
User=pocketbase
WorkingDirectory=/srv/pb/myapp
ExecStart=/srv/pb/myapp/pocketbase serve --http 127.0.0.1:8090
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable it, add the Caddy block (`myapp.example.dev → 127.0.0.1:8090`,
reload Caddy), then visit `https://myapp.example.dev/_/` once to create
the admin account. Your GitHub Pages frontend talks to it with the
PocketBase JS SDK; set the app's allowed origins in the admin UI to your
Pages URL. Next app: copy the directory + unit + Caddy block, bump the
port.

## Step 6 — Backups you can trust (20 min + one restore drill)

B2: create a bucket (private) + an app key. Then:

```sh
sudo apt -y install restic
sudo mkdir -p /etc/restic
sudo tee /etc/restic/env >/dev/null <<'EOF'
export RESTIC_REPOSITORY=b2:your-bucket-name:server
export RESTIC_PASSWORD=<long-random-passphrase — store a copy OFF the server>
export B2_ACCOUNT_ID=<keyID>
export B2_ACCOUNT_KEY=<applicationKey>
EOF
sudo chmod 600 /etc/restic/env
. /etc/restic/env && restic init
```

`/etc/cron.daily/backup`, executable:

```sh
#!/bin/sh
. /etc/restic/env
restic backup /srv/pb /opt/plp-sync/data /etc/caddy /etc/systemd/system
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
```

**Do one restore drill now** (this is the step everyone skips and
regrets): `restic restore latest --target /tmp/restore-test`, open the
restored SQLite file, delete the test dir. SQLite + restic snapshots are
consistent enough at this scale; for extra rigor add
`pocketbase ... backup` (built-in) before the restic line.

## Step 7 — Wire it into your routine

- **Monthly (5 min)**: `apt update && apt upgrade`, glance at
  `systemctl --failed`, `restic snapshots | tail`.
- **Adding any future app** = user + directory + systemd unit + one Caddy
  block + add its data path to the backup script. ~10 minutes.
- **For friends/students**: minimal data (usernames over emails), tell
  them it's a hobby box not an SLA, and keep each app in its own
  PocketBase so one mistake never touches another app's data.

## What you end up with

```
GitHub Pages (free, static)          Your VPS (~$8/mo)
┌──────────────────────┐   wss/https   ┌─────────────────────────────┐
│ partlywhole.github.io│ ────────────► │ Caddy (auto-TLS, wildcard)  │
│  /PLP/  + other apps │               │ ├─ plp-sync.example.dev     │
└──────────────────────┘               │ │    automerge relay :3030  │
                                       │ ├─ myapp.example.dev        │
                                       │ │    PocketBase :8090       │
                                       │ └─ nextapp.example.dev …    │
                                       │ restic ──► Backblaze B2     │
                                       └─────────────────────────────┘
```
