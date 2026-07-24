// Live collaboration: share the editor AND the run experience (memory model
// + console) with peers. Built on Automerge (CRDT) via the vendored bundle
// (vendor/automerge-collab.mjs — see vendor/PROVENANCE.md and app/COLLAB.md).
//
// Architecture in one paragraph: the console chunk store and the memory
// model are deterministic projections of the trace record stream, so a room
// replicates the *records*, not the panes. One shared doc per room holds
// { code, run }: `code` syncs the editor with character-level merging
// (updateText); `run` holds the driver's record stream, mirrored in
// rAF-sized batches, so followers (and late joiners, via ordinary CRDT
// sync) replay the identical run through the same record→UI fan-out the
// live runner uses (renderRecordToUI). Presence (roster, shared scrub
// position) rides ephemeral messages and is never persisted in the doc.
//
// Transports — three independent, free pathways attached CONCURRENTLY
// (CRDT sync is idempotent, so redundant delivery is safe; whichever path
// works carries the room — "fallback" is emergent, not a state machine):
//   ws   — Automerge's public sync server (also persists while nobody's on)
//   p2p  — direct WebRTC; peers meet via public Nostr relays (trystero)
//   tabs — BroadcastChannel; same-browser tabs, zero network
// `?transports=` (test/debug seam) > link's `&via=` (joiner) > all three.

import { renderRecordToUI, renderRunEnd } from "./runner.mjs";
import { isRenderableRecord } from "./record-guard.mjs";
import { traceStreamCheck } from "./stream-checks.mjs";

const ALL_TRANSPORTS = ["ws", "p2p", "tabs"];
// Self-hosted relay (deploy/relay/): the same sync-server package the
// CO-series fault-injection tests exercise, pinned 0.2.8.
const SYNC_SERVER = "wss://sync.partlywhole.org";

function parseTransports(raw) {
  if (!raw) return null;
  const picked = new Set(raw.split(",").map((s) => s.trim()).filter((s) => ALL_TRANSPORTS.includes(s)));
  return picked.size ? picked : null;
}
const paramTransports = () => parseTransports(new URLSearchParams(location.search).get("transports"));
const roomKey = (docUrl) => String(docUrl).replace(/^automerge:/, ""); // trystero room id

function parseHash() {
  const m = location.hash.match(/^#room=(automerge:[A-Za-z0-9]+)(?:&via=([\w,]*))?$/);
  return m ? { url: m[1], via: m[2] ?? null } : null;
}

const NAME_ADJ = ["Plucky", "Zesty", "Nimble", "Cheery", "Snazzy", "Bouncy", "Dapper", "Breezy", "Sunny", "Funky"];
const NAME_ANIMAL = ["Otter", "Panda", "Fox", "Heron", "Lynx", "Gecko", "Wombat", "Axolotl", "Puffin", "Quokka"];
const PEER_COLORS = ["#56b6c2", "#c678dd", "#e5c07b", "#98c379", "#61afef", "#e06c75", "#d19a66", "#7fbbb3"];
const CURSOR_BROADCAST_MS = 40;
const pickFrom = (a) => a[Math.floor(Math.random() * a.length)];
const colorForPeer = (peerId) => {
  let hash = 0;
  for (const ch of String(peerId)) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
};

let _lib = null;
async function loadCollabLib() {
  // Relative + import.meta.url so it resolves under the /PLP/ project
  // subpath; the ~3 MB bundle loads only when a room starts (solo pays 0).
  _lib ??= await import(new URL("../vendor/automerge-collab.mjs", import.meta.url).href);
  window.__amLoaded = true; // test sentinel
  return _lib;
}

export function createCollab({ editor, memory, consoleUI, onUiState }) {
  const selfId = "plp-" + Math.random().toString(36).slice(2, 10);
  const c = {
    active: false,
    lib: null, repo: null, net: null, handle: null, presence: null,
    applyingRemote: false,
    // driver state
    myRunId: null, pending: [], flushScheduled: false, usurped: false,
    // follower state
    view: { runId: null, records: 0, echoes: 0, ended: false, shared: [] },
    // scrub sharing
    scrubSeq: 0, peerScrubSeen: new Map(), applyingScrub: false, detached: false,
    // editor cursor/selection presence (ephemeral)
    cursorSeq: 0, cursorTimer: null, pendingCursor: null,
    peerCursorSeen: new Map(), peerCursorStates: new Map(),
  };

  const guarded = (fn) => { c.applyingRemote = true; try { fn(); } finally { c.applyingRemote = false; } };
  const doc = () => c.handle?.doc();

  function makeNetwork(key, on) {
    const net = { adapters: [] };
    // window.__collabSyncServerUrl: test seam — point the ws transport at a
    // local throwaway sync server (fault-injection tests). Undefined in prod.
    if (on.has("ws")) { net.ws = new c.lib.WebSocketClientAdapter(window.__collabSyncServerUrl ?? SYNC_SERVER); net.adapters.push(net.ws); }
    // window.__collabRtcTestConfig: test seam (headless Chromium can't
    // resolve mDNS host candidates; tests pass trystero's loopback
    // fallback). Undefined in production.
    if (on.has("p2p") && key) {
      net.rtc = new c.lib.TrysteroNetworkAdapter({ roomId: key, config: window.__collabRtcTestConfig });
      net.adapters.push(net.rtc);
    }
    if (on.has("tabs")) { net.bc = new c.lib.BroadcastChannelNetworkAdapter(); net.adapters.push(net.bc); }
    window.__collabNet = net; // debug/test seam (peerCount, relayStatus, ws socket state)
    return net;
  }

  // ---- editor binding (invariants: echo guard + equality backstop; splice
  // remote changes so local cursor/scroll/undo survive) --------------------
  function queueCursorBroadcast(nextSelection = editor.selection()) {
    if (c.applyingRemote || !c.active || !c.presence) return;
    c.pendingCursor = nextSelection;
    if (c.cursorTimer !== null) return;
    c.cursorTimer = setTimeout(() => {
      c.cursorTimer = null;
      const cursor = c.pendingCursor;
      c.pendingCursor = null;
      if (!cursor || !c.active || !c.presence) return;
      c.presence.broadcast("cursor", { ...cursor, n: ++c.cursorSeq });
    }, CURSOR_BROADCAST_MS);
  }

  function bindEditor() {
    editor.onLocalChange(() => {
      if (c.applyingRemote || !c.active || !c.handle) return;
      const value = editor.getValue();
      if (doc()?.code === value) return; // echo backstop
      c.handle.change((d) => c.lib.updateText(d, ["code"], value));
    });
    editor.onCursorActivity((selection) => queueCursorBroadcast(selection));
  }

  function applyRemoteCode() {
    const code = doc()?.code;
    if (typeof code === "string" && code !== editor.getValue()) {
      guarded(() => editor.applyRemote(code));
      // Presence may arrive before the corresponding CRDT splice. Re-anchor
      // saved peer indices against the new buffer without restarting labels.
      for (const cursor of c.peerCursorStates.values()) {
        editor.showPeerPresence({ ...cursor, showLabel: false });
      }
      // The splice may have shifted this learner's own caret/selection.
      queueCursorBroadcast(editor.selection());
    }
  }

  // ---- driver side: mirror the run into the doc --------------------------
  // One handle.change per animation frame, NEVER per record (records arrive
  // at thousands/sec — same throttling rule as the memory model renders).
  function scheduleFlush() {
    if (c.flushScheduled) return;
    c.flushScheduled = true;
    const flush = () => { c.flushScheduled = false; flushPending(); };
    if (document.hidden) setTimeout(flush, 200);
    else requestAnimationFrame(flush);
  }

  function flushPending() {
    if (!c.active || !c.handle || !c.pending.length) return;
    if (doc()?.run?.runId !== c.myRunId) {
      // A concurrent Run on another peer won the LWW race for d.run. Stop
      // mirroring and stop the local session; the doc-change handler will
      // replay the winner's run.
      c.pending = [];
      if (!c.usurped) { c.usurped = true; onUiState?.({ type: "usurped" }); }
      return;
    }
    const batch = c.pending;
    c.pending = [];
    c.handle.change((d) => {
      for (const item of batch) {
        if (item.echo !== undefined) d.run.echoes.push({ at: d.run.records.length, text: item.echo });
        else d.run.records.push(item.record);
      }
    });
  }

  const hooks = {
    onRunStart(runId) {
      if (!c.active || !c.handle) return;
      c.myRunId = runId;
      c.pending = [];
      c.usurped = false;
      c.handle.change((d) => {
        d.run = { runId, driverId: selfId, status: "running", records: [], echoes: [], summary: null };
      });
    },
    onRecord(record) {
      if (!c.active || c.myRunId === null || c.usurped) return;
      c.pending.push({ record });
      scheduleFlush();
    },
    onInput(line) {
      if (!c.active || c.myRunId === null || c.usurped) return;
      c.pending.push({ echo: line + "\n" });
      scheduleFlush();
    },
    onRunEnd(summary) {
      if (!c.active || !c.handle || c.myRunId === null || c.usurped) return;
      flushPending();
      const runId = c.myRunId;
      c.handle.change((d) => {
        if (d.run?.runId !== runId) return;
        d.run.status = "done";
        d.run.summary = summary ? JSON.parse(JSON.stringify(summary)) : null;
      });
    },
  };

  // ---- follower side: replay the driver's run --------------------------
  function applyRemoteRun() {
    const run = doc()?.run;
    if (!run || run.runId === c.myRunId) return; // absent, or I am the driver
    const v = c.view;
    if (run.runId !== v.runId) {
      // New (or first-seen) run: reset both panes, replay from record 0 —
      // exactly the late-joiner path; X0b determinism makes it identical.
      v.runId = run.runId; v.records = 0; v.echoes = 0; v.ended = false; v.shared = []; v.warned = false;
      c.detached = false;
      memory.reset();
      consoleUI.reset();
      consoleUI.system("── shared run ──");
      onUiState?.({ type: "remote-run", phase: "running" });
    }
    const records = run.records ?? [], echoes = run.echoes ?? [];
    while (v.records < records.length || v.echoes < echoes.length) {
      if (v.echoes < echoes.length && echoes[v.echoes].at <= v.records) {
        // Remote-authored text: keep it a bounded string (the terminal
        // renders text, never markup, so this is a size guard only).
        const text = echoes[v.echoes].text;
        if (typeof text === "string") consoleUI.append("echo", text.slice(0, 4096));
        v.echoes += 1;
      } else if (v.records < records.length) {
        const r = records[v.records];
        v.records += 1;
        // Trust boundary: this record came from another peer's document,
        // not from our engine facade, so it has had no schema validation.
        // Drop anything not shaped like engine output rather than render it
        // (app/record-guard.mjs).
        if (!isRenderableRecord(r)) {
          if (!v.warned) {
            v.warned = true;
            consoleUI.system("⚠ ignored malformed record(s) from the shared session");
            console.warn("collab: dropped malformed remote record", r);
          }
          continue;
        }
        v.shared.push(r);
        renderRecordToUI(r, { memory, consoleUI, interactive: false });
      } else break;
    }
    if (run.status === "done" && !v.ended && v.records === records.length) {
      v.ended = true;
      const reason = run.summary?.terminal_reason ?? "completed";
      renderRunEnd(v.shared, reason, consoleUI);
      onUiState?.({ type: "remote-run", phase: "done", reason });
    }
  }

  function onDocChange() {
    applyRemoteCode();
    applyRemoteRun();
  }

  // ---- presence: roster + shared scrub position (ephemeral, never in the
  // doc — every mouse move in permanent history would be pollution) -------

  // A peer is "fresh" if we heard from it within TTL + one heartbeat of
  // grace. This is OUR staleness check, applied at read time (badge count,
  // run lock): the Presence library's TTL prune runs on a setInterval,
  // which background tabs throttle to ≥1/min — trusting the un-pruned
  // roster left ungracefully-closed peers on the badge (and a dead driver
  // holding the run lock) for minutes.
  const FRESH_MS = 20000;
  const isFresh = (p) => p.lastSeenAt == null || Date.now() - p.lastSeenAt < FRESH_MS;
  const freshPeers = () =>
    c.presence ? Object.values(c.presence.getPeerStates().value).filter(isFresh) : [];

  function startPresence() {
    const me = {
      name: pickFrom(NAME_ADJ) + " " + pickFrom(NAME_ANIMAL),
      color: colorForPeer(selfId),
    };
    c.presence = new c.lib.Presence({ handle: c.handle });
    // Heartbeat 5s, prune after 3 missed (15s) — the fallback for ungraceful
    // exits; a graceful leave broadcasts a goodbye that drops us instantly.
    c.presence.start({
      initialState: { user: me, cursor: { ...editor.selection(), n: ++c.cursorSeq } },
      heartbeatMs: 5000,
      peerTtlMs: 15000,
    });
    const renderPeers = () => {
      const peers = Object.values(c.presence.getPeerStates().value).filter(isFresh);
      onUiState?.({ type: "peers", count: peers.length + 1 });
      const cursorPeerIds = new Set();
      for (const p of peers) {
        const cursor = p.value?.cursor;
        if (cursor && Number.isInteger(cursor.anchor) && Number.isInteger(cursor.head)
          && typeof cursor.n === "number") {
          cursorPeerIds.add(p.peerId);
          const lastCursor = c.peerCursorSeen.get(p.peerId) ?? -1;
          if (cursor.n > lastCursor) {
            c.peerCursorSeen.set(p.peerId, cursor.n);
            const advertisedColor = p.value?.user?.color;
            const peerCursor = {
              peerId: p.peerId,
              name: typeof p.value?.user?.name === "string" ? p.value.user.name : "Collaborator",
              color: PEER_COLORS.includes(advertisedColor) ? advertisedColor : colorForPeer(p.peerId),
              anchor: cursor.anchor,
              head: cursor.head,
            };
            c.peerCursorStates.set(p.peerId, peerCursor);
            editor.showPeerPresence({ ...peerCursor, showLabel: true });
          }
        }

        const s = p.value?.scrub;
        if (!s || typeof s.n !== "number") continue;
        if ((c.peerScrubSeen.get(p.peerId) ?? -1) >= s.n) continue;
        c.peerScrubSeen.set(p.peerId, s.n);
        // Follow a peer's scrubbing unless this user scrubbed away locally
        // (same detach semantics as the live-follow pause). Never during my
        // own live run — my panes are live.
        if (c.detached || c.myRunId === doc()?.run?.runId && doc()?.run?.status === "running") continue;
        if (typeof s.index === "number") {
          c.applyingScrub = true;
          try { memory.goTo(s.index); } finally { c.applyingScrub = false; }
        }
      }
      editor.retainPeerPresence(cursorPeerIds);
      for (const peerId of c.peerCursorStates.keys()) {
        if (!cursorPeerIds.has(peerId)) {
          c.peerCursorStates.delete(peerId);
          c.peerCursorSeen.delete(peerId);
        }
      }
    };
    for (const ev of ["update", "snapshot", "goodbye", "heartbeat", "pruning"]) c.presence.on(ev, renderPeers);
    // The badge must also DROP without any inbound event (an ungracefully
    // closed peer sends nothing, and the library's prune interval is
    // throttled in background tabs): repaint on our own cadence and the
    // moment the tab comes back to the foreground.
    c.rosterTimer = setInterval(renderPeers, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) renderPeers(); });
  }

  // Called from main's onUserScrub (i.e. a LOCAL user scrub, or our own
  // application of a remote one — the flag distinguishes them).
  function notifyUserScrub() {
    if (!c.active || c.applyingScrub) return;
    // Scrubbing away from the live end detaches this peer from remote
    // scrub-following; scrubbing back to the end re-attaches.
    c.detached = memory.stepIndex() < memory.stepCount() - 1;
    c.presence?.broadcast("scrub", { index: memory.stepIndex(), n: ++c.scrubSeq });
  }

  // ---- room lifecycle ----------------------------------------------------
  async function enterRoom() {
    c.active = true;
    c.handle.on("change", onDocChange);
    bindEditor();
    startPresence();
    onUiState?.({ type: "state", state: "live" });
  }

  async function start() {
    if (c.active) return c.handle.url;
    onUiState?.({ type: "state", state: "connecting" });
    c.lib = await loadCollabLib();
    const on = paramTransports() ?? new Set(ALL_TRANSPORTS);
    // The p2p adapter needs the room id, which IS the doc id — create the
    // doc over ws/tabs first, then attach p2p to the live repo.
    c.net = makeNetwork(null, on);
    c.repo = new c.lib.Repo({ network: c.net.adapters, peerId: selfId });
    c.handle = c.repo.create({ code: editor.getValue(), run: null });
    await c.handle.whenReady();
    if (on.has("p2p")) {
      c.net.rtc = new c.lib.TrysteroNetworkAdapter({ roomId: roomKey(c.handle.url), config: window.__collabRtcTestConfig });
      c.net.adapters.push(c.net.rtc);
      c.repo.networkSubsystem.addNetworkAdapter(c.net.rtc);
    }
    location.hash = "#room=" + c.handle.url
      + (on.size === ALL_TRANSPORTS.length ? "" : "&via=" + [...on].join(","));
    await enterRoom();
    return c.handle.url;
  }

  // Patient multi-transport find: ONE long-lived repo with every transport
  // attached; grab the handle in whatever state and wait for readiness —
  // any transport (late ws propagation, a WebRTC handshake finishing, a
  // same-browser tab) can deliver the doc and flip it ready.
  async function findPatiently(repo, url, deadlineMs) {
    const handle = await repo.find(url, { allowableStates: ["ready", "unavailable", "requesting", "loading"] });
    if (handle.isReady?.() || handle.state === "ready") return handle;
    return Promise.race([
      handle.whenReady().then(() => handle),
      new Promise((r) => setTimeout(() => r(null), deadlineMs)),
    ]);
  }

  async function join(url, via, { deadlineMs = 45000 } = {}) {
    if (c.active) return true;
    onUiState?.({ type: "state", state: "connecting" });
    c.lib = await loadCollabLib();
    const on = paramTransports() ?? parseTransports(via) ?? new Set(ALL_TRANSPORTS);
    c.net = makeNetwork(roomKey(url), on);
    c.repo = new c.lib.Repo({ network: c.net.adapters, peerId: selfId });
    c.handle = await findPatiently(c.repo, url, deadlineMs);
    if (!c.handle) {
      try { c.repo.shutdown?.(); } catch { /* best-effort */ }
      c.repo = null; c.net = null;
      onUiState?.({ type: "state", state: "unreachable" });
      return false;
    }
    guarded(() => { const code = c.handle.doc()?.code; if (typeof code === "string") editor.setValue(code); });
    await enterRoom();
    applyRemoteRun(); // adopt an already-finished (or in-flight) run
    return true;
  }

  // Join if the URL carries a room hash (page load / link paste + reload).
  async function maybeAutoJoin() {
    const room = parseHash();
    if (!room) return false;
    return join(room.url, room.via);
  }

  // Pasting a room link into a tab that already shows PLP only changes the
  // hash — the browser does NOT reload, so startup auto-join never ran and
  // nothing happened (the "have to refresh to join" bug). Join live on
  // hashchange; switching to a DIFFERENT room while active reloads for a
  // clean slate. start() setting its own hash is a no-op here (same url,
  // already active).
  addEventListener("hashchange", () => {
    const room = parseHash();
    if (!room) return;
    if (c.active) {
      if (c.handle && c.handle.url !== room.url) location.reload();
      return;
    }
    join(room.url, room.via).catch((e) => {
      console.error(e);
      onUiState?.({ type: "state", state: "unreachable" });
    });
  });

  async function leave() {
    if (!c.active) return;
    // Goodbye first, then a short flush pause so it reaches the datachannel
    // / socket BEFORE the transport it rides on is torn down.
    try { c.presence?.stop?.(); } catch { /* best-effort */ }
    await new Promise((r) => setTimeout(r, 200));
    try { c.repo?.shutdown?.(); } catch { /* best-effort */ }
    history.replaceState(null, "", location.pathname + location.search);
    location.reload(); // full teardown of every room binding, zero leftovers
  }

  // Tab-close politeness: broadcast the goodbye and STOP — no repo.shutdown
  // here. pagehide can't await, and shutting the transports down in the
  // same tick raced the goodbye to page death (peers then waited out the
  // ~20 s freshness window instead of dropping us instantly). Leaving the
  // repo alive costs nothing: the browser destroys the sockets moments
  // later, and a non-persisted pagehide page never comes back. Best-effort
  // by nature — same-browser tabs (BroadcastChannel) usually get the
  // goodbye; a ws/WebRTC buffer may not flush, and the freshness window
  // remains the guaranteed backstop.
  addEventListener("pagehide", (e) => {
    if (e.persisted || !c.active) return;
    try { c.presence?.stop?.(); } catch { /* best-effort */ }
  });

  // Run gating: while a room-mate's run is streaming, local Run is off. A
  // vanished driver (crashed tab — presence roster no longer has them)
  // releases the lock rather than wedging the room.
  function canRun() {
    if (!c.active) return true;
    const run = doc()?.run;
    if (!run || run.status !== "running") return true;
    if (run.runId === c.myRunId) return false; // my own run is active
    // Only a FRESH driver holds the lock — a crashed/vanished driver
    // (stale or absent in the roster) must not wedge the room.
    return !freshPeers().some((p) => p.peerId === run.driverId);
  }

  return {
    start, join, maybeAutoJoin, leave, canRun, hooks, notifyUserScrub,
    isActive: () => c.active,
    selfId,
    url: () => c.handle?.url ?? null,
    // Shared-run records as seen by this peer (driver: local runner owns
    // records; followers: the replayed stream). For tests/debugging.
    records: () => (c.myRunId !== null && doc()?.run?.runId === c.myRunId ? null : c.view.shared),
    checkErrors: () => traceStreamCheck(c.view.shared).errors,
    detached: () => c.detached,
    _state: c, // debug seam
  };
}
