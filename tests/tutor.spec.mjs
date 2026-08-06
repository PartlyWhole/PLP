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
    // units are debug-only via plp.tutor.start — except the fresh-profile
    // "Start here" on-ramp, which leads the menu into the first guided unit).
    await expect(page.locator("#practice .pr-static .tutor-card")).toHaveCount(1);
    await expect(page.locator("#practice [data-role=pr-controls] button").first()).toContainText("Start here");
    await expect(page.locator("#practice [data-role=pr-controls] button:not(.t-endless-mini)")).toHaveCount(12); // start-here + all + endless + map + 8 topics
    await expect(page.locator("#practice [data-role=pr-controls] .t-endless-mini")).toHaveCount(8); // ∞ per topic
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
        // No such name at the end → the GONE question, not null.
        unboundGone: missing.gone,
        unboundExpected: missing.grade({ text: "gone" }).expected,
        unboundRight: missing.grade({ text: "  NOTHING " }).correct,
        unboundValue: missing.grade({ text: "[1, 2, 3]" }).correct,
      };
    });
    expect(r.prompt).toContain("what does `a` hold");
    expect(r.expected).toBe("[1, 2, 3]"); // the aliased mutation shows through `a`
    expect(r.right).toBe(true);
    expect(r.rightSpacey).toBe(true);
    expect(r.wrongUnmutated).toBe(false);
    expect(r.unboundGone).toBe(true);
    expect(r.unboundExpected).toEqual({ text: "gone", gone: true });
    expect(r.unboundRight).toBe(true);
    expect(r.unboundValue).toBe(false);
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

  test("write-the-line (§R5): the intended line grades right; a plausible CONSTANT line and a broken line grade wrong; curly quotes normalize", async ({ page }) => {
    await setup(page);
    // The seed is DERIVED, not a fixture: scan focus rounds for the first
    // seed that deals write-loop-step (the pool may grow; the derivation
    // stays valid). Warm stats + focus keep the round to that one concept.
    const warm = { "0005": { seen: 24, missed: 0 } };
    const found = await page.evaluate(async (warmStats) => {
      const { buildKBSession } = await import("./app/kb-session.mjs");
      for (let seed = 1; seed < 200; seed++) {
        const l = buildKBSession("loops", { seed, count: 1, stats: warmStats, focus: "001J" });
        const ask = l?.steps.find((s) => s.ask)?.ask;
        if (ask?.template === "write-loop-step") {
          return { seed, form: ask.form, kind: ask.kind, prompt: ask.prompt, target: ask.targetOutput, answer: ask.blank.target, code: ask.code };
        }
      }
      return null;
    }, warm);
    expect(found, "a loops focus round must deal write-loop-step").toBeTruthy();
    // It RIDES the fill-one-blank ask kind; only `form` distinguishes it.
    expect(found.kind).toBe("fill-one-blank");
    expect(found.form).toBe("write-the-line");
    expect(found.prompt).toContain("Write the missing line");

    const targetLines = found.target.split("\n");
    const accName = found.code.split("\n")[0].split(" ")[0]; // total | count
    // The plausible constant a gamer types: assign the finished value.
    const constantLine = `${accName} = ${targetLines[targetLines.length - 1]}`;

    const round = async () => {
      await page.evaluate((w) => {
        localStorage.setItem("plp.kb.v1", JSON.stringify(w));
        localStorage.removeItem("plp.tutor.v1");
      }, warm);
      await page.evaluate((seed) => window.plp.tutor.startDrill("loops", { seed, count: 1, focus: "001J" }), found.seed);
      // The dealt program shows the hole, a whole line wide.
      expect(await page.evaluate(() => window.plp.editor.getValue())).toContain("    ___");
    };
    const answer = async (text) => {
      await page.evaluate((t) => window.plp.tutor.lockPrediction(t), text);
      await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 20_000 });
      return page.evaluate(() => ({
        lastAnswer: window.plp.tutor.state().lastAnswer,
        editor: window.plp.editor.getValue(),
        console: window.plp.console.text().replace(/\n+$/, ""),
        errors: window.plp.checkErrors(),
      }));
    };

    // 1. The intended line: graded right by REAL execution against the target.
    await round();
    let r = await answer(found.answer);
    expect(r.lastAnswer).toBe("correct");
    expect(r.console).toBe(found.target);
    expect(r.errors).toEqual([]);

    // 2. THE SCOPE RULE, made visible: a constant line executes once per pass
    // and prints the finished value every time, so it never reproduces the
    // growing target — the exercise cannot be gamed without the concept.
    await round();
    r = await answer(constantLine);
    expect(r.lastAnswer).toBe("wrong");
    expect(r.editor).toContain(`    ${constantLine}`);
    expect(r.console).not.toBe(found.target);
    expect(r.console.split("\n").every((l) => l === targetLines[targetLines.length - 1])).toBe(true);
    expect(r.errors).toEqual([]);

    // 3. A syntactically invalid line grades wrong without wedging the round.
    await round();
    r = await answer(`${accName} = ${accName} +`);
    expect(r.lastAnswer).toBe("wrong");
    expect(r.errors).toEqual([]);
    expect(await page.evaluate(() => window.plp.tutor.state().waiting)).toBe("pause");

    // 4. Mobile smart quotes are normalized BEFORE the splice: the curly-quoted
    // line would be a syntax error, and the console reveal shows what really
    // ran — the straight-quoted program.
    await round();
    r = await answer(`${found.answer} + int(“0”)`);
    expect(r.lastAnswer).toBe("correct");
    expect(r.editor).toContain('int("0")');
    expect(r.editor).not.toContain("“");
    expect(r.console).toBe(found.target);
    expect(r.errors).toEqual([]);
  });

  // fix-the-bug (expansion ladder §R5's composition). The seed is DERIVED,
  // never a fixture: scan focus rounds for the first seed that deals the
  // wanted template (the pool may grow; the derivation stays valid).
  async function findFixRound(page, { topic, focus, template }) {
    const warm = { "0005": { seen: 24, missed: 0 } };
    const found = await page.evaluate(async ({ topic, focus, template, warm }) => {
      const { buildKBSession } = await import("./app/kb-session.mjs");
      for (let seed = 1; seed < 300; seed++) {
        const l = buildKBSession(topic, { seed, count: 1, stats: warm, focus });
        const ask = l?.steps.find((s) => s.ask)?.ask;
        if (ask?.template === template) {
          return {
            seed, form: ask.form, kind: ask.kind, prompt: ask.prompt,
            code: ask.code, target: ask.targetOutput, wrong: ask.wrongOutput,
            fixLine: ask.blank.line, fix: ask.blank.target,
          };
        }
      }
      return null;
    }, { topic, focus, template, warm });
    expect(found, `a ${topic} focus round must deal ${template}`).toBeTruthy();
    found.start = async () => {
      await page.evaluate((w) => {
        localStorage.setItem("plp.kb.v1", JSON.stringify(w));
        localStorage.removeItem("plp.tutor.v1");
        localStorage.removeItem("plp.kb.met.v1");
        localStorage.removeItem("plp.kb.tmpl.v1");
      }, warm);
      await page.evaluate(({ topic, focus, seed }) =>
        window.plp.tutor.startDrill(topic, { seed, count: 1, focus }), { topic, focus, seed: found.seed });
    };
    found.answer = async (line, text) => {
      await page.evaluate((a) => window.plp.tutor.submit(a), { line, text });
      await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 20_000 });
      return page.evaluate(() => ({
        lastAnswer: window.plp.tutor.state().lastAnswer,
        editor: window.plp.editor.getValue(),
        console: window.plp.console.text().replace(/\n+$/, ""),
        errors: window.plp.checkErrors(),
      }));
    };
    return found;
  }

  test("fix-the-bug (§R5 composition): the buggy program runs clean, the intended repair grades right, the gaming line grades wrong", async ({ page }) => {
    await setup(page);
    const round = await findFixRound(page, { topic: "loops", focus: "001J", template: "fix-accumulator" });
    // It RIDES the fill-one-blank ask kind — no third grading path (§R5).
    expect(round.kind).toBe("fill-one-blank");
    expect(round.form).toBe("fix-the-bug");
    // The card states BOTH outputs: the goal and the evidence.
    expect(round.prompt).toContain("This should print");
    expect(round.prompt).toContain("but it prints");
    expect(round.wrong).not.toBe(round.target);

    await round.start();
    // The editor holds the BUGGY program — whole, never holed (it runs clean).
    expect(await page.evaluate(() => window.plp.editor.getValue())).toBe(round.code);
    expect(await page.evaluate(() => window.plp.editor.getValue())).not.toContain("___");
    // The picker rows ARE the program: numbered lines, no second copy above.
    await expect(page.locator("#practice .pr-errline")).toHaveCount(round.code.replace(/\n$/, "").split("\n").length);
    await expect(page.locator("#practice .pr-question .pr-program")).toHaveCount(0);
    await expect(page.locator("#practice .pr-mechanics")).toContainText("tap the wrong line");

    // 1. FIND the line + FIX it: graded by REAL execution against the target.
    let r = await round.answer(round.fixLine, round.fix);
    expect(r.lastAnswer).toBe("correct");
    expect(r.console).toBe(round.target);
    expect(r.errors).toEqual([]);
    await expect(page.locator("#practice .pr-verdict-slot .tutor-verdict")).toContainText("That prints the target");
    await expect(page.locator("#practice .pr-errline.ok")).toHaveCount(1);

    // 2. THE ANTI-GAMING RULE (E10c), made visible: writing the answer into
    // the buggy line cannot work — it runs once per pass while the truth grows.
    const constantLine = `${round.code.split(" ")[0]} = ${round.target.split("\n").pop()}`;
    await round.start();
    r = await round.answer(round.fixLine, constantLine);
    expect(r.lastAnswer).toBe("wrong");
    expect(r.console).not.toBe(round.target);
    expect(r.errors).toEqual([]);
  });

  test("fix-the-bug: a DIFFERENT line that still prints the intended output is correct; review + retry re-pick and re-run", async ({ page }) => {
    await setup(page);
    const round = await findFixRound(page, { topic: "lists", focus: "0024", template: "fix-alias" });
    // Line 3 is the mutation through the alias (`b.append(v)`) in every shape;
    // rebuilding b there instead of copying on line 2 ALSO prints the intended
    // output — and the interpreter, not the pick, is the answer key.
    const added = round.code.split("\n")[2].match(/append\((\d+)\)/)[1];
    const otherFix = `b = a + [${added}]`;
    expect(round.fixLine).toBe(2);

    await round.start();
    let r = await round.answer(3, otherFix);
    expect(r.lastAnswer).toBe("correct");
    expect(r.console).toBe(round.target);
    expect(r.errors).toEqual([]);
    await expect(page.locator("#practice .pr-verdict-slot .tutor-verdict"))
      .toContainText("Not the line I'd have changed, but it works");

    // Review: the buggy program in its picker with the picked line marked,
    // the answer as line → replacement, and what it really printed.
    const rec = await page.evaluate(() =>
      window.plp.tutor.feed().findLast((c) => c.type === "question-frozen"));
    expect(rec.review.form).toBe("fix-the-bug");
    expect(rec.review.picked).toEqual({ line: 3, text: otherFix });
    expect(rec.answerText).toBe(`line 3 → ${otherFix}`);

    await page.evaluate(() => window.plp.tutor.review(0));
    await expect(page.locator("#practice .pr-review .pr-errreview .pr-errline"))
      .toHaveCount(round.code.replace(/\n$/, "").split("\n").length);
    await expect(page.locator("#practice .pr-review .pr-errreview .pr-errline.ok")).toHaveCount(1);
    await expect(page.locator("#practice .pr-review .pr-reveal pre")).toContainText(round.target.split("\n")[0]);
    await expect(page.locator("#practice .pr-review .pr-retry.pr-retry-fix")).toHaveCount(1);

    // Starting the retry swaps the marked answer for a live picker + box.
    await page.locator("#practice .pr-retry-fix button.primary", { hasText: "Try it again" }).click();
    await expect(page.locator("#practice .pr-review .pr-errline")).toHaveCount(round.code.replace(/\n$/, "").split("\n").length);
    await page.locator("#practice .pr-retry-cancel").click();
    await expect(page.locator("#practice .pr-review .pr-errreview")).toBeVisible();

    // The retry re-picks and re-runs for real; a wrong repair stays wrong.
    const liveCode = await page.evaluate(() => window.plp.editor.getValue());
    const bad = await page.evaluate(() => window.plp.tutor.retry(0, { line: 2, text: "b = a" }));
    expect(bad.ok).toBe(false);
    const good = await page.evaluate((fix) => window.plp.tutor.retry(0, { line: 2, text: fix }), round.fix);
    expect(good.ok).toBe(true);
    expect(good.expectedText.trim()).toBe(round.target);
    const after = await page.evaluate(() => ({
      rec: (() => { const x = window.plp.tutor.feed().find((c) => c.type === "question-frozen"); return { ok: x.ok, retry: x.retry }; })(),
      editor: window.plp.editor.getValue(),
    }));
    // The score of record keeps the FIRST attempt; the retry only decorates.
    expect(after.rec).toEqual({ ok: true, retry: { ok: true, tries: 2 } });
    expect(after.editor).toBe(liveCode); // the live round's program survived
    await page.evaluate(() => window.plp.tutor.closeReview());
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("spot-the-difference: program A shown with its real output; predict program B", async ({ page }) => {
    await setup(page);
    // Warm stats neutralize the cold-start frontier bias (this test is about
    // the spot-the-difference FORM, whose focus concept is deep — a cold
    // compile would ~never deal it in a single-question round).
    await page.evaluate(() => {
      localStorage.setItem("plp.kb.v1", JSON.stringify({ "0005": { seen: 24, missed: 0 } }));
      localStorage.removeItem("plp.tutor.v1");
    });
    // Seed 194 of a warm lists round opens with the += vs + [x] contrast (the
    // seed is a fixture — re-derive it if the lists exercise pool changes;
    // derivation: scan buildKBSession("lists", {seed, count: 1, stats: warm})
    // for the first seed whose ask.context.code contains "+= [").
    const id = await page.evaluate(() => window.plp.tutor.startDrill("lists", { seed: 194, count: 1 }));
    expect(id).toBe("drill-lists-194");
    // The contrast rides ON the ask (ask.context): program A (uses +=) with
    // its real output — reload-safe — and the card renders it above B.
    const ctx = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("plp.tutor.v1"));
      return s.drillLesson.steps.find((x) => x.ask)?.ask.context;
    });
    expect(ctx.code).toContain("b += [40]");   // program A mutates the shared list
    expect(ctx.output).toBe("[1, 8, 40]");     // …and its real output is shown
    await expect(page.locator("#practice .pr-context")).toContainText("b += [40]");
    await expect(page.locator("#practice .pr-context .pr-out")).toContainText("[1, 8, 40]");
    // The editor holds program B (the one to predict — a is left untouched).
    expect((await page.evaluate(() => window.plp.editor.getValue())).trim())
      .toBe("a = [1, 8]\nb = a\nb = b + [40]\nprint(a)");
    // Predicting B's output correctly grades right and records the focus tag.
    await page.evaluate(() => window.plp.tutor.lockPrediction("[1, 8]"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    expect(await page.evaluate(() => window.plp.tutor.drillStats())).toEqual({
      "0005": { seen: 24, missed: 0 }, // the warm-stats primer
      "0023": { seen: 1, missed: 0 },
    });
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
    // (warm stats: the predict-state fixture's focus is deep — cold-biased
    // single-question rounds would ~never deal it)
    await page.evaluate(() => window.plp.tutor.exit());
    await page.evaluate(() => localStorage.setItem("plp.kb.v1", JSON.stringify({ "0005": { seen: 24, missed: 0 } })));
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
    await expect(page.locator("#practice .cm-lane")).toHaveCount(8);
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
    // Focused rounds default shorter — and a single-exercise focus pool
    // (0005 has one) caps at 2: four near-identical questions read as broken.
    expect(round.asks.length).toBe(2);
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

    // (b) The int(input()) bridge — a predict-io ask focused on 0026
    // (expansion ladder §R4a). Answered CLEANLY on the first attempt, so it
    // grants met from a lesson: the input-boundary gap of
    // design/lesson-kb-binding.md §3 is closed.
    expect(await page.evaluate(() => window.plp.tutor.ask())).toEqual({ kind: "predict-io" });
    await page.evaluate(() => window.plp.tutor.lockPrediction("Pick a number: 7\n8"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    const ioMet = await page.evaluate(() => window.plp.tutor.met());
    expect(Object.keys(ioMet)).toEqual(["0026"]);
    expect(ioMet["0026"].source).toBe("lesson");

    await page.evaluate(() => window.plp.tutor.continue()); // output card
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");

    // (b) A clean first-attempt CORRECT answer on the total ask (focus 000B)
    // grants met with source "lesson".
    await page.evaluate(() => window.plp.tutor.lockPrediction("total: 15"));
    const met = await page.evaluate(() => window.plp.tutor.met());
    expect(Object.keys(met).sort()).toEqual(["0026", "000B"].sort());
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
    await expect(page.locator("#practice [data-role=pr-controls] button:not(.t-endless-mini)")).toHaveCount(12); // frontier entry + all + endless + map + 8 topics
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

    // The int(input()) bridge (expansion ladder §R4a): a predict-io ask on
    // the stage, auto-answered from its stdinScript. Its focus is 0026, so a
    // clean first-attempt transcript closes the input-boundary met gap
    // (design/lesson-kb-binding.md §3).
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.waiting).toBe("ask");
    expect(await page.evaluate(() => window.plp.tutor.ask())).toEqual({ kind: "predict-io" });
    expect(await page.evaluate(() => window.plp.editor.getValue())).toContain("int(answer)");
    await page.evaluate(() => window.plp.tutor.lockPrediction("Pick a number: 7\n8"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.lastAnswer).toBe("correct");
    expect(await page.evaluate(() => window.plp.console.text())).toBe("Pick a number: 7\n8\n");
    const u1met = await page.evaluate(() => window.plp.tutor.met());
    expect(Object.keys(u1met)).toEqual(["0026"]);
    expect(u1met["0026"].source).toBe("lesson");

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
      // Prime EVERY concept (not just this round's focuses): primed stats
      // change selection (novelty + the cold-start bias), so the primed
      // round may deal different exercises — the invariant is that no SEEN
      // concept ever gets a teach line, whichever ones deal.
      const primed = buildKBSession("numbers", {
        seed: 7, count: 5,
        stats: Object.fromEntries([...kinds.keys()].map((t) => [t, { seen: 2, missed: 0 }])),
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

  test("selection policy: cold start deals basics, the worst concept returns, no concept repeats — within and across chunks", async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(async () => {
      const { buildKBSession } = await import("./app/kb-session.mjs");
      const { loadKB } = await import("./kb/index.mjs");
      const kb = loadKB();
      const depth = (t) => [...kb.ancestors(t)].filter((a) => !kb.structural.has(a)).length;

      // (a) Cold-start frontier bias: a brand-new learner's first question is
      // a shallow concept (property, not a fixed tag: few non-structural
      // ancestors), across seeds.
      const firstDepths = [];
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const l = buildKBSession("all", { seed, stats: {}, met: [] });
        firstDepths.push(depth(l.steps.find((s) => s.ask).ask.concept));
      }

      // (b) Guaranteed miss-return: every compiled round contains the
      // learner's worst concept when the pool carries one.
      const stats = { "000H": { seen: 4, missed: 3 } };
      const missReturn = [1, 5, 9, 23].every((seed) =>
        buildKBSession("all", { seed, count: 8, stats })
          .steps.filter((s) => s.ask).some((s) => s.ask.concept === "000H"));

      // (c) Concept-level no-repeat within a round, and across a chunk
      // boundary via prevKey (the endless finish() hand-off).
      let repeat = null;
      for (const topic of ["all", "numbers", "lists"]) {
        for (const seed of [1, 7, 23, 42, 99]) {
          const asks = buildKBSession(topic, { seed, count: 10 })
            .steps.filter((s) => s.ask).map((s) => s.ask);
          for (let i = 1; i < asks.length; i++) {
            if (asks[i].concept === asks[i - 1].concept) repeat = `${topic}/${seed}@${i}`;
          }
          const last = asks.at(-1);
          const next = buildKBSession(topic, {
            seed: seed + 1000, count: 4,
            prevKey: `${last.form}|${last.shape}|${last.concept}`,
          }).steps.find((s) => s.ask).ask;
          if (next.concept === last.concept) repeat = `${topic}/${seed}@chunk-boundary`;
          if (`${next.form}|${next.shape}` === `${last.form}|${last.shape}`) repeat = `${topic}/${seed}@chunk-boundary-fs`;
        }
      }
      return { firstDepths, missReturn, repeat };
    });
    expect(Math.max(...r.firstDepths)).toBeLessThanOrEqual(4);
    expect(r.firstDepths.filter((d) => d <= 2).length).toBeGreaterThanOrEqual(4);
    expect(r.missReturn).toBe(true);
    expect(r.repeat).toBeNull();
  });

  test("focus rounds always teach the asked-for concept and cap a single-exercise pool at 2", async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(async () => {
      const { buildKBSession } = await import("./app/kb-session.mjs");
      // Single-exercise focus (0005 → hello-print), already seen: still
      // teaches (the learner explicitly asked), and caps at 2.
      const single = buildKBSession("state", { seed: 3, focus: "0005", stats: { "0005": { seen: 5, missed: 0 } } });
      const singleAsks = single.steps.filter((s) => s.ask).map((s) => s.ask);
      // Edge (discover-first) concept focus: "Try it anyway" still teaches.
      const edge = buildKBSession("lists", { seed: 1, focus: "000H", stats: {} });
      const edgeAsks = edge.steps.filter((s) => s.ask).map((s) => s.ask);
      return {
        singleCount: singleAsks.length,
        singleTeach: Boolean(singleAsks[0].teach?.statement),
        edgeCount: edgeAsks.length,
        edgeTeach: Boolean(edgeAsks[0].teach?.statement),
        edgeFocused: edgeAsks.every((a) => a.concept === "000H"),
      };
    });
    expect(r.singleCount).toBe(2);
    expect(r.singleTeach).toBe(true);
    expect(r.edgeCount).toBe(4);
    expect(r.edgeTeach).toBe(true);
    expect(r.edgeFocused).toBe(true);
  });

  test("Start here: a fresh profile's menu leads with the first lesson; any experience removes it", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.clear(); location.reload(); });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await page.locator("#btn-tutor").click();
    const first = page.locator("#practice [data-role=pr-controls] button").first();
    await expect(first).toContainText("Start here");
    // Clicking it starts the guided unit (stage surface) from the menu.
    await first.click();
    await expect(page.locator(".tutor-stage")).toBeVisible();
    expect((await page.evaluate(() => window.plp.tutor.state())).lessonId).toBe("u1-state-io");
    await page.evaluate(() => window.plp.tutor.exit());
    // Any answered question (stats non-empty) retires the on-ramp.
    await page.evaluate(() => {
      localStorage.setItem("plp.kb.v1", JSON.stringify({ "0008": { seen: 1, missed: 0 } }));
      location.reload();
    });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    // The surface visibility persisted; the reload re-renders the menu.
    await expect(page.locator("body")).toHaveClass(/practice/);
    await expect(page.locator("#practice [data-role=pr-controls] button").first()).toContainText("Everything");
    expect(await page.evaluate(() =>
      [...document.querySelectorAll("#practice [data-role=pr-controls] button")].some((b) => b.textContent.includes("Start here")))).toBe(false);
  });

  test("predict-state grants met: a clean first-attempt state prediction evidences the concept (binding §4 rule 2)", async ({ page }) => {
    await setup(page);
    // Inline drill lesson (the trace-table tests' pattern): pool-proof — the
    // grant path under test is the tutor runtime's, not the KB's selection.
    await page.evaluate(() => {
      localStorage.removeItem("plp.kb.met.v1");
      localStorage.removeItem("plp.kb.v1");
      const lesson = {
        id: "ps-inline",
        title: "Predict state",
        steps: [
          { loadCode: "a = [1, 8]\nb = a\nb.append(71)\n" },
          { ask: { kind: "predict-state", opts: { name: "a" }, singleLine: true, concept: "000H", prompt: "After it runs, what does `a` hold?" } },
          { pause: true },
          { done: "done" },
        ],
      };
      localStorage.setItem("plp.tutor.v1", JSON.stringify({
        lessonId: lesson.id, drillLesson: lesson, resumeIndex: 0, cards: [],
      }));
      location.reload();
    });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.ask())).kind).toBe("predict-state");
    // a = [1, 8]; b = a; b.append(71) → `a` holds [1, 8, 71] (the alias).
    await page.evaluate(() => window.plp.tutor.lockPrediction("[1, 8, 71]"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    const met = await page.evaluate(() => window.plp.tutor.met());
    expect(Object.keys(met)).toEqual(["000H"]);
    expect(met["000H"].source).toBe("drill");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("predict-state \"gone\": a vanished local grades right on the token, wrong on a value, and the reveal prints no value", async ({ page }) => {
    await setup(page);
    // Inline drill lesson (the trace-table tests' pattern). `m` is a FUNCTION
    // LOCAL: after the call there is no such module name, so the answer is
    // the gone token, never a value (ladder §R4b W4).
    const install = () => page.evaluate(() => {
      localStorage.removeItem("plp.kb.met.v1");
      localStorage.removeItem("plp.kb.v1");
      const lesson = {
        id: "ps-gone-inline",
        title: "Gone",
        steps: [
          { loadCode: "def shout(word):\n    m = word + \"!\"\n    return m\nr = shout(\"hi\")\n" },
          { ask: { kind: "predict-state", opts: { name: "m" }, singleLine: true, concept: "000H", prompt: "After it runs, what does `m` hold?" } },
          { pause: true },
          { done: "done" },
        ],
      };
      localStorage.setItem("plp.tutor.v1", JSON.stringify({
        lessonId: lesson.id, drillLesson: lesson, resumeIndex: 0, cards: [],
      }));
      location.reload();
    });

    // A VALUE is wrong — the learner who thinks the local survives misses.
    await install();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.ask())).kind).toBe("predict-state");
    // The affordance: a child should not have to guess the magic word.
    await expect(page.locator(".tutor-gone-chip").last()).toHaveText("the name is gone");
    await page.evaluate(() => window.plp.tutor.lockPrediction("'hi!'"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("wrong");
    // The reveal never prints a value — it says the name is gone.
    const reveal = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".pr-reveal")].pop();
      return b && { label: b.querySelector(".pr-reveal-label").textContent, text: b.querySelector("pre").textContent };
    });
    expect(reveal).toEqual({ label: "it holds nothing", text: "that name is gone" });
    expect(await page.evaluate(() => window.plp.tutor.met())).toEqual({});

    // The token is right — and a clean first attempt still grants met.
    await install();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    await page.evaluate(() => window.plp.tutor.lockPrediction("gone"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    expect(Object.keys(await page.evaluate(() => window.plp.tutor.met()))).toEqual(["000H"]);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("drill round: seeded session, miss stats, explain cards, reload-restores same round", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => localStorage.removeItem("plp.drills.v1"));
    // Seed 8 is the cold two-plain-predict-output fixture (derivation: first
    // seed where both asks of a cold numbers count-2 round are predict-output
    // without a spot-the-difference context).
    const id = await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 8, count: 2 }));
    expect(id).toBe("drill-numbers-8");
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
    expect(s.lessonId).toBe("drill-numbers-8");
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

  test("endless mode + score tracker: chunks chain with no summary, score and reviews carry, exit earns the run summary, menu shows the lifetime line", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.removeItem("plp.kb.v1"); localStorage.removeItem("plp.tutor.v1"); localStorage.removeItem("plp.score.v1"); });
    // Endless numbers with chunk size 1; seed 2 is the fill fixture ("-").
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 2, count: 1, endless: true }));
    const first = (await page.evaluate(() => window.plp.tutor.state())).lessonId;
    await page.evaluate(() => window.plp.tutor.lockPrediction("-"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 30_000 });
    // Score chip: right-count on a first-attempt basis, streak alive.
    expect(await page.evaluate(() => window.plp.tutor.score())).toEqual({ answered: 1, right: 1, streak: 1, best: 1 });
    await expect(page.locator("[data-role=pr-score]")).toHaveText("✓ 1/1");
    // Chunk boundary: no summary card, no menu — a fresh ask deals directly.
    await page.evaluate(() => window.plp.tutor.continue());
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    const s2 = await page.evaluate(() => window.plp.tutor.state());
    expect(s2.lessonId).not.toBe(first);
    await expect(page.locator("#practice .tutor-summary")).toHaveCount(0);
    // Score carries; a skip breaks the streak but keeps the run alive.
    await page.evaluate(() => window.plp.tutor.skip());
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 15_000 });
    expect(await page.evaluate(() => window.plp.tutor.score())).toEqual({ answered: 2, right: 1, streak: 0, best: 1 });
    // Reviews reach back across the chunk boundary (absolute indices).
    await page.evaluate(() => window.plp.tutor.review(0));
    await expect(page.locator("#practice .pr-review")).toBeVisible();
    await page.evaluate(() => window.plp.tutor.closeReview());
    // Ending the run earns the WHOLE run's summary, with a go-again.
    await page.evaluate(() => window.plp.tutor.exit());
    await expect(page.locator("#practice .tutor-summary .t-summary-head")).toContainText("1 of 2");
    await expect(page.locator("[data-role=pr-title]")).toHaveText("Endless run");
    await expect(page.locator("#practice [data-role=pr-controls] button.primary")).toContainText("∞ Go again");
    // Back to topics: the menu offers ∞ and the lifetime line counts this run.
    await page.locator("#practice [data-role=pr-controls] button", { hasText: "Back to topics" }).click();
    await expect(page.locator("#practice .pr-static")).toContainText("All time:");
    expect(await page.evaluate(() =>
      [...document.querySelectorAll("#practice [data-role=pr-controls] button")].some((b) => b.textContent.includes("∞ Endless practice")))).toBe(true);
    // Every topic has its own ∞ companion: clicking one starts an endless
    // run scoped to THAT topic (the chunks chain within it).
    await page.locator("#practice [data-role=pr-controls] .t-endless-mini").first().click();
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    const scoped = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("plp.tutor.v1"));
      return { endless: s.endless, topic: s.drillTopic };
    });
    expect(scoped.endless).toBe(true);
    expect(scoped.topic).toBe("state"); // first topic button
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("proven material recedes: a template answered right fades; a mastered concept yields its weight", async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(async () => {
      const { buildKBSession } = await import("./app/kb-session.mjs");
      const warm = { "0005": { seen: 24, missed: 0 } };
      const tally = (opts) => {
        const byTemplate = {}, byFocus = {};
        for (let seed = 1; seed <= 8; seed++) {
          const l = buildKBSession("state", { seed, count: 8, stats: { ...warm, ...(opts.stats ?? {}) }, ...opts });
          for (const s of l.steps) {
            if (!s.ask) continue;
            byTemplate[s.ask.template] = (byTemplate[s.ask.template] ?? 0) + 1;
            byFocus[s.ask.concept] = (byFocus[s.ask.concept] ?? 0) + 1;
          }
        }
        return { byTemplate, byFocus };
      };
      const base = tally({});
      const topTemplate = Object.entries(base.byTemplate).sort((a, b) => b[1] - a[1])[0][0];
      const afterRight = tally({ templateStats: { [topTemplate]: { seen: 5, right: 5 } } });
      // Mastery: 000A met + practiced cleanly → its exercises yield weight.
      const afterMastery = tally({ met: ["000A"], stats: { "000A": { seen: 6, missed: 0 } } });

      // Hard siblings (R1.3): with the hard sibling's focus met + warm,
      // clean stats, the hard material's share RISES (it is exempt from
      // the mastery discount) while the easy templates fade under it.
      const tallyNumbers = (opts) => {
        const byTemplate = {};
        for (let seed = 1; seed <= 8; seed++) {
          const l = buildKBSession("numbers", { seed, count: 8, ...opts });
          for (const s of l.steps) {
            if (!s.ask) continue;
            byTemplate[s.ask.template] = (byTemplate[s.ask.template] ?? 0) + 1;
          }
        }
        return byTemplate;
      };
      const numBase = tallyNumbers({ stats: {} });
      const numWarm = tallyNumbers({ met: ["000N"], stats: { "000N": { seen: 6, missed: 0 } } });
      return {
        topTemplate,
        before: base.byTemplate[topTemplate],
        after: afterRight.byTemplate[topTemplate] ?? 0,
        focusBefore: base.byFocus["000A"] ?? 0,
        focusAfter: afterMastery.byFocus["000A"] ?? 0,
        hardBefore: numBase["precedence-gauntlet-hard"] ?? 0,
        hardAfter: numWarm["precedence-gauntlet-hard"] ?? 0,
        easyBefore: numBase["precedence-mix"] ?? 0,
        easyAfter: numWarm["precedence-mix"] ?? 0,
      };
    });
    // The exact question you already got right stops dominating…
    expect(r.after).toBeLessThan(r.before);
    // …and a concept you've mastered recedes (but never vanishes by fiat —
    // this is a weight, not a gate).
    expect(r.focusAfter).toBeLessThan(r.focusBefore);
    // Hard sibling: unavailable cold, present once its focus is met, and its
    // share rises while the easy intro template fades under mastery.
    expect(r.hardBefore).toBe(0);
    expect(r.hardAfter).toBeGreaterThan(0);
    expect(r.easyAfter).toBeLessThan(r.easyBefore);
  });

  test("misconception follow-up slot: a recorded confusion reserves a deterministic slot; guards hold; contrast preferred (R1.1)", async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(async () => {
      const { buildKBSession } = await import("./app/kb-session.mjs");
      // (a) A recorded 000H confusion deals a follow-up ask on 000H, on
      // every seed, deterministically, with the repeat guards intact.
      const out = { followUps: [], repeats: 0, nondet: false, contrastPick: null, cleanHasFollowUp: false };
      for (const seed of [1, 5, 9, 23]) {
        const opts = { seed, count: 8, misconceptions: { "000H": { hits: 2, at: 1 } } };
        const l = buildKBSession("lists", opts);
        const asks = l.steps.filter((s) => s.ask).map((s) => s.ask);
        const fu = asks.filter((a) => a.followUp);
        out.followUps.push(fu.map((a) => a.concept).join(","));
        for (let i = 1; i < asks.length; i++) {
          if (asks[i].concept === asks[i - 1].concept) out.repeats += 1;
          if (`${asks[i].form}|${asks[i].shape}` === `${asks[i - 1].form}|${asks[i - 1].shape}`) out.repeats += 1;
        }
        if (JSON.stringify(l) !== JSON.stringify(buildKBSession("lists", opts))) out.nondet = true;
      }
      // (b) A confusion whose tag has a dedicated CONTRAST exercise deals it.
      const c = buildKBSession("lists", { seed: 2, count: 8, misconceptions: { "0021": 3 } });
      out.contrastPick = c.steps.filter((s) => s.ask && s.ask.followUp).map((s) => s.ask.template).join(",");
      // (c) No recorded misconceptions ⇒ no follow-up flag anywhere.
      const clean = buildKBSession("lists", { seed: 2, count: 8 });
      out.cleanHasFollowUp = clean.steps.some((s) => s.ask?.followUp);
      return out;
    });
    for (const fu of r.followUps) expect(fu).toContain("000H");
    expect(r.repeats).toBe(0);
    expect(r.nondet).toBe(false);
    expect(r.contrastPick).toBe("plus-eq-contrast"); // contrast: "0021" wins the narrowed pool
    expect(r.cleanHasFollowUp).toBe(false);
  });

  test("misconception loop end-to-end: the designed wrong answer bumps plp.kb.mc.v1; the next compile deals the follow-up; resolving it settles the entry (R1.1)", async ({ page }) => {
    await setup(page);
    // Inline drill lesson (pool-proof): the classic alias trap with its
    // designed misconception riding on the ask, exactly as the compiler
    // stamps it (alias-trap emits the unmutated list).
    await page.evaluate(() => {
      localStorage.removeItem("plp.kb.mc.v1");
      localStorage.removeItem("plp.kb.v1");
      const lesson = {
        id: "mc-inline",
        title: "Misconception",
        steps: [
          { loadCode: "a = [1, 8]\nb = a\nb.append(71)\nprint(a)\n" },
          { ask: { kind: "predict-output", singleLine: true, concept: "000H", template: "alias-trap", misconception: "[1, 8]", prompt: "What does this print?" } },
          { pause: true },
          { loadCode: "a = [2, 9]\nb = a\nb.append(50)\nprint(a)\n" },
          { ask: { kind: "predict-output", singleLine: true, concept: "000H", template: "alias-trap", followUp: true, prompt: "What does this print?" } },
          { pause: true },
          { done: "done" },
        ],
      };
      localStorage.setItem("plp.tutor.v1", JSON.stringify({
        lessonId: lesson.id, drillLesson: lesson, resumeIndex: 0, cards: [],
      }));
      location.reload();
    });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    // Lock EXACTLY the designed wrong answer → wrong AND matched.
    await page.evaluate(() => window.plp.tutor.lockPrediction("[1, 8]"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 30_000 });
    let mc = await page.evaluate(() => window.plp.tutor.mcStats());
    expect(mc["000H"]?.hits).toBe(1);
    // The next compile (fed the store, as both call sites are) reserves the
    // follow-up slot for 000H.
    const dealt = await page.evaluate(async () => {
      const { buildKBSession } = await import("./app/kb-session.mjs");
      const l = buildKBSession("lists", { seed: 7, count: 8, misconceptions: window.plp.tutor.mcStats() });
      return l.steps.filter((s) => s.ask && s.ask.followUp).map((s) => s.ask.concept);
    });
    expect(dealt).toContain("000H");
    // Answering the follow-up (right this time) settles the entry.
    await page.evaluate(() => window.plp.tutor.continue());
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    await page.evaluate(() => window.plp.tutor.lockPrediction("[2, 9, 50]"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 30_000 });
    mc = await page.evaluate(() => window.plp.tutor.mcStats());
    expect(mc["000H"]).toBeUndefined();
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
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
    // Seed 8: both asks plain predict-output (the retry below re-grades
    // output text, and the review card must hold a single program).
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 8, count: 2 }));

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
          { loadCode: "a = 0\nb = [1, 2]\nb = b + [3]\na = a + 1\n" },
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

  test("trace-table frames: an opt-in ask walks INTO the call — indented frame rows, call-site lines", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      localStorage.removeItem("plp.kb.met.v1");
      localStorage.removeItem("plp.kb.v1");
      const lesson = {
        id: "tt-frames-inline",
        title: "Trace table (frames)",
        steps: [
          { loadCode: "def double(n):\n    return n * 2\nv = 4\nx = double(v)\ny = double(x)\n" },
          { ask: { kind: "trace-table", probeNames: ["n", "x", "y"], frames: true, maxBlanks: 8, prompt: "Fill in the table.", concept: "0009" } },
          { pause: true },
          { done: "done" },
        ],
      };
      localStorage.setItem("plp.tutor.v1", JSON.stringify({
        lessonId: lesson.id, drillLesson: lesson, resumeIndex: 0, cards: [],
      }));
      location.reload();
    });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await page.evaluate(() => {
      if (!document.body.classList.contains("practice")) window.plp.tutor.toggleSurface();
    });
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    // Four rows: the parameter bind inside each call, then each module bind.
    const rows = await page.evaluate(() => [...document.querySelectorAll("#practice .tutor-trace-table tr")]
      .slice(1)
      .map((tr) => ({
        frame: tr.classList.contains("trace-frame-row"),
        label: tr.querySelector(".trace-frame-label")?.textContent ?? null,
        line: tr.children[1].textContent,
        code: tr.querySelector("code").textContent,
      })));
    expect(rows).toEqual([
      { frame: true, label: "double()", line: "4", code: "x = double(v)" },
      { frame: false, label: null, line: "4", code: "x = double(v)" },
      { frame: true, label: "double()", line: "5", code: "y = double(x)" },
      { frame: false, label: null, line: "5", code: "y = double(x)" },
    ]);
    // All four cells are computed → all four are blanks; the real trace grades.
    await expect(page.locator("#practice .tutor-trace-table input[data-blank-id]")).toHaveCount(4);
    await page.evaluate(() => window.plp.tutor.submit({ b0: "4", b1: "8", b2: "8", b3: "16" }));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

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
    // Literal binds are givens; the two COMPUTED changes are the blanks.
    await expect(page.locator("#practice .tutor-trace-table input[data-blank-id]")).toHaveCount(2);

    // Non-empty gate: a partial submit sets the note and stays waiting.
    await page.evaluate(() => window.plp.tutor.submit({ b0: "[1, 2, 3]", b1: "" }));
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");
    await expect(page.locator("#practice .pr-note")).toContainText("Fill every box first");

    // One wrong cell: ok false, per-cell marks, the truth beside the miss.
    await page.evaluate(() => window.plp.tutor.submit({ b0: "[1,2,3]", b1: "999" }));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    const s = await page.evaluate(() => window.plp.tutor.state());
    expect(s.lastAnswer).toBe("wrong");
    await expect(page.locator("#practice .tutor-trace-table input.ok")).toHaveCount(1); // container spacing forgiven on b0
    await expect(page.locator("#practice .tutor-trace-table input.bad")).toHaveCount(1);
    await expect(page.locator("#practice .tutor-trace-table .tutor-cell-truth")).toContainText("1");
    await expect(page.locator("#practice .pr-reveal pre")).toContainText("1 of 2 steps right");
    await expect(page.locator("#practice .pr-verdict-slot .tutor-verdict")).toContainText("1 of 2");
    // The record froze with the review snapshot; the score counted a miss.
    const rec = await page.evaluate(() =>
      window.plp.tutor.feed().findLast((c) => c.type === "question-frozen"));
    expect(rec.ok).toBe(false);
    expect(rec.review.kind).toBe("trace-table");
    expect(rec.review.table.rows.length).toBe(4);
    expect(rec.review.answersById.b1).toBe("999");
    expect(await page.evaluate(() => window.plp.tutor.drillStats())).toEqual({ "0009": { seen: 1, missed: 1 } });
    // A wrong table grants no met.
    expect(await page.evaluate(() => window.plp.tutor.met())).toEqual({});
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("trace-table ask: clean all-correct first attempt grants met; review shows the completed table with the table-shaped retry", async ({ page }) => {
    await setup(page);
    await startTraceTableRound(page);
    await page.evaluate(() => window.plp.tutor.submit({ b0: "[1, 2, 3]", b1: "1" }));
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
    await expect(page.locator("#practice .pr-review .tutor-trace-table code.ok")).toHaveCount(2);
    await expect(page.locator("#practice .pr-review .pr-retry.pr-retry-table")).toHaveCount(1);
    await expect(page.locator("#practice .pr-review .pr-retry input")).toHaveCount(0);
    await page.evaluate(() => window.plp.tutor.closeReview());
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("trace-table review retry: blank table replaces the graded truth; a correct retry decorates the dot but never the score", async ({ page }) => {
    await setup(page);
    await startTraceTableRound(page);
    // Miss the table on the first (scored) attempt.
    await page.evaluate(() => window.plp.tutor.submit({ b0: "[1, 2, 3]", b1: "999" }));
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
    await expect(page.locator("#practice .pr-review .tutor-trace-table input[data-blank-id]")).toHaveCount(2);
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
    await inputs.nth(0).fill("[1, 2, 3]");
    await inputs.nth(1).fill("1");
    await page.locator("#practice .pr-retry-table button.primary", { hasText: "Check my answers" }).click();
    await expect(page.locator("#practice .pr-retry-verdict")).toContainText("✓ every step!", { timeout: 30_000 });
    // The re-graded table shows every cell right.
    await expect(page.locator("#practice .pr-review .tutor-trace-table code.ok")).toHaveCount(2);

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

  // order-the-lines (Parsons, expansion ladder §R2). The fixture is a FOCUS
  // round on 000A (rebind-updates-name): seed 2 of a cold `state` focus round
  // deals order-rebind-last-wins — re-derive by scanning
  // buildKBSession("state", { seed, count: 1, focus: "000A" }) for the first
  // seed whose ask.kind is "order-the-lines".
  async function startOrderRound(page) {
    await page.evaluate(() => {
      localStorage.removeItem("plp.kb.v1");
      localStorage.removeItem("plp.kb.met.v1");
      localStorage.removeItem("plp.kb.tmpl.v1");
      localStorage.removeItem("plp.tutor.v1");
    });
    const id = await page.evaluate(() =>
      window.plp.tutor.startDrill("state", { focus: "000A", seed: 2, count: 1 }));
    expect(id).toBe("drill-state-000A-2");
    return page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("plp.tutor.v1"));
      return s.drillLesson.steps.find((x) => x.ask)?.ask;
    });
  }
  const orderIdsFor = (ask, texts) => texts.map((t) => ask.items.find((it) => it.text === t).id);

  test("order-the-lines: the deal is shuffled, a wrong order really runs and grades wrong, the right one grades right and grants NO met", async ({ page }) => {
    await setup(page);
    // lintLesson accepts the kind via the questionGenerators stub entry.
    expect(await page.evaluate(() => window.plp.tutor.lintLesson({
      id: "ol-lint", steps: [{ ask: { kind: "order-the-lines", items: [] } }],
    }))).toEqual([]);

    const ask = await startOrderRound(page);
    expect(ask.kind).toBe("order-the-lines");
    expect(ask.template).toBe("order-rebind-last-wins");
    expect(ask.prompt).toContain(`prints \`${ask.targetOutput}\``);
    // The dealt puzzle NEVER starts solved (the compile-time guard).
    expect(ask.items.map((it) => it.text)).not.toEqual(ask.lines);
    // loadCode carries the SHUFFLED join — open-in-editor is honest.
    expect((await page.evaluate(() => window.plp.editor.getValue())).trim())
      .toBe(ask.items.map((it) => it.text).join("\n"));
    // The widget IS the program: no second, uneditable copy of the lines.
    await expect(page.locator("#practice .pr-order-row")).toHaveCount(ask.lines.length);
    await expect(page.locator("#practice .pr-question .pr-program")).toHaveCount(0);
    await expect(page.locator("#practice .pr-mechanics")).toContainText("↑ and ↓");

    // A WRONG arrangement (the two binds swapped) runs for real and prints
    // the other value — the reveal shows what it actually printed.
    const wrong = orderIdsFor(ask, [ask.lines[1], ask.lines[0], ask.lines[2]]);
    await page.evaluate((ids) => window.plp.tutor.submit(ids), wrong);
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("wrong");
    const printed = (await page.evaluate(() => window.plp.console.text())).trim();
    expect(printed).not.toBe(ask.targetOutput);
    await expect(page.locator("#practice .pr-reveal pre")).toContainText(printed);
    await expect(page.locator("#practice .pr-order.bad")).toHaveCount(1);
    expect(await page.evaluate(() => window.plp.tutor.drillStats())).toEqual({ "000A": { seen: 1, missed: 1 } });
    expect(await page.evaluate(() => window.plp.tutor.met())).toEqual({});
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);

    // The same deal, arranged correctly: right, stats bump — and still NO met
    // grant (v1: an arrangement is not a §4 prediction evidence class).
    const ask2 = await startOrderRound(page);
    const right = orderIdsFor(ask2, ask2.lines);
    await page.evaluate((ids) => window.plp.tutor.submit(ids), right);
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    expect((await page.evaluate(() => window.plp.console.text())).trim()).toBe(ask2.targetOutput);
    await expect(page.locator("#practice .pr-verdict-slot .tutor-verdict")).toContainText("✓ That prints the target");
    await expect(page.locator("#practice .pr-order.ok")).toHaveCount(1);
    expect(await page.evaluate(() => window.plp.tutor.drillStats())).toEqual({ "000A": { seen: 1, missed: 0 } });
    expect(await page.evaluate(() => window.plp.tutor.met())).toEqual({}); // no met for this form
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  // predict-the-error (expansion ladder §R3). Fixture: a FOCUS round on 002N
  // (errors-are-information), whose only exercise is err-name-unbound —
  // re-derive by scanning buildKBSession("state", { seed, count: 1,
  // focus: "002N" }) for the seed whose loadCode is the wanted shape. Seed 1
  // deals the misspelled-name shape, which raises NameError on LINE 3.
  async function startErrorRound(page) {
    await page.evaluate(() => {
      localStorage.removeItem("plp.kb.v1");
      localStorage.removeItem("plp.kb.met.v1");
      localStorage.removeItem("plp.kb.tmpl.v1");
      localStorage.removeItem("plp.tutor.v1");
    });
    const id = await page.evaluate(() =>
      window.plp.tutor.startDrill("state", { focus: "002N", seed: 1, count: 1 }));
    expect(id).toBe("drill-state-002N-1");
    return page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("plp.tutor.v1"));
      return { ask: s.drillLesson.steps.find((x) => x.ask)?.ask, code: window.plp.editor.getValue() };
    });
  }

  test("predict-the-error: a half-right pick grades wrong, both-right grades right and GRANTS met, against the real exception", async ({ page }) => {
    await setup(page);
    expect(await page.evaluate(() => window.plp.tutor.lintLesson({
      id: "pe-lint", steps: [{ ask: { kind: "predict-the-error" } }],
    }))).toEqual([]);

    const { ask, code } = await startErrorRound(page);
    expect(ask.kind).toBe("predict-the-error");
    expect(ask.template).toBe("err-name-unbound");
    // The ask carries NO authored answer: expectedError is K-series provenance.
    expect(ask.expectedError).toBeUndefined();
    expect(code.split("\n").filter(Boolean).length).toBe(3);
    // The widget IS the program: numbered rows, no second uneditable copy,
    // and all FOUR error names on every question (no meta-pattern).
    await expect(page.locator("#practice .pr-errline")).toHaveCount(3);
    await expect(page.locator("#practice .pr-question .pr-program")).toHaveCount(0);
    await expect(page.locator("#practice .pr-errkind")).toHaveText(["NameError", "TypeError", "IndexError", "KeyError"]);
    await expect(page.locator("#practice .pr-mechanics")).toContainText("tap the line it stops on");

    // Half right (right kind, wrong line) is still wrong — but the verdict
    // says which half landed, and the truth is marked on the picker.
    await page.evaluate(() => window.plp.tutor.submit({ line: 1, type: "NameError" }));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("wrong");
    await expect(page.locator("#practice .pr-verdict-slot .tutor-verdict")).toContainText("Right kind, wrong line");
    await expect(page.locator("#practice .pr-reveal pre")).toContainText("NameError");
    await expect(page.locator("#practice .pr-reveal pre")).toContainText("line 3");
    await expect(page.locator("#practice .pr-errline.truth")).toHaveCount(1);
    expect(await page.evaluate(() => window.plp.tutor.drillStats())).toEqual({ "002N": { seen: 1, missed: 1 } });
    expect(await page.evaluate(() => window.plp.tutor.met())).toEqual({});
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);

    // Both right: correct — and this form DOES grant met (binding §4).
    await startErrorRound(page);
    await page.evaluate(() => window.plp.tutor.submit({ line: 3, type: "NameError" }));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    await expect(page.locator("#practice .pr-verdict-slot .tutor-verdict")).toContainText("Right line, right kind");
    expect(Object.keys(await page.evaluate(() => window.plp.tutor.met()))).toEqual(["002N"]);
    expect((await page.evaluate(() => window.plp.tutor.met()))["002N"].source).toBe("drill");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("predict-the-error review + retry: the recorded pick and the truth come back, the retry re-runs and keeps the first attempt", async ({ page }) => {
    await setup(page);
    await startErrorRound(page);
    await page.evaluate(() => window.plp.tutor.submit({ line: 1, type: "KeyError" }));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    const liveCode = await page.evaluate(() => window.plp.editor.getValue());

    const rec = await page.evaluate(() =>
      window.plp.tutor.feed().findLast((c) => c.type === "question-frozen"));
    expect(rec.review.kind).toBe("predict-the-error");
    expect(rec.review.picked).toEqual({ line: 1, type: "KeyError" });
    expect(rec.review.actual.type).toBe("NameError");
    expect(rec.review.actual.line).toBe(3);
    expect(rec.answerText).toBe("line 1 · KeyError");

    await page.evaluate(() => window.plp.tutor.review(0));
    await expect(page.locator("#practice .pr-review .pr-errreview .pr-errline")).toHaveCount(3);
    await expect(page.locator("#practice .pr-review .pr-errreview .pr-errline.bad")).toHaveCount(1);
    await expect(page.locator("#practice .pr-review .pr-errreview .pr-errline.truth")).toHaveCount(1);
    await expect(page.locator("#practice .pr-review .pr-errreview .hint")).toContainText("it raised NameError");
    await expect(page.locator("#practice .pr-review .pr-retry.pr-retry-error")).toHaveCount(1);

    // Starting the retry swaps the marked answer for a live picker.
    await page.locator("#practice .pr-retry-error button.primary", { hasText: "Try it again" }).click();
    await expect(page.locator("#practice .pr-review .pr-errkind")).toHaveCount(4);
    await page.locator("#practice .pr-retry-cancel").click();
    await expect(page.locator("#practice .pr-review .pr-errreview")).toBeVisible();

    // A correct retry re-runs for real and decorates the record only.
    const res = await page.evaluate(() => window.plp.tutor.retry(0, { line: 3, type: "NameError" }));
    expect(res.ok).toBe(true);
    expect(res.expectedText).toContain("line 3");
    const after = await page.evaluate(() => ({
      rec: (() => { const r = window.plp.tutor.feed().find((c) => c.type === "question-frozen"); return { ok: r.ok, retry: r.retry }; })(),
      stats: window.plp.tutor.drillStats(),
      met: window.plp.tutor.met(),
      editor: window.plp.editor.getValue(),
    }));
    expect(after.rec).toEqual({ ok: false, retry: { ok: true, tries: 1 } });
    expect(after.stats).toEqual({ "002N": { seen: 1, missed: 1 } });
    expect(after.met).toEqual({}); // a retry never grants
    expect(after.editor).toBe(liveCode);
    await page.evaluate(() => window.plp.tutor.closeReview());
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("order-the-lines review + retry: the recorded arrangement comes back, the retry re-runs for real and keeps the first attempt", async ({ page }) => {
    await setup(page);
    const ask = await startOrderRound(page);
    const wrong = orderIdsFor(ask, [ask.lines[1], ask.lines[0], ask.lines[2]]);
    await page.evaluate((ids) => window.plp.tutor.submit(ids), wrong);
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 15_000 });
    const liveCode = await page.evaluate(() => window.plp.editor.getValue());

    // The review snapshot carries everything needed to rebuild the puzzle.
    const rec = await page.evaluate(() =>
      window.plp.tutor.feed().findLast((c) => c.type === "question-frozen"));
    expect(rec.review.kind).toBe("order-the-lines");
    expect(rec.review.items.length).toBe(3);
    expect(rec.review.answerOrder).toEqual(wrong);
    expect(rec.review.canonical).toEqual(ask.lines);
    expect(rec.review.targetOutput).toBe(ask.targetOutput);

    // Review: the arrangement the learner submitted, the verdict, and what it
    // really printed.
    await page.evaluate(() => window.plp.tutor.review(0));
    await expect(page.locator("#practice .pr-review .pr-order-arrangement pre"))
      .toHaveText([ask.lines[1], ask.lines[0], ask.lines[2]].join("\n"));
    await expect(page.locator("#practice .pr-review .pr-review-answer .tutor-verdict")).toContainText("✗");
    await expect(page.locator("#practice .pr-review .pr-reveal pre")).toContainText(rec.review.expectedText.trim());
    await expect(page.locator("#practice .pr-review .pr-retry.pr-retry-order")).toHaveCount(1);

    // Starting the retry brings the DEALT items back as a live widget.
    await page.locator("#practice .pr-retry-order button.primary", { hasText: "Try it again" }).click();
    await expect(page.locator("#practice .pr-review .pr-order-row")).toHaveCount(3);
    await expect(page.locator("#practice .pr-review .pr-order-row code").first())
      .toHaveText(ask.items[0].text);
    // ↑/↓ move rows: the top row's ↓ swaps it with the second.
    await page.locator("#practice .pr-review .pr-order-row").first().locator("button").nth(1).click();
    await expect(page.locator("#practice .pr-review .pr-order-row code").first())
      .toHaveText(ask.items[1].text);
    await page.locator("#practice .pr-retry-cancel").click();
    await expect(page.locator("#practice .pr-review .pr-order-arrangement pre")).toBeVisible();

    // A correct retry (driven through the API, same path) re-runs for real,
    // decorates the record — and never touches the score of record.
    const res = await page.evaluate((ids) => window.plp.tutor.retry(0, ids), orderIdsFor(ask, ask.lines));
    expect(res.ok).toBe(true);
    expect(res.expectedText.trim()).toBe(ask.targetOutput);
    const after = await page.evaluate(() => ({
      rec: (() => { const r = window.plp.tutor.feed().find((c) => c.type === "question-frozen"); return { ok: r.ok, retry: r.retry }; })(),
      stats: window.plp.tutor.drillStats(),
      met: window.plp.tutor.met(),
      editor: window.plp.editor.getValue(),
    }));
    expect(after.rec).toEqual({ ok: false, retry: { ok: true, tries: 1 } });
    expect(after.stats).toEqual({ "000A": { seen: 1, missed: 1 } });
    expect(after.met).toEqual({});
    expect(after.editor).toBe(liveCode); // the live round's program survived
    await page.evaluate(() => window.plp.tutor.closeReview());
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("history: transitions push entries; Back walks round → menu → IDE; Forward resumes the live round", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.clear(); location.reload(); });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await page.locator("#btn-tutor").click(); // IDE → menu
    await page.waitForFunction(() => location.hash === "#learn");
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 8, count: 2 }));
    await page.waitForFunction(() => location.hash === "#learn/round");
    await expect(page.locator("#practice .tutor-output-input")).toBeVisible();
    // Back mid-round: the menu, with the round still live and resumable.
    await page.goBack();
    await page.waitForFunction(() => location.hash === "#learn");
    await expect(page.locator("body")).toHaveClass(/practice/);
    await expect(page.locator("#practice [data-role=pr-controls] button", { hasText: "Continue your round" })).toBeVisible();
    const st = await page.evaluate(() => window.plp.tutor.state());
    expect(st.lessonId).toBe("drill-numbers-8");
    expect(st.waiting).toBe("ask");
    // Back again: the IDE.
    await page.goBack();
    await expect(page.locator("body")).not.toHaveClass(/practice/);
    await expect(page.locator("#layout")).toBeVisible();
    // Forward, forward: menu, then the round's live card intact.
    await page.goForward();
    await page.waitForFunction(() => location.hash === "#learn");
    await page.goForward();
    await page.waitForFunction(() => location.hash === "#learn/round");
    await expect(page.locator("#practice .tutor-output-input")).toBeVisible();
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");
    // Reload keeps the hash and the hash restores the round view.
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    expect(await page.evaluate(() => location.hash)).toBe("#learn/round");
    await expect(page.locator("body")).toHaveClass(/practice/);
    await expect(page.locator("#practice .tutor-output-input")).toBeVisible();
  });

  test("a first visit to #learn survives the COI-shim reload and opens the menu", async ({ page }) => {
    await page.goto(SITE + "#learn");
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await expect(page.locator("body")).toHaveClass(/practice/);
    await expect(page.locator("#practice .pr-static .tutor-card")).toHaveCount(1);
    expect(await page.evaluate(() => location.hash)).toBe("#learn");
  });

  test("continue signal: a persisted round badges Learn and offers a chip; Continue opens it; dismiss is session-only", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.clear(); location.reload(); });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 8, count: 2 }));
    await page.evaluate(() => window.plp.tutor.hideSurface()); // round persists
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await expect(page.locator("#btn-tutor .continue-badge")).toBeVisible();
    await expect(page.locator("#continue-chip")).toContainText("mid-round");
    await page.locator("#continue-chip button", { hasText: "Continue" }).click();
    await expect(page.locator("body")).toHaveClass(/practice/);
    await expect(page.locator("#continue-chip")).toHaveCount(0);
    await expect(page.locator("#btn-tutor .continue-badge")).toHaveCount(0);
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");
    // Dismiss: the ✕ hides both for the session (nothing persisted).
    await page.evaluate(() => window.plp.tutor.hideSurface());
    await page.reload();
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await expect(page.locator("#continue-chip")).toBeVisible();
    await page.locator("#continue-chip .chip-dismiss").click();
    await expect(page.locator("#continue-chip")).toHaveCount(0);
    await expect(page.locator("#btn-tutor .continue-badge")).toHaveCount(0);
  });

  test("world switch: segments carry active states; the Lesson segment appears during a guided lesson", async ({ page }) => {
    await setup(page);
    await expect(page.locator("#btn-code")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#btn-tutor")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#btn-lesson")).toBeHidden();
    await page.evaluate(() => window.plp.tutor.start("u1-state-io"));
    await expect(page.locator("#btn-lesson")).toBeVisible();
    await expect(page.locator("#btn-lesson")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#btn-code")).toHaveAttribute("aria-pressed", "false");
    // Code segment: back to the IDE; the lesson stays live so its segment stays.
    await page.locator("#btn-code").click();
    await expect(page.locator("#layout")).not.toHaveClass(/focus/);
    await expect(page.locator("#btn-code")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#btn-lesson")).toBeVisible();
    await expect(page.locator("#btn-lesson")).toHaveAttribute("aria-pressed", "false");
    // Lesson segment: resumes the stage.
    await page.locator("#btn-lesson").click();
    await expect(page.locator(".tutor-stage")).toBeVisible();
    await expect(page.locator("#btn-lesson")).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.plp.tutor.exit());
    await expect(page.locator("#btn-lesson")).toBeHidden();
  });

  test("unified ←: round → menu keeps the round live; map → menu; a map-launched round ends back at the map", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.clear(); location.reload(); });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 8, count: 2 }));
    await expect(page.locator("body")).toHaveClass(/practice/);
    // ← from the round: the menu, round resumable (still the ask of record).
    await page.locator("#practice [data-role=pr-leave]").click();
    await expect(page.locator("body")).toHaveClass(/practice/);
    await expect(page.locator("#practice [data-role=pr-controls] button", { hasText: "Continue your round" })).toBeVisible();
    expect((await page.evaluate(() => window.plp.tutor.state())).waiting).toBe("ask");
    await page.locator("#practice [data-role=pr-controls] button", { hasText: "Continue your round" }).click();
    await expect(page.locator("#practice .tutor-output-input")).toBeVisible();
    await page.evaluate(() => window.plp.tutor.exit());
    // ← from the map: the menu; ← from the menu: the IDE.
    await page.evaluate(() => window.plp.tutor.showMap());
    await expect(page.locator("#practice .cm-lane")).toHaveCount(8);
    await page.locator("#practice [data-role=pr-leave]").click();
    await expect(page.locator("#practice .cm-lane")).toHaveCount(0);
    await expect(page.locator("#practice [data-role=pr-controls] button", { hasText: "Everything" })).toBeVisible();
    await page.locator("#practice [data-role=pr-leave]").click();
    await expect(page.locator("body")).not.toHaveClass(/practice/);
    // A round launched from the map ends (✕) back on the map, not the menu.
    await page.evaluate(() => window.plp.tutor.showMap());
    await page.locator("#practice .cm-node.frontier").click();
    await page.locator("#practice .cm-detail button.primary").click();
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    await page.locator("#practice [data-role=pr-exit-lesson]").click();
    await expect(page.locator("#practice .cm-lane")).toHaveCount(8);
  });

  test("summary: the look-back button opens the first miss's review; Back returns to the summary; miss dots read ✗", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { localStorage.removeItem("plp.kb.v1"); localStorage.removeItem("plp.tutor.v1"); });
    await page.evaluate(() => window.plp.tutor.startDrill("numbers", { seed: 8, count: 2 }));
    await page.evaluate(() => window.plp.tutor.lockPrediction("definitely wrong"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "pause", null, { timeout: 30_000 });
    await page.evaluate(() => window.plp.tutor.continue());
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 15_000 });
    // The miss dot renders its ✗ glyph (CSS ::after over the styled class).
    await expect(page.locator("#practice button.pr-dot.miss")).toHaveCount(1);
    await page.evaluate(() => window.plp.tutor.skip());
    await page.evaluate(() => window.plp.tutor.continue());
    await page.waitForFunction(() => window.plp.tutor.state().waiting === null, null, { timeout: 15_000 });
    await expect(page.locator("#practice .tutor-summary")).toBeVisible();
    await expect(page.locator("#practice .t-summary-review")).toContainText("Look back");
    await page.locator("#practice .t-summary-review").click();
    await expect(page.locator("#practice .pr-review")).toBeVisible();
    await expect(page.locator("#practice .pr-review .pr-review-answer")).toContainText("definitely wrong");
    await page.locator("#practice .pr-review .pr-actions button").click(); // ↩ Back to the round
    await expect(page.locator("#practice .tutor-summary")).toBeVisible();
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("chrome minors: maximize glyph swaps to restore; untraced-run memory note; the stage shows ✕ End lesson", async ({ page }) => {
    await setup(page);
    // m3: ⤢ becomes ⤡ "Restore (Esc)" while maximized; Esc restores both.
    const maxBtn = page.locator('.max-btn[data-max="editor-pane"]');
    await maxBtn.click();
    await expect(maxBtn).toHaveText("⤡");
    await expect(maxBtn).toHaveAttribute("title", "Restore (Esc)");
    await page.keyboard.press("Escape");
    await expect(maxBtn).toHaveText("⤢");
    // m4: after an untraced Run the empty memory pane says why.
    await page.evaluate(() => window.plp.editor.setValue("print(1)\n"));
    await page.evaluate(() => window.plp.run());
    await expect(page.locator("#memory-pane .memory-empty")).toContainText("goes full speed", { timeout: 60_000 });
    // m5: the stage header carries a visible End lesson.
    await page.evaluate(() => window.plp.tutor.start("u1-state-io"));
    await expect(page.locator(".tutor-stage [data-role=stage-exit]")).toBeVisible();
    await page.locator(".tutor-stage [data-role=stage-exit]").click();
    await expect(page.locator(".tutor-stage")).toBeHidden();
    expect((await page.evaluate(() => window.plp.tutor.state())).lessonId).toBeNull();
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

  // ---- predict-io: the input boundary (expansion ladder §R4a) -------------
  // Fixture: a FOCUS round on 0026 (input-pauses-for-value). Seed 0 deals
  // greet-and-echo's bind-then-print shape (ONE rendezvous); seed 2 deals
  // two-questions' reverse-order shape (TWO). Re-derive by scanning
  // buildKBSession("state", { seed, count: 1, focus: "0026" }).
  async function startIORound(page, seed) {
    await page.evaluate(() => {
      localStorage.removeItem("plp.kb.v1");
      localStorage.removeItem("plp.kb.met.v1");
      localStorage.removeItem("plp.kb.tmpl.v1");
      localStorage.removeItem("plp.tutor.v1");
      localStorage.removeItem("plp.practice.v1");
    });
    const id = await page.evaluate((s) =>
      window.plp.tutor.startDrill("state", { focus: "0026", seed: s, count: 1 }), seed);
    expect(id).toBe(`drill-state-0026-${seed}`);
    return page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("plp.tutor.v1"));
      return { ask: s.drillLesson.steps.find((x) => x.ask)?.ask, code: window.plp.editor.getValue() };
    });
  }

  test("predict-io: the ask carries its stdin script, the card shows it as chips, and the auto-answered run produces the real transcript", async ({ page }) => {
    await setup(page);
    expect(await page.evaluate(() => window.plp.tutor.lintLesson({
      id: "io-lint", steps: [{ ask: { kind: "predict-io" } }],
    }))).toEqual([]);

    const { ask, code } = await startIORound(page, 0);
    expect(ask.kind).toBe("predict-io");
    expect(ask.template).toBe("greet-and-echo");
    expect(ask.stdinScript).toEqual(["blue"]);
    expect(ask.multiline).toBe(true);
    expect(code).toBe('print("moon")\nword = input("Your name? ")\nprint(word)\n');

    // The typing is SCAFFOLDED and shown: one chip per scripted line, beside
    // the program, plus this form's first-time mechanics line.
    await expect(page.locator("#practice .pr-question .pr-stdin")).toHaveCount(1);
    await expect(page.locator("#practice .pr-stdin .pr-reveal-label")).toHaveText("someone types:");
    await expect(page.locator("#practice .pr-stdin-chip code")).toHaveText(["blue"]);
    await expect(page.locator("#practice .pr-mechanics")).toContainText("type the WHOLE console");
    // The answer widget is the growing line-box widget (a transcript is not one
    // line) — and it starts with EXACTLY ONE box: the number of boxes must
    // never hint at how many lines the console shows.
    await expect(page.locator("#practice .pr-answer textarea")).toHaveCount(0);
    await expect(page.locator("#practice .pr-answer .tutor-lines")).toHaveCount(1);
    await expect(page.locator("#practice .pr-answer .tutor-lines-input")).toHaveCount(1);

    // A wrong answer — the concept's own misconception: output with no pause,
    // no prompt and no typed line.
    await page.evaluate(() => window.plp.tutor.lockPrediction("moon\nblue"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("wrong");
    // The run really happened, answered from the script — a single echo of
    // the typed line, in the right place (invariant 4).
    expect(await page.evaluate(() => window.plp.console.text())).toBe("moon\nYour name? blue\nblue\n");
    expect(await page.evaluate(() => window.plp.console.engineText())).toBe("moon\nYour name? blue\n");
    await expect(page.locator("#practice .pr-reveal .pr-reveal-label")).toHaveText("the console really showed");
    await expect(page.locator("#practice .pr-reveal pre")).toContainText("Your name? blue");
    expect(await page.evaluate(() => window.plp.tutor.drillStats())).toEqual({ "0026": { seen: 1, missed: 1 } });
    expect(await page.evaluate(() => window.plp.tutor.met())).toEqual({});
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("predict-io: the full transcript grades right and GRANTS met; the echo-stripped reading is accepted too", async ({ page }) => {
    await setup(page);
    await startIORound(page, 0);
    await page.evaluate(() => window.plp.tutor.lockPrediction("moon\nYour name? blue\nblue"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    await expect(page.locator("#practice .pr-verdict-slot .tutor-verdict")).toContainText("Exactly right");
    // MET GRANT (lesson-kb-binding §4): predicting the transcript of a program
    // that pauses for the outside world is the §2.8 evidence class.
    expect(Object.keys(await page.evaluate(() => window.plp.tutor.met()))).toEqual(["0026"]);
    expect((await page.evaluate(() => window.plp.tutor.met()))["0026"].source).toBe("drill");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);

    // Two rendezvous, answered in order — and the echo-STRIPPED reading (what
    // the program alone emits) is accepted: the local echo is a presentation
    // choice, not the concept.
    const { ask } = await startIORound(page, 2);
    expect(ask.template).toBe("two-questions");
    expect(ask.stdinScript).toEqual(["tree", "hi"]);
    await expect(page.locator("#practice .pr-stdin-chip code")).toHaveText(["tree", "hi"]);
    await expect(page.locator("#practice .pr-stdin-then")).toHaveText(["then"]);
    await page.evaluate(() => window.plp.tutor.lockPrediction("What shall I say? Say a word: hi\ntree"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    expect(await page.evaluate(() => window.plp.console.text()))
      .toBe("What shall I say? tree\nSay a word: hi\nhi\ntree\n");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("predict-io: a script the program out-asks INTERRUPTS and skips — the run always reaches a terminal (invariant 2)", async ({ page }) => {
    await setup(page);
    await startIORound(page, 2); // two rendezvous
    // Starve the stored round's script, then let the tutor rebuild the ask
    // from it on reload — the ask re-arms with a script too short to finish.
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("plp.tutor.v1"));
      s.drillLesson.steps.find((x) => x.ask).ask.stdinScript = ["tree"];
      localStorage.setItem("plp.tutor.v1", JSON.stringify(s));
    });
    await setup(page);
    await page.waitForFunction(() => window.plp.tutor.ask()?.kind === "predict-io", null, { timeout: 30_000 });

    await page.evaluate(() => window.plp.tutor.lockPrediction("anything at all"));
    // The point of the test: this RESOLVES. A run left waiting at the stdin
    // rendezvous would wedge the buttons (and, in a room, everybody).
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("skipped");
    const rec = await page.evaluate(() => window.plp.tutor.feed().findLast((c) => c.type === "question-frozen"));
    expect(rec.verdict).toBe("couldn't grade this run");
    expect(rec.ok).toBe(false);
    // The engine really stopped, and the app is runnable again.
    expect(await page.evaluate(() => window.plp.runner.summary()?.terminal_reason)).toBe("interrupted");
    expect(await page.evaluate(() => window.plp.runner.isRunning())).toBe(false);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("predict-io review + retry: the script comes back with the program, and the retry re-runs deterministically", async ({ page }) => {
    await setup(page);
    await startIORound(page, 0);
    await page.evaluate(() => window.plp.tutor.lockPrediction("moon\nblue"));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    const liveCode = await page.evaluate(() => window.plp.editor.getValue());

    const rec = await page.evaluate(() => window.plp.tutor.feed().findLast((c) => c.type === "question-frozen"));
    expect(rec.review.kind).toBe("predict-io");
    expect(rec.review.stdinScript).toEqual(["blue"]);
    expect(rec.review.expectedText).toBe("moon\nYour name? blue\nblue\n");

    await page.evaluate(() => window.plp.tutor.review(0));
    await expect(page.locator("#practice .pr-review .pr-stdin-chip code")).toHaveText(["blue"]);
    // The retry widget matches the live card: the growing line boxes (never a
    // textarea, which has no keyboard submit), one box to start.
    await expect(page.locator("#practice .pr-review .pr-retry textarea")).toHaveCount(0);
    await expect(page.locator("#practice .pr-review .pr-retry .tutor-lines-input")).toHaveCount(1);

    const res = await page.evaluate(() => window.plp.tutor.retry(0, "moon\nYour name? blue\nblue"));
    expect(res.ok).toBe(true);
    expect(res.expectedText).toBe("moon\nYour name? blue\nblue\n");
    const after = await page.evaluate(() => ({
      rec: (() => { const r = window.plp.tutor.feed().find((c) => c.type === "question-frozen"); return { ok: r.ok, retry: r.retry }; })(),
      stats: window.plp.tutor.drillStats(),
      met: window.plp.tutor.met(),
      editor: window.plp.editor.getValue(),
    }));
    expect(after.rec).toEqual({ ok: false, retry: { ok: true, tries: 1 } });
    expect(after.stats).toEqual({ "0026": { seen: 1, missed: 1 } });
    expect(after.met).toEqual({}); // a retry never grants
    expect(after.editor).toBe(liveCode);
    await page.evaluate(() => window.plp.tutor.closeReview());
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  // ---- the growing line-box answer widget (multi-line asks) ---------------
  // The defect this covers: a MULTI-line ask used a textarea, so there was NO
  // keyboard way to submit (Enter-submits was bound only for single-line asks)
  // and the first-time mechanics line claimed otherwise. Driven end to end on
  // the practice surface against a REAL drill deal — the seed is scanned for,
  // never hardcoded blind, because the KB pool moves.
  async function startMultilineRound(page) {
    await page.evaluate(() => {
      for (const k of ["plp.kb.v1", "plp.kb.met.v1", "plp.kb.tmpl.v1", "plp.tutor.v1", "plp.practice.v1"]) {
        localStorage.removeItem(k);
      }
    });
    const seed = await page.evaluate(async () => {
      const mod = await import("./app/kb-session.mjs");
      for (let s = 0; s < 24; s++) {
        const built = await mod.buildKBSession("loops", { seed: s, count: 1, focus: "001E" });
        const ask = built?.steps?.find((x) => x.ask)?.ask;
        if (ask?.kind === "predict-output" && ask.singleLine === false) return s;
      }
      return null;
    });
    expect(seed, "no multi-line predict-output deal found in the loops pool").not.toBeNull();
    await page.evaluate((s) =>
      window.plp.tutor.startDrill("loops", { focus: "001E", seed: s, count: 1 }), seed);
    await page.waitForFunction(() => window.plp.tutor.ask()?.kind === "predict-output", null, { timeout: 30_000 });
    return seed;
  }

  test("multi-line predict-output: one box to start, Enter builds lines, double-Enter submits — and the mechanics line no longer lies", async ({ page }) => {
    await setup(page);
    const seed = await startMultilineRound(page);

    // Exactly ONE box: the widget must never hint at how many lines print.
    await expect(page.locator("#practice .pr-answer .tutor-lines-input")).toHaveCount(1);
    await expect(page.locator("#practice .pr-answer textarea")).toHaveCount(0);
    // The mechanics line describes THIS widget — the old copy promised a plain
    // Enter submit that never existed on multi-line asks.
    const mech = page.locator("#practice .pr-mechanics");
    await expect(mech).toContainText("one box per printed line");
    await expect(mech).not.toContainText("press Enter — the program really runs");

    // Two lines, typed the way a learner types them, then the "I'm done"
    // gesture: Enter on an empty last box submits and drops that box.
    const boxes = page.locator("#practice .pr-answer .tutor-lines-input");
    await boxes.nth(0).click();
    await page.keyboard.type("20");
    await page.keyboard.press("Enter");
    await expect(boxes).toHaveCount(2);
    await page.keyboard.type("90");
    await page.keyboard.press("Enter");
    await expect(boxes).toHaveCount(3);
    await page.keyboard.press("Enter"); // empty last box → drop it and submit
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    await expect(boxes).toHaveCount(2); // the empty box is gone from the answer

    // It graded against the REAL run, exactly as before: the recorded answer is
    // the "\n"-joined boxes, and the truth is the console's own text.
    const st = await page.evaluate(() => window.plp.tutor.state());
    const rec = await page.evaluate(() => window.plp.tutor.feed().findLast((c) => c.type === "question-frozen"));
    const real = await page.evaluate(() => window.plp.console.text());
    expect(rec.answerText).toBe("20\n90");
    expect(rec.review.expectedText).toBe(real);
    expect(st.lastAnswer).toBe(real.replace(/\n$/, "") === "20\n90" ? "correct" : "wrong");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);

    // Driver-API compatibility: the same round, answered through
    // lockPrediction with a "\n"-joined string, still grades right.
    await setup(page);
    await startMultilineRound(page);
    await page.evaluate((t) => window.plp.tutor.lockPrediction(t), real.replace(/\n$/, ""));
    await page.waitForFunction(() => window.plp.tutor.state().waiting !== "ask", null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.plp.tutor.state())).lastAnswer).toBe("correct");
    // One box per predicted line — lockPrediction split it, nothing was lost.
    expect(await page.evaluate(() => window.plp.editor.getValue())).toBeTruthy();
    await expect(page.locator("#practice .pr-answer .tutor-lines-input"))
      .toHaveCount(real.replace(/\n$/, "").split("\n").length);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("multi-line answering explains itself: the hint persists and the boxes are labelled lines", async ({ page }) => {
    await setup(page);
    // A learner who has ALREADY met these forms — the flag that used to
    // suppress the hint forever. Reported defect: "I don't know how to type
    // in multi-line answers", with no cue left on screen.
    await page.evaluate(() => {
      localStorage.setItem("plp.practice.v1", JSON.stringify({ forms: {
        "predict-output": true, "predict-output#lines": true,
        "predict-exact-output": true, "predict-exact-output#lines": true,
      } }));
      localStorage.setItem("plp.kb.v1", JSON.stringify({ "0005": { seen: 24, missed: 0 } }));
      localStorage.removeItem("plp.tutor.v1");
    });
    await page.evaluate(() => window.plp.tutor.startDrill("loops", { seed: 7, count: 1 }));
    await page.waitForFunction(() => window.plp.tutor.state().waiting === "ask", null, { timeout: 30_000 });
    // The hint is STILL there on a repeat visit — multi-line asks always carry it.
    await expect(page.locator("#practice .pr-mechanics")).toContainText("one box per printed line");
    // And the widget says what it is without needing the hint at all.
    await expect(page.locator("#practice .tutor-lines-num").first()).toHaveText("line 1");
    await expect(page.locator("#practice .tutor-lines-add")).toContainText("another line");
    // Enter grows the list and the numbering follows.
    await page.locator("#practice .tutor-lines-input").first().fill("20");
    await page.locator("#practice .tutor-lines-input").first().press("Enter");
    await expect(page.locator("#practice .tutor-lines-num")).toHaveText(["line 1", "line 2"]);
    // (no checkErrors here: it validates the TRACE record stream, and this
    // test inspects the card's chrome without ever running a program.)
  });
});
