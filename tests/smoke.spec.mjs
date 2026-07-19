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

    // Program prints, then waits at input() — the terminal enters line mode.
    await page.waitForFunction(() => window.plp.console.isWaiting(), null, { timeout: 180_000 });
    const preInput = await page.evaluate(() => window.plp.console.text());
    expect(preInput).toContain("items: 3");
    expect(preInput).toContain("total: 10");

    await page.evaluate(() => window.plp.provideInput("Ada"));
    const summary = await page.evaluate(() => window.__run);
    expect(summary.terminal_reason).toBe("completed");
    expect(summary.trace_complete).toBe(true);

    // Consumer-side stream checks: zero violations.
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);

    // Echoed input (local echo; engine echo disabled in live mode) + final
    // print reached the transcript and the screen.
    const text = await page.evaluate(() => window.plp.console.text());
    expect(text).toContain("Your name? Ada");
    expect(text).toContain("thanks, Ada");
    expect(await page.evaluate(() => window.plp.console.buffer())).toContain("Your name? Ada");

    // Memory model: final snapshot has known names and a dict object.
    await expect(page.locator("[data-role=names-table]")).toContainText("cart");
    await expect(page.locator("[data-role=objects-table]")).toContainText("dict");

    // Scrubber (line-step mode is the default): position 0 is the synthetic
    // "before the program runs" anchor — empty tables, no output.
    await page.evaluate(() => window.plp.memory.goTo(0));
    expect(await page.evaluate(() => window.plp.memory.lineMode())).toBe(true);
    await expect(page.locator("[data-role=step-counter]")).toHaveText(/^line 0\//);
    await expect(page.locator("[data-role=step-event]")).toContainText("before the program runs");
    await expect.poll(() => page.evaluate(() => window.plp.console.buffer())).toContain("no output yet");

    // Position 1 = first executed line; console shows partial output.
    await page.evaluate(() => window.plp.memory.goTo(1));
    await expect(page.locator("[data-role=step-counter]")).toHaveText(/^line 1\//);
    const scrubbed = await page.evaluate(() => window.plp.console.buffer());
    expect(scrubbed).toMatch(/output up to step \d+/);
    expect(scrubbed).not.toContain("thanks, Ada");

    // Scrubbing to the end returns to the live view.
    await page.evaluate(() => window.plp.memory.goTo(window.plp.memory.stepCount() - 1));
    await expect.poll(() => page.evaluate(() => window.plp.console.buffer())).toContain("thanks, Ada");
  });

  test("isolated: uncaught exception surfaces on stderr styling and terminal note", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue("x = 1\nprint(x)\ny = x // 0\n"));
    const summary = await page.evaluate(() => window.plp.run());
    expect(summary.terminal_reason).toBe("uncaught_exception");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
    await expect.poll(() => page.evaluate(() => window.plp.console.buffer())).toContain("ZeroDivisionError");
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

  test("isolated: plain functions render inline, not as object rows (display filter)", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue(
      "x = 1\ny = x\nx = x+y\ny = x+x\ndef add(x,y):\n    return x+y\nz = add(x,y)\nprint(z)\n",
    ));
    const summary = await page.evaluate(() => window.plp.run());
    expect(summary.terminal_reason).toBe("completed");

    // Names: the `add` binding is hidden entirely (hideFunctionBindings).
    const namesHtml = await page.evaluate(() => document.querySelector("[data-role=names-table]").innerHTML);
    expect(namesHtml).not.toContain("add");
    expect(namesHtml).not.toContain("mm-ref"); // scalars only

    // hideFunctionBindings off -> binding returns as inline text (no chip).
    await page.evaluate(() => {
      window.plp.memory.filters.hideFunctionBindings = false;
      window.plp.memory.refresh();
    });
    await expect(page.locator("[data-role=names-table]")).toContainText("function add");

    // Objects: no function row (this program allocates no other objects).
    const objectsText = await page.evaluate(() => document.querySelector("[data-role=objects-table]").textContent);
    expect(objectsText).not.toContain("function");
    // No dangling chips anywhere (core invariant, filters on or off).
    const dangling = await page.evaluate(() => {
      const rows = new Set([...document.querySelectorAll("[data-role=objects-table] tr[data-uid]")].map((r) => r.dataset.uid));
      return [...document.querySelectorAll("a.mm-ref")].filter((a) => !rows.has(a.dataset.uid)).length;
    });
    expect(dangling).toBe(0);

    // Toggling the filter off in code restores the object row + chip.
    await page.evaluate(() => {
      window.plp.memory.filters.inlinePlainFunctions = false;
      window.plp.memory.refresh();
    });
    await expect(page.locator("[data-role=objects-table]")).toContainText("function add");
    await page.evaluate(() => {
      window.plp.memory.filters.inlinePlainFunctions = true;
      window.plp.memory.filters.hideFunctionBindings = true;
      window.plp.memory.refresh();
    });

    // Modules: `import math` adds nothing — no Names row, no Objects row.
    await page.evaluate(() => window.plp.editor.setValue("import math\nx = 1\n"));
    const summary2 = await page.evaluate(() => window.plp.run());
    expect(summary2.terminal_reason).toBe("completed");
    // Rendering is rAF-scheduled — poll.
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-role=names-table]").textContent))
      .toContain("x");
    const names2 = await page.evaluate(() => document.querySelector("[data-role=names-table]").textContent);
    expect(names2).not.toContain("math");
    expect(await page.evaluate(() => document.querySelector("[data-role=objects-table]").textContent))
      .not.toContain("module");
    // hideModuleBindings off -> the binding returns, inline (still no row).
    await page.evaluate(() => {
      window.plp.memory.filters.hideModuleBindings = false;
      window.plp.memory.refresh();
    });
    await expect(page.locator("[data-role=names-table]")).toContainText("module math");
    await page.evaluate(() => {
      window.plp.memory.filters.hideModuleBindings = true;
      window.plp.memory.refresh();
    });
  });

  test("isolated: hovering a name highlights its occurrences in the editor", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue("count = 1\ncount = count + 1\nprint(count)\n"));
    const summary = await page.evaluate(() => window.plp.run());
    expect(summary.terminal_reason).toBe("completed");
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-role=names-table]").textContent))
      .toContain("count");
    const marks = await page.evaluate(() => {
      const td = [...document.querySelectorAll("[data-role=names-table] td.name")]
        .find((c) => c.textContent.trim() === "count");
      td.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return document.querySelectorAll(".cm-name-hl").length;
    });
    expect(marks).toBe(4); // count appears 4 times in the source
    const cleared = await page.evaluate(() => {
      document.querySelector("[data-role=names-table]")
        .dispatchEvent(new MouseEvent("mouseleave"));
      return document.querySelectorAll(".cm-name-hl").length;
    });
    expect(cleared).toBe(0);

    // Scope-aware: `prices` is both a global and a local of total().
    // Hovering each highlights only its own scope's occurrences.
    await page.evaluate(() => window.plp.editor.setValue(
      "def total(prices):\n"      // line 1: local occurrence (param)
      + "    s = 0\n"
      + "    for p in prices:\n"  // line 3: local occurrence
      + "        s = s + p\n"
      + "    return s\n"
      + "\n"
      + "prices = [3, 5]\n"       // line 7: global occurrence
      + "t = total(prices)\n"     // line 8: global occurrence
      + "print(t)\n",
    ));
    expect((await page.evaluate(() => window.plp.run())).terminal_reason).toBe("completed");
    const scoped = await page.evaluate(() => {
      // Scrub to a position where the total() frame is on screen.
      const m = window.plp.memory;
      let frameCell = null;
      for (let i = 0; i < m.stepCount() && !frameCell; i++) {
        m.goTo(i);
        frameCell = document.querySelector('td.name[data-scope="frame"][data-fn="total"]');
      }
      const lines = () => [...document.querySelectorAll(".cm-name-hl")]
        .map((el) => el.closest(".CodeMirror-line")).length;
      const hover = (cell) => cell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const pricesCells = [...document.querySelectorAll("td.name")]
        .filter((c) => c.textContent.trim() === "prices");
      const local = pricesCells.find((c) => c.dataset.scope === "frame");
      const global = pricesCells.find((c) => c.dataset.scope === "global");
      hover(local);
      const localMarks = document.querySelectorAll(".cm-name-hl").length;
      hover(global);
      const globalMarks = document.querySelectorAll(".cm-name-hl").length;
      return { localMarks, globalMarks };
    });
    expect(scoped.localMarks).toBe(2);  // lines 1 and 3 only
    expect(scoped.globalMarks).toBe(2); // lines 7 and 8 only
  });

  test("isolated: line-step mode groups per executed line and shows produced state", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue(
      "grid_bad = [[0, 0]] * 3\n"
      + "grid_good = [[0, 0] for _ in range(3)]\n"
      + "grid_bad[0][0] = 9\n"
      + "print(grid_bad)\n",
    ));
    const summary = await page.evaluate(() => window.plp.run());
    expect(summary.terminal_reason).toBe("completed");

    // 4 source lines executed -> 5 positions (synthetic start + one per
    // line; the comprehension's iterations collapse into one), though the
    // raw trace has more steps.
    const positions = await page.evaluate(() => window.plp.memory.stepCount());
    const rawSteps = await page.evaluate(() => window.plp.memory.steps().length);
    expect(positions).toBe(5);
    expect(rawSteps).toBeGreaterThan(positions);

    // Position 1 = "line 1 just ran": grid_bad is already bound while
    // line 1 is highlighted (state shown is the state the line PRODUCED).
    await page.evaluate(() => window.plp.memory.goTo(1));
    await expect(page.locator("[data-role=step-counter]")).toHaveText("line 1/4");
    await expect(page.locator("[data-role=step-event]")).toContainText("line 1");
    await expect(page.locator("[data-role=names-table]")).toContainText("grid_bad");

    // The comprehension position reports its collapsed engine steps.
    await page.evaluate(() => window.plp.memory.goTo(2));
    await expect(page.locator("[data-role=step-event]")).toContainText("engine steps");

    // Raw engine-step mode is still available via the toggle.
    await page.locator("[data-role=step-mode]").uncheck();
    await expect(page.locator("[data-role=step-counter]")).toHaveText(/^step \d+\/\d+/);
  });

  test("non-isolated: input() program ends needs_input (degraded semantics)", async ({ page }) => {
    await page.goto(SITE + "?nonisolated");
    await page.waitForFunction(() => Boolean(window.plp));
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    const summary = await page.evaluate(() => window.plp.run());
    expect(summary.terminal_reason).toBe("needs_input");
    await expect.poll(() => page.evaluate(() => window.plp.console.buffer())).toContain("live input is unavailable");
  });
});
