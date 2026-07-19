// PLP smoke suite. Drives the app through the window.plp debug API, served
// under the /PLP/ prefix with no COOP/COEP headers (the coi-serviceworker
// path — real GitHub Pages conditions).

import { test, expect } from "@playwright/test";

const SITE = "/PLP/";

async function gotoIsolated(page) {
  await page.goto(SITE);
  // The COI shim reloads once on first visit; ride it out.
  await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.plp));
}

test.describe("PLP smoke", () => {
  test("isolated: run sample, answer input() live, verify console + memory + scrubber", async ({ page }) => {
    await gotoIsolated(page);

    // Start the run without awaiting: it blocks at input().
    await page.evaluate(() => { window.__run = window.plp.run(); });

    // Program prints, then waits at input() — the inline input row appears.
    await expect(page.locator("[data-role=input-row]")).toHaveClass(/active/, { timeout: 180_000 });
    const preInput = await page.evaluate(() => window.plp.console.text());
    expect(preInput).toContain("items: 3");
    expect(preInput).toContain("total: 10");

    await page.evaluate(() => window.plp.provideInput("Ada"));
    const summary = await page.evaluate(() => window.__run);
    expect(summary.terminal_reason).toBe("completed");
    expect(summary.trace_complete).toBe(true);

    // Consumer-side stream checks: zero violations.
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);

    // Echoed input + final print reached the console.
    const text = await page.evaluate(() => window.plp.console.text());
    expect(text).toContain("Your name? Ada");
    expect(text).toContain("thanks, Ada");

    // Memory model: final snapshot has known names and a dict object.
    await expect(page.locator("[data-role=names-table]")).toContainText("cart");
    await expect(page.locator("[data-role=objects-table]")).toContainText("dict");

    // Scrubber: jumping to step 0 changes the view; console shows the
    // reconstructed (partial) output.
    await page.evaluate(() => window.plp.memory.goTo(0));
    await expect(page.locator("[data-role=step-counter]")).toHaveText(/^step 1\//);
    const scrubbed = await page.locator("[data-role=console-out]").textContent();
    expect(scrubbed).toContain("output up to step 1");
    expect(scrubbed).not.toContain("thanks, Ada");

    // Scrubbing to the end returns to the live view.
    await page.evaluate(() => window.plp.memory.goTo(window.plp.memory.stepCount() - 1));
    await expect(page.locator("[data-role=console-out]")).toContainText("thanks, Ada");
  });

  test("isolated: uncaught exception surfaces on stderr styling and terminal note", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue("x = 1\nprint(x)\ny = x // 0\n"));
    const summary = await page.evaluate(() => window.plp.run());
    expect(summary.terminal_reason).toBe("uncaught_exception");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
    await expect(page.locator("[data-role=console-out]")).toContainText("ZeroDivisionError");
  });

  test("isolated: objects table shows chip-reachable objects only; class bases inline", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue(
      "class Dog:\n"
      + "    species = 'canis'\n"
      + "class Puppy(Dog):\n"
      + "    pass\n"
      + "rex = Puppy()\n"
      + "rex.name = 'Rex'\n"
      + "print(rex.name)\n",
    ));
    const summary = await page.evaluate(() => window.plp.run());
    expect(summary.terminal_reason).toBe("completed");

    const objects = page.locator("[data-role=objects-table]");
    // User classes and instance visible; base rendered inline by name.
    await expect(objects).toContainText("class Puppy(Dog)");
    await expect(objects).toContainText("name=\"Rex\"");
    // The implicit builtin `object` base is not rendered as a row.
    await expect(objects).not.toContainText("opaque");
    // Every rendered chip resolves to a rendered row (display invariant).
    const dangling = await page.evaluate(() => {
      const table = document.querySelector("[data-role=objects-table]");
      const rows = new Set([...table.querySelectorAll("tr[data-uid]")].map((r) => r.dataset.uid));
      return [...document.querySelectorAll("a.mm-ref")].filter((a) => !rows.has(a.dataset.uid)).length;
    });
    expect(dangling).toBe(0);
  });

  test("non-isolated: input() program ends needs_input (degraded semantics)", async ({ page }) => {
    await page.goto(SITE + "?nonisolated");
    await page.waitForFunction(() => Boolean(window.plp));
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    const summary = await page.evaluate(() => window.plp.run());
    expect(summary.terminal_reason).toBe("needs_input");
    await expect(page.locator("[data-role=console-out]")).toContainText("live input is unavailable");
  });
});
