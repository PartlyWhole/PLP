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

// Tracing now rests at the START anchor (position 0, "before the program
// runs") so the learner walks forward from the beginning. Tests that assert
// the FINAL memory state therefore say so explicitly.
const showFinalStep = (page) =>
  page.evaluate(() => window.plp.memory.goTo(window.plp.memory.stepCount() - 1));

test.describe("PLP smoke", () => {
  test("isolated: run sample, answer input() live, verify console + memory + scrubber", async ({ page }) => {
    await gotoIsolated(page);

    // Start the run without awaiting: it blocks at input().
    await page.evaluate(() => { window.__run = window.plp.trace(); });

    // Program prints, then waits at input() — the terminal enters line mode.
    await page.waitForFunction(() => window.plp.console.isWaiting(), null, { timeout: 180_000 });
    const preInput = await page.evaluate(() => window.plp.console.text());
    expect(preInput).toContain("items: 3");
    expect(preInput).toContain("total: 10");

    await page.evaluate(() => window.plp.provideInput("Ada"));
    const summary = await page.evaluate(() => window.__run);
    await showFinalStep(page);
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

  test("isolated: a finished trace rests at the start, ready to step forward", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue(
      "a = 1\nb = a + 1\nc = b + 1\nprint(c)\n"));
    const summary = await page.evaluate(() => window.plp.trace());
    expect(summary.terminal_reason).toBe("completed");

    // The scrubber lands on the "before the program runs" anchor, not on the
    // last step the stream reached — tracing is for walking forward.
    expect(await page.evaluate(() => window.plp.memory.stepIndex())).toBe(0);
    await expect(page.locator("[data-role=step-counter]")).toHaveText(/^line 0\//);
    await expect(page.locator("[data-role=step-event]")).toContainText("before the program runs");
    // Nothing is bound yet at the anchor, and the trace is fully available.
    await expect(page.locator("[data-role=names-table]")).not.toContainText("a");
    expect(await page.evaluate(() => window.plp.memory.stepCount())).toBeGreaterThan(1);

    // Stepping forward from there reveals the program one line at a time.
    await page.evaluate(() => window.plp.memory.goTo(1));
    await expect(page.locator("[data-role=step-counter]")).toHaveText(/^line 1\//);
    await expect(page.locator("[data-role=names-table]")).toContainText("a");

    // An untraced Run has no steps, so nothing to reposition.
    await page.evaluate(() => window.plp.run());
    expect(await page.evaluate(() => window.plp.memory.steps().length)).toBe(0);
  });

  test("isolated: uncaught exception surfaces on stderr styling and terminal note", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue("x = 1\nprint(x)\ny = x // 0\n"));
    const summary = await page.evaluate(() => window.plp.trace());
    await showFinalStep(page);
    expect(summary.terminal_reason).toBe("uncaught_exception");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
    await expect.poll(() => page.evaluate(() => window.plp.console.buffer())).toContain("ZeroDivisionError");
  });

  test("isolated: class definitions are filtered by default; advanced view restores bases", async ({ page }) => {
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
    const summary = await page.evaluate(() => window.plp.trace());
    await showFinalStep(page);
    expect(summary.terminal_reason).toBe("completed");

    const objects = page.locator("[data-role=objects-table]");
    const names = page.locator("[data-role=names-table]");
    // The learner view keeps the instance story and omits definition objects.
    await expect(names).not.toContainText("Dog");
    await expect(names).not.toContainText("Puppy");
    await expect(names).toContainText("rex");
    await expect(objects).not.toContainText("class ·");
    const instance = objects.locator(".mm-object-node").filter({ hasText: "Puppy · 1 attribute" }).first();
    await instance.locator(".mm-object-pill").click();
    await expect(instance.locator(".mm-object-detail")).toBeVisible();
    await expect(instance.locator(".mm-object-detail")).toContainText("name");
    await expect(instance.locator(".mm-object-detail")).toContainText('"Rex"');
    // The raw trace still contains both class objects.
    expect(await page.evaluate(() => window.plp.memory.steps().at(-1).heap
      .filter((node) => node.kind === "class").map((node) => node.qualname)))
      .toEqual(expect.arrayContaining(["Dog", "Puppy"]));

    // Advanced teaching can restore class bindings and identity pills. Bases
    // render by name; the implicit builtin `object` still gets no row.
    await page.evaluate(() => {
      window.plp.memory.filters.hideClassBindings = false;
      window.plp.memory.refresh();
    });
    await expect(names).toContainText("Dog");
    await expect(names).toContainText("Puppy");
    await expect(objects).toContainText("class · Puppy(Dog)");
    await expect(objects).not.toContainText("opaque");
    // Every binding/reference target resolves to one rendered object node.
    const dangling = await page.evaluate(() => {
      const canvas = document.querySelector("[data-role=memory-canvas]");
      const nodes = new Set([...canvas.querySelectorAll(".mm-object-node[data-uid]")].map((node) => node.dataset.uid));
      const bound = [...canvas.querySelectorAll('.mm-binding-ref[data-target^="object-"]')]
        .map((ref) => ref.dataset.target.slice("object-".length));
      const internal = [...canvas.querySelectorAll(".mm-inner-ref[data-uid]")].map((ref) => ref.dataset.uid);
      return [...bound, ...internal].filter((uid) => !nodes.has(uid)).length;
    });
    expect(dangling).toBe(0);
    await page.evaluate(() => {
      window.plp.memory.filters.hideClassBindings = true;
      window.plp.memory.refresh();
    });
  });

  test("isolated: class-body implementation metadata stays out of the learner view", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue(
      "class Dog:\n"
      + "    def __init__(self, name, age):\n"
      + "        self.name = name\n"
      + "        self.age = age\n\n"
      + "dog1 = Dog('Buddy', 3)\n",
    ));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await showFinalStep(page);

    const exposed = await page.evaluate(() => {
      const results = [];
      for (let position = 0; position < window.plp.memory.stepCount(); position += 1) {
        window.plp.memory.goTo(position);
        const names = [...document.querySelectorAll(".mm-name-box")].map((node) => node.textContent.trim());
        const metadata = names.filter((name) => /^__.*__$/.test(name));
        if (metadata.length) results.push({ position, metadata });
      }
      return results;
    });
    expect(exposed).toEqual([]);

    // Advanced teaching can still inspect the untouched engine truth.
    await page.locator("[data-role=step-mode]").uncheck();
    await page.evaluate(() => {
      const classBodyStep = window.plp.memory.steps().findIndex((step) =>
        (step.stack ?? []).some((frame) => (frame.locals ?? [])
          .some((binding) => binding.name === "__qualname__")));
      window.plp.memory.filters.hideClassBindings = false;
      window.plp.memory.goTo(classBodyStep);
    });
    await expect(page.locator("[data-role=names-table]")).toContainText("__module__");
    await expect(page.locator("[data-role=names-table]")).toContainText("__qualname__");
    await page.evaluate(() => {
      window.plp.memory.filters.hideClassBindings = true;
      window.plp.memory.refresh();
    });
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("isolated: visual grammar uses boxes, pills, arrows, and shared identity", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue("a = [1, 2]\nb = a\ncount = 3\nb.append(3)\n"));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await showFinalStep(page);
    await expect.poll(() => page.locator(".mm-name-box").count()).toBe(3);

    const graph = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll(".mm-name-box")]
        .filter((box) => ["a", "b"].includes(box.textContent.trim()));
      const refs = boxes.map((box) => box.closest(".mm-binding").querySelector(".mm-binding-ref"));
      const target = refs[0]?.dataset.target;
      const scalar = [...document.querySelectorAll(".mm-name-box")]
        .find((box) => box.textContent.trim() === "count").closest(".mm-binding");
      return {
        names: boxes.map((box) => box.textContent.trim()),
        bindingPillParts: refs.map((ref) => [...ref.children].map((part) => part.textContent.trim())),
        bindingPillLabels: refs.map((ref) => ref.getAttribute("aria-label")),
        subscripts: refs.map((ref) => ref.querySelector("sub")?.textContent),
        scalarType: scalar.querySelector(".mm-value-type")?.textContent,
        scalarValue: scalar.querySelector(".mm-value-content")?.textContent,
        listTitle: document.querySelector(".mm-object-list-title")?.textContent,
        sameTarget: refs.length === 2 && refs.every((ref) => ref.dataset.target === target),
        objectNodes: document.querySelectorAll(`.mm-object-node[data-value-id="${target}"]`).length,
        dataPillParts: [...document.querySelector(`.mm-object-node[data-value-id="${target}"] .mm-object-pill`).children]
          .map((part) => part.textContent.trim()),
        sharedPillShape: refs.every((ref) => ref.matches(".mm-value-pill.mm-data-pill"))
          && document.querySelector(`.mm-object-node[data-value-id="${target}"] .mm-object-pill`).matches(".mm-value-pill.mm-data-pill"),
        dataPillControls: document.querySelectorAll(`.mm-object-node[data-value-id="${target}"] .mm-object-line > button`).length,
        legacyObjectLabels: document.querySelector("[data-role=memory-canvas]").innerText.includes("obj"),
      };
    });
    expect(graph.names).toEqual(["a", "b"]);
    expect(graph.bindingPillParts).toHaveLength(2);
    expect(graph.bindingPillParts[0]).toEqual(graph.bindingPillParts[1]);
    expect(graph.bindingPillParts[0]).toEqual([`data${graph.subscripts[0]}`]);
    expect(graph.bindingPillLabels).toEqual([`data ${graph.subscripts[0]}`, `data ${graph.subscripts[0]}`]);
    expect(graph.subscripts[0]).toBe(graph.subscripts[1]);
    expect(graph).toMatchObject({
      scalarType: "int",
      scalarValue: "3",
      listTitle: "Data In Memory",
      sameTarget: true,
      objectNodes: 1,
      dataPillParts: [`data${graph.subscripts[0]}`, ":", "list", "·", "3 items", "▸"],
      sharedPillShape: true,
      dataPillControls: 1,
      legacyObjectLabels: false,
    });
    await expect.poll(() => page.locator('.mm-binding-path[data-target^="object-"]').count()).toBe(2);
    await page.locator(".mm-binding-ref").first().hover();
    await expect(page.locator(".mm-binding-path.active")).toHaveCount(2);

    const shortListNavigation = await page.evaluate(() => {
      const scroller = document.querySelector(".mm-object-scroll");
      return {
        order: [...scroller.querySelectorAll(".mm-object-node")].map((node) => node.dataset.uid),
        scrollTop: scroller.scrollTop,
        scrollable: scroller.dataset.scrollable,
      };
    });
    await page.locator(".mm-binding-ref").first().click();
    await expect.poll(() => page.evaluate(() => document.querySelector(".mm-object-scroll").scrollTop)).toBe(0);
    expect(await page.evaluate(() => [...document.querySelectorAll(".mm-object-scroll .mm-object-node")]
      .map((node) => node.dataset.uid))).toEqual(shortListNavigation.order);
    expect(shortListNavigation).toMatchObject({ scrollTop: 0, scrollable: "false" });

    const list = page.locator(".mm-object-node").filter({ hasText: "list · 3 items" });
    await expect(list.locator(".mm-object-pill")).toHaveAttribute("aria-expanded", "false");
    await list.locator(".mm-object-pill").click();
    await expect(list.locator(".mm-object-pill")).toHaveAttribute("aria-expanded", "true");
    await expect(list.locator(".mm-object-detail")).toBeVisible();
    await expect(list.locator(".mm-mini-pill")).toHaveCount(3);
  });

  test("isolated: indirect references appear on hover; clicking a data pill surfaces it", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue("outer = [[1]]\n"));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await showFinalStep(page);
    await expect.poll(() => page.locator(".mm-object-node").count()).toBe(2);

    const childUid = await page.evaluate(() => {
      const directlyBound = new Set([...document.querySelectorAll(".mm-binding-ref")]
        .map((ref) => ref.dataset.uid));
      return [...document.querySelectorAll(".mm-object-node")]
        .find((node) => !directlyBound.has(node.dataset.uid)).dataset.uid;
    });
    const child = page.locator(`.mm-object-node[data-uid="${childUid}"]`);
    await child.locator(".mm-object-pill").hover();
    await expect(page.locator(`.mm-object-path.active[data-target="object-${childUid}"]`)).toHaveCount(1);
    await expect(page.locator(`.mm-binding-path.active[data-target="object-${childUid}"]`)).toHaveCount(0);

    await child.locator(".mm-object-pill").click();
    await expect(page.locator(".mm-object-node").first()).toHaveAttribute("data-uid", childUid);
  });

  test("isolated: plain functions stay paired values, not data pills (display filter)", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue(
      "x = 1\ny = x\nx = x+y\ny = x+x\ndef add(x,y):\n    return x+y\nz = add(x,y)\nprint(z)\n",
    ));
    const summary = await page.evaluate(() => window.plp.trace());
    await showFinalStep(page);
    expect(summary.terminal_reason).toBe("completed");

    // Names: the `add` binding is hidden entirely (hideFunctionBindings).
    const namesHtml = await page.evaluate(() => document.querySelector("[data-role=names-table]").innerHTML);
    expect(namesHtml).not.toContain("add");
    expect(namesHtml).not.toContain("mm-ref"); // scalars only

    // hideFunctionBindings off -> the name box and inline value pill return.
    await page.evaluate(() => {
      window.plp.memory.filters.hideFunctionBindings = false;
      window.plp.memory.refresh();
    });
    await expect(page.locator("[data-role=names-table]")).toContainText("function add");

    // Inline values stay paired with names, not in the object list.
    expect(await page.evaluate(() => document.querySelector("[data-role=objects-table]").textContent))
      .not.toContain("function");
    // No dangling object targets anywhere (core invariant, filters on or off).
    const dangling = await page.evaluate(() => {
      const nodes = new Set([...document.querySelectorAll(".mm-object-node[data-uid]")].map((node) => node.dataset.uid));
      return [...document.querySelectorAll('.mm-binding-ref[data-target^="object-"]')]
        .filter((ref) => !nodes.has(ref.dataset.target.slice("object-".length))).length;
    });
    expect(dangling).toBe(0);

    // Toggling the filter off restores an identity-bearing object pill.
    await page.evaluate(() => {
      window.plp.memory.filters.inlinePlainFunctions = false;
      window.plp.memory.refresh();
    });
    await expect(page.locator("[data-role=objects-table] .mm-object-node")).toContainText("function · add");
    await page.evaluate(() => {
      window.plp.memory.filters.inlinePlainFunctions = true;
      window.plp.memory.filters.hideFunctionBindings = true;
      window.plp.memory.refresh();
    });

    // Modules: `import math` adds no name binding or object pill by default.
    await page.evaluate(() => window.plp.editor.setValue("import math\nx = 1\n"));
    const summary2 = await page.evaluate(() => window.plp.trace());
    await showFinalStep(page);
    expect(summary2.terminal_reason).toBe("completed");
    // Rendering is rAF-scheduled — poll.
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-role=names-table]").textContent))
      .toContain("x");
    const names2 = await page.evaluate(() => document.querySelector("[data-role=names-table]").textContent);
    expect(names2).not.toContain("math");
    expect(await page.evaluate(() => document.querySelector("[data-role=objects-table]").textContent))
      .not.toContain("module");
    // hideModuleBindings off -> the name and inline module pill return.
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
    await page.evaluate(() => window.plp.editor.setValue('count = 1\ncount = count + 1\nprint("count", count)\n'));
    const summary = await page.evaluate(() => window.plp.trace());
    await showFinalStep(page);
    expect(summary.terminal_reason).toBe("completed");
    await expect.poll(() => page.evaluate(() => document.querySelector("[data-role=names-table]").textContent))
      .toContain("count");
    const marks = await page.evaluate(() => {
      const td = [...document.querySelectorAll("[data-role=names-table] .mm-name-box.name")]
        .find((c) => c.textContent.trim() === "count");
      td.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return {
        total: document.querySelectorAll(".cm-name-hl").length,
        inStrings: document.querySelectorAll(
          ".cm-name-hl.cm-string, .cm-string .cm-name-hl, .cm-name-hl .cm-string",
        ).length,
      };
    });
    expect(marks).toEqual({ total: 5, inStrings: 1 });
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
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await showFinalStep(page);
    const scoped = await page.evaluate(() => {
      // Scrub to a position where the total() frame is on screen.
      const m = window.plp.memory;
      let frameCell = null;
      for (let i = 0; i < m.stepCount() && !frameCell; i++) {
        m.goTo(i);
        frameCell = document.querySelector('.mm-name-box.name[data-scope="frame"][data-fn="total"]');
      }
      const lines = () => [...document.querySelectorAll(".cm-name-hl")]
        .map((el) => el.closest(".CodeMirror-line")).length;
      const hover = (cell) => cell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const pricesCells = [...document.querySelectorAll(".mm-name-box.name")]
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
    const summary = await page.evaluate(() => window.plp.trace());
    await showFinalStep(page);
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
    const summary = await page.evaluate(() => window.plp.trace());
    await showFinalStep(page);
    expect(summary.terminal_reason).toBe("needs_input");
    await expect.poll(() => page.evaluate(() => window.plp.console.buffer())).toContain("live input is unavailable");
  });

  test("isolated: binding reference scrolls to matching data without reordering", async ({ page }) => {
    await gotoIsolated(page);
    const source = [
      ...Array.from({ length: 5 }, (_, i) => `s${i} = ${i}`),
      ...Array.from({ length: 12 }, (_, i) => `d${i} = [${i}]`),
    ].join("\n");
    await page.evaluate((code) => window.plp.editor.setValue(code), source);
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await showFinalStep(page);

    const scroller = page.locator(".mm-object-scroll");
    await expect(scroller).toHaveAttribute("data-scrollable", "true");
    const target = await page.evaluate(() => [...document.querySelectorAll(".mm-binding")]
      .find((row) => row.querySelector(".mm-name-box")?.textContent.trim() === "d0")
      .querySelector(".mm-binding-ref").dataset.target);
    const reference = page.locator(`.mm-binding-ref[data-target="${target}"]`);
    const before = await page.evaluate(() => ({
      order: [...document.querySelectorAll(".mm-object-scroll .mm-object-node")].map((node) => node.dataset.uid),
      scrollTop: document.querySelector(".mm-object-scroll").scrollTop,
    }));

    await reference.click();
    await expect.poll(() => page.evaluate((targetId) => {
      const referencePill = document.querySelector(`.mm-binding-ref[data-target="${targetId}"]`);
      const dataPill = document.querySelector(`.mm-object-node[data-value-id="${targetId}"] .mm-object-pill`);
      const referenceRect = referencePill.getBoundingClientRect();
      const dataRect = dataPill.getBoundingClientRect();
      return Math.round(Math.abs(
        (referenceRect.top + referenceRect.height / 2) - (dataRect.top + dataRect.height / 2),
      ));
    }, target)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => [...document.querySelectorAll(".mm-object-scroll .mm-object-node")]
      .map((node) => node.dataset.uid))).toEqual(before.order);
    expect(await page.evaluate(() => document.querySelector(".mm-object-scroll").scrollTop)).not.toBe(before.scrollTop);
  });

  test("isolated: a class instance shows learner data without its definition object", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue(
      "class Dog:\n"
      + "    def __init__(self, name, age):\n"
      + "        self.name = name\n"
      + "        self.age = age\n\n"
      + "    def bark(self):\n"
      + "        return f\"{self.name} says woof!\"\n\n"
      + "dog1 = Dog(\"Buddy\", 3)\n"
      + "print(dog1.bark())\n",
    ));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await showFinalStep(page);

    const names = page.locator("[data-role=names-table]");
    const objects = page.locator("[data-role=objects-table]");
    await expect(names).not.toContainText("Dog");
    await expect(names).toContainText("dog1");
    await expect(objects.locator(".mm-object-node")).toHaveCount(1);
    const dog = objects.locator(".mm-object-node").filter({ hasText: "Dog · 2 attributes" });
    await expect(dog).toHaveCount(1);
    await dog.locator(".mm-object-pill").click();
    await expect(dog.locator(".mm-object-detail")).toContainText("age");
    await expect(dog.locator(".mm-object-detail")).toContainText("3");
    await expect(dog.locator(".mm-object-detail")).toContainText("name");
    await expect(dog.locator(".mm-object-detail")).toContainText('"Buddy"');
    await expect(objects).not.toContainText("function Dog.bark");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });
});
