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
  const summary = await page.evaluate(() => window.plp.run());
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

  test("quiz pilot UI: renders a memory question, checks answers", async ({ page }) => {
    await setupRun(page);
    await page.click("#btn-quiz");
    await expect(page.locator(".quiz-panel")).toBeVisible();
    const q = await page.evaluate(() =>
      window.plp.quiz.newQuestion("memory-next-line", { from: 1, to: 2 }));
    expect(q.blanks.length).toBe(1);
    await page.fill('.quiz-panel input[data-blank]', "[3, 5]");
    const result = await page.evaluate(() => window.plp.quiz.check());
    expect(result.correct).toBe(true);
    await expect(page.locator(".quiz-panel input.ok")).toHaveCount(1);
    // Wrong answer marks the blank and reveals the expected value on hover.
    await page.fill('.quiz-panel input[data-blank]', "[5, 3]");
    const result2 = await page.evaluate(() => window.plp.quiz.check());
    expect(result2.correct).toBe(false);
    await expect(page.locator(".quiz-panel input.bad")).toHaveCount(1);
    // Trace-needing question without a run reports gracefully.
    const none = await page.evaluate(() => {
      window.plp.memory.reset();
      return window.plp.quiz.newQuestion("memory-next-line");
    });
    expect(none).toBeNull();
  });
});
