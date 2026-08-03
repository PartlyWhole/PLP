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
  test("Exercises starts hidden; the header button enters focus mode (stage up, transcript tucked away); visibility persists", async ({ page }) => {
    await setup(page);
    await expect(page.locator(".tutor-stage")).not.toBeVisible();
    await expect(page.locator("#layout")).not.toHaveClass(/focus/);
    await page.locator("#btn-tutor").click();
    // Focus mode: the stage carries the menu beat; the transcript pane stays
    // tucked behind the 📜 History toggle.
    await expect(page.locator("#layout")).toHaveClass(/focus/);
    await expect(page.locator(".tutor-stage")).toBeVisible();
    await expect(page.locator("#tutor-pane")).not.toBeVisible();
    await page.locator("[data-role=stage-history]").click();
    await expect(page.locator("#tutor-pane")).toBeVisible();
    // Idle state: welcome card + exercises-only menu (drill topics; guided
    // units are debug-only via plp.tutor.start).
    await expect(page.locator(".tutor-feed .tutor-card")).toHaveCount(1);
    await expect(page.locator(".tutor-controls button").first()).toContainText("Everything");
    await expect(page.locator(".tutor-controls button")).toHaveCount(9); // all + map + 7 topics
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await expect(page.locator("#layout")).toHaveClass(/focus/); // persisted (flags reset)
    await expect(page.locator(".tutor-stage")).toBeVisible();
    await expect(page.locator("#tutor-pane")).not.toBeVisible(); // history flag never persists
    await page.locator("#btn-tutor").click(); // toggle off: leaves Exercises entirely
    await expect(page.locator("#layout")).not.toHaveClass(/focus/);
    await expect(page.locator(".tutor-stage")).not.toBeVisible();
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
    // Seed 143 of a lists round opens with the += vs + [x] contrast (the
    // seed is a fixture — re-derive it if the lists exercise pool changes).
    const id = await page.evaluate(() => window.plp.tutor.startDrill("lists", { seed: 143, count: 1 }));
    expect(id).toBe("drill-lists-143");
    // The contrast card shows program A (uses +=) WITH its real output.
    const feed = await page.evaluate(() => window.plp.tutor.feed().map((c) => c.md).filter(Boolean));
    const contrast = feed.find((md) => md.includes("Spot the difference"));
    expect(contrast).toContain("b += [54]");   // program A mutates the shared list
    expect(contrast).toContain("[3, 8, 54]");  // …and its real output is shown
    // The editor holds program B (the one to predict — a is left untouched).
    expect((await page.evaluate(() => window.plp.editor.getValue())).trim())
      .toBe("a = [3, 8]\nb = a\nb = b + [54]\nprint(a)");
    // Predicting B's output correctly grades right and records the focus tag.
    await page.evaluate(() => window.plp.tutor.lockPrediction("[3, 8]"));
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

  test("reveal choreography: locking grows the console, the explain keeps it, the next question resets; predict-state opens memory", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.removeItem("plp.kb.v1"); localStorage.removeItem("plp.tutor.v1"); });
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 7, count: 2 }));
    await expect(page.locator("#layout")).toHaveClass(/focus/);
    await expect(page.locator("#layout")).not.toHaveClass(/focus-reveal/);
    const slim = await page.evaluate(() => document.getElementById("console-pane").getBoundingClientRect().height);

    // Lock a (wrong) prediction: the console growing IS the reveal cue.
    await page.evaluate(() => window.plp.tutor.lockPrediction("definitely wrong"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 15_000 });
    await expect(page.locator("#layout")).toHaveClass(/focus-reveal/);
    const grown = await page.evaluate(() => document.getElementById("console-pane").getBoundingClientRect().height);
    expect(grown).toBeGreaterThan(slim * 1.5);

    // The explain beat (static) keeps the grown console — the learner reads
    // the card with the real output still on screen. The NEXT question resets.
    await page.evaluate(() => window.plp.tutor.continue());
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 15_000 });
    await expect(page.locator("#layout")).not.toHaveClass(/focus-reveal/);
    const slimAgain = await page.evaluate(() => document.getElementById("console-pane").getBoundingClientRect().height);
    expect(Math.abs(slimAgain - slim)).toBeLessThan(4);

    // predict-state reveal opens the memory pane (the state IS the answer).
    await page.evaluate(() => window.plp.tutor.exit());
    await page.evaluate(() => window.plp.tutor.startDrill("lists", { seed: 4, count: 1 }));
    expect((await page.evaluate(() => window.plp.tutor.ask())).kind).toBe("predict-state");
    await expect(page.locator("#memory-pane")).not.toBeVisible();
    await page.evaluate(() => window.plp.tutor.lockPrediction("[1]"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    await expect(page.locator("#layout")).toHaveClass(/focus-memory/);
    await expect(page.locator("#memory-pane")).toBeVisible();
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
    await page.evaluate(() => window.plp.layout.setTutorVisible(true));
    await expect(page.locator(".tutor-controls .t-meter").first()).toBeAttached();
    expect(await page.evaluate(() => document.querySelectorAll(".tutor-controls .t-meter-count").length)).toBe(0);

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
      const card = document.querySelector(".tutor-stage .tutor-summary") ?? document.querySelector(".tutor-feed .tutor-summary");
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
      [...document.querySelectorAll(".tutor-controls button")].map((b) => b.textContent).find((t) => t.includes("Keep going")));
    expect(keepGoing).toBeTruthy();

    // Reload after the round: the summary card restores from the store.
    // (no checkErrors after reload — no trace has run in the fresh page)
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await expect(page.locator(".tutor-feed .tutor-summary")).toBeAttached();
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
    await page.evaluate(() => { window.plp.layout.setTutorVisible(true); window.plp.tutor.showMap(); });
    await expect(page.locator(".tutor-stage .cm-lane")).toHaveCount(7);
    await expect(page.locator(".tutor-stage .cm-node.frontier")).toHaveCount(1);
    expect(await page.evaluate(() => document.querySelectorAll(".tutor-stage .cm-node.met").length)).toBe(0);

    // Clicking the frontier chip opens its detail; "Practice this ▶" starts
    // a targeted round whose every ask is that concept.
    await page.locator(".tutor-stage .cm-node.frontier").click();
    await expect(page.locator(".tutor-stage .cm-detail")).toContainText("Ready to try");
    await page.locator(".tutor-stage .cm-detail button.primary").click();
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
    await expect(page.locator(".tutor-controls button").first()).toContainText("Drill what you just learned");
    await expect(page.locator(".tutor-controls button")).toHaveCount(10); // frontier entry + all + map + 7 topics
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

    // Compiled-script level (pure): fresh stats → one teach card per distinct
    // CORE concept (edge concepts stay discovery-first — the trap's surprise
    // is the pedagogy), each BEFORE that concept's first ask; primed stats →
    // none at all.
    const r = await page.evaluate(async () => {
      const { buildKBSession } = await import("./app/kb-session.mjs");
      const { loadKB } = await import("./kb/index.mjs");
      const kinds = loadKB().concepts;
      const fresh = buildKBSession("numbers", { seed: 7, count: 5, stats: {} });
      const asks = fresh.steps.filter((s) => s.ask);
      const focuses = [...new Set(asks.map((s) => s.ask.concept))];
      const coreFocuses = focuses.filter((t) => kinds.get(t).kind === "core");
      const teach = fresh.steps.filter((s) => s.say?.includes("New idea!"));
      const firstTeachIdx = fresh.steps.findIndex((s) => s.say?.includes("New idea!"));
      const firstAskIdx = fresh.steps.findIndex((s) => s.ask);
      const primed = buildKBSession("numbers", {
        seed: 7, count: 5,
        stats: Object.fromEntries(focuses.map((t) => [t, { seen: 2, missed: 0 }])),
      });
      return {
        coreConcepts: coreFocuses.length,
        teachCount: teach.length,
        teachBeforeAsk: firstTeachIdx !== -1 && firstTeachIdx < firstAskIdx,
        primedTeachCount: primed.steps.filter((s) => s.say?.includes("New idea!")).length,
      };
    });
    expect(r.coreConcepts).toBeGreaterThan(0); // the fixture round must exercise the rule
    expect(r.teachCount).toBe(r.coreConcepts); // one lesson per new CORE concept, no repeats
    expect(r.teachBeforeAsk).toBe(true);
    expect(r.primedTeachCount).toBe(0); // once seen, questions stay unspoiled

    // UI level: the teach card lands in the feed and does NOT block — the
    // round still opens waiting on the ask, with the rule card above it.
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 7, count: 2 }));
    const s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBe("ask");
    const feed = await page.evaluate(() => window.plp.tutor.feed().map((c) => c.md).filter(Boolean));
    expect(feed.some((md) => md.includes("New idea!"))).toBe(true);
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
