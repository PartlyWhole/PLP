// Q-series: generative question engine (app/questions.mjs) + quiz pilot.
// Engine is exercised through window.plp.questions with explicit options so
// every question is deterministic.

import { test, expect } from "@playwright/test";

const SITE = "/PLP/";

const PROGRAM =
  "def total(prices):\n"
  + "    result = 0\n"
  + "    for p in prices:\n"
  + "        result = result + p\n"
  + "    return result\n"
  + "\n"
  + "cart = {\"apple\": 3, \"pear\": 5}\n"
  + "prices = list(cart.values())\n"
  + "t = total(prices)\n"
  + "print(t)\n";

async function setupRun(page) {
  await page.goto(SITE);
  await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.plp));
  await page.evaluate((src) => window.plp.editor.setValue(src), PROGRAM);
  const summary = await page.evaluate(() => window.plp.trace());
  expect(summary.terminal_reason).toBe("completed");
}

const ctxExpr = `({
  source: window.plp.editor.getValue(),
  steps: window.plp.memory.steps(),
  positions: window.plp.memory.linePositions(),
})`;

test.describe("PLP questions (Q-series)", () => {
  test("memory-next-line: blanks are the diff; grading accepts equivalent forms", async ({ page }) => {
    await setupRun(page);
    const r = await page.evaluate((ctxSrc) => {
      const ctx = eval(ctxSrc);
      // positions: 0=line1(def), 1=line7(cart), 2=line8(prices), ...
      const q = window.plp.questions.generateQuestion("memory-next-line", ctx, { from: 1, to: 2 });
      const right = {};
      for (const b of q.blanks) right[b.id] = b.expected.replace(/"/g, "'"); // student-style quotes
      const wrong = Object.fromEntries(q.blanks.map((b) => [b.id, "999"]));
      return {
        prompt: q.prompt,
        fromLine: q.fromLine, toLine: q.toLine,
        blanks: q.blanks,
        givenNames: q.given.entries.map((e) => e.name),
        targetShown: q.target.entries.filter((e) => !e.blankId).map((e) => e.name),
        gradeRight: q.grade(right),
        gradeWrong: q.grade(wrong),
      };
    }, ctxExpr);
    expect(r.fromLine).toBe(7);
    expect(r.toLine).toBe(8);
    expect(r.givenNames).toEqual(["cart"]);
    // The changed binding (prices) is blanked; the unchanged one shown.
    expect(r.blanks.map((b) => b.label)).toEqual(["globals · prices"]);
    expect(r.blanks[0].expected).toBe("[3, 5]");
    expect(r.targetShown).toEqual(["cart"]);
    expect(r.gradeRight.correct).toBe(true); // whitespace/quote-insensitive
    expect(r.gradeWrong.correct).toBe(false);
    expect(r.gradeWrong.expected[r.blanks[0].id]).toBe("[3, 5]");
  });

  test("memory-line-to-line: spans multiple lines incl. frame locals", async ({ page }) => {
    await setupRun(page);
    const r = await page.evaluate((ctxSrc) => {
      const ctx = eval(ctxSrc);
      // to a position inside total(): frame locals appear as scoped entries
      const inTotal = ctx.positions.findIndex((p) => p.function === "total" && p.line === 4);
      const q = window.plp.questions.generateQuestion("memory-line-to-line", ctx, { from: 1, to: inTotal });
      return { scopes: q.target.entries.map((e) => e.scope), blanks: q.blanks.length };
    }, ctxExpr);
    expect(r.scopes).toContain("globals");
    expect(r.scopes).toContain("total()");
    expect(r.blanks).toBeGreaterThan(0);
  });

  test("memory construction: graph grading ignores local data ids and preserves identity", async ({ page }) => {
    await setupRun(page);
    const r = await page.evaluate((ctxSrc) => {
      const ctx = eval(ctxSrc);
      const q = window.plp.questions.generateQuestion("memory-construct", ctx, { position: 2 });
      const renamed = structuredClone(q.construction.target);
      const ids = new Map(renamed.data.map((node, index) => [node.id, `learner-data-${index + 1}`]));
      const renameValue = (value) => {
        if (value?.kind === "ref") value.target = ids.get(value.target);
      };
      for (const scope of renamed.scopes) for (const binding of scope.bindings) renameValue(binding.value);
      for (const node of renamed.data) {
        node.id = ids.get(node.id);
        for (const value of node.items ?? []) renameValue(value);
        for (const entry of node.entries ?? []) { renameValue(entry.key); renameValue(entry.value); }
        for (const field of node.fields ?? []) renameValue(field.value);
      }
      const wrong = structuredClone(renamed);
      wrong.scopes.find((scope) => scope.label === "Globals").bindings
        .find((binding) => binding.name === "prices").value = null;
      return {
        mode: q.construction.mode,
        dataCount: q.construction.target.data.length,
        right: q.grade({ type: "memory-graph-answer", graph: renamed }),
        wrong: q.grade({ type: "memory-graph-answer", graph: wrong }),
      };
    }, ctxExpr);
    expect(r.mode).toBe("blank");
    expect(r.dataCount).toBeGreaterThan(1);
    expect(r.right.correct).toBe(true);
    expect(r.wrong.correct).toBe(false);
    expect(r.wrong.perArea.bindings).toBe(false);
  });

  test("expression sequence: augmented assignment includes RHS construction and store", async ({ page }) => {
    await setupRun(page);
    const r = await page.evaluate(() => {
      const plan = window.plp.questions.buildEvaluationPlan("items += [4]");
      const q = window.plp.questions.generateQuestion("expression-sequence", {
        source: "items += [4]", steps: [], positions: [],
      }, { line: 1, seed: 9 });
      const order = q.evaluation.cards.map((card) => card.id);
      return {
        labels: plan.cards.map((card) => card.label),
        paletteDiffers: q.evaluation.palette.some((card, index) => card.id !== order[index]),
        right: q.grade(order),
        wrong: q.grade([...order].reverse()),
      };
    });
    expect(r.labels).toEqual(["Read target", "Produce literal", "Construct list", "Apply +=", "Store result"]);
    expect(r.paletteDiffers).toBe(true);
    expect(r.right.correct).toBe(true);
    expect(r.wrong.correct).toBe(false);
  });

  test("code-order: shuffled items grade by position", async ({ page }) => {
    await setupRun(page);
    const r = await page.evaluate((ctxSrc) => {
      const ctx = eval(ctxSrc);
      const q = window.plp.questions.generateQuestion("code-order", ctx, { seed: 7 });
      const expectedLines = ctx.source.split("\n").filter((l) => l.trim() !== "");
      // Correct answer: items sorted back into source order.
      const byText = new Map(q.items.map((it) => [it.text, it.id]));
      const rightOrder = expectedLines.map((l) => byText.get(l));
      return {
        shuffledDiffers: q.items.some((it, i) => it.text !== expectedLines[i]),
        right: q.grade(rightOrder),
        wrong: q.grade([...rightOrder].reverse()),
      };
    }, ctxExpr);
    expect(r.shuffledDiffers).toBe(true);
    expect(r.right.correct).toBe(true);
    expect(r.wrong.correct).toBe(false);
  });

  // The Parsons renderer (expansion ladder §R2) has no generator — the KB
  // deals its items — so it is unit-checked directly through the shared
  // question-ui module: ↑/↓ reorder the rows, collect() reads them
  // top-to-bottom, and freeze() ends the interaction.
  test("renderOrderLines: ↑/↓ reorder the rows; collect reads them top-down; freeze stops moving", async ({ page }) => {
    await page.goto(SITE);
    await page.waitForFunction(() => Boolean(window.plp?.questionUI));
    const r = await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const items = [{ id: "l2", text: "print(n)" }, { id: "l0", text: "n = 1" }, { id: "l1", text: "n = n + 1" }];
      const view = window.plp.questionUI.renderOrderLines(host, { items });
      const rows = () => [...host.querySelectorAll(".pr-order-row")];
      const click = (i, which) => rows()[i].querySelectorAll("button")[which].click();
      const dealt = view.collect();
      click(0, 1);              // ↓ on the top row
      const afterDown = view.collect();
      click(2, 0);              // ↑ on the bottom row
      const afterUp = view.collect();
      click(0, 0);              // ↑ at the top edge: no-op
      const atEdge = view.collect();
      const texts = rows().map((row) => row.querySelector("code").textContent);
      view.applyResult({ correct: false });
      const marked = host.querySelector(".pr-order").className;
      view.freeze();
      click(0, 1);              // frozen: the row does not move
      const afterFreeze = view.collect();
      const disabled = [...host.querySelectorAll(".pr-order-move")].every((b) => b.disabled);
      host.remove();
      return { dealt, afterDown, afterUp, atEdge, texts, marked, afterFreeze, disabled };
    });
    expect(r.dealt).toEqual(["l2", "l0", "l1"]);
    expect(r.afterDown).toEqual(["l0", "l2", "l1"]);
    expect(r.afterUp).toEqual(["l0", "l1", "l2"]);
    expect(r.atEdge).toEqual(["l0", "l1", "l2"]);
    expect(r.texts).toEqual(["n = 1", "n = n + 1", "print(n)"]);
    expect(r.marked).toContain("bad");
    expect(r.afterFreeze).toEqual(["l0", "l1", "l2"]);
    expect(r.disabled).toBe(true);
  });

  test("code-structure: both modes blank complementary lines", async ({ page }) => {
    await setupRun(page);
    const r = await page.evaluate((ctxSrc) => {
      const ctx = eval(ctxSrc);
      const qs = window.plp.questions.generateQuestion("code-structure", ctx, { mode: "structure" });
      const qd = window.plp.questions.generateQuestion("code-structure", ctx, { mode: "details" });
      const right = Object.fromEntries(qs.blanks.map((b) => [b.id, "  " + b.expected + "  "]));
      return {
        structureBlanked: qs.blanks.map((b) => b.expected),
        detailsBlanked: qd.blanks.map((b) => b.expected),
        gradeRight: qs.grade(right).correct,
      };
    }, ctxExpr);
    expect(r.structureBlanked).toEqual([
      "def total(prices):", "for p in prices:", "return result",
    ]);
    expect(r.detailsBlanked).toEqual([
      "result = 0", "result = result + p",
      'cart = {"apple": 3, "pear": 5}', "prices = list(cart.values())", "t = total(prices)", "print(t)",
    ]);
    expect(r.gradeRight).toBe(true);
  });

  test("code-args: call arguments blanked and graded", async ({ page }) => {
    await setupRun(page);
    const r = await page.evaluate((ctxSrc) => {
      const ctx = eval(ctxSrc);
      const q = window.plp.questions.generateQuestion("code-args", ctx, { line: 9 }); // t = total(prices)
      return {
        before: q.before,
        expected: q.blanks.map((b) => b.expected),
        right: q.grade({ b0: " prices " }).correct,
        wrong: q.grade({ b0: "cart" }).correct,
      };
    }, ctxExpr);
    expect(r.before).toBe("t = total(");
    expect(r.expected).toEqual(["prices"]);
    expect(r.right).toBe(true);
    expect(r.wrong).toBe(false);
  });

  test("trace-table: changed-only rows, givens vs blanks, elision, container-forgiving all-or-nothing grading", async ({ page }) => {
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp));
    await page.evaluate(() => window.plp.editor.setValue(
      "a = 0\nb = [1, 2]\nb = b + [3]\na = a + 1\na = a + 1\na = a + 1\nprint(a)\n"));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const r = await page.evaluate((ctxSrc) => {
      const ctx = eval(ctxSrc);
      const q = window.plp.questions.generateQuestion("trace-table", ctx, { names: ["a", "b"] });
      const right = Object.fromEntries(q.blanks.map((x) => [x.id, x.expected]));
      const bBlank = q.blanks.find((x) => x.label.endsWith("· b"));
      const tight = { ...right, [bBlank.id]: "[1,2,3]" }; // container display spacing forgiven
      const oneWrong = { ...right, [q.blanks[0].id]: "999" };
      const small = window.plp.questions.generateQuestion("trace-table", ctx, { names: ["a", "b"], maxBlanks: 3 });
      return {
        rows: q.rows.map((row) => ({
          step: row.step, line: row.line, code: row.codeText,
          cells: row.cells.map((c) => ({ name: c.name, blank: c.blank, value: c.blank ? undefined : c.value })),
        })),
        labels: q.blanks.map((x) => x.label),
        expected: q.blanks.map((x) => x.expected),
        right: q.grade(right),
        tight: q.grade(tight).correct,
        oneWrong: q.grade(oneWrong),
        smallRows: small.rows.map((row) => (row.elided ? "…" : row.line)),
        smallBlanks: small.blanks.map((x) => x.label),
        none: window.plp.questions.generateQuestion("trace-table", ctx, { names: ["zzz"] }),
        // A single computed change is not a walkthrough: `b` alone has one
        // real blank (its literal bind is a given), so the builder refuses.
        thin: window.plp.questions.generateQuestion("trace-table", ctx, { names: ["b"] }),
      };
    }, ctxExpr);
    // The print line changes nothing watched → 6 rows kept.
    expect(r.rows.map((row) => row.line)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.rows[0].code).toBe("a = 0");
    // LITERAL binds are GIVENS, not blanks — `a = 0` would be transcription.
    expect(r.rows[0].cells).toEqual([
      { name: "a", blank: false, value: "0" },
      { name: "b", blank: false, value: "—" },
    ]);
    expect(r.rows[1].cells).toEqual([
      { name: "a", blank: false, value: "0" },
      { name: "b", blank: false, value: "[1, 2]" },
    ]);
    // Computed changes are the blanks: b = b + [3], then each a = a + 1.
    expect(r.rows[2].cells).toEqual([
      { name: "a", blank: false, value: "0" },
      { name: "b", blank: true, value: undefined },
    ]);
    expect(r.labels).toEqual(["step 3 · b", "step 4 · a", "step 5 · a", "step 6 · a"]);
    expect(r.expected).toEqual(["[1, 2, 3]", "1", "2", "3"]);
    expect(r.right.correct).toBe(true);
    expect(r.tight).toBe(true); // "[1,2,3]" ≡ "[1, 2, 3]"
    expect(r.oneWrong.correct).toBe(false); // all-or-nothing
    expect(r.oneWrong.perBlank.b0).toBe(false);
    expect(Object.values(r.oneWrong.perBlank).filter(Boolean).length).toBe(3);
    // Elision under maxBlanks 3: given-only rows + the first blank fit in
    // maxBlanks−2, gap, final row's blank.
    expect(r.smallRows).toEqual([1, 2, 3, "…", 6]);
    expect(r.smallBlanks).toEqual(["step 3 · b", "step 6 · a"]);
    expect(r.none).toBeNull(); // no watched name ever binds
    expect(r.thin).toBeNull(); // <2 real blanks → not a walkthrough
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("quiz UI: constructs a memory answer and an evaluation sequence", async ({ page }) => {
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp));
    await page.evaluate(() => window.plp.editor.setValue("x = 3\n"));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    await expect(page.locator("#btn-quiz")).toBeHidden();
    await page.evaluate(() => window.plp.quiz.open());
    await expect(page.locator(".quiz-panel")).toBeVisible();
    const q = await page.evaluate(() =>
      window.plp.quiz.newQuestion("memory-construct", { position: 0 }));
    expect(q.construction.type).toBe("memory-graph");
    await expect(page.locator(".memory-construction")).toBeVisible();
    await page.locator(".construction-add-name").click();
    await page.locator(".construction-name-input").fill("x");
    await page.locator(".construction-value-kind").fill("int");
    await page.locator(".construction-value-kind").press("Enter");
    await page.locator(".construction-scalar-input").fill("3");
    const result = await page.evaluate(() => window.plp.quiz.check());
    expect(result.correct).toBe(true);
    await expect(page.locator(".memory-construction.correct")).toBeVisible();
    await page.locator(".construction-scalar-input").fill("4");
    const result2 = await page.evaluate(() => window.plp.quiz.check());
    expect(result2.correct).toBe(false);
    await expect(page.locator(".memory-construction.incorrect")).toBeVisible();

    // Common data types are suggested immediately. Advanced types stay hidden
    // until the learner searches for them, then remain fully constructible.
    await page.getByRole("button", { name: "+ Data", exact: true }).click();
    const dataType = page.locator(".construction-data-kind");
    await dataType.fill("");
    const initialTypeOptions = await dataType.evaluate((input) =>
      [...document.getElementById(input.getAttribute("list")).options].map((entry) => entry.value));
    expect(initialTypeOptions).toEqual(["list", "dict", "tuple", "set", "instance"]);
    await dataType.fill("gen");
    const filteredTypeOptions = await dataType.evaluate((input) =>
      [...document.getElementById(input.getAttribute("list")).options].map((entry) => entry.value));
    expect(filteredTypeOptions).toEqual(["generator"]);
    await dataType.press("Enter");
    await expect(page.locator(".construction-data-kind")).toHaveValue("generator");
    await expect(page.locator(".construction-description-input")).toBeVisible();

    const expression = await page.evaluate(() => {
      window.plp.editor.setValue("items += [4]\n");
      return window.plp.quiz.newQuestion("expression-sequence", { line: 1, seed: 9 });
    });
    await expect(page.locator(".evaluation-construction")).toBeVisible();
    for (const card of expression.evaluation.cards) {
      await page.locator(`.evaluation-palette-card[data-card-id="${card.id}"]`).click();
    }
    const expressionResult = await page.evaluate(() => window.plp.quiz.check());
    expect(expressionResult.correct).toBe(true);
    await expect(page.locator(".evaluation-construction.correct")).toBeVisible();

    // Trace-needing question without a run reports gracefully.
    const none = await page.evaluate(() => {
      window.plp.memory.reset();
      return window.plp.quiz.newQuestion("memory-construct");
    });
    expect(none).toBeNull();
  });
});
