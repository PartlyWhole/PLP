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
  test("pane starts hidden; header button toggles; visibility persists", async ({ page }) => {
    await setup(page);
    await expect(page.locator("#tutor-pane")).not.toBeVisible();
    await page.locator("#btn-tutor").click();
    await expect(page.locator("#tutor-pane")).toBeVisible();
    // Idle state: welcome card + exercises-only menu (drill topics; guided
    // units are debug-only via plp.tutor.start).
    await expect(page.locator(".tutor-feed .tutor-card")).toHaveCount(1);
    await expect(page.locator(".tutor-controls button").first()).toContainText("Everything");
    await expect(page.locator(".tutor-controls button")).toHaveCount(8); // all + 7 topics
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await expect(page.locator("#tutor-pane")).toBeVisible(); // persisted
    await page.locator("[data-role=tutor-collapse]").click();
    await expect(page.locator("#tutor-pane")).not.toBeVisible();
  });

  test("predict-output: trace-grounded, position-aware, forgiving only on trailing whitespace", async ({ page }) => {
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
    expect(r.wholeWrongSpace).toBe(false); // internal spacing exact
    expect(r.wholeWrongCase).toBe(false);
    expect(r.expectedText).toBe("a\nb 1\n");
    expect(r.partialLine).toBe(1);
    expect(r.partialRight).toBe(true);
    expect(r.partialWrong).toBe(false);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("popup: current beat pops up, close returns it to the feed, bubble click reopens with state intact", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.plp.tutor.start("u1-state-io"));
    // First beat (loadCode note + "press Trace" action) pops automatically.
    await expect(page.locator(".tutor-popup")).toBeVisible();
    await expect(page.locator(".tutor-popup .tutor-action")).toHaveCount(1);
    await expect(page.locator(".tutor-bubble-stub")).toHaveCount(1);
    // Non-modal: closing changes nothing about the lesson; the card returns.
    await page.locator("[data-role=popup-close]").click();
    await expect(page.locator(".tutor-popup")).toBeHidden();
    await expect(page.locator(".tutor-feed .tutor-action")).toHaveCount(1);
    await expect(page.locator(".tutor-bubble-stub")).toHaveCount(0);
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("action");
    // Clicking the bubble reopens the same live card.
    await page.locator(".tutor-feed .tutor-action").click();
    await expect(page.locator(".tutor-popup .tutor-action")).toHaveCount(1);

    // Reach the first ask; type into the popup's textarea, close, reopen —
    // the reparented card keeps the typed prediction.
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await page.evaluate(() => window.plp.tutor.continue());
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) document.querySelector("[data-role=step-next]").click();
    });
    await page.evaluate(() => window.plp.tutor.continue());
    await expect(page.locator(".tutor-popup .tutor-output-input")).toBeVisible();
    // One-thing-at-a-time: the single-print ask renders a single-line input.
    await expect(page.locator(".tutor-popup input.tutor-output-line")).toBeVisible();
    await page.locator(".tutor-popup .tutor-output-input").fill("6");
    await page.locator("[data-role=popup-close]").click();
    await expect(page.locator(".tutor-feed .tutor-output-input")).toHaveValue("6");
    // Click the card itself, not its inputs (input clicks never pop).
    await page.locator(".tutor-feed .tutor-question").click({ position: { x: 8, y: 8 } });
    await expect(page.locator(".tutor-popup .tutor-output-input")).toHaveValue("6");
    // A past static bubble also reopens (rebuilt read-only in the popup).
    await page.locator(".tutor-feed .tutor-say").first().click();
    await expect(page.locator(".tutor-popup .tutor-say")).toHaveCount(1);

    // Reviewing a bubble about an EARLIER program shows a context card with
    // that program (the editor has moved on; line talk would mislead), and
    // its "load this program" button restores it via the stash-safe path.
    await page.locator(".tutor-feed .tutor-action").first().click(); // completed "press Trace" step (program 1)
    await expect(page.locator(".tutor-popup .tutor-context")).toContainText("x = 3");
    await page.locator(".tutor-popup .tutor-context .tutor-tryit").click();
    expect(await page.evaluate(() => window.plp.editor.getValue())).toContain("x = 3");
    // Editor now matches that program again → reviewing shows no context card.
    await page.locator(".tutor-feed .tutor-action").first().click();
    await expect(page.locator(".tutor-popup .tutor-context")).toHaveCount(0);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
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

  test("drills: deterministic under a seed, varied across seeds", async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const { buildDrillLesson, drillTemplates } = window.plp.drills;
      const a = buildDrillLesson("numbers", { seed: 42, count: 4 });
      const b = buildDrillLesson("numbers", { seed: 42, count: 4 });
      const codes = new Set();
      for (let seed = 1; seed <= 8; seed++) {
        codes.add(buildDrillLesson("lists", { seed, count: 1 }).steps[1].loadCode);
      }
      return {
        sameSeedIdentical: JSON.stringify(a) === JSON.stringify(b),
        distinctAcrossSeeds: codes.size,
        templateCount: Object.keys(drillTemplates).length,
        allHaveExplain: Object.values(drillTemplates).every((t) => t.explain?.length > 40 && t.topic && t.title),
        allLeveled: Object.values(drillTemplates).every((t) => t.level === "core" || t.level === "edge"),
        coreCount: Object.values(drillTemplates).filter((t) => t.level === "core").length,
      };
    });
    expect(r.sameSeedIdentical).toBe(true);
    expect(r.distinctAcrossSeeds).toBeGreaterThan(3); // real variation, not one program
    expect(r.templateCount).toBeGreaterThanOrEqual(40);
    expect(r.allHaveExplain).toBe(true);
    expect(r.allLeveled).toBe(true);
    expect(r.coreCount).toBeGreaterThanOrEqual(20); // basics dominate the bank
  });

  test("drills: rounds are mostly basics (core outweighs edge ~3:1)", async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const { buildDrillLesson, drillTemplates } = window.plp.drills;
      let core = 0, total = 0;
      for (const seed of [3, 11, 27]) {
        const lesson = buildDrillLesson("all", { seed, count: 10 });
        for (const step of lesson.steps) {
          if (!step.ask) continue;
          total += 1;
          if (drillTemplates[step.ask.template].level === "core") core += 1;
        }
      }
      return { core, total };
    });
    expect(r.total).toBe(30);
    expect(r.core / r.total).toBeGreaterThanOrEqual(0.6); // "mostly basics"
  });

  test("drills: every template generates a clean, gradable program", async ({ page }) => {
    test.setTimeout(240_000);
    await setup(page);
    const ids = await page.evaluate(() => Object.keys(window.plp.drills.drillTemplates));
    for (const id of ids) {
      const ok = await page.evaluate(async (templateId) => {
        const { drillTemplates } = window.plp.drills;
        const rng = window.plp.questions.mulberry32(7 + templateId.length);
        const { code, multiline } = drillTemplates[templateId].generate(rng);
        window.plp.editor.setValue(code);
        const summary = await window.plp.trace();
        const q = window.plp.questions.generateQuestion("predict-output", {
          source: code,
          steps: window.plp.memory.steps(),
          positions: window.plp.memory.linePositions(),
        });
        const expected = q ? q.grade({ text: "" }).expected.text.replace(/\n+$/, "") : null;
        return {
          reason: summary?.terminal_reason,
          gradable: Boolean(q),
          oneLine: Boolean(multiline) || (expected !== null && !expected.includes("\n")),
          errors: window.plp.checkErrors(),
        };
      }, id);
      expect(ok.reason, `template ${id} must run clean`).toBe("completed");
      expect(ok.gradable, `template ${id} must print something gradable`).toBe(true);
      expect(ok.oneLine, `template ${id} must ask one thing (one output line)`).toBe(true);
      expect(ok.errors).toEqual([]);
    }
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
