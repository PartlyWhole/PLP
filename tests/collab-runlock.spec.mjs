// Diagnostic suite for shared-run lifecycle hangs (reported: "run and stop
// behave weirdly in collab; sometimes it hangs in different ways").
//
// The room holds ONE shared run at a time and gates every other peer's Run
// while `run.status === "running"`. So any path that fails to move a run to
// `done` wedges the whole room — including the driver, since canRun()
// returns false for one's own live run. These tests assert that every way a
// run can end releases the lock.

import { test, expect } from "@playwright/test";

const SITE = "/PLP/";
const LOOP = 'print("looping")\nwhile True:\n    pass\n';
const ASKS = 'name = input("Who? ")\nprint("hi", name)\n';

async function gotoApp(page, query = "", hash = "") {
  await page.goto(SITE + query + hash);
  await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.plp));
}
const startRoom = (page) => page.evaluate(() => window.plp.collab.start());
async function joinRoom(page, url) {
  await gotoApp(page, "?transports=tabs", `#room=${url}&via=tabs`);
  await page.waitForFunction(() => window.plp.collab.isActive(), null, { timeout: 60_000 });
}
const sharedStatus = (page) =>
  page.evaluate(() => window.plp.collab._state.handle?.doc()?.run?.status ?? null);

test.describe("shared run lifecycle: every ending must release the room lock", () => {
  test("L1: Stop during an untraced shared run releases the lock", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, url);

    await page.evaluate((src) => window.plp.editor.setValue(src), LOOP);
    await page.evaluate(() => { window.__run = window.plp.run(); });
    await page.waitForFunction(() => window.plp.console.text().includes("looping"), null, { timeout: 120_000 });

    // While it streams, the peer is correctly locked out.
    await expect.poll(() => b.evaluate(() => window.plp.collab.canRun())).toBe(false);

    await page.evaluate(() => window.plp.interrupt());
    const summary = await page.evaluate(() => window.__run);
    expect(summary.terminal_reason).toBe("interrupted");

    // The lock must lift for BOTH peers — the driver's own canRun() is false
    // while its run is still marked running, so a stuck run wedges everyone.
    await expect.poll(() => b.evaluate(() => window.plp.collab.canRun()), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => window.plp.collab.canRun())).toBe(true);
    // And the peer can actually drive the next run.
    const next = await b.evaluate(() => { window.plp.editor.setValue("print('peer ok')\n"); return window.plp.run(); });
    expect(next.terminal_reason).toBe("completed");
  });

  test("L2: Stop during a traced shared run releases the lock", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, url);

    // ms-scale C work per iteration so the interrupt lands in bytecode
    // (engine note: a long single C call can surface as engine_error).
    await page.evaluate(() => window.plp.editor.setValue(
      "print('go')\nwhile True:\n    s = sum(range(100_000))\n"));
    await page.evaluate(() => { window.__run = window.plp.trace(); });
    await page.waitForFunction(() => window.plp.console.text().includes("go"), null, { timeout: 120_000 });

    await page.evaluate(() => window.plp.interrupt());
    const summary = await page.evaluate(() => window.__run);
    expect(["interrupted", "step_limit"]).toContain(summary.terminal_reason);

    await expect.poll(() => b.evaluate(() => window.plp.collab.canRun()), { timeout: 15_000 }).toBe(true);
    const next = await b.evaluate(() => { window.plp.editor.setValue("print('peer ok')\n"); return window.plp.run(); });
    expect(next.terminal_reason).toBe("completed");
  });

  test("L3: a run waiting at input() is stoppable and releases the lock", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, url);

    await page.evaluate((src) => window.plp.editor.setValue(src), ASKS);
    await page.evaluate(() => { window.__run = window.plp.run(); });
    await page.waitForFunction(() => window.plp.console.isWaiting(), null, { timeout: 120_000 });
    await expect.poll(() => b.evaluate(() => window.plp.collab.canRun())).toBe(false);

    // The driver changes their mind and presses Stop instead of answering.
    await page.evaluate(() => window.plp.interrupt());
    const summary = await page.evaluate(() => window.__run);
    expect(["interrupted", "killed", "uncaught_exception"]).toContain(summary.terminal_reason);

    await expect.poll(() => b.evaluate(() => window.plp.collab.canRun()), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => window.plp.console.isWaiting())).toBe(false);
  });

  test("L3b: the same, on the traced path (PyTrace's own rendezvous)", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, url);

    await page.evaluate((src) => window.plp.editor.setValue(src), ASKS);
    await page.evaluate(() => { window.__run = window.plp.trace(); });
    await page.waitForFunction(() => window.plp.console.isWaiting(), null, { timeout: 120_000 });

    await page.evaluate(() => window.plp.interrupt());
    const summary = await page.evaluate(() => window.__run);
    expect(["interrupted", "killed", "uncaught_exception"]).toContain(summary.terminal_reason);
    await expect.poll(() => b.evaluate(() => window.plp.collab.canRun()), { timeout: 15_000 }).toBe(true);
  });

  test("L4: a crashing run releases the lock", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, url);

    await page.evaluate(() => window.plp.editor.setValue('print("before")\nboom = 1 // 0\n'));
    const summary = await page.evaluate(() => window.plp.run());
    expect(summary.terminal_reason).toBe("uncaught_exception");
    expect(await sharedStatus(page)).toBe("done");
    await expect.poll(() => b.evaluate(() => window.plp.collab.canRun())).toBe(true);
  });

  test("L5: back-to-back runs by alternating drivers never wedge", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, url);

    for (let i = 0; i < 3; i++) {
      const driver = i % 2 === 0 ? page : b;
      const other = i % 2 === 0 ? b : page;
      const summary = await driver.evaluate((n) => {
        window.plp.editor.setValue(`print("run ${n}")\n`);
        return window.plp.run();
      }, i);
      expect(summary.terminal_reason).toBe("completed");
      await expect.poll(() => other.evaluate(() => window.plp.collab.canRun()), { timeout: 15_000 }).toBe(true);
    }
  });

  test("L6: simultaneous Run on both peers leaves the room usable", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, url);

    await page.evaluate(() => window.plp.editor.setValue("print('A')\n"));
    await b.evaluate(() => window.plp.editor.setValue("print('B')\n"));
    const [ra, rb] = await Promise.all([
      page.evaluate(() => window.plp.run().catch((e) => ({ terminal_reason: "threw: " + e.message }))),
      b.evaluate(() => window.plp.run().catch((e) => ({ terminal_reason: "threw: " + e.message }))),
    ]);
    // At least one must have driven a real run; neither may wedge the room.
    expect([ra?.terminal_reason, rb?.terminal_reason].filter(Boolean).length).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.plp.collab.canRun()), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => b.evaluate(() => window.plp.collab.canRun()), { timeout: 20_000 }).toBe(true);
  });

  // KNOWN DEFECT (not yet fixed) — reproduces ~25% of runs.
  // After a simultaneous-Run race, a LATER, unrelated run sometimes ends
  // "interrupted". Mechanism: `run` is replaced wholesale in the CRDT, so
  // last-writer-wins can deliver the loser's older write AFTER the new
  // driver's newer one. The new driver's next flush then sees
  // doc.run.runId !== myRunId, concludes it was usurped, and main.mjs's
  // usurped handler calls runner.interrupt() — killing its own innocent run.
  // Fix direction: order `run` writes (runIds already embed Date.now(), so
  // a stale clobber is detectable) and re-assert rather than surrender.
  test.fixme("L6b: a later run must not be killed by a stale usurpation", async ({ page, context }) => {
    await gotoApp(page, "?transports=tabs");
    const url = await startRoom(page);
    const b = await context.newPage();
    await joinRoom(b, url);

    await page.evaluate(() => window.plp.editor.setValue("print('A')\n"));
    await b.evaluate(() => window.plp.editor.setValue("print('B')\n"));
    await Promise.all([
      page.evaluate(() => window.plp.run().catch(() => null)),
      b.evaluate(() => window.plp.run().catch(() => null)),
    ]);
    await expect.poll(() => page.evaluate(() => window.plp.collab.canRun()), { timeout: 20_000 }).toBe(true);
    const after = await page.evaluate(() => { window.plp.editor.setValue("print('after')\n"); return window.plp.run(); });
    expect(after.terminal_reason).toBe("completed");
  });
});
