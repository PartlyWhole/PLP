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

## Security posture

What the script hardens, and what it deliberately does not:

| control | effect |
|---|---|
| SSH keys only | `PasswordAuthentication no` + `KbdInteractiveAuthentication no` + `PermitRootLogin prohibit-password`, in both `sshd_config` and a `sshd_config.d` drop-in (Ubuntu 24.04 drop-ins would otherwise win). `ufw limit` throttles repeated attempts |
| relay confined to loopback | the sync server calls `app.listen(PORT)` with no host, so it binds `0.0.0.0`; the unit adds `IPAddressDeny=any` + `IPAddressAllow=localhost`, so only Caddy can reach it **even if ufw were disabled**. Plus `ProtectSystem=strict`, `ProtectHome`, `PrivateDevices`, `NoNewPrivileges`, `MemoryMax=1G`, `TasksMax=256` |
| browser-origin allowlist | Caddy 403s WebSocket/HTTP requests carrying an `Origin` outside `*.partlywhole.org`, `partlywhole.github.io`, or localhost |
| disk guard | hourly: if the room store exceeds `DATA_CAP_MB` (2 GB), the least-recently-touched rooms are deleted until it fits (logged via `logger -t plp-sync-diskguard`). Weekly: rooms untouched for `PRUNE_DAYS` are removed |
| request size cap | `request_body max_size 32MB` |

**Not solved — know these:**

- **The relay is unauthenticated.** Anyone who knows the hostname can sync
  arbitrary documents; the Origin check only stops *browsers* on other
  sites, since any non-browser client forges `Origin` freely. The disk
  guard bounds the damage rather than preventing the abuse.
- **Room links are unrevocable capabilities.** Anyone holding a link has
  permanent read+write on that room. There is no kick, no expiry (an
  actively-used room never ages out), and no way to make a room private
  after sharing.
- **Room contents are plaintext on disk.** You — and anyone who compromises
  the box — can read every shared session's code. Tell students that.
- Peers can rewrite each other's editor buffer, and the engines are
  liveness boundaries, not security sandboxes: treat code arriving from a
  room as untrusted before you press Run.

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
