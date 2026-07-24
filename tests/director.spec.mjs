// D-series: director layer — event bus, stage (gates/targets/effects),
// condition library, lesson lint, runtime grammar (triggers, hints,
// signals, branching, skip/exit, telemetry), and the reference lesson
// end-to-end. Drives the app through window.plp; DOM assertions only where
// the DOM is the feature (effects, gates).

import { test, expect } from "@playwright/test";
import referenceLesson from "../lessons/meet-the-machine.mjs";

const SITE = "/PLP/";

async function boot(page) {
  await page.goto(SITE);
  await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.plp));
}

async function run(page, source) {
  await page.evaluate((src) => window.plp.editor.setValue(src), source);
  return page.evaluate(() => window.plp.trace());
}

test.describe("D0 — dormant learner surface", () => {
  test("the app exposes no Lesson control and loads no lesson data", async ({ page }) => {
    await boot(page);
    await expect(page.locator("#btn-lesson")).toHaveCount(0);
    expect(await page.evaluate(() => ({
      registryExposed: "lessons" in window.plp,
      lessonResources: performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.includes("/lessons/")),
    }))).toEqual({ registryExposed: false, lessonResources: [] });
  });
});

test.describe("D1 — event bus", () => {
  test("scripted session emits the expected semantic events in order", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.plp.events.clearLog());
    const summary = await run(page, "a = [1, 2]\nb = a\nprint(len(b))\n");
    expect(summary.terminal_reason).toBe("completed");
    await page.evaluate(() => window.plp.memory.goTo(1)); // user scrub
    await page.evaluate(() => { // hover a name cell
      const td = [...document.querySelectorAll(".mm-name-box.name")].find((c) => c.textContent.trim() === "a");
      td.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const types = await page.evaluate(() => window.plp.events.log().map((e) => e.type));
    const idx = (t) => types.indexOf(t);
    expect(idx("run-started")).toBeGreaterThanOrEqual(0);
    expect(idx("run-ended")).toBeGreaterThan(idx("run-started"));
    expect(idx("scrubbed")).toBeGreaterThan(idx("run-ended"));
    expect(idx("hover-name")).toBeGreaterThan(idx("scrubbed"));
    expect(types).toContain("memory-rendered");
    const runEnded = await page.evaluate(() => window.plp.events.log().find((e) => e.type === "run-ended"));
    expect(runEnded.reason).toBe("completed");
    const hover = await page.evaluate(() => window.plp.events.log().find((e) => e.type === "hover-name"));
    expect(hover.name).toBe("a");
    expect(hover.active).toBe(true);
  });

  test("edited fires on user-origin editor changes only", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.plp.events.clearLog());
    await page.evaluate(() => window.plp.editor.setValue("x = 1\n")); // programmatic: no event
    let types = await page.evaluate(() => window.plp.events.log().map((e) => e.type));
    expect(types).not.toContain("edited");
    await page.click("#cm-host");
    await page.keyboard.type("# note");
    types = await page.evaluate(() => window.plp.events.log().map((e) => e.type));
    expect(types).toContain("edited");
  });
});

test.describe("D2 — lesson lint", () => {
  test("reference lesson lints clean; malformed lessons fail loudly", async ({ page }) => {
    await boot(page);
    const clean = await page.evaluate((lesson) => window.plp.lintLesson(lesson), referenceLesson);
    expect(clean).toEqual([]);

    const errors = await page.evaluate(() => window.plp.lintLesson({
      id: "bad",
      beats: [
        { id: "a", do: [
          { spotlight: "nonsense-target" },
          { say: { at: "run", avoid: "editor" } },
          { cue: { at: "run", motion: "teleport" } },
          { frobnicate: true },
        ], until: { idleMs: 100 } },
        { id: "a", until: { event: "not-an-event", dwellMs: -1 } }, // dup id + bad event/dwell
        { id: "c", until: { check: "noSuchCheck" }, next: "ghost",
          hints: [
            { when: { signal: "nope", gte: 1 }, popover: {} },
            { when: { event: "hover-name", dwellMs: 100 }, popover: { at: "run", md: "wait" } },
          ] },
        { id: "d" }, // non-final beat without until
        { id: "e" },
      ],
    }));
    const text = errors.join("\n");
    expect(text).toContain("invalid target");
    expect(text).toContain("say.md required");
    expect(text).toContain("avoid must be an array");
    expect(text).toContain("unknown motion");
    expect(text).toContain("unknown action");
    expect(text).toContain("idleMs is hint-only");
    expect(text).toContain("duplicate beat id");
    expect(text).toContain('non-learner event "not-an-event"');
    expect(text).toContain('dwellMs requires event "hover-name"');
    expect(text).toContain("dwellMs must be positive");
    expect(text).toContain("dwellMs is until-only");
    expect(text).toContain('unknown condition "noSuchCheck"');
    expect(text).toContain('unknown beat "ghost"');
    expect(text).toContain("unknown signal");
    expect(text).toContain("popover.md required");
    expect(text).toContain('only the final beat may omit "until"');
    // start() refuses a lesson that fails lint
    const threw = await page.evaluate(() => {
      try { window.plp.director.start({ id: "nope", beats: [{ id: "x", until: { idleMs: 5 } }] }); return null; }
      catch (e) { return e.message; }
    });
    expect(threw).toContain("failed lint");
  });
});

test.describe("D3 — stage gates", () => {
  test("deny/allow each capability; reset restores everything", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.plp.stage.gate({
      deny: ["run", "stop", "quiz", "scrub", "step-mode", "maximize", "edit", "console-input"],
    }));
    await expect(page.locator("#btn-run")).toBeDisabled();
    await expect(page.locator("#btn-run")).toHaveClass(/stage-gated/);
    await expect(page.locator("#btn-quiz")).toBeDisabled();
    await expect(page.locator("[data-role=step-slider]")).toBeDisabled();
    expect(await page.evaluate(() => window.plp.editor.isReadOnly())).toBe(true);
    expect(await page.evaluate(() => window.plp.console.isInteractive())).toBe(false);
    // selective allow
    await page.evaluate(() => window.plp.stage.gate({ allow: ["run", "edit"] }));
    await expect(page.locator("#btn-run")).toBeEnabled();
    expect(await page.evaluate(() => window.plp.editor.isReadOnly())).toBe(false);
    expect(await page.evaluate(() => window.plp.stage.gatedCaps())).not.toContain("run");
    // full reset
    await page.evaluate(() => window.plp.stage.reset());
    await expect(page.locator("[data-role=step-slider]")).toBeEnabled();
    expect(await page.evaluate(() => window.plp.console.isInteractive())).toBe(true);
    expect(await page.evaluate(() => window.plp.stage.gatedCaps())).toEqual([]);
    expect(await page.evaluate(() => document.querySelectorAll(".stage-gated").length)).toBe(0);
  });

  test("console-input gate suppresses line mode while the prompt still shows", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.plp.stage.gate({ deny: ["console-input"] }));
    await page.evaluate(() => window.plp.editor.setValue('x = input("Q? ")\n'));
    await page.evaluate(() => { window.__run = window.plp.trace(); });
    // Prompt reaches the transcript but the console never enters line mode.
    await expect.poll(() => page.evaluate(() => window.plp.console.text())).toContain("Q? ");
    expect(await page.evaluate(() => window.plp.console.isWaiting())).toBe(false);
    // Escape hatch still works; then clean up.
    await page.evaluate(() => window.plp.interrupt());
    await page.evaluate(() => window.__run);
    await page.evaluate(() => window.plp.stage.reset());
  });
});

test.describe("D4 — stage targets and effects", () => {
  test("spotlight/dim, pulse, popover, veil, clear — and unknown targets are null", async ({ page }) => {
    await boot(page);
    // spotlight with backdrop dim
    await page.evaluate(() => window.plp.stage.spotlight("run", { dim: true }));
    await expect(page.locator("#btn-run")).toHaveClass(/stage-spot/);
    await expect(page.locator(".stage-backdrop")).toHaveCount(1);
    // second spotlight without dim keeps existing backdrop semantics (any dim => backdrop)
    await page.evaluate(() => window.plp.stage.spotlight("memory-names", { dim: false }));
    await expect(page.locator(".stage-spot")).toHaveCount(2);
    // pulse
    await page.evaluate(() => window.plp.stage.pulse("console"));
    await expect(page.locator("#console-pane")).toHaveClass(/stage-pulse/);
    // cue grammar supports distinct, restartable attention motions
    await page.evaluate(() => {
      window.plp.stage.cue("run", { motion: "bounce" });
      window.plp.stage.cue("console", { motion: "wiggle" });
    });
    await expect(page.locator("#btn-run")).toHaveClass(/stage-cue-bounce/);
    await expect(page.locator("#console-pane")).toHaveClass(/stage-cue-wiggle/);
    // popover with rich text, dismiss via Esc
    await page.evaluate(() => window.plp.stage.popover("run", "Press **Run** and `watch`", { sticky: false }));
    await expect(page.locator(".stage-popover")).toContainText("Press Run and watch");
    expect(await page.locator(".stage-popover b").textContent()).toBe("Run");
    expect(await page.locator(".stage-popover code").textContent()).toBe("watch");
    await page.keyboard.press("Escape");
    await expect(page.locator(".stage-popover")).toHaveCount(0);
    // veil (class-based assertion: an empty table has zero size, so
    // visibility checks would false-negative before any run)
    await page.evaluate(() => window.plp.stage.veil("memory-objects"));
    await expect(page.locator(".stage-veiled")).toHaveCount(1);
    await expect(page.locator("[data-role=objects-table]")).toBeHidden();
    await page.evaluate(() => window.plp.stage.unveil("memory-objects"));
    await expect(page.locator(".stage-veiled")).toHaveCount(0);
    // clear removes everything
    await page.evaluate(() => {
      window.plp.stage.veil("memory-objects");
      window.plp.stage.clearEffects();
    });
    expect(await page.evaluate(() => ({
      spots: document.querySelectorAll(".stage-spot").length,
      veils: document.querySelectorAll(".stage-veiled").length,
      backdrop: document.querySelectorAll(".stage-backdrop").length,
      popovers: document.querySelectorAll(".stage-popover").length,
      cues: document.querySelectorAll(".stage-cue").length,
    }))).toEqual({ spots: 0, veils: 0, backdrop: 0, popovers: 0, cues: 0 });
    expect(await page.evaluate(() => window.plp.stage.resolveTarget("bogus"))).toBe(null);
  });

  test("structured name target resolves and effects survive memory re-renders", async ({ page }) => {
    await boot(page);
    await run(page, "total = 0\nfor n in [1, 2, 3]:\n    total = total + n\n");
    // target a Names cell by semantic spec
    await page.evaluate(() => window.plp.stage.spotlight({ name: "total", scope: "global" }, { dim: false }));
    await expect(page.locator(".mm-name-box.name.stage-spot")).toHaveText("total");
    // scrubbing re-renders the table (cells recreated) — effect re-anchors
    await page.evaluate(() => window.plp.memory.goTo(1));
    await expect(page.locator(".mm-name-box.name.stage-spot")).toHaveText("total");
    // veil re-applies across re-renders too
    await page.evaluate(() => { window.plp.stage.veil("memory-objects"); window.plp.memory.goTo(2); });
    await expect(page.locator("[data-role=objects-table]")).toBeHidden();
    await page.evaluate(() => window.plp.stage.reset());
  });

  test("tutor say types rich text over glass, supports reveal/why, and dismisses", async ({ page }) => {
    await boot(page);
    const started = await page.evaluate(() => {
      window.plp.stage.say(
        "run",
        "Try **Run** and watch `x`.",
        {
          sticky: false,
          typingSpeedMs: 55,
          avoid: ["editor", "memory"],
          onWhy: () => "Running produces the trace.",
        },
      );
      const body = document.querySelector(".stage-popover-body");
      return { text: body.textContent, busy: body.getAttribute("aria-busy"), label: body.getAttribute("aria-label") };
    });
    expect(started).toEqual({ text: "", busy: "true", label: "Try Run and watch x." });
    const speech = page.locator(".stage-popover.teacher");
    await expect(speech).toBeVisible();
    await expect(speech).toHaveAttribute("role", "note");
    await expect.poll(() => speech.locator(".stage-popover-body").textContent())
      .toMatch(/^Try(?! Run and watch x\.$)/);
    await speech.locator(".stage-popover-body").dispatchEvent("click");
    await expect(speech.locator(".stage-popover-body")).toContainText("Try Run and watch x.");
    await expect(speech.locator(".stage-popover-body")).toHaveAttribute("aria-busy", "false");
    await expect(speech.locator("b")).toHaveText("Run");
    await expect(speech.locator("code")).toHaveText("x");
    await expect.poll(() => page.evaluate(() => {
      const art = document.querySelector(".stage-teacher-art");
      const bubble = document.querySelector(".stage-popover.teacher");
      const editor = document.querySelector("#editor-pane").getBoundingClientRect();
      const memory = document.querySelector("#memory-pane").getBoundingClientRect();
      const speech = bubble?.getBoundingClientRect();
      const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return {
        loaded: art?.complete && art.naturalWidth > 0,
        projectAsset: art?.src.includes("/PLP/assets/director-tutor.png"),
        positioned: bubble?.style.top.endsWith("px") && bubble?.style.left.endsWith("px"),
        protectedAreasClear: speech ? overlap(speech, editor) === 0 && overlap(speech, memory) === 0 : false,
        insideViewport: speech ? speech.left >= 0 && speech.top >= 0
          && speech.right <= innerWidth && speech.bottom <= innerHeight : false,
        placementNamed: Boolean(bubble?.dataset.placement),
        glass: getComputedStyle(bubble, "::before").backgroundColor.includes("0.68"),
        blurred: (getComputedStyle(bubble, "::before").backdropFilter
          || getComputedStyle(bubble, "::before").webkitBackdropFilter).includes("blur"),
      };
    })).toEqual({
      loaded: true,
      projectAsset: true,
      positioned: true,
      protectedAreasClear: true,
      insideViewport: true,
      placementNamed: true,
      glass: true,
      blurred: true,
    });
    await page.click(".stage-popover-actions button:has-text('why?')");
    await expect(speech.locator(".stage-popover-body")).toHaveAttribute("aria-busy", "true");
    await speech.locator(".stage-popover-body").dispatchEvent("click");
    await expect(speech).toContainText("Running produces the trace.");
    await page.keyboard.press("Escape");
    await expect(speech).toHaveCount(0);

    // Motion preferences make both speech and cues immediate/still.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await page.evaluate(() => {
      window.plp.stage.say("run", "The **whole message** appears now.", { sticky: false });
      window.plp.stage.cue("run", { motion: "bounce" });
      const body = document.querySelector(".stage-popover-body");
      return {
        text: body.textContent,
        busy: body.getAttribute("aria-busy"),
        cueAnimation: getComputedStyle(document.querySelector("#btn-run")).animationName,
      };
    });
    expect(reduced).toEqual({ text: "The whole message appears now.", busy: null, cueAnimation: "none" });
    await page.evaluate(() => window.plp.stage.reset());
  });

  test("tutor placement automatically avoids the pane that owns its target", async ({ page }) => {
    await boot(page);
    const placements = await page.evaluate(() => {
      const cases = [
        { target: "run", pane: "#editor-pane" },
        { target: "memory", pane: "#memory-pane" },
        { target: "console", pane: "#console-pane" },
      ];
      const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return cases.map(({ target, pane }) => {
        window.plp.stage.say(target, "Placement check", { typing: false, sticky: false });
        const bubble = document.querySelector(".stage-popover.teacher");
        const speech = bubble.getBoundingClientRect();
        const protectedPane = document.querySelector(pane).getBoundingClientRect();
        return {
          target,
          overlap: overlap(speech, protectedPane),
          insideViewport: speech.left >= 0 && speech.top >= 0
            && speech.right <= innerWidth && speech.bottom <= innerHeight,
          named: Boolean(bubble.dataset.placement),
        };
      });
    });
    expect(placements).toEqual([
      { target: "run", overlap: 0, insideViewport: true, named: true },
      { target: "memory", overlap: 0, insideViewport: true, named: true },
      { target: "console", overlap: 0, insideViewport: true, named: true },
    ]);
    await page.evaluate(() => window.plp.stage.reset());
  });
});

test.describe("D5 — condition library", () => {
  test("every predicate: true and false cases against a known trace", async ({ page }) => {
    await boot(page);
    const summary = await run(page, 'a = [1, 2]\nb = a\nc = [1, 2]\nprint("done", len(b))\n');
    expect(summary.terminal_reason).toBe("completed");
    const r = await page.evaluate(() => {
      const app = { runner: window.plp.runner, memory: window.plp.memory, consoleUI: window.plp.console, editor: window.plp.editor };
      const ev = (spec) => window.plp.director ? window.plp.__eval(spec, app) : null;
      return {
        completed: window.plp.__eval({ check: "completedRun" }, app),
        endedWith: window.plp.__eval({ check: "endedWith", reason: "completed" }, app),
        endedWithWrong: window.plp.__eval({ check: "endedWith", reason: "interrupted" }, app),
        nameIs: window.plp.__eval({ check: "nameIs", name: "a", value: "[1,2]" }, app),
        nameIsWrong: window.plp.__eval({ check: "nameIs", name: "a", value: "[9]" }, app),
        nameExists: window.plp.__eval({ check: "nameExists", name: "c" }, app),
        nameMissing: window.plp.__eval({ check: "nameExists", name: "zz" }, app),
        aliased: window.plp.__eval({ check: "sameObject", names: ["a", "b"] }, app),
        notAliased: window.plp.__eval({ check: "sameObject", names: ["a", "c"] }, app),
        output: window.plp.__eval({ check: "outputContains", text: "done 2" }, app),
        outputMissing: window.plp.__eval({ check: "outputContains", text: "nope" }, app),
        ranLine: window.plp.__eval({ check: "ranLine", line: 3 }, app),
        ranLineNo: window.plp.__eval({ check: "ranLine", line: 99 }, app),
        noException: window.plp.__eval({ check: "raisedException" }, app),
        source: window.plp.__eval({ check: "sourceContains", text: "b = a" }, app),
      };
    });
    expect(r).toEqual({
      completed: true, endedWith: true, endedWithWrong: false,
      nameIs: true, nameIsWrong: false, nameExists: true, nameMissing: false,
      aliased: true, notAliased: false,
      output: true, outputMissing: false, ranLine: true, ranLineNo: false,
      noException: false, source: true,
    });
    // exception predicate, positive case
    await run(page, "x = 1 // 0\n");
    expect(await page.evaluate(() =>
      window.plp.__eval({ check: "raisedException", type: "ZeroDivisionError" },
        { runner: window.plp.runner, memory: window.plp.memory, consoleUI: window.plp.console, editor: window.plp.editor }),
    )).toBe(true);
  });
});

test.describe("D6 — director runtime grammar (synthetic lessons)", () => {
  test("event/check/all triggers, gates persist across beats, signal branching", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.plp.director.start({
      id: "synthetic-1",
      code: "x = 1\n",
      beats: [
        { id: "b1",
          do: [{ gate: { deny: ["quiz"] } }, { spotlight: "run" }],
          until: { event: "run-ended", reason: "completed" } },
        { id: "b2",
          // all-composition: needs BOTH a scrub event and a trace predicate
          until: { all: [{ event: "scrubbed" }, { check: "nameIs", name: "x", value: "1" }] } },
        { id: "b3",
          until: { event: "edited" },
          // branch: many attempts -> detour; else finish
          next: [{ if: { signal: "attempts", gte: 2 }, then: "detour" }, "end"] },
        { id: "detour", until: { event: "hover-name" }, next: "end" },
        { id: "end", do: [{ popover: { at: "memory", md: "fin" } }] },
      ],
    }));
    expect(await page.evaluate(() => window.plp.director.state().beat)).toBe("b1");
    // gates + effects staged
    await expect(page.locator("#btn-quiz")).toBeDisabled();
    await expect(page.locator("#btn-run")).toHaveClass(/stage-spot/);
    // wrong-terminal run does NOT advance (reason mismatch)
    await run(page, "y = 1 // 0\n");
    expect(await page.evaluate(() => window.plp.director.state().beat)).toBe("b1");
    // completing run advances
    await run(page, "x = 1\n");
    expect(await page.evaluate(() => window.plp.director.state().beat)).toBe("b2");
    // beat transition cleared effects but KEPT gates
    await expect(page.locator("#btn-run")).not.toHaveClass(/stage-spot/);
    await expect(page.locator("#btn-quiz")).toBeDisabled();
    // scrub satisfies the event leaf; predicate already true -> advance
    await page.evaluate(() => window.plp.memory.goTo(0));
    expect(await page.evaluate(() => window.plp.director.state().beat)).toBe("b3");
    // drive attempts to 2 (branch condition), then edit to trigger until
    await run(page, "x = 1\n");
    await run(page, "x = 1\n");
    expect(await page.evaluate(() => window.plp.director.state().signals.attempts)).toBe(2);
    await page.click("#cm-host");
    await page.keyboard.type("#");
    // branched to detour, not end
    expect(await page.evaluate(() => window.plp.director.state().beat)).toBe("detour");
    await page.evaluate(() => {
      const td = [...document.querySelectorAll(".mm-name-box.name")].find((c) => c.textContent.trim() === "x");
      td.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(await page.evaluate(() => window.plp.director.state().beat)).toBe("end");
    // terminal resting beat: skip completes the lesson, stage fully restored
    await page.evaluate(() => window.plp.director.skip());
    expect(await page.evaluate(() => window.plp.director.isActive())).toBe(false);
    await expect(page.locator("#btn-quiz")).toBeEnabled();
    expect(await page.evaluate(() => window.plp.director.progress()["synthetic-1"]?.done)).toBe(true);
  });

  test("hover dwell waits for a continuous hover and cancels on leave", async ({ page }) => {
    await boot(page);
    await run(page, "y = 3\nprint(\"y is\", y)\n");
    await expect(page.locator(".mm-name-box.name", { hasText: /^y$/ })).toHaveCount(1);
    await page.evaluate(() => window.plp.director.start({
      id: "synthetic-hover-dwell",
      beats: [
        { id: "hover", until: { event: "hover-name", name: "y", dwellMs: 300 } },
        { id: "done" },
      ],
    }));
    const beat = () => page.evaluate(() => window.plp.director.state()?.beat);
    const hoverY = () => page.evaluate(() => {
      const td = [...document.querySelectorAll(".mm-name-box.name")].find((c) => c.textContent.trim() === "y");
      td.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await hoverY();
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const td = [...document.querySelectorAll(".mm-name-box.name")].find((c) => c.textContent.trim() === "y");
      td.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    });
    await page.waitForTimeout(300);
    expect(await beat()).toBe("hover");

    await hoverY();
    await page.waitForTimeout(150);
    expect(await beat()).toBe("hover");
    await expect.poll(beat, { timeout: 1500 }).toBe("done");
    const phases = await page.evaluate(() => window.plp.events.log()
      .filter((e) => e.type === "hover-name" && e.name === "y")
      .map((e) => e.active));
    expect(phases).toEqual([true, false, true]);
    await page.evaluate(() => window.plp.director.exit("test"));
  });

  test("hints: idle (once), event-pattern, signal-threshold; why-on-demand; strip; exit restores", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.plp.director.start({
      id: "synthetic-hints",
      beats: [
        { id: "h1",
          do: [
            { gate: { deny: ["scrub"] } },
            { veil: "memory-objects" },
            { popover: { at: "run", md: "main popover" } },
          ],
          why: "because reasons",
          until: { event: "run-ended", reason: "completed" },
          hints: [
            { when: { idleMs: 500 }, say: { at: "run", md: "idle hint" } },
            { when: { event: "run-ended", reason: "uncaught_exception" },
              popover: { at: "console", md: "crash hint" }, once: false },
          ] },
        { id: "h2", do: [{ popover: { at: "memory", md: "done" } }] },
      ],
    }));
    // beat popover + why-on-demand
    await expect(page.locator(".stage-popover")).toContainText("main popover");
    await page.click(".stage-popover-actions button:has-text('why?')");
    await expect(page.locator(".stage-popover")).toContainText("because reasons");
    // strip shows title + dots with current marked
    await expect(page.locator(".director-strip")).toBeVisible();
    expect(await page.locator(".director-strip .dot").count()).toBe(2);
    await expect(page.locator(".director-strip .dot.now")).toHaveCount(1);
    // idle hint fires after 500ms of no learner events, replacing the popover
    await expect.poll(() => page.evaluate(() =>
      document.querySelector(".stage-popover")?.textContent ?? ""), { timeout: 5000 })
      .toContain("idle hint");
    await expect(page.locator(".stage-popover.teacher.hint")).toBeVisible();
    expect(await page.evaluate(() => window.plp.director.state().signals.hintsShown)).toBe(1);
    // event-pattern hint on crash (and once:false means it can repeat)
    await run(page, "boom = 1 // 0\n");
    await expect(page.locator(".stage-popover")).toContainText("crash hint");
    // hint popovers are the quiet kind
    await expect(page.locator(".stage-popover")).toHaveClass(/hint/);
    // exit restores everything mid-lesson
    await page.evaluate(() => window.plp.director.exit("user"));
    expect(await page.evaluate(() => ({
      active: window.plp.director.isActive(),
      gated: window.plp.stage.gatedCaps(),
      veils: document.querySelectorAll(".stage-veiled").length,
      popovers: document.querySelectorAll(".stage-popover").length,
      stripHidden: document.querySelector(".director-strip").hidden,
    }))).toEqual({ active: false, gated: [], veils: 0, popovers: 0, stripHidden: true });
    // telemetry recorded the exited beat with signals
    const tele = await page.evaluate(() => window.plp.director.telemetry());
    const last = tele[tele.length - 1];
    expect(last.lesson).toBe("synthetic-hints");
    expect(last.how).toBe("exit:user");
    expect(last.hintsShown).toBeGreaterThanOrEqual(2);
    expect(last.attempts).toBe(1);
  });

  test("a beat that crashes while staging tears down to free play (gates fail open)", async ({ page }) => {
    await boot(page);
    // lint can't catch a target that is *shaped* right but resolves to
    // nothing at runtime + an action that throws mid-do: simulate via a
    // valid lesson whose second beat throws (quiz with unknown kind).
    await page.evaluate(() => window.plp.director.start({
      id: "synthetic-crash",
      beats: [
        { id: "ok", do: [{ gate: { deny: ["run", "edit"] } }], until: { event: "edited" } },
        { id: "boom", do: [{ quiz: { kind: "no-such-kind" } }] },
      ],
    }));
    await expect(page.locator("#btn-run")).toBeDisabled();
    // director-level skip advances into the crashing beat
    await page.evaluate(() => window.plp.director.skip());
    expect(await page.evaluate(() => window.plp.director.isActive())).toBe(false);
    await expect(page.locator("#btn-run")).toBeEnabled();
    expect(await page.evaluate(() => window.plp.editor.isReadOnly())).toBe(false);
  });
});

test.describe("D7 — reference lesson end-to-end", () => {
  test("a learner can walk meet-the-machine start to finish", async ({ page }) => {
    await boot(page);
    await expect(page.locator("#btn-lesson")).toHaveCount(0);
    await page.evaluate((lesson) => window.plp.director.start(lesson), referenceLesson);
    const beat = () => page.evaluate(() => window.plp.director.state()?.beat ?? "(none)");

    // Beat 1: everything but Run is gated; objects table veiled
    expect(await beat()).toBe("press-run");
    await expect(page.locator(".stage-popover.teacher")).toBeVisible();
    expect(await page.evaluate(() => {
      const speech = document.querySelector(".stage-popover.teacher").getBoundingClientRect();
      const overlap = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return Math.max(0, Math.min(speech.right, r.right) - Math.max(speech.left, r.left))
          * Math.max(0, Math.min(speech.bottom, r.bottom) - Math.max(speech.top, r.top));
      };
      return { editor: overlap("#editor-pane"), memory: overlap("#memory-pane") };
    })).toEqual({ editor: 0, memory: 0 });
    await expect(page.locator("[data-role=objects-table]")).toBeHidden();
    expect(await page.evaluate(() => window.plp.editor.isReadOnly())).toBe(true);
    await expect(page.locator("#btn-quiz")).toBeDisabled();
    // Beat 1 teaches Trace: Run alone would not fill the memory model.
    await expect(page.locator("#btn-run")).toBeDisabled();
    await page.click("#btn-trace");
    await expect.poll(beat, { timeout: 180_000 }).toBe("read-names");
    await expect(page.locator(".mm-name-box.name", { hasText: /^y$/ })).toHaveCount(1);

    // Beat 2: hover y (objects stays veiled only during beat 1 — cleared now)
    await page.evaluate(() => {
      const td = [...document.querySelectorAll(".mm-name-box.name")].find((c) => c.textContent.trim() === "y");
      td.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await page.waitForTimeout(400);
    expect(await beat()).toBe("read-names");
    await expect.poll(beat, { timeout: 2500 }).toBe("scrub-time");

    // Beat 3: scrub unlocked now; scrub anywhere (predicate ranLine 2 holds)
    await expect(page.locator("[data-role=step-slider]")).toBeEnabled();
    await page.evaluate(() => window.plp.memory.goTo(1));
    await expect.poll(beat).toBe("answer-input");

    // Beat 4: input program — run, answer inline
    await page.click("#btn-run");
    await page.waitForFunction(() => window.plp.console.isWaiting(), null, { timeout: 60_000 });
    await page.click("[data-role=console-term]");
    await page.keyboard.type("Ada");
    await page.keyboard.press("Enter");
    await expect.poll(beat).toBe("rerun");

    // Beat 5: trace the arithmetic program again (the quiz needs records)
    await page.click("#btn-trace");
    await expect.poll(beat).toBe("mastery");

    // Beat 6: quiz — wrong answer stays, correct advances to done
    await expect(page.locator(".quiz-panel")).toBeVisible();
    await page.fill(".quiz-panel input[data-blank]", "999");
    await page.evaluate(() => window.plp.quiz.check());
    expect(await beat()).toBe("mastery");
    await page.fill(".quiz-panel input[data-blank]", "3");
    await page.evaluate(() => window.plp.quiz.check());
    await expect.poll(beat).toBe("done");

    // Terminal beat: exit -> free play fully restored, progress recorded
    await page.click("[data-role=dir-exit]");
    expect(await page.evaluate(() => ({
      active: window.plp.director.isActive(),
      gated: window.plp.stage.gatedCaps(),
      readOnly: window.plp.editor.isReadOnly(),
    }))).toEqual({ active: false, gated: [], readOnly: false });
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("branch path: three wrong quiz answers detour to review", async ({ page }) => {
    await boot(page);
    // jump straight to the mastery beat by starting the lesson and skipping
    await page.evaluate((lesson) => window.plp.director.start(lesson), referenceLesson);
    for (const target of ["read-names", "scrub-time", "answer-input", "rerun"]) {
      await page.evaluate(() => window.plp.director.skip());
      expect(await page.evaluate(() => window.plp.director.state().beat)).toBe(target);
    }
    // mastery needs a matching trace: trace the arithmetic program
    await page.click("#btn-trace");
    await expect.poll(() => page.evaluate(() => window.plp.director.state().beat), { timeout: 180_000 })
      .toBe("mastery");
    for (let i = 0; i < 3; i++) {
      await page.fill(".quiz-panel input[data-blank]", "999");
      await page.evaluate(() => window.plp.quiz.check());
    }
    // struggle hint fired (signal threshold) and branch went to review
    expect(await page.evaluate(() => window.plp.director.state().beat)).toBe("review");
    // recovering: correct answer in review completes to done
    await page.fill(".quiz-panel input[data-blank]", "3");
    await page.evaluate(() => window.plp.quiz.check());
    expect(await page.evaluate(() => window.plp.director.state().beat)).toBe("done");
    await page.evaluate(() => window.plp.director.exit("user"));
  });
});
