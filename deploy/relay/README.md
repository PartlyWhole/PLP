# PLP collab relay — deployment runbook

Self-hosted replacement for the public `wss://sync.automerge.org` relay,
served at **sync.partlywhole.org**. The server binary is
`@automerge/automerge-repo-sync-server` — the exact package the collab
test suite fault-injects against (kill/restart mid-stream, CO-series).

## Your three manual steps

1. **VPS** (~5 min): Hetzner Cloud → new project → add your SSH public key
   → create server: Ubuntu 24.04, CX22 (or CAX11/ARM), location nearest
   your users. Note the IPv4 address.
2. **DNS** (~2 min, at Porkbun): add record
   `A  sync  →  <server-ip>`  (TTL default is fine).
3. **Run the script** (~5 min, from this repo on your machine):

   ```sh
   scp -r deploy/relay root@<server-ip>:/root/
   ssh root@<server-ip> 'bash /root/relay/setup.sh'
   ```

   Then verify from your laptop:

   ```sh
   curl -sI https://sync.partlywhole.org | head -1    # HTTP/2 200
   ```

   (First request may take ~a minute while Caddy obtains the TLS
   certificate; DNS must already resolve for issuance to succeed.)

The script is idempotent — re-run it if anything fails midway. Overridable
env vars: `RELAY_HOST`, `SYNC_VERSION` (pinned 0.2.8), `PRUNE_DAYS` (90).

## What the script sets up

| piece | detail |
|---|---|
| firewall | ufw: SSH + 80/443 only; unattended security upgrades on |
| Caddy | auto-TLS + WebSocket proxy `sync.partlywhole.org → 127.0.0.1:3030`; future apps = append blocks to `/etc/caddy/Caddyfile` |
| relay | systemd unit `plp-sync`, dedicated no-login user, `DATA_DIR=/opt/plp-sync/data`, sandboxed (ProtectSystem=strict), auto-restart |
| hygiene | weekly cron deletes room files untouched 90 days (rooms are link-access-only; stale = unreachable) |

## Wiring PLP to it (after the relay answers)

In [app/collab.mjs](../../app/collab.mjs), change:

```js
const SYNC_SERVER = "wss://sync.partlywhole.org";
```

The `window.__collabSyncServerUrl` override stays (the test suite uses it
to point at its local fixture server, so tests are unaffected). Optionally
default share links to `?transports=ws` to drop the public Nostr/WebRTC
leg entirely — with a reliable owned relay, the extra transports are
redundancy, not necessity.

**Do not flip `SYNC_SERVER` before the relay is live** — a dead primary
transport degrades rooms to the flakier P2P/tabs legs.

## Operations

- Health: `systemctl status plp-sync caddy`, logs via
  `journalctl -u plp-sync -f`.
- Update the relay: bump `SYNC_VERSION`, re-run `setup.sh` (or
  `sudo -u plpsync npm install @automerge/automerge-repo-sync-server@<v>`
  in `/opt/plp-sync` + `systemctl restart plp-sync`).
- Monthly 5-min check: `apt update && apt upgrade`, `systemctl --failed`.
- Room data is best-effort by design (multi-transport rooms; links are the
  only access control) — no backups needed for the relay. Add restic only
  when this box gains data that matters (e.g. PocketBase), per
  [design/server-setup-guide.md](../../design/server-setup-guide.md).
