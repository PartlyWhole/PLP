// Live-collaboration suite (CO-series in VALIDATION.md). Deterministic
// scenarios run over BroadcastChannel-only rooms (`?transports=tabs`) —
// zero network, hermetic. The p2p scenario uses real WebRTC with trystero's
// loopback test knob and SKIPS (not fails) when the public Nostr signaling
// relays are unreachable from this network. The severing scenario runs a
// local throwaway sync server (devDependency) and kills it mid-stream.
//
// Core assertion bundle everywhere: a follower is a bit-identical projection
// of the driver — same records, same transcript, same memory positions, and
// clean stream checks on BOTH sides.

import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE = "/PLP/";
const DEPLOYED_SITE = Boolean(process.env.PLP_BASE_URL);

async function gotoApp(page, query = "", hash = "") {
  await page.goto(SITE + query + hash);
  await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.plp));
}

const startRoom = (page) => page.evaluate(() => window.plp.collab.start());

async function joinRoom(page, query, url, via) {
  await gotoApp(page, query, `#room=${url}&via=${via}`);
  await page.waitForFunction(() => window.plp.collab.isActive(), null, { timeout: 60_000 });
}

// Driver-side run that returns the summary (kick + poll — first run boots Pyodide).
async function runOn(page, source) {
  if (source !== undefined) await page.evaluate((s) => window.plp.editor.setValue(s), source);
  await page.evaluate(() => { window.__run = window.plp.run(); });
  return page.evaluate(() => window.__run); // resolves when the run ends

}

// The follower/driver equality bundle.
async function expectFollowerMatchesDriver(follower, driver) {
  const driverRecords = await driver.evaluate(() => window.plp.records());
  await expect.poll(
    () => follower.evaluate(() => window.plp.collab.records()?.length),
    { timeout: 30_000 },
  ).toBe(driverRecords.length);
  expect(await follower.evaluate(() => window.plp.collab.records())).toEqual(driverRecords);
  expect(await follower.evaluate(() => window.plp.console.text()))
    .toBe(await driver.evaluate(() => window.plp.console.text()));
  expect(await follower.evaluate(() => window.plp.memory.stepCount()))
    .toBe(await driver.evaluate(() => window.plp.memory.stepCount()));
  expect(await follower.evaluate(() => window.plp.collab.checkErrors())).toEqual([]);
  expect(await driver.evaluate(() => window.plp.checkErrors())).toEqual([]);
}

test.describe("collab (tabs transport, hermetic)", () => {
  test("create/join, two-way editor sync, no sync-server sockets", async ({ page, context }) => {
    const wsHits = [];
    page.on("websocket", (ws) => { if (ws.url().includes("sync.automerge.org")) wsHits.push(ws.url()); });
    await gotoApp(page, "?transports=tabs");
    await page.evaluate(() => window.plp.editor.setValue("seeded = 1\n"));
    const url = await startRoom(page);
    expect(url).toMatch(/^automerge:/);
    expect(await page.evaluate(() => location.hash)).toBe(`#room=${url}&via=tabs`);

    const b = await context.newPage();
    b.on("websocket", (ws) => { if (ws.url().includes("sync.automerge.org")) wsHits.push(ws.url()); });
    await joinRoom(b, "?transports=tabs", url, "tabs");
    // Joiner adopted the creator's code.
    await expect.poll(() => b.evaluate(() => window.plp.editor.getValue())).toContain("seeded = 1");
    await expect.poll(() => page.evaluate(() => document.getElementById("collab-peers").textContent)).toBe("2");
    await expect.poll(() => b.evaluate(() => document.getElementById("collab-peers").textContent)).toBe("2");

    // Cursor and selection presence is ephemeral and attributed. The name
    // gets out of the way, while the caret/selection remains until movement
    // or departure updates it.
    const aId = await page.evaluate(() => window.plp.collab.selfId);
    const bId = await b.evaluate(() => window.plp.collab.selfId);
    await page.evaluate(() => window.plp.editor.setSelection(0, 6));
    const aCursorOnB = b.locator(`.cm-peer-cursor[data-peer-id="${aId}"]`);
    const aSelectionOnB = b.locator(`.cm-peer-selection[data-peer-id="${aId}"]`);
    const aLabelOnB = aCursorOnB.locator(".cm-peer-label");
    await expect(aCursorOnB).toHaveCount(1);
    await expect.poll(() => aSelectionOnB.count()).toBeGreaterThan(0);
    await expect(aLabelOnB).toHaveCount(1);
    await expect(aLabelOnB).toHaveText(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    await expect(page.locator(`.cm-peer-cursor[data-peer-id="${aId}"]`)).toHaveCount(0);
    await expect(aLabelOnB).toHaveCount(0, { timeout: 5000 });
    await expect(aCursorOnB).toHaveCount(1);
    await expect.poll(() => aSelectionOnB.count()).toBeGreaterThan(0);

    // Moving to a caret collapses the selection and briefly re-shows the name.
    await page.evaluate(() => window.plp.editor.setSelection(4));
    await expect(aLabelOnB).toHaveCount(1);
    await expect(aSelectionOnB).toHaveCount(0);

    // Two-way live sync (programmatic setValue counts as a local edit).
    await page.evaluate(() => window.plp.editor.setValue("a_to_b = 2\nseeded = 1\n"));
    await expect.poll(() => b.evaluate(() => window.plp.editor.getValue())).toContain("a_to_b");
    // The receiver briefly sees the changed text and inferred remote caret;
    // the author does not get a remote cue for their own local edit.
    await expect.poll(() => b.locator(".cm-remote-edit").count()).toBeGreaterThan(0);
    await expect(b.locator(".cm-remote-cursor")).toHaveCount(1);
    await expect(page.locator(".cm-remote-edit, .cm-remote-cursor")).toHaveCount(0);
    // Decorations fade and remove themselves instead of becoming document
    // or presence state.
    await expect(b.locator(".cm-remote-edit, .cm-remote-cursor"))
      .toHaveCount(0, { timeout: 5000 });

    await b.evaluate(() => window.plp.editor.setValue("b_to_a = 3\na_to_b = 2\nseeded = 1\n"));
    await expect.poll(() => page.evaluate(() => window.plp.editor.getValue())).toContain("b_to_a");
    await expect.poll(() => page.locator(".cm-remote-edit").count()).toBeGreaterThan(0);
    await expect(page.locator(".cm-remote-cursor")).toHaveCount(1);
    await expect(b.locator(".cm-remote-edit, .cm-remote-cursor")).toHaveCount(0);

    // A deletion has no inserted span to tint, but its inferred caret still
    // lands at the deletion point on the receiver.
    await page.evaluate(() => window.plp.editor.setValue("a_to_b = 2\nseeded = 1\n"));
    await expect.poll(() => b.evaluate(() => window.plp.editor.getValue()))
      .toBe("a_to_b = 2\nseeded = 1\n");
    await expect(b.locator(".cm-remote-edit")).toHaveCount(0);
    await expect(b.locator(".cm-remote-cursor")).toHaveCount(1);

    // Transport gating: a tabs room must never touch the public sync server.
    expect(wsHits).toEqual([]);

    // The last received shared buffer is browser-local too. Leaving strips
    // room state and reloads, but must not reset the learner's code.
    await b.getByRole("button", { name: "Leave" }).click();
    await b.waitForFunction(() => !location.hash && window.plp && !window.plp.collab.isActive());
    await expect(page.locator(`.cm-peer-cursor[data-peer-id="${bId}"]`)).toHaveCount(0);
    expect(await b.evaluate(() => window.plp.editor.getValue()))
      .toBe("a_to_b = 2\nseeded = 1\n");
    expect((await b.evaluate(() => window.plp.run())).terminal_reason).toBe("completed");
    expect(await b.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("shared run: follower and late joiner replay the driver's run exactly", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, "?transports=tabs", url, "tabs");

    const summary = await runOn(page,
      "x = [1, 2]\nx.append(3)\nprint('sum', sum(x))\n");
    expect(summary.terminal_reason).toBe("completed");
    await expectFollowerMatchesDriver(b, page);

    // Follower memory tables rendered (names + objects, not just stored).
    await expect(b.locator("[data-role=names-table]")).toContainText("x");
    await expect(b.locator("[data-role=objects-table]")).toContainText("list");
    // Follower console shows the shared-run framing + end note (sys lines).
    await expect.poll(() => b.evaluate(() => window.plp.console.buffer())).toContain("── program finished ──");

    // Late joiner: a third page joining AFTER the run replays it fully.
    const c = await context.newPage();
    await joinRoom(c, "?transports=tabs", url, "tabs");
    await expectFollowerMatchesDriver(c, page);
    await c.close();

    // A second run on the same room resets followers and replays the new run.
    const summary2 = await runOn(page, "y = 'again'\nprint(y)\n");
    expect(summary2.terminal_reason).toBe("completed");
    await expectFollowerMatchesDriver(b, page);
    expect(await b.evaluate(() => window.plp.console.text())).toBe("again\n");
  });

  test("input() run: prompt + echo reach the follower; run lockout while streaming", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, "?transports=tabs", url, "tabs");

    await page.evaluate(() => window.plp.editor.setValue('name = input("Who? ")\nprint("hi", name)\n'));
    await page.evaluate(() => { window.__run = window.plp.run(); });
    await page.waitForFunction(() => window.plp.console.isWaiting(), null, { timeout: 180_000 });

    // Lockout: while the driver's run is live, a follower Run is refused —
    // and the follower terminal never enters line mode for the remote input().
    await expect.poll(() => b.evaluate(() => window.plp.collab.canRun())).toBe(false);
    expect(await b.evaluate(() => window.plp.run())).toBeNull();
    expect(await b.evaluate(() => window.plp.console.isWaiting())).toBe(false);

    await page.evaluate(() => window.plp.provideInput("Ada"));
    const summary = await page.evaluate(() => window.__run);
    expect(summary.terminal_reason).toBe("completed");
    await expectFollowerMatchesDriver(b, page);
    const followerText = await b.evaluate(() => window.plp.console.text());
    expect(followerText).toContain("Who? Ada");   // prompt (stdout) + mirrored echo
    expect(followerText).toContain("hi Ada");

    // After the run ends, the follower may drive the next one.
    await expect.poll(() => b.evaluate(() => window.plp.collab.canRun())).toBe(true);
    const summaryB = await runOn(b, "z = 7\nprint(z * 6)\n");
    expect(summaryB.terminal_reason).toBe("completed");
    await expectFollowerMatchesDriver(page, b); // roles swap: A is now the follower
  });

  test("shared scrubbing: peers follow the scrubber; local scrub detaches", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, "?transports=tabs", url, "tabs");

    await runOn(page, "a = 1\nb = 2\nc = a + b\nprint(c)\n");
    await expectFollowerMatchesDriver(b, page);

    // Driver scrubs to position 2 → follower follows (and reconstructs console).
    await page.evaluate(() => window.plp.memory.goTo(2));
    await expect.poll(() => b.evaluate(() => window.plp.memory.stepIndex()), { timeout: 15_000 }).toBe(2);
    expect(await b.evaluate(() => window.plp.collab.detached())).toBe(false);

    // Follower scrubs on its own → detached; driver's next scrub is ignored.
    await b.evaluate(() => window.plp.memory.goTo(1));
    expect(await b.evaluate(() => window.plp.collab.detached())).toBe(true);
    await page.evaluate(() => window.plp.memory.goTo(3));
    await page.waitForTimeout(1000); // give a wrong application time to happen
    expect(await b.evaluate(() => window.plp.memory.stepIndex())).toBe(1);

    // Scrubbing to the live end re-attaches.
    await b.evaluate(() => window.plp.memory.goTo(window.plp.memory.stepCount() - 1));
    expect(await b.evaluate(() => window.plp.collab.detached())).toBe(false);
    await page.evaluate(() => window.plp.memory.goTo(2));
    await expect.poll(() => b.evaluate(() => window.plp.memory.stepIndex()), { timeout: 15_000 }).toBe(2);
  });
});

test.describe("collab (tabs transport, lifecycle edges)", () => {
  test("pasting a room link into a live tab joins via hashchange (no reload)", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    await page.evaluate(() => window.plp.editor.setValue("hash_join = 1\n"));
    const url = await startRoom(page);

    const b = await context.newPage();
    await gotoApp(b, "?transports=tabs"); // solo, NO room hash
    await b.evaluate(() => { window.__noReloadMarker = true; });
    // Simulate pasting the link into the URL bar of the open tab: hash-only
    // navigation fires hashchange, not a load.
    await b.evaluate((u) => { location.hash = `#room=${u}&via=tabs`; }, url);
    await b.waitForFunction(() => window.plp.collab.isActive(), null, { timeout: 60_000 });
    await expect.poll(() => b.evaluate(() => window.plp.editor.getValue())).toContain("hash_join");
    // The page must NOT have reloaded to get there.
    expect(await b.evaluate(() => window.__noReloadMarker)).toBe(true);
  });

  test("tab close (pagehide fires): goodbye drops the peer promptly, not via the 20 s window", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, "?transports=tabs", url, "tabs");
    await expect.poll(() => page.evaluate(() => document.getElementById("collab-peers").textContent)).toBe("2");
    await b.close(); // fires pagehide → goodbye broadcast (no repo.shutdown racing it)
    // Well under the freshness window: the goodbye did the work.
    await expect.poll(() => page.evaluate(() => document.getElementById("collab-peers").textContent),
      { timeout: 10_000 }).toBe("1");
  });

  test("ungracefully closed peer: badge drops and a dead driver's run lock releases", async ({ page, context }) => {
    test.slow(); // staleness window is 20 s by design
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, "?transports=tabs", url, "tabs");
    await expect.poll(() => page.evaluate(() => document.getElementById("collab-peers").textContent)).toBe("2");

    // B becomes the driver of a long run, then its tab dies mid-stream
    // (page.close() = ungraceful: no Leave, goodbye not guaranteed).
    await b.evaluate(() => window.plp.editor.setValue(
      "t = 0\nfor i in range(400):\n    t += sum(range(100_000))\nprint('t', t)\n"));
    await b.evaluate(() => { window.__run = window.plp.run(); });
    await expect.poll(() => page.evaluate(() => window.plp.collab.records()?.length ?? 0), { timeout: 180_000 })
      .toBeGreaterThan(3); // the shared run is streaming to A
    expect(await page.evaluate(() => window.plp.collab.canRun())).toBe(false); // locked while B drives
    // A true crash sends no goodbye. page.close() DOES fire pagehide (we
    // measured the goodbye arriving), so neuter B's presence teardown to
    // force the staleness path — the one a killed process/tab exercises.
    await b.evaluate(() => { window.plp.collab._state.presence.stop = () => {}; });
    await b.close();

    // Freshness (20 s) + repaint cadence: the badge drops and the run lock
    // releases without any goodbye, well before the old minutes-long stall.
    await expect.poll(() => page.evaluate(() => document.getElementById("collab-peers").textContent),
      { timeout: 45_000 }).toBe("1");
    await expect.poll(() => page.evaluate(() => window.plp.collab.canRun()),
      { timeout: 45_000 }).toBe(true);

    // And the room is actually usable again.
    const summary = await runOn(page, "after = 'ok'\nprint(after)\n");
    expect(summary.terminal_reason).toBe("completed");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });
});

test.describe("collab (fault injection: local sync server)", () => {
  let server = null;
  let dataDir = null;
  let port = 0;

  async function startSyncServer() {
    dataDir ??= mkdtempSync(join(tmpdir(), "plp-sync-"));
    port ||= 8710 + Math.floor(Math.random() * 200);
    server = spawn(process.execPath, ["node_modules/@automerge/automerge-repo-sync-server/src/index.js"], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
      stdio: "ignore",
    });
    // Wait for the port to accept connections.
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/`);
        if (r.ok || r.status) return;
      } catch { await new Promise((r) => setTimeout(r, 200)); }
    }
    throw new Error("local sync server did not come up");
  }

  const killSyncServer = () => new Promise((resolve) => {
    if (!server) return resolve();
    server.once("exit", resolve);
    server.kill("SIGKILL");
    server = null;
  });

  test.afterEach(async () => {
    await killSyncServer();
    if (dataDir) { rmSync(dataDir, { recursive: true, force: true }); dataDir = null; }
  });

  test("ws-only room over a local server; killed mid-stream, records resume on restart", async ({ browser }) => {
    test.skip(DEPLOYED_SITE, "requires ws:// loopback from the local HTTP test site");
    test.slow();
    await startSyncServer();
    // Separate contexts: no BroadcastChannel between A and B — the local
    // sync server is the ONLY pathway, so what this test kills is load-bearing.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const seam = `window.__collabSyncServerUrl = "ws://127.0.0.1:${port}"`;
    await ctxA.addInitScript(seam);
    await ctxB.addInitScript(seam);
    try {
      const a = await ctxA.newPage();
      await gotoApp(a, "?transports=ws");
      const url = await startRoom(a);
      const b = await ctxB.newPage();
      await joinRoom(b, "?transports=ws", url, "ws");
      await expect.poll(() => b.evaluate(() => window.plp.editor.getValue()), { timeout: 30_000 })
        .toContain("def total");

      // A long run: ~ms of C-level work per iteration so records stream for
      // a while (interruptible-workload guidance from the engine facts).
      await a.evaluate(() => window.plp.editor.setValue(
        "t = 0\nfor i in range(120):\n    t += sum(range(100_000))\nprint('t', t)\n"));
      await a.evaluate(() => { window.__run = window.plp.run(); });

      // Wait until the follower has some records, then kill the relay mid-stream.
      await expect.poll(() => b.evaluate(() => window.plp.collab.records()?.length ?? 0), { timeout: 180_000 })
        .toBeGreaterThan(5);
      await killSyncServer();

      // Driver finishes locally while the relay is down.
      const summary = await a.evaluate(() => window.__run);
      expect(summary.terminal_reason).toBe("completed");
      const driverCount = await a.evaluate(() => window.plp.records().length);
      const stalled = await b.evaluate(() => window.plp.collab.records()?.length ?? 0);
      expect(stalled).toBeLessThan(driverCount); // the follower really did stall

      // Relay comes back on the same port: the ws adapter reconnects and
      // sync RESUMES — the follower converges to the full run.
      await startSyncServer();
      await expect.poll(() => b.evaluate(() => window.plp.collab.records()?.length ?? 0), { timeout: 120_000 })
        .toBe(driverCount);
      await expectFollowerMatchesDriver(b, a);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

test.describe("collab (p2p transport, network-dependent)", () => {
  test("pure WebRTC room via public Nostr signaling (SKIPS if relays unreachable)", async ({ browser }) => {
    test.slow();
    const wsHits = [];
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    // Headless Chromium can't resolve peers' mDNS host candidates (no
    // responder), so same-machine ICE would fail; trystero's test knob
    // falls back to loopback. Real browsers on real networks use mDNS/STUN.
    const seam = "window.__collabRtcTestConfig = { _test_only_mdnsHostFallbackToLoopback: true }";
    await ctxA.addInitScript(seam);
    await ctxB.addInitScript(seam);
    try {
      const a = await ctxA.newPage();
      a.on("websocket", (ws) => { if (ws.url().includes("sync.automerge.org")) wsHits.push(ws.url()); });
      await gotoApp(a, "?transports=p2p");
      await a.evaluate(() => window.plp.editor.setValue("via_p2p = 1\n"));
      const url = await startRoom(a);

      const b = await ctxB.newPage();
      b.on("websocket", (ws) => { if (ws.url().includes("sync.automerge.org")) wsHits.push(ws.url()); });
      await gotoApp(b, "?transports=p2p", `#room=${url}&via=p2p`);
      const joined = await b.waitForFunction(() => window.plp.collab.isActive(), null, { timeout: 60_000 })
        .then(() => true, () => false);
      test.skip(!joined, "peers did not meet over WebRTC (Nostr relays unreachable or WebRTC blocked here)");

      await expect.poll(() => b.evaluate(() => window.plp.editor.getValue()), { timeout: 30_000 })
        .toContain("via_p2p");
      const summary = await runOn(a, "p = list(range(4))\nprint(len(p))\n");
      expect(summary.terminal_reason).toBe("completed");
      await expectFollowerMatchesDriver(b, a);
      expect(wsHits).toEqual([]); // p2p room never touches the sync server
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
