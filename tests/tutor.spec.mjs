// T-series: guided tutor (app/tutor.mjs runtime, app/tutor-ui.mjs pane,
// predict-output question kind, curriculum unit 1). Driven through
// window.plp.tutor per invariant 9; every run ends with checkErrors clean.

import { test, expect } from "@playwright/test";

const SITE = "/PLP/";

async function setup(page) {
  await page.goto(SITE);
  await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.plp?.tutor));
}

test.describe("PLP tutor (T-series)", () => {
  test("Exercises starts hidden; the header button opens the full-viewport practice surface; visibility persists", async ({ page }) => {
    await setup(page);
    await expect(page.locator("#practice")).not.toBeVisible();
    await expect(page.locator("body")).not.toHaveClass(/practice/);
    await page.locator("#btn-tutor").click();
    // The practice surface owns the whole viewport: header + IDE hidden.
    await expect(page.locator("body")).toHaveClass(/practice/);
    await expect(page.locator("#practice")).toBeVisible();
    await expect(page.locator("header")).not.toBeVisible();
    await expect(page.locator("#layout")).not.toBeVisible();
    // Idle state: welcome card + exercises-only menu (drill topics; guided
    // units are debug-only via plp.tutor.start).
    await expect(page.locator("#practice .pr-static .tutor-card")).toHaveCount(1);
    await expect(page.locator("#practice [data-role=pr-controls] button").first()).toContainText("Everything");
    await expect(page.locator("#practice [data-role=pr-controls] button")).toHaveCount(9); // all + map + 7 topics
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await expect(page.locator("body")).toHaveClass(/practice/); // persisted
    await expect(page.locator("#practice")).toBeVisible();
    // The header is hidden while practicing — the surface's own ← leaves.
    await page.locator("#practice [data-role=pr-leave]").click();
    await expect(page.locator("body")).not.toHaveClass(/practice/);
    await expect(page.locator("#practice")).not.toBeVisible();
    await expect(page.locator("header")).toBeVisible();
    await expect(page.locator("#layout")).toBeVisible();
  });

  test("predict-output: trace-grounded, position-aware; forgives trailing whitespace + container display spacing, never content", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.plp.editor.setValue(
      'print("a")\nx = 1\nprint("b", x)\n'));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const r = await page.evaluate(() => {
      const ctx = {
        source: window.plp.editor.getValue(),
        steps: window.plp.memory.steps(),
        positions: window.plp.memory.linePositions(),
      };
      const whole = window.plp.questions.generateQuestion("predict-output", ctx, {});
      // linePositions has one entry per executed line: position 0 = line 1
      const partial = window.plp.questions.generateQuestion("predict-output", ctx, { position: 0 });
      return {
        wholePrompt: whole.prompt,
        wholeRight: whole.grade({ text: "a\nb 1" }).correct,
        wholeTrailing: whole.grade({ text: "a  \nb 1\n\n" }).correct,
        wholeWrongSpace: whole.grade({ text: "a\nb1" }).correct,
        wholeWrongCase: whole.grade({ text: "A\nb 1" }).correct,
        expectedText: whole.grade({ text: "" }).expected.text,
        partialLine: partial.line,
        partialRight: partial.grade({ text: "a" }).correct,
        partialWrong: partial.grade({ text: "a\nb 1" }).correct,
      };
    });
    expect(r.wholePrompt).toContain("What does this program print?");
    expect(r.wholeRight).toBe(true);
    expect(r.wholeTrailing).toBe(true); // trailing whitespace forgiven
    expect(r.wholeWrongSpace).toBe(false); // spacing OUTSIDE containers is content — exact
    expect(r.wholeWrongCase).toBe(false);
    expect(r.expectedText).toBe("a\nb 1\n");
    expect(r.partialLine).toBe(1);
    expect(r.partialRight).toBe(true);
    expect(r.partialWrong).toBe(false);

    // Container displays forgive spacing/quote-style variants that carry the
    // same content and understanding — but never a content difference.
    await page.evaluate(() => window.plp.editor.setValue('d = {"a": 1}\nprint([1, 2, 3], d)\n'));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const c = await page.evaluate(() => {
      const ctx = {
        source: window.plp.editor.getValue(),
        steps: window.plp.memory.steps(),
        positions: window.plp.memory.linePositions(),
      };
      const q = window.plp.questions.generateQuestion("predict-output", ctx, {});
      return {
        exact: q.grade({ text: "[1, 2, 3] {'a': 1}" }).correct,
        tightCommas: q.grade({ text: "[1,2,3] {'a':1}" }).correct,
        mixedSpacing: q.grade({ text: "[1,2, 3] {'a': 1}" }).correct,
        doubleQuotes: q.grade({ text: '[1, 2, 3] {"a": 1}' }).correct,
        wrongContent: q.grade({ text: "[1, 2] {'a': 1}" }).correct,
        gapIsContent: q.grade({ text: "[1, 2, 3]{'a': 1}" }).correct, // the space BETWEEN prints is content
      };
    });
    expect(c.exact).toBe(true);
    expect(c.tightCommas).toBe(true);
    expect(c.mixedSpacing).toBe(true);
    expect(c.doubleQuotes).toBe(true);
    expect(c.wrongContent).toBe(false);
    expect(c.gapIsContent).toBe(false);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("predict-state: latent state is examinable — grades a name never printed, quote-style forgiving", async ({ page }) => {
    await setup(page);
    // The classic aliasing trap, WITHOUT a print: `a` is never output, yet the
    // predict-state form asks what it holds and grades against the real trace.
    await page.evaluate(() => window.plp.editor.setValue("a = [1, 2]\nb = a\nb.append(3)\n"));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const r = await page.evaluate(() => {
      const ctx = {
        source: window.plp.editor.getValue(),
        steps: window.plp.memory.steps(),
        positions: window.plp.memory.linePositions(),
      };
      const q = window.plp.questions.generateQuestion("predict-state", ctx, { name: "a" });
      const missing = window.plp.questions.generateQuestion("predict-state", ctx, { name: "zzz" });
      return {
        prompt: q.prompt,
        expected: q.grade({ text: "" }).expected.text,
        right: q.grade({ text: "[1, 2, 3]" }).correct,
        rightSpacey: q.grade({ text: " [1,2,3] " }).correct, // whitespace forgiven
        wrongUnmutated: q.grade({ text: "[1, 2]" }).correct,
        unbound: missing, // no such name → null (cannot ask)
      };
    });
    expect(r.prompt).toContain("what does `a` hold");
    expect(r.expected).toBe("[1, 2, 3]"); // the aliased mutation shows through `a`
    expect(r.right).toBe(true);
    expect(r.rightSpacey).toBe(true);
    expect(r.wrongUnmutated).toBe(false);
    expect(r.unbound).toBeNull();
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("fill-one-blank: substitutes the typed token, runs it for real, judges by output", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.removeItem("plp.kb.v1"); localStorage.removeItem("plp.tutor.v1"); });
    // Seed 2 of a numbers round opens with `print(14 ___ 8)`, target 6.
    const id = await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 2, count: 1 }));
    expect(id).toBe("drill-numbers-2");
    expect((await page.evaluate(() => window.plp.editor.getValue())).trim()).toBe("print(14 ___ 8)");

    // A WRONG fill: 14 * 8 is 112, not the target 6.
    await page.evaluate(() => window.plp.tutor.lockPrediction("*"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 15_000 });
    const s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.lastAnswer).toBe("wrong");
    // The filled program really ran (the reveal): editor + console prove it.
    expect((await page.evaluate(() => window.plp.editor.getValue())).trim()).toBe("print(14 * 8)");
    expect((await page.evaluate(() => window.plp.console.text())).trim()).toBe("112");
    // Mastery recorded by concept TAG (arith-on-ints), not by exercise id.
    expect(await page.evaluate(() => window.plp.tutor.drillStats())).toEqual({ "0008": { seen: 1, missed: 1 } });
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("spot-the-difference: program A shown with its real output; predict program B", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.removeItem("plp.kb.v1"); localStorage.removeItem("plp.tutor.v1"); });
    // Seed 199 of a lists round opens with the += vs + [x] contrast (the
    // seed is a fixture — re-derive it if the lists exercise pool changes;
    // derivation: scan buildKBSession("lists", {seed, count: 1}) for the
    // first seed whose ask.context.code contains "+= [").
    const id = await page.evaluate(() => window.plp.tutor.startDrill("lists", { seed: 199, count: 1 }));
    expect(id).toBe("drill-lists-199");
    // The contrast rides ON the ask (ask.context): program A (uses +=) with
    // its real output — reload-safe — and the card renders it above B.
    const ctx = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("plp.tutor.v1"));
      return s.drillLesson.steps.find((x) => x.ask)?.ask.context;
    });
    expect(ctx.code).toContain("b += [88]");   // program A mutates the shared list
    expect(ctx.output).toBe("[4, 9, 88]");     // …and its real output is shown
    await expect(page.locator("#practice .pr-context")).toContainText("b += [88]");
    await expect(page.locator("#practice .pr-context .pr-out")).toContainText("[4, 9, 88]");
    // The editor holds program B (the one to predict — a is left untouched).
    expect((await page.evaluate(() => window.plp.editor.getValue())).trim())
      .toBe("a = [4, 9]\nb = a\nb = b + [88]\nprint(a)");
    // Predicting B's output correctly grades right and records the focus tag.
    await page.evaluate(() => window.plp.tutor.lockPrediction("[4, 9]"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    expect(await page.evaluate(() => window.plp.tutor.drillStats())).toEqual({ "0023": { seen: 1, missed: 0 } });
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("stage: beats take center stage in focus mode; Back-to-editor falls back to the classic dock; bubble click reopens with state intact", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.plp.tutor.start("u1-state-io"));
    // First beat (loadCode note + "press Trace" action) lands on the stage.
    await expect(page.locator("#layout")).toHaveClass(/focus/);
    await expect(page.locator(".tutor-stage")).toBeVisible();
    await expect(page.locator(".tutor-stage .tutor-action")).toHaveCount(1);
    await expect(page.locator(".tutor-bubble-stub")).toHaveCount(1);
    // Focus geometry: the stage fills the code column (left of the editor,
    // which recedes to the right column), above the console strip — still
    // docked in the grid, never floating.
    await page.locator(".tutor-stage").evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)));
    const geom = await page.evaluate(() => {
      const sr = document.querySelector(".tutor-stage").getBoundingClientRect();
      const er = document.getElementById("editor-pane").getBoundingClientRect();
      const cr = document.getElementById("console-pane").getBoundingClientRect();
      return {
        leftOfEditor: sr.right <= er.left + 2,
        aboveConsole: sr.bottom <= cr.top,
        editorVisible: er.width > 100 && er.height > 100,
        consoleSlim: cr.height < window.innerHeight * 0.3,
      };
    });
    expect(geom).toEqual({ leftOfEditor: true, aboveConsole: true, editorVisible: true, consoleSlim: true });

    // Back to editor: classic layout, stage docked under the code pane —
    // the old geometry — with the transcript pane back. Non-modal: nothing
    // about the lesson changes.
    await page.locator("[data-role=popup-close]").click();
    await expect(page.locator("#layout")).not.toHaveClass(/focus/);
    await expect(page.locator(".tutor-stage")).toBeVisible();
    await expect(page.locator("#tutor-pane")).toBeVisible();
    const classic = await page.evaluate(() => {
      const sr = document.querySelector(".tutor-stage").getBoundingClientRect();
      const er = document.getElementById("editor-pane").getBoundingClientRect();
      const cr = document.getElementById("console-pane").getBoundingClientRect();
      return {
        sameLeft: Math.abs(sr.left - er.left) < 2,
        sameRight: Math.abs(sr.right - er.right) < 2,
        belowEditor: sr.top >= er.bottom,
        aboveConsole: sr.bottom <= cr.top,
      };
    });
    expect(classic).toEqual({ sameLeft: true, sameRight: true, belowEditor: true, aboveConsole: true });
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("action");

    // Reach the first ask; type into the stage's input, hop through history
    // bubbles, and come back — the reparented card keeps the typed text.
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await page.evaluate(() => window.plp.tutor.continue());
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) document.querySelector("[data-role=step-next]").click();
    });
    await page.evaluate(() => window.plp.tutor.continue());
    await expect(page.locator(".tutor-stage .tutor-output-input")).toBeVisible();
    // One-thing-at-a-time: the single-print ask renders a single-line input.
    await expect(page.locator(".tutor-stage input.tutor-output-line")).toBeVisible();
    await page.locator(".tutor-stage .tutor-output-input").fill("6");
    // A past static bubble reopens read-only on the stage; the live card
    // returns to its feed bubble, typed value intact.
    await page.locator(".tutor-feed .tutor-say").first().click();
    await expect(page.locator(".tutor-stage .tutor-say")).toHaveCount(1);
    await expect(page.locator(".tutor-feed .tutor-output-input")).toHaveValue("6");
    // Click the question card itself, not its inputs (input clicks never pop).
    await page.locator(".tutor-feed .tutor-question").click({ position: { x: 8, y: 8 } });
    await expect(page.locator(".tutor-stage .tutor-output-input")).toHaveValue("6");

    // Reviewing a bubble about an EARLIER program shows a context card with
    // that program (the editor has moved on; line talk would mislead), and
    // its "load this program" button restores it via the stash-safe path.
    await page.locator(".tutor-feed .tutor-action").first().click(); // completed "press Trace" step (program 1)
    await expect(page.locator(".tutor-stage .tutor-context")).toContainText("x = 3");
    await page.locator(".tutor-stage .tutor-context .tutor-tryit").click();
    expect(await page.evaluate(() => window.plp.editor.getValue())).toContain("x = 3");
    // Editor now matches that program again → reviewing shows no context card.
    await page.locator(".tutor-feed .tutor-action").first().click();
    await expect(page.locator(".tutor-stage .tutor-context")).toHaveCount(0);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("reveal-in-card: locking shows the real output in the card, the explain keeps it, the next question resets; predict-state shows the value + memory escape", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.removeItem("plp.kb.v1"); localStorage.removeItem("plp.tutor.v1"); });
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 7, count: 2 }));
    await expect(page.locator("body")).toHaveClass(/practice/);
    await expect(page.locator("#practice .pr-question")).toBeVisible();
    await expect(page.locator("#practice .pr-reveal")).toHaveCount(0);

    // Lock a (wrong) prediction: the real run's output appears IN the card.
    await page.evaluate(() => window.plp.tutor.lockPrediction("definitely wrong"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 30_000 });
    await expect(page.locator("#practice .pr-reveal")).toBeVisible();
    await expect(page.locator("#practice .pr-reveal .pr-reveal-label")).toContainText("it printed");
    const revealed = await page.evaluate(() => document.querySelector("#practice .pr-reveal pre").textContent.trim());
    expect(revealed.length).toBeGreaterThan(0);
    // …and the explain face renders in the SAME card, reveal still visible.
    await expect(page.locator("#practice .pr-question .pr-explain .tutor-card")).toHaveCount(1);

    // Continue → the next question is a fresh card with no reveal.
    await page.evaluate(() => window.plp.tutor.continue());
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 15_000 });
    await expect(page.locator("#practice .pr-reveal")).toHaveCount(0);
    await expect(page.locator("#practice .pr-question")).toBeVisible();

    // predict-state: the reveal is the probed value, with the memory escape.
    await page.evaluate(() => window.plp.tutor.exit());
    await page.evaluate(() => window.plp.tutor.startDrill("lists", { seed: 4, count: 1 }));
    expect((await page.evaluate(() => window.plp.tutor.ask())).kind).toBe("predict-state");
    await page.evaluate(() => window.plp.tutor.lockPrediction("[1]"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    await expect(page.locator("#practice .pr-reveal .pr-reveal-label")).toContainText("it really holds");
    // The escape hatch drops to the IDE, where the trace already filled the
    // memory model.
    await page.locator("#practice .pr-see-memory").click();
    await expect(page.locator("body")).not.toHaveClass(/practice/);
    await expect(page.locator("#memory-pane")).toBeVisible();
    expect(await page.evaluate(() => window.plp.memory.steps().length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("topic meters + round summary: menu buttons show mastery; a finished round summarizes and suggests the next step", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.clear(); location.reload(); });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));

    // Pure helpers: totals over the 7 topics cover every non-structural
    // loaded concept exactly once.
    const totals = await page.evaluate(async () => {
      const { topicProgress } = await import("./app/kb-session.mjs");
      const { loadKB } = await import("./kb/index.mjs");
      const rows = topicProgress([]);
      const kb = loadKB();
      const nonStructural = [...kb.concepts.values()].filter((c) => c.kind !== "structural").length;
      return { sum: rows.reduce((a, r) => a + r.total, 0), nonStructural, met0: rows.every((r) => r.met === 0) };
    });
    expect(totals.sum).toBe(totals.nonStructural);
    expect(totals.met0).toBe(true);

    // Fresh menu: meters render empty (no count text at 0).
    await page.locator("#btn-tutor").click();
    await expect(page.locator("#practice [data-role=pr-controls] .t-meter").first()).toBeAttached();
    expect(await page.evaluate(() => document.querySelectorAll("#practice [data-role=pr-controls] .t-meter-count").length)).toBe(0);

    // A 2-question round: one right (grants met), one skipped.
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 7, count: 2 }));
    const q1 = await page.evaluate(() => window.plp.tutor.ask());
    expect(q1.kind).toBe("predict-output");
    // Answer question 1 correctly: read the loaded program's real answer by
    // evaluating it mentally is impossible here, so miss it on purpose, then
    // skip question 2 — summary shape is what's under test.
    await page.evaluate(() => window.plp.tutor.lockPrediction("wrong on purpose"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 15_000 });
    await page.evaluate(() => window.plp.tutor.continue());
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 15_000 });
    await page.evaluate(() => window.plp.tutor.skip());
    await page.evaluate(() => window.plp.tutor.continue());
    await page.waitForFunction(() => window.plp.tutor.state().waiting === null, null, { timeout: 15_000 });

    // Summary card: headline 0 of 2, two open dots, missed line; no
    // newly-met chips (nothing was answered correctly).
    const sum = await page.evaluate(() => {
      const card = document.querySelector("#practice .tutor-summary");
      return {
        head: card?.querySelector(".t-summary-head")?.textContent,
        hits: card?.querySelectorAll(".t-dot.hit").length,
        open: card?.querySelectorAll(".t-dot.open").length,
        chips: card?.querySelectorAll(".t-chip").length,
        missed: card?.querySelector(".t-summary-missed")?.textContent ?? "",
      };
    });
    expect(sum.head).toContain("0 of 2");
    expect(sum.hits).toBe(0);
    expect(sum.open).toBe(2);
    expect(sum.chips).toBe(0);
    expect(sum.missed).toContain("Coming back for you");
    // The frontier is non-empty even from zero (print-text), so the round
    // ends with a "Keep going" suggestion.
    const keepGoing = await page.evaluate(() =>
      [...document.querySelectorAll("#practice [data-role=pr-controls] button")].map((b) => b.textContent).find((t) => t.includes("Keep going")));
    expect(keepGoing).toBeTruthy();

    // Reload after the round: the summary card restores from the store.
    // (no checkErrors after reload — no trace has run in the fresh page)
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await expect(page.locator("#practice .tutor-summary")).toBeAttached();
  });

  test("concept map: lanes with met/frontier/locked chips; a frontier chip starts a targeted round on that concept", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.clear(); location.reload(); });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));

    // Pure model: every non-structural loaded concept appears exactly once;
    // a fresh student's frontier is exactly print-text; layering is
    // deterministic (two builds identical).
    const m = await page.evaluate(async () => {
      const { mapModel } = await import("./app/concept-map.mjs");
      const { loadKB } = await import("./kb/index.mjs");
      const kb = loadKB();
      const a = mapModel([]);
      const b = mapModel([]);
      const nodes = a.lanes.flatMap((l) => l.rows.flat());
      return {
        total: nodes.length,
        nonStructural: [...kb.concepts.values()].filter((c) => c.kind !== "structural").length,
        frontierTags: nodes.filter((n) => n.state === "frontier").map((n) => n.tag),
        lockedCount: nodes.filter((n) => n.state === "locked").length,
        deterministic: JSON.stringify(a) === JSON.stringify(b),
      };
    });
    expect(m.total).toBe(m.nonStructural);
    expect(m.frontierTags).toEqual(["0005"]); // cold start: print-text alone
    expect(m.lockedCount).toBe(m.total - 1);
    expect(m.deterministic).toBe(true);

    // The map view renders on the stage with matching chip states.
    await page.evaluate(() => { window.plp.tutor.showMap(); });
    await expect(page.locator("#practice .cm-lane")).toHaveCount(7);
    await expect(page.locator("#practice .cm-node.frontier")).toHaveCount(1);
    expect(await page.evaluate(() => document.querySelectorAll("#practice .cm-node.met").length)).toBe(0);

    // Locked chips are recommendations, not walls: the detail keeps its
    // "First: …" prerequisite links but still offers a jump-ahead.
    await page.locator("#practice .cm-node.locked").first().click();
    await expect(page.locator("#practice .cm-detail")).toContainText("First:");
    await expect(page.locator("#practice .cm-detail button", { hasText: "Try it anyway" })).toBeVisible();

    // Clicking the frontier chip opens its detail; "Practice this ▶" starts
    // a targeted round whose every ask is that concept.
    await page.locator("#practice .cm-node.frontier").click();
    await expect(page.locator("#practice .cm-detail")).toContainText("Ready to try");
    await page.locator("#practice .cm-detail button.primary").click();
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask");
    const round = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("plp.tutor.v1"));
      const asks = s.drillLesson.steps.filter((x) => x.ask).map((x) => x.ask.concept);
      return { id: s.lessonId, asks };
    });
    expect(round.id).toMatch(/^drill-state-0005-\d+$/);
    expect(round.asks.every((t) => t === "0005")).toBe(true);
    expect(round.asks.length).toBe(4); // focused rounds default shorter
  });

  test("practice edge flows: open-in-editor round trip, changed-program chip, reload rebuilds the card, hide keeps the round", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.clear(); location.reload(); });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 7, count: 2 }));
    await expect(page.locator("body")).toHaveClass(/practice/);
    const program = await page.evaluate(() => window.plp.editor.getValue());

    // Open in editor: the IDE returns with the program loaded.
    await page.locator("#practice .pr-open-editor").click();
    await expect(page.locator("body")).not.toHaveClass(/practice/);
    await expect(page.locator("#layout")).toBeVisible();
    expect(await page.evaluate(() => window.plp.editor.getValue())).toBe(program);

    // Edit the program, come back: the card offers to restore — and does.
    await page.evaluate(() => window.plp.editor.setValue("print('changed')\n"));
    await page.locator("#btn-tutor").click();
    await expect(page.locator("#practice .pr-restore-chip")).toBeVisible();
    await page.locator("#practice .pr-restore-chip").click();
    expect(await page.evaluate(() => window.plp.editor.getValue())).toBe(program);

    // Reload mid-ask: the practice card rebuilds (program + input) and the
    // driver still grades.
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await expect(page.locator("body")).toHaveClass(/practice/);
    await expect(page.locator("#practice .pr-question .pr-program")).toContainText(program.trim().slice(0, 8));
    await expect(page.locator("#practice .tutor-output-input")).toBeVisible();
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");

    // Hiding the surface (Esc / collab go-live path) never ends the round.
    await page.evaluate(() => window.plp.tutor.hideSurface());
    await expect(page.locator("body")).not.toHaveClass(/practice/);
    const st = await page.evaluate(() => window.plp.tutor.state());
    expect(st.lessonId).toMatch(/^drill-numbers-7$/);
    expect(st.waiting).toBe("ask");
  });

  test("lesson lint rejects malformed steps", async ({ page }) => {
    await setup(page);
    const errors = await page.evaluate(() => window.plp.tutor.lintLesson({
      id: "bad",
      steps: [
        { say: "ok", ask: { kind: "predict-output" } },   // two primaries
        { action: "do it" },                               // missing await
        { action: "do it", await: { event: "nope" } },     // unknown event
        { ask: { kind: "unknown-kind" } },                 // unknown kind
        { if: {}, say: "x" },                              // bad condition
      ],
    }));
    expect(errors.length).toBe(5);
  });

  test("lesson↔KB binding: lint rejects bad focus tags (binding spec §2/§7a)", async ({ page }) => {
    await setup(page);
    const errors = await page.evaluate(() => window.plp.tutor.lintLesson({
      id: "bad-binding",
      concepts: ["0006", "ZZZZ", "0001"],                       // unknown + structural
      steps: [
        { ask: { kind: "predict-output", focus: "XXXX" } },      // unknown focus
        { ask: { kind: "predict-output", focus: "0001" } },      // structural focus
        { ask: { kind: "predict-output", focus: "000A" } },      // not in unit concepts
        { ask: { kind: "predict-output", focus: "0006" } },      // fine
      ],
    }));
    expect(errors.some((e) => e.includes("unknown tag ZZZZ"))).toBe(true);
    expect(errors.some((e) => e.includes("structural tag 0001"))).toBe(true);
    expect(errors.some((e) => e.includes("XXXX is not a KB tag"))).toBe(true);
    expect(errors.some((e) => e.includes("0001 is structural"))).toBe(true);
    expect(errors.some((e) => e.includes("000A missing from the unit's concepts"))).toBe(true);
    expect(errors.filter((e) => e.includes("0006")).length).toBe(0); // the good one is clean
    // The shipped unit lints clean.
    const u1errors = await page.evaluate(async () => {
      const { curriculum } = await import("./curriculum/index.mjs");
      return window.plp.tutor.lintLesson(curriculum.units[0].lesson);
    });
    expect(u1errors).toEqual([]);
  });

  test("lesson↔KB binding: clean first-attempt correct ask grants met; wrong or post-hint grants nothing; frontier feeds the menu (§7b–d)", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.removeItem("plp.kb.met.v1"); localStorage.removeItem("plp.kb.v1"); });

    // Drive u1 to the b = a * 3 ask (focus 0009), skipping the demo steps.
    await page.evaluate(() => window.plp.tutor.start("u1-state-io"));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await page.evaluate(() => window.plp.tutor.continue());
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) document.querySelector("[data-role=step-next]").click();
    });
    await page.evaluate(() => window.plp.tutor.continue());
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");

    // (c) The demo-only walkthrough so far granted nothing.
    expect(await page.evaluate(() => window.plp.tutor.met())).toEqual({});

    // (b) A WRONG answer grants nothing.
    await page.evaluate(() => window.plp.tutor.lockPrediction("9"));
    expect(await page.evaluate(() => window.plp.tutor.met())).toEqual({});
    await page.evaluate(() => window.plp.tutor.continue()); // past the wrong-branch card

    // Input section: complete the rendezvous to reach the total ask.
    await page.evaluate(() => { window.__p = window.plp.trace(); });
    await page.waitForFunction(() => window.plp.console.isWaiting());
    await page.evaluate(() => window.plp.provideInput("Ada"));
    expect((await page.evaluate(() => window.__p)).terminal_reason).toBe("completed");
    await page.evaluate(() => window.plp.tutor.continue()); // input card
    await page.evaluate(() => window.plp.tutor.continue()); // output card
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");

    // (b) A clean first-attempt CORRECT answer on the total ask (focus 000B)
    // grants met with source "lesson".
    await page.evaluate(() => window.plp.tutor.lockPrediction("total: 15"));
    const met = await page.evaluate(() => window.plp.tutor.met());
    expect(Object.keys(met)).toEqual(["000B"]);
    expect(met["000B"].source).toBe("lesson");
    expect(met["000B"].at).toBeGreaterThan(0);
    // 0009 stayed ungranted (it was answered wrong).
    expect(met["0009"]).toBeUndefined();

    // (d) The met set feeds the frontier, and the post-lesson menu offers
    // the frontier entry on top of the standard 8.
    const frontier = await page.evaluate(() => window.plp.tutor.frontier());
    expect(frontier.length).toBeGreaterThan(0);
    await page.evaluate(() => window.plp.tutor.exit());
    await expect(page.locator("#practice [data-role=pr-controls] button").first()).toContainText("Drill what you just learned");
    await expect(page.locator("#practice [data-role=pr-controls] button")).toHaveCount(10); // frontier entry + all + map + 7 topics
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("lesson↔KB binding: an answer after the final hint grants nothing (§4.3)", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => localStorage.removeItem("plp.kb.met.v1"));
    await page.evaluate(() => window.plp.tutor.start("u1-state-io"));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await page.evaluate(() => window.plp.tutor.continue());
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) document.querySelector("[data-role=step-next]").click();
    });
    await page.evaluate(() => window.plp.tutor.continue());
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");

    // Reveal BOTH hints (the second states the reasoning outright), then
    // answer correctly: correct grades correct, but met is NOT granted.
    await page.locator(".tutor-popup button", { hasText: "Give me a hint" }).click();
    await page.locator(".tutor-popup button", { hasText: "Give me a hint" }).click();
    await page.evaluate(() => window.plp.tutor.lockPrediction("6"));
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    expect(await page.evaluate(() => window.plp.tutor.met())).toEqual({});
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("unit 1 end-to-end: actions, predict-then-verify, branches, input, completion", async ({ page }) => {
    await setup(page);
    const startedWith = await page.evaluate(() => window.plp.editor.getValue());

    await page.evaluate(() => window.plp.tutor.start("u1-state-io"));
    let s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.lessonId).toBe("u1-state-io");
    expect(s.waiting).toBe("action"); // press Trace

    // The lesson replaced the editor program and reset the panes (raw
    // record store empty; stepCount keeps its synthetic start position).
    const code1 = await page.evaluate(() => window.plp.editor.getValue());
    expect(code1).toContain("x = 3");
    expect(await page.evaluate(() => window.plp.memory.steps().length)).toBe(0);

    // Learner presses Trace (the real button path is covered by S-series;
    // the event, not the click, is the contract here).
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBe("pause");
    await page.evaluate(() => window.plp.tutor.continue());

    // Scrub action: three forward steps through the real scrubber button.
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBe("action");
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) document.querySelector("[data-role=step-next]").click();
    });
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBe("pause"); // the state-model card
    await page.evaluate(() => window.plp.tutor.continue());

    // First prediction: wrong on purpose → reveal + wrong-branch card.
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBe("ask");
    expect(await page.evaluate(() => window.plp.tutor.ask())).toEqual({ kind: "predict-output" });
    await page.evaluate(() => window.plp.tutor.lockPrediction("9"));
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.lastAnswer).toBe("wrong");
    expect(s.waiting).toBe("pause"); // the wrong-branch explanation pauses
    const afterWrong = await page.evaluate(() => window.plp.tutor.feed().slice(-2));
    expect(afterWrong[0].type).toBe("question-frozen");
    expect(afterWrong[0].ok).toBe(false);
    expect(afterWrong[1].md).toContain("stayed"); // the misconception card
    await page.evaluate(() => window.plp.tutor.continue());

    // Input section: trace, answer the prompt through the real rendezvous.
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBe("action");
    await page.evaluate(() => { window.__p = window.plp.trace(); });
    await page.waitForFunction(() => window.plp.console.isWaiting());
    await page.evaluate(() => window.plp.provideInput("Ada"));
    expect((await page.evaluate(() => window.__p)).terminal_reason).toBe("completed");
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBe("pause");
    await page.evaluate(() => window.plp.tutor.continue()); // input card
    await page.evaluate(() => window.plp.tutor.continue()); // output card

    // Mastery prediction, correct → correct-branch → pocket → done.
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBe("ask");
    await page.evaluate(() => window.plp.tutor.lockPrediction("total: 15"));
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.lastAnswer).toBe("correct");
    expect(s.waiting).toBeNull(); // lesson finished
    const feed = await page.evaluate(() => window.plp.tutor.feed());
    const types = feed.map((c) => c.type);
    expect(types).toContain("question-frozen");
    expect(feed.some((c) => c.pocket)).toBe(true);
    expect(feed[feed.length - 1].md).toContain("Unit 1");
    // Stream invariants hold for the lesson's final run (before the reload
    // below empties the record store).
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);

    // Transcript survives reload; finished state intact.
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    const restored = await page.evaluate(() => ({
      state: window.plp.tutor.state(),
      cards: window.plp.tutor.feed().length,
      dom: document.querySelectorAll(".tutor-card").length,
    }));
    expect(restored.state.lessonId).toBe("u1-state-io");
    expect(restored.cards).toBe(feed.length);
    expect(restored.dom).toBe(feed.length);

    // Exit restores the learner's own program (lesson code was unedited).
    await page.evaluate(() => window.plp.tutor.exit());
    expect(await page.evaluate(() => window.plp.editor.getValue())).toBe(startedWith);
    expect(await page.evaluate(() => window.plp.tutor.state())).toEqual({
      lessonId: null, stepIndex: -1, waiting: null, lastAnswer: null,
    });
  });

  test("learner edits during a lesson are never clobbered on exit", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.plp.editor.setValue("# my precious work\n"));
    await page.evaluate(() => window.plp.tutor.start("u1-state-io"));
    // The learner writes their own thing mid-lesson…
    await page.evaluate(() => window.plp.editor.setValue("# my solution attempt\n"));
    await page.evaluate(() => window.plp.tutor.exit());
    // …and exit keeps it (only unedited lesson code is replaced by the stash).
    expect(await page.evaluate(() => window.plp.editor.getValue())).toBe("# my solution attempt\n");
  });

  // The legacy drill-template bank (app/drills.mjs) and its six tests were
  // retired once the KB reached drill parity: practice rounds now compile
  // from kb/ exercises (app/kb-session.mjs), whose generation, variety,
  // explanation, and doc-fidelity guarantees live in the K-series
  // (tests/kb.spec.mjs). The round *behavior* tests below stayed.

  test("first encounter teaches first: an unseen concept's rule card precedes its question; seen concepts stay unspoiled", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.removeItem("plp.kb.v1"); localStorage.removeItem("plp.tutor.v1"); });

    // Compiled-script level (pure): fresh stats → the FIRST ask on each
    // distinct CORE concept carries ask.teach (edge concepts stay
    // discovery-first — the trap's surprise is the pedagogy); primed stats →
    // no teach at all; no standalone teach say-steps exist (prose diet).
    const r = await page.evaluate(async () => {
      const { buildKBSession } = await import("./app/kb-session.mjs");
      const { loadKB } = await import("./kb/index.mjs");
      const kinds = loadKB().concepts;
      const fresh = buildKBSession("numbers", { seed: 7, count: 5, stats: {} });
      const asks = fresh.steps.filter((s) => s.ask);
      const focuses = [...new Set(asks.map((s) => s.ask.concept))];
      const coreFocuses = focuses.filter((t) => kinds.get(t).kind === "core");
      const taught = asks.filter((s) => s.ask.teach);
      const primed = buildKBSession("numbers", {
        seed: 7, count: 5,
        stats: Object.fromEntries(focuses.map((t) => [t, { seen: 2, missed: 0 }])),
      });
      return {
        coreConcepts: coreFocuses.length,
        teachCount: taught.length,
        teachHasStatement: taught.every((s) => s.ask.teach.statement?.length > 0 && s.ask.teach.card?.length > 0),
        noTeachSays: fresh.steps.every((s) => !s.say?.includes("New idea!")),
        primedTeachCount: primed.steps.filter((s) => s.ask?.teach).length,
      };
    });
    expect(r.coreConcepts).toBeGreaterThan(0); // the fixture round must exercise the rule
    expect(r.teachCount).toBe(r.coreConcepts); // one teach per new CORE concept, no repeats
    expect(r.teachHasStatement).toBe(true);
    expect(r.noTeachSays).toBe(true);
    expect(r.primedTeachCount).toBe(0); // once seen, questions stay unspoiled

    // UI level: the 🌱 teach line renders IN the question card, non-blocking,
    // with the worked example collapsed behind a tap.
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 7, count: 2 }));
    const s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBe("ask");
    await expect(page.locator("#practice .pr-question .pr-teach")).toBeVisible();
    await expect(page.locator("#practice .pr-teach-example summary")).toContainText("show me an example");
    // (no checkErrors here: it validates the trace record stream, and this
    // test intentionally stops before any trace runs)
  });

  test("drill round: seeded session, miss stats, explain cards, reload-restores same round", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => localStorage.removeItem("plp.drills.v1"));
    const id = await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 42, count: 2 }));
    expect(id).toBe("drill-numbers-42");
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");

    // Miss on purpose → template explain card arrives and pauses.
    await page.evaluate(() => window.plp.tutor.lockPrediction("definitely wrong"));
    let s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.lastAnswer).toBe("wrong");
    expect(s.waiting).toBe("pause");
    const stats = await page.evaluate(() => window.plp.tutor.drillStats());
    const bumped = Object.values(stats);
    expect(bumped.length).toBe(1);
    expect(bumped[0]).toEqual({ seen: 1, missed: 1 });

    // Reload mid-round: the persisted compiled script restores the SAME round.
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.lessonId).toBe("drill-numbers-42");
    // Reload-as-continue moves past the pause to the round's next question.
    expect(s.waiting).toBe("ask");

    // Finish the round (skip counts as a miss and triggers the explain pause).
    await page.evaluate(() => window.plp.tutor.skip());
    await page.evaluate(() => window.plp.tutor.continue());
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBeNull();
    const feed = await page.evaluate(() => window.plp.tutor.feed());
    expect(feed[feed.length - 1].md).toContain("Round complete");
    const finalStats = await page.evaluate(() => window.plp.tutor.drillStats());
    expect(Object.values(finalStats).reduce((a, x) => a + x.seen, 0)).toBe(2);
  });

  test("a correct answer holds the card: verdict + reveal stay up until Continue (Enter works)", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.removeItem("plp.kb.v1"); localStorage.removeItem("plp.tutor.v1"); });
    // Fixture: numbers seed 2 count 1 is `print(14 ___ 8)` target 6 → "-".
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 2, count: 1 }));
    await page.evaluate(() => window.plp.tutor.lockPrediction("-"));
    // The round PAUSES on a correct answer too — the one-card surface would
    // otherwise wipe the verdict before the learner reads it.
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 30_000 });
    await expect(page.locator("#practice .pr-verdict-slot .tutor-verdict")).toContainText("✓");
    await expect(page.locator("#practice .pr-reveal.good")).toBeVisible();
    await expect(page.locator("#practice [data-role=pr-controls] button.primary")).toContainText("Continue");
    // The answered dot reads green.
    await expect(page.locator("#practice .pr-dot.hit")).toHaveCount(1);
    // Enter presses Continue (the frozen card's input is readOnly, so the
    // keystroke falls through to the surface).
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.plp.tutor.state().waiting === null, null, { timeout: 15_000 });
    await expect(page.locator("#practice .tutor-summary .t-summary-head")).toContainText("1 of 1");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("dots review + retry: go back to any answered question; a retry re-runs for real but the score keeps the first attempt", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.removeItem("plp.kb.v1"); localStorage.removeItem("plp.tutor.v1"); });
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 42, count: 2 }));

    // Q1 wrong: the reveal carries the reflect link (the graded trace is
    // already scrubbable in the memory model), and its dot reads red.
    await page.evaluate(() => window.plp.tutor.lockPrediction("definitely wrong"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 30_000 });
    await expect(page.locator("#practice .pr-reveal .pr-see-memory")).toContainText("step through this run");
    const expected1 = (await page.evaluate(() => document.querySelector("#practice .pr-reveal pre").textContent)).replace(/\n$/, "");
    await page.evaluate(() => window.plp.tutor.continue());
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 15_000 });
    await expect(page.locator("#practice .pr-dot.miss")).toHaveCount(1);
    const q2code = await page.evaluate(() => window.plp.editor.getValue());

    // Click the red dot: the review card rebuilds Q1 from the store.
    await page.locator("#practice button.pr-dot").click();
    await expect(page.locator("#practice .pr-review .pr-program")).toBeVisible();
    await expect(page.locator("#practice .pr-review .pr-review-answer")).toContainText("definitely wrong");
    await expect(page.locator("#practice .pr-retry-note")).toContainText("keeps the first try");

    // Retry wrong, then retry right: the record decorates (retry.ok), but
    // ok, the kb stats, and the round score never move off the first attempt.
    const bad = await page.evaluate(() => window.plp.tutor.retry(0, "still wrong"));
    expect(bad.ok).toBe(false);
    const good = await page.evaluate((t) => window.plp.tutor.retry(0, t), expected1);
    expect(good.ok).toBe(true);
    const after = await page.evaluate(() => ({
      rec: (() => { const r = window.plp.tutor.feed().filter((c) => c.type === "question-frozen")[0]; return { ok: r.ok, retryOk: r.retry.ok }; })(),
      stats: Object.values(window.plp.tutor.drillStats()),
      editor: window.plp.editor.getValue(),
    }));
    expect(after.rec).toEqual({ ok: false, retryOk: true });   // miss of record, solved on retry
    expect(after.stats).toEqual([{ seen: 1, missed: 1 }]);      // score untouched
    expect(after.editor).toBe(q2code);                          // the live round's program survived the retry runs
    // The dot now shows missed-then-solved (red with the green ring).
    await expect(page.locator("#practice .pr-dot.miss.retried")).toHaveCount(1);

    // Back to the round: the live Q2 card returns intact.
    await page.locator("#practice .pr-review .pr-actions button").click();
    await expect(page.locator("#practice .pr-question:not(.pr-review) .tutor-output-input")).toBeVisible();
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");

    // Scratch notes: persist as typed; Esc closes the drawer, not practice.
    await page.locator("[data-role=pr-notes]").click();
    await page.locator("[data-role=pr-notes-text]").fill("aliases share one list");
    expect(await page.evaluate(() => localStorage.getItem("plp.notes.v1"))).toBe("aliases share one list");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-role=pr-notes-drawer]")).toBeHidden();
    await expect(page.locator("body")).toHaveClass(/practice/);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  // Ad-hoc trace-table lessons ride the drill-restore path: a hand-authored
  // script persisted as store.drillLesson runs on the ordinary lesson
  // machinery after a reload (the same mechanism that resumes real rounds).
  async function startTraceTableRound(page) {
    await page.evaluate(() => {
      localStorage.removeItem("plp.kb.met.v1");
      localStorage.removeItem("plp.kb.v1");
      const lesson = {
        id: "tt-inline",
        title: "Trace table",
        steps: [
          { loadCode: "a = 0\nb = [1, 2]\na = a + 1\n" },
          { ask: { kind: "trace-table", probeNames: ["a", "b"], maxBlanks: 8, prompt: "Fill in the table.", concept: "0009" } },
          { pause: true }, // hold the graded card (drill cadence) for the DOM assertions
          { done: "done" },
        ],
      };
      localStorage.setItem("plp.tutor.v1", JSON.stringify({
        lessonId: lesson.id, drillLesson: lesson, resumeIndex: 0, cards: [],
      }));
      location.reload();
    });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    // The reload starts with the surface hidden — open it for the DOM checks.
    await page.evaluate(() => {
      if (!document.body.classList.contains("practice")) window.plp.tutor.toggleSurface();
    });
    // execTraceTable traces silently first; the ask arms once the table is up.
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    expect(await page.evaluate(() => window.plp.tutor.ask())).toEqual({ kind: "trace-table" });
  }

  test("trace-table ask: lint accepts the kind; silent trace; non-empty gate; per-cell marks; wrong grants nothing", async ({ page }) => {
    await setup(page);
    // lintLesson accepts the kind via the questionGenerators registry.
    const lintErrors = await page.evaluate(() => window.plp.tutor.lintLesson({
      id: "tt-lint", steps: [{ ask: { kind: "trace-table", probeNames: ["a"] } }],
    }));
    expect(lintErrors).toEqual([]);

    await startTraceTableRound(page);
    // The silent trace really ran: the record store is populated.
    expect(await page.evaluate(() => window.plp.memory.steps().length)).toBeGreaterThan(0);
    // The table rendered with one input per blank (a@1, b@2, a@3).
    await expect(page.locator("#practice .tutor-trace-table input[data-blank-id]")).toHaveCount(3);

    // Non-empty gate: a partial submit sets the note and stays waiting.
    await page.evaluate(() => window.plp.tutor.submit({ b0: "0", b1: "", b2: "1" }));
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");
    await expect(page.locator("#practice .pr-note")).toContainText("Fill every box first");

    // One wrong cell: ok false, per-cell marks, the truth beside the miss.
    await page.evaluate(() => window.plp.tutor.submit({ b0: "0", b1: "[1,2]", b2: "999" }));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    const s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.lastAnswer).toBe("wrong");
    await expect(page.locator("#practice .tutor-trace-table input.ok")).toHaveCount(2); // container spacing forgiven on b1
    await expect(page.locator("#practice .tutor-trace-table input.bad")).toHaveCount(1);
    await expect(page.locator("#practice .tutor-trace-table .tutor-cell-truth")).toContainText("1");
    await expect(page.locator("#practice .pr-reveal pre")).toContainText("2 of 3 steps right");
    await expect(page.locator("#practice .pr-verdict-slot .tutor-verdict")).toContainText("2 of 3");
    // The record froze with the review snapshot; the score counted a miss.
    const rec = await page.evaluate(() =>
      window.plp.tutor.feed().findLast((c) => c.type === "question-frozen"));
    expect(rec.ok).toBe(false);
    expect(rec.review.kind).toBe("trace-table");
    expect(rec.review.table.rows.length).toBe(3);
    expect(rec.review.answersById.b2).toBe("999");
    expect(await page.evaluate(() => window.plp.tutor.drillStats())).toEqual({ "0009": { seen: 1, missed: 1 } });
    // A wrong table grants no met.
    expect(await page.evaluate(() => window.plp.tutor.met())).toEqual({});
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("trace-table ask: clean all-correct first attempt grants met; review shows the completed table with the table-shaped retry", async ({ page }) => {
    await setup(page);
    await startTraceTableRound(page);
    await page.evaluate(() => window.plp.tutor.submit({ b0: "0", b1: "[1, 2]", b2: "1" }));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    await expect(page.locator("#practice .pr-verdict-slot .tutor-verdict")).toContainText("✓ Every step right");
    const met = await page.evaluate(() => window.plp.tutor.met());
    expect(Object.keys(met)).toEqual(["0009"]);
    expect(met["0009"].source).toBe("drill");
    expect(await page.evaluate(() => window.plp.tutor.drillStats())).toEqual({ "0009": { seen: 1, missed: 0 } });

    // Review: the completed table rebuilds read-only — your answers marked
    // per cell — and the table-shaped retry widget IS offered (not the
    // single-input one).
    await page.evaluate(() => window.plp.tutor.review(0));
    await expect(page.locator("#practice .pr-review .tutor-trace-table")).toBeVisible();
    await expect(page.locator("#practice .pr-review .tutor-trace-table code.ok")).toHaveCount(3);
    await expect(page.locator("#practice .pr-review .pr-retry.pr-retry-table")).toHaveCount(1);
    await expect(page.locator("#practice .pr-review .pr-retry input")).toHaveCount(0);
    await page.evaluate(() => window.plp.tutor.closeReview());
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("trace-table review retry: blank table replaces the graded truth; a correct retry decorates the dot but never the score", async ({ page }) => {
    await setup(page);
    await startTraceTableRound(page);
    // Miss the table on the first (scored) attempt.
    await page.evaluate(() => window.plp.tutor.submit({ b0: "0", b1: "[1, 2]", b2: "999" }));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    const liveCode = await page.evaluate(() => window.plp.editor.getValue());
    await expect(page.locator("#practice .pr-dot.miss")).toHaveCount(1);

    // The red dot opens the review: graded table (truth beside the miss)
    // plus the "Try it again" entry point and the score-keeping note.
    await page.locator("#practice button.pr-dot").click();
    await expect(page.locator("#practice .pr-review .tutor-trace-table code.bad")).toHaveCount(1);
    await expect(page.locator("#practice .pr-review .pr-retry-note")).toContainText("keeps the first try");

    // Starting the retry swaps in a FRESH blank table: no graded marks, no
    // truth anywhere, one empty input per blank.
    await page.locator("#practice .pr-retry-table button.primary", { hasText: "Try it again" }).click();
    await expect(page.locator("#practice .pr-review .tutor-trace-table input[data-blank-id]")).toHaveCount(3);
    await expect(page.locator("#practice .pr-review .tutor-trace-table code.ok, #practice .pr-review .tutor-trace-table code.bad")).toHaveCount(0);
    await expect(page.locator("#practice .pr-review .tutor-trace-table .hint")).toHaveCount(0);

    // The quiet escape restores the graded view without grading anything.
    await page.locator("#practice .pr-retry-cancel").click();
    await expect(page.locator("#practice .pr-review .tutor-trace-table code.bad")).toHaveCount(1);
    await expect(page.locator("#practice .pr-review .tutor-trace-table input")).toHaveCount(0);

    // Retry for real: the empty gate holds, then an all-correct fill grades
    // against a genuine re-run of the program.
    await page.locator("#practice .pr-retry-table button.primary", { hasText: "Try it again" }).click();
    await page.locator("#practice .pr-retry-table button.primary", { hasText: "Check my answers" }).click();
    await expect(page.locator("#practice .pr-retry-verdict")).toContainText("Fill every box first");
    const inputs = page.locator("#practice .pr-review .tutor-trace-table input[data-blank-id]");
    await inputs.nth(0).fill("0");
    await inputs.nth(1).fill("[1, 2]");
    await inputs.nth(2).fill("1");
    await page.locator("#practice .pr-retry-table button.primary", { hasText: "Check my answers" }).click();
    await expect(page.locator("#practice .pr-retry-verdict")).toContainText("✓ every step!", { timeout: 30_000 });
    // The re-graded table shows every cell right.
    await expect(page.locator("#practice .pr-review .tutor-trace-table code.ok")).toHaveCount(3);

    // Score of record untouched; the retry only decorates.
    const after = await page.evaluate(() => ({
      rec: (() => {
        const r = window.plp.tutor.feed().find((c) => c.type === "question-frozen");
        return { ok: r.ok, retryOk: r.retry.ok, tries: r.retry.tries };
      })(),
      stats: window.plp.tutor.drillStats(),
      met: window.plp.tutor.met(),
      editor: window.plp.editor.getValue(),
    }));
    expect(after.rec).toEqual({ ok: false, retryOk: true, tries: 1 });
    expect(after.stats).toEqual({ "0009": { seen: 1, missed: 1 } });
    expect(after.met).toEqual({});
    expect(after.editor).toBe(liveCode); // the live round's program survived the retry run
    // The dot now reads missed-then-solved (red with the green ring).
    await expect(page.locator("#practice .pr-dot.miss.retried")).toHaveCount(1);
    await page.evaluate(() => window.plp.tutor.closeReview());
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("generated ask retries: wrong first try keeps the card live, second resolves", async ({ page }) => {
    await setup(page);
    // Drive an ask directly through a tiny inline lesson via the quiz-less
    // runtime path: use unit 1's first predict step but answer via submit on
    // a generated (non-predict) kind. Simplest real coverage: memory ask.
    await page.evaluate(() => window.plp.editor.setValue("x = 3\ny = 4\n"));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const r = await page.evaluate(() => {
      const ctx = {
        source: window.plp.editor.getValue(),
        steps: window.plp.memory.steps(),
        positions: window.plp.memory.linePositions(),
      };
      const q = window.plp.questions.generateQuestion("memory-next-line", ctx, { from: 0, to: 1 });
      const wrong = Object.fromEntries(q.blanks.map((b) => [b.id, "999"]));
      const right = Object.fromEntries(q.blanks.map((b) => [b.id, b.expected]));
      return { wrong: q.grade(wrong).correct, right: q.grade(right).correct };
    });
    expect(r.wrong).toBe(false);
    expect(r.right).toBe(true);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });
});
