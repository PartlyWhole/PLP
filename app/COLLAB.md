# Live collaboration — as-built documentation

[collab.mjs](collab.mjs) shares a session between browsers: the code
editor, and — the part specific to PLP — the *run experience*: as one peer
runs/steps a program, every peer's memory model and console show the
identical run, live, including `input()` prompts and echoed answers.

Related docs: [CONSOLE.md](CONSOLE.md) (chunk store / replay determinism
this feature builds on), [MEMORY.md](MEMORY.md) (record-driven rendering),
`vendor/PROVENANCE.md` (the vendored CRDT bundle), VALIDATION.md CO-series
(evidence), [../tests/collab.spec.mjs](../tests/collab.spec.mjs) (the
automated proofs).

---

## 1. The core idea: replicate records, not panes

PLP's console and memory model are **deterministic projections of the
trace record stream**:

- the console renders its chunk store by pure replay (VALIDATION X0a/X0b);
- the memory model renders whatever step records it has been fed;
- `renderRecordToUI()` in [runner.mjs](runner.mjs) is the **single
  record→UI fan-out** used by both the live runner and the collab
  follower path (extracting it was the load-bearing refactor: one code
  path means a follower cannot drift from a driver).

So a room does not sync xterm buffers, table DOM, or scroll state. It
replicates **the records**, and each peer's panes reconstruct themselves.
Two consequences fall out for free:

1. **Late joiners** replay a finished run identically (same records,
   position 0 → end, X0b determinism).
2. **Equality is testable**: the suite asserts followers' records
   deep-equal the driver's, transcripts are string-equal, and the
   consumer-side stream checks (`traceStreamCheck`) pass on both sides.

Why not re-run the program on each peer instead? Because runs are not
reproducible: live `input()`, wall-clock, `random`, and interleaving all
differ. Exactly one peer executes Python; everyone else replays truth.

Record volume is engine-bounded (`max_steps` default 1000 plus a trace
size limit), which is what makes "records in the CRDT document" viable.

## 2. The shared document

One Automerge document per room. Its URL (`automerge:<id>`) **is** the
room identity, the invite token, and the WebRTC room key.

```
{
  code: string,            // the editor buffer (Automerge text; updateText)
  run: {                   // the current/last run — REPLACED WHOLESALE per run
    runId:    string,      // runner's runId (`plp-<ts>-<n>`)
    driverId: string,      // executing peer's repo peerId (`plp-<rand>`)
    status:   "running" | "done",
    records:  [...],       // engine records verbatim: header, steps,
                           //   diagnostics, terminal — the full stream
    echoes:   [{ at, text }], // accepted input() lines; see §4.3
    summary:  object|null, // run summary, written at terminal
  } | null
}
```

Schema notes:

- `code` must only ever be written through `updateText` (never whole-string
  assignment) — that is what makes concurrent edits merge per character
  instead of last-writer-wins clobbering.
- `run` is deliberately **replaced**, not appended to, on each run: the
  doc stays a bounded size in live memory (Automerge history retains old
  runs, but rooms are ephemeral — no storage adapter — so history lives
  only for the tab session).
- Records are engine-JSON (strings/numbers/bools/null/arrays/objects —
  no `undefined`, no binary; `bytes` values are base64 strings), so they
  round-trip through Automerge unchanged. Followers receive frozen POJOs;
  all consumers only read records, so frozenness is harmless.

## 3. Module wiring

```
index.html  — #btn-share / #btn-leave / #collab-badge (● N)
main.mjs    — createCollab({editor, memory, consoleUI, onUiState})
              runner gets `hooks: collab.hooks`
              run() gates on collab.canRun()
              memory.onUserScrub → collab.notifyUserScrub()
              startup: collab.maybeAutoJoin()   (joins on #room=… links)
              window.plp.collab = collab        (test/debug surface)
runner.mjs  — exports renderRecordToUI / renderRunEnd / END_NOTES;
              createRunner accepts optional hooks
              { onRunStart(runId), onRecord(r), onInput(line), onRunEnd(summary) }
              (all fire AFTER the local UI updated; runner invariant #2 —
              guard before state reset — is untouched)
editor.mjs  — applyRemote(text): common-prefix/suffix splice via
              cm.replaceRange(..., "collab") — preserves cursor/scroll/undo
              and briefly marks changed text + the inferred remote caret
              onLocalChange(fn): change events EXCEPT origin "collab"
collab.mjs  — everything else (room, doc, presence, transports)
```

Everything collaborative is lazy: `collab.mjs` itself is tiny and imported
statically, but the ~3 MB CRDT bundle is dynamically imported only inside
`start()`/`join()`. Solo use never loads it (CO13).

## 4. Runs

### 4.1 Roles

Whoever presses Run is the **driver** for that run; there is no permanent
role. Any idle peer may start the next run.

- Driver: normal local run (Pyodide worker, live input, interrupt — all
  unchanged), plus mirroring via the runner hooks.
- Followers: no Python session at all. They render the mirrored stream.

### 4.2 Driver mirroring (batched)

`onRunStart` writes a fresh `run` object. `onRecord`/`onInput` push into a
pending queue which flushes as **one `handle.change()` per animation
frame** (200 ms `setTimeout` fallback when `document.hidden`, mirroring
the memory model's render throttle):

- one CRDT change per record would freeze the tab at thousands of
  records/sec and bloat history — this is collab invariant "one change per
  frame, never per record" (CLAUDE.md #6);
- batching also keeps sync messages coarse, which every transport prefers.

`onRunEnd` flushes the tail, then sets `status: "done"` + `summary`
(guarded by `runId` so it can't stamp a different run).

### 4.3 Input echo interleaving

In live mode the engine's `echo_stdin` is off and the single echo path is
`runner.provideInput` (CONSOLE.md echo contract). The echoed line is NOT
part of the engine record stream, but it *is* part of the transcript, so
it is mirrored separately: `echoes: [{ at, text }]`, where `at` = the
number of records already in the doc when the echo happened.

Followers interleave deterministically: before applying record `i`, apply
every pending echo with `at ≤ i`. Result: follower `console.text()` is
string-equal to the driver's (prompt arrives via `stdout_delta`, answer
via the echo chunk) — asserted in CO7.

### 4.4 Follower replay

On every doc change:

1. `run.runId` unseen → reset memory + console, print the dim
   `── shared run ──` framing line, clear scrub detachment.
2. Apply new records through `renderRecordToUI(r, { interactive: false })`
   — identical rendering except the follower terminal never enters line
   mode for the driver's `input()` (CO7 asserts `isWaiting()` stays false).
3. When `status === "done"` and all records are applied →
   `renderRunEnd()` (exception summary line + terminal note), same
   function the driver used.

System (`sys`) lines are excluded from `text()` by the console contract,
so the different framing lines ("── run ──" vs "── shared run ──") don't
break transcript equality.

### 4.5 Run gating and the start race

`collab.canRun()` (checked in `main.run()`):

- no room, or no `run`, or `status !== "running"` → allowed;
- my own run active → refused (the runner's own guard also holds);
- a foreign run streaming → refused (`"a peer is running — watch along"`),
  **unless the driver has vanished from the presence roster** (crashed
  tab) — a dead driver must not wedge the room forever.

If two peers Run within the same sync window, both write `run`; Automerge
LWW picks one winner deterministically. The loser discovers it at flush
time (`doc.run.runId !== myRunId`), stops mirroring, interrupts its local
session (`usurped` UI state → `runner.interrupt()`), and replays the
winner like any follower. This is a cosmetic-only race: no data is
corrupted, and it requires near-simultaneous clicks. Not automated
(VALIDATION CO-series notes it); the deterministic lockout path is CO8.

## 5. Scrub and editor presence

Presence rides automerge-repo **ephemeral messages** (never persisted —
the doc must not accumulate a history entry per slider drag).

- **Roster**: `Presence` (from the bundle) heartbeats every 5 s with
  `{ user: { name, color } }` (a generated "Adjective Animal" and a stable
  palette color); peers missing 3
  beats (15 s TTL) are pruned — the crash/network-drop fallback. A
  graceful Leave broadcasts a goodbye first and waits ~200 ms so the
  message flushes *before* the transport it rides on is torn down, making
  departures instant instead of TTL-delayed. On tab close, `pagehide`
  (non-bfcache) broadcasts the goodbye and deliberately does **not** shut
  the repo down — pagehide can't await, and a same-tick shutdown raced the
  goodbye to page death; the browser reaps the sockets moments later
  anyway. Best-effort: same-browser tabs usually get it (sub-second drop),
  a ws/WebRTC buffer may not flush — the freshness window below is the
  guaranteed backstop.
- **Scrub**: every local user scrub broadcasts
  `{ index, n }` — `index` in the current mode's position space, `n` a
  per-peer monotonic sequence so receivers apply each scrub at most once.
  Receivers call `memory.goTo(index)` (which also reconstructs the console
  via the existing `onUserScrub` path) under an `applyingScrub` flag so
  the application doesn't rebroadcast (no echo storms).
- **Editor cursor and selection**: CodeMirror cursor activity broadcasts
  `{ anchor, head, n }` at most once per 40 ms. Indices are ephemeral and
  re-anchored after incoming code splices. Each receiver renders a colored
  caret plus the selected range. The peer's anonymous name appears beside
  the caret after movement, then its DOM label is removed after 1.4 s while
  the caret or selection remains. Goodbye, pruning, and the 20 s freshness
  check remove the peer's editor marks. None of this enters Automerge history.

**Staleness is checked at read time, not prune time.** The Presence
library prunes dead peers on a `setInterval`, which background tabs
throttle to ≥1/min — so an ungracefully closed peer (no goodbye: crash,
kill, some mobile closes) could sit on the badge, and a dead *driver*
could hold the run lock, for minutes. The roster is therefore filtered
through a freshness check (`lastSeenAt` within 20 s = TTL + one heartbeat
of grace) everywhere it is *read* — the ● count, editor presence, and
`canRun()` — and the badge additionally repaints on a 5 s timer, on every
heartbeat event, and
on `visibilitychange`, so TTL expiry surfaces without any inbound event.

**Detachment** (mirrors the live-follow pause semantics): scrubbing away
from the live end sets `detached` — remote scrubs are then ignored;
scrubbing back to the last position re-attaches. A peer driving a live
run ignores remote scrubs while `status === "running"`. Assumption: peers
share the default step mode (line steps); positions are not translated
between modes.

## 6. Transports

Three independent, free pathways, attached **concurrently** to one Repo.
Automerge sync is idempotent — redundant delivery is a no-op — so
"fallback" is *emergent*: whichever pathway is alive carries the room. No
health-check/switchover state machine exists, which is also why fault
injection is testable with simple kill/restart (CO10).

| id | adapter | properties |
|---|---|---|
| `ws` | `WebSocketClientAdapter` → `wss://sync.automerge.org` | works everywhere; also persists the doc server-side while nobody is online; auto-reconnects with retry; the relay is explicitly best-effort ("no reliability guarantees") — which is exactly why it is not the only pathway |
| `p2p` | `TrysteroNetworkAdapter` (vendored, [tools/collab-vendor-build/trystero-adapter.mjs](../tools/collab-vendor-build/trystero-adapter.mjs)) | direct WebRTC data channels; peers meet via trystero's **Nostr strategy** — signaling rides ~a dozen public Nostr relays (free, account-less, connected concurrently, so no single relay matters); signaling payloads are encrypted with a room-id-derived password, so relays can't read SDP/IPs; roughly 1-in-5 consumer peer *pairs* can't traverse NAT without TURN (none is configured) — those pairs are carried by `ws`/`tabs` |
| `tabs` | `BroadcastChannelNetworkAdapter` | same-browser tabs; zero network; also the hermetic transport the deterministic tests run on |

Adapter details worth knowing (`trystero-adapter.mjs`):

- an arrive/welcome handshake maps trystero transport ids ↔ automerge
  peerIds (the same pattern the BroadcastChannel adapter uses);
- repo messages are CBOR-encoded into one binary payload (they mix strings
  and byte arrays); trystero chunks/reassembles large payloads, so
  multi-megabyte first syncs are fine;
- surfaced diagnostics: `peerCount()`, `relayStatus()` (connected/total
  signaling relays), `lastJoinError` (e.g. NAT failure) — the raw material
  for any future per-transport status UI.

**Selection precedence** (both roles):
`?transports=` query seam (debug/tests, never persisted) → the link's
`&via=` (joiners; the *creator's* choice travels in the link, so joiners
need zero configuration) → all three. A full-default room emits a clean
link with no `&via=`.

**Ordering caveat**: the p2p room id IS the doc id, which doesn't exist
until `repo.create()` returns — so `start()` builds the repo with ws/tabs,
creates the doc, then attaches the Trystero adapter via
`networkSubsystem.addNetworkAdapter()` (supported API).

**COI compatibility**: COEP `require-corp` governs embedded subresources;
WebSockets and WebRTC are not in that fetch path, so all three transports
work under the coi-serviceworker shim — and in `?nonisolated` degraded
mode (which only affects live input/interrupt, not sync).

## 7. Room lifecycle

- **Create** (`start()` / Share button): load bundle → repo(+adapters) →
  `repo.create({ code: <editor>, run: null })` → attach p2p → set
  `location.hash = #room=<url>[&via=…]` → bind editor, start presence.
  The Share button then copies the full page URL.
- **Join** (`join(url, via)`; triggered by `maybeAutoJoin()` at startup
  for a page loaded with `#room=` in the URL, or by the **`hashchange`
  listener** when a room link is pasted into the URL bar of a tab already
  showing PLP — hash-only navigation doesn't reload the page, so without
  the listener nothing would happen until a manual refresh. Switching to a
  *different* room while already in one reloads for a clean slate.): build repo with the link's transports →
  `findPatiently()` — request the handle in any state and race
  `whenReady()` against a 45 s deadline, keeping every transport listening
  the whole time (`unavailable` is not terminal: a late relay propagation,
  a finishing WebRTC handshake, or another tab can each flip it ready).
  On success: adopt `doc.code` into the editor (under the remote guard),
  enter the room, and immediately `applyRemoteRun()` so an in-flight or
  finished run appears. On timeout: shut the repo down, stay solo, report
  `unreachable`.
  The COI shim's first-visit reload preserves the hash, so cold joins work.
- **Leave**: presence goodbye → 200 ms flush → `repo.shutdown()` → strip
  the hash → `location.reload()`. The reload is deliberate: it tears down
  every room binding (editor hooks, presence, doc listeners) with zero
  leftover room state. The current editor buffer has already been saved to
  browser-local storage, so the solo page restores the same code.

## 8. Editor binding (the seven glue invariants)

1. **Echo guard**: remote applications run under `applyingRemote`;
   `editor.onLocalChange` additionally filters the `"collab"` CodeMirror
   origin. (Programmatic `plp.editor.setValue` **does** count as a local
   edit and syncs — origin `"setValue"` is not filtered; a stale-cache
   bug during development hid this once, hence the explicit test.)
2. **Equality backstop**: a local change equal to `doc.code` writes
   nothing.
3. **Splice, don't replace**: `editor.applyRemote` computes the common
   prefix/suffix and `replaceRange`s only the middle, so the local cursor,
   scroll, selection, and undo history survive remote edits.
4. **Text ops only**: writes go through `updateText` (§2).
5. **Transient remote activity**: a received splice briefly highlights its
   inserted/replaced text and shows a caret at the resulting position. A
   deletion shows the caret at its deletion point. The marks fade after 1.8
   seconds, never change the local selection or scroll, and are derived UI
   only: they do not enter the shared document.
6. **Live peer presence**: actual caret and selection indices travel through
   ephemeral Presence messages with a monotonic sequence. Per-peer colors and
   transient name labels are view state; stale or departed peers are removed.
   No cursor, selection, color, or name enters the shared document.
7. **Local durability**: `main.mjs` saves every editor change, including
   remote splices, under the versioned browser-local key
   `plp.editor.code.v1`. Startup restores the saved string exactly; only an
   absent or inaccessible value falls back to the sample program.

## 9. Security model (bearer capability)

The doc URL is an **irrevocable bearer capability**: anyone who has the
link can read and write the room — the code, the run stream, everything —
forever. There is no read-only mode, no ACL, no revocation (ecosystem-wide
Automerge status, not a PLP choice). The public sync server additionally
sees room plaintext. Consequences:

- share links like you'd share edit access, because that's what they are;
- the only "revocation" is abandoning the room (new doc, new link);
- defensive rendering is the last line of defense: followers only feed
  records through the same validated fan-out, and `traceStreamCheck` runs
  consumer-side, so malformed hostile records surface as check errors
  rather than silent corruption. (A hostile peer can still vandalize the
  code/run — accepted for a teaching tool.)

## 10. Test seams and debug surface

| seam | purpose |
|---|---|
| `?transports=ws,p2p,tabs` | force a room's pathway set (never persisted) |
| `window.__collabSyncServerUrl` | point `ws` at a local throwaway sync server (fault injection, CO10) |
| `window.__collabRtcTestConfig` | extra trystero room config; tests pass `{_test_only_mdnsHostFallbackToLoopback: true}` because headless Chromium has no mDNS responder |
| `window.__collabNet` | live adapter internals: `rtc.peerCount()`, `rtc.relayStatus()`, `rtc.lastJoinError`, `ws.socket.readyState` |
| `window.__amLoaded` | bundle-loaded sentinel |
| `plp.collab` | `start()/join()/leave()/canRun()`, `isActive()`, `records()` (the follower-view stream; `null` while I'm the driver — use `plp.records()` then), `checkErrors()` (stream checks over the follower view), `detached()`, `selfId`, `url()`, `_state` (raw internals) |

## 11. Validation map (VALIDATION.md CO-series)

Deterministic scenarios run on `tabs`-only rooms — hermetic, zero network,
CI-gating. The severing test spawns a **local** sync server
(`@automerge/automerge-repo-sync-server` devDependency — dev-only, never
served) and kills it mid-record-stream: the follower visibly stalls, the
driver finishes, the server restarts on the same port, and sync resumes to
full equality — that is the fallback/recovery claim, proven. The p2p
scenario uses real WebRTC with the loopback seam and **skips** (never
fails) when the public Nostr relays are unreachable, so CI is not hostage
to the exact unreliability this feature routes around. Public-relay
*reliability over time* is deliberately out of the suite — that's a
post-deploy canary concern, not a repo gate.

The universal assertion bundle: follower records deep-equal driver
records; `console.text()` string-equal; `memory.stepCount()` equal;
`checkErrors()` empty on both sides.

## 12. The vendored bundle

`vendor/automerge-collab.mjs` (~3 MB, MIT components) is **built, not
fetched** — recipe, lockfile, and the trystero adapter live in
[tools/collab-vendor-build/](../tools/collab-vendor-build/):

```sh
cd tools/collab-vendor-build && npm install && npm run build
```

Pinned: `@automerge/automerge` 2.2.9, `@automerge/automerge-repo` 2.5.6,
websocket + broadcastchannel adapters, `trystero` ^0.25.3 (Nostr entry),
`cbor-x`. The esbuild recipe aliases every automerge import onto the
base64-inlined self-initializing WASM entrypoints (the default bundler
entry emits a `.wasm` sibling that never initializes at runtime — the
classic pitfall). Exports: `Repo`, the three adapters, `Presence`,
`updateText`, plus trystero internals for diagnostics. Hash recorded in
`vendor/PROVENANCE.md` on every rebuild (standing rule). The bundle is
self-contained at import time (COEP-safe); at *runtime* it dials only the
sync relay and Nostr relays, and only once a room starts.

## 13. Known limitations / future work

- **No follower input**: only the driver can answer `input()` (a
  "raise-hand" relay over ephemeral messages is a natural v2).
- **No remote Stop**: followers can't interrupt the driver's run.
- **Scrub positions assume the default step mode** on all peers.
- **Start-race cosmetics**: the usurped driver's partial output may
  briefly interleave before the winner's replay resets the panes.
- **Bearer-link security** (§9) is inherent until Keyhive-class tech
  ships upstream.
- Presence names are whimsical and anonymous; attribution/identity is
  out of scope.
