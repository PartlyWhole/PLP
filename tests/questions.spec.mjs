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

  // The predict-the-error picker (expansion ladder §R3) has no generator
  // either — the KB deals the program — so it is unit-checked directly:
  // picking is single-choice per half, the palette is always all four names,
  // collect() reads the pair, and freeze() ends the interaction.
  test("renderErrorPicker: single-choice halves, the four names always, collect + freeze", async ({ page }) => {
    await page.goto(SITE);
    await page.waitForFunction(() => Boolean(window.plp?.questionUI));
    const r = await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const view = window.plp.questionUI.renderErrorPicker(host, { code: "x = 1\nprint(y)\n" });
      const lines = [...host.querySelectorAll(".pr-errline")];
      const kinds = [...host.querySelectorAll(".pr-errkind")];
      const empty = view.collect();
      lines[0].click();
      lines[1].click();          // single choice: the second pick replaces the first
      kinds[0].click();
      const picked = view.collect();
      const pickedLines = lines.filter((b) => b.classList.contains("picked")).length;
      view.applyResult({ lineOk: true, typeOk: false, actual: { line: 2, type: "TypeError" } });
      const marks = {
        lineOk: lines[1].classList.contains("ok"),
        typeBad: kinds[0].classList.contains("bad"),
        typeTruth: kinds[1].classList.contains("truth"),
      };
      view.freeze();
      lines[0].click();          // frozen: the pick does not move
      const afterFreeze = view.collect();
      const disabled = [...lines, ...kinds].every((b) => b.disabled);
      const texts = lines.map((b) => b.querySelector("code").textContent);
      const names = kinds.map((b) => b.textContent);
      host.remove();
      return { empty, picked, pickedLines, marks, afterFreeze, disabled, texts, names };
    });
    expect(r.empty).toEqual({ line: null, type: null });
    expect(r.picked).toEqual({ line: 2, type: "NameError" });
    expect(r.pickedLines).toBe(1);
    expect(r.marks).toEqual({ lineOk: true, typeBad: true, typeTruth: true });
    expect(r.afterFreeze).toEqual({ line: 2, type: "NameError" });
    expect(r.disabled).toBe(true);
    expect(r.texts).toEqual(["x = 1", "print(y)"]);
    expect(r.names).toEqual(["NameError", "TypeError", "IndexError", "KeyError"]);
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

  test("predict-state: an unbound probe asks the GONE question — every alias right, a value wrong", async ({ page }) => {
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp));
    // `m` lives only inside the frame: after the call it is gone from globals.
    await page.evaluate(() => window.plp.editor.setValue(
      "def shout(word):\n    m = word + \"!\"\n    return m\nr = shout(\"hi\")\n"));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const r = await page.evaluate((ctxSrc) => {
      const ctx = eval(ctxSrc);
      const q = window.plp.questions.generateQuestion("predict-state", ctx, { name: "m" });
      const bound = window.plp.questions.generateQuestion("predict-state", ctx, { name: "r" });
      const aliases = ["gone", "GONE", "  Nothing ", "not defined", "Not  Defined",
        "undefined", "no such name"];
      return {
        gone: q.gone,
        prompt: q.prompt,
        expected: q.grade({ text: "gone" }).expected,
        aliases: aliases.map((a) => q.grade({ text: a }).correct),
        value: q.grade({ text: '"hi!"' }).correct,
        empty: q.grade({ text: "" }).correct,
        nonsense: q.grade({ text: "None" }).correct,
        // Bound names are untouched: the value grades, "gone" does not.
        boundGone: bound.gone,
        boundRight: bound.grade({ text: "'hi!'" }).correct,
        boundGoneAnswer: bound.grade({ text: "gone" }).correct,
        boundExpected: bound.grade({ text: "" }).expected,
      };
    }, ctxExpr);
    expect(r.gone).toBe(true);
    expect(r.prompt).toContain("what does `m` hold");
    expect(r.expected).toEqual({ text: "gone", gone: true });
    expect(r.aliases).toEqual([true, true, true, true, true, true, true]);
    expect(r.value).toBe(false); // typing a value is WRONG
    expect(r.empty).toBe(false);
    expect(r.nonsense).toBe(false); // `None` is a value, not "no such name"
    expect(r.boundGone).toBeUndefined();
    expect(r.boundRight).toBe(true);
    expect(r.boundGoneAnswer).toBe(false);
    expect(r.boundExpected).toEqual({ text: '"hi!"' });
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("trace-query: counts, last-line, and mid-run values derive from the real trace", async ({ page }) => {
    await setupRun(page);
    // A while loop with 3 passes: n = 5, 3, 1 print; the header tests 4 times
    // (three true, one final false); the last executed line is the after-print.
    await page.evaluate(() => window.plp.editor.setValue('n = 5\nwhile n > 0:\n    print(n)\n    n = n - 2\nprint("done")\n'));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const r = await page.evaluate((ctxSrc) => {
      const ctx = eval(ctxSrc);
      const gen = (query) => window.plp.questions.generateQuestion("trace-query", ctx, { query });
      const body = gen({ type: "runs", line: 3 });
      const checks = gen({ type: "runs", line: 2 });
      const lastLine = gen({ type: "last-line" });
      // Produced-state convention: just after line 3's 2nd run, n still holds
      // 3 (the decrement is the NEXT line).
      const mid = gen({ type: "value-when", name: "n", line: 3, visit: 2 });
      const missingName = gen({ type: "value-when", name: "zzz", line: 3, visit: 1 });
      const missingVisit = gen({ type: "value-when", name: "n", line: 3, visit: 9 });
      return {
        bodyExpected: body.grade({}).expected.text,
        bodyRight: body.grade({ text: " 3 " }).correct,   // whitespace forgiven
        bodyWrong: body.grade({ text: "4" }).correct,
        checksExpected: checks.grade({}).expected.text,
        lastExpected: lastLine.grade({}).expected.text,
        midExpected: mid.grade({}).expected.text,
        midRight: mid.grade({ text: "3" }).correct,
        missingName, missingVisit,
      };
    }, ctxExpr);
    expect(r.bodyExpected).toBe("3");
    expect(r.bodyRight).toBe(true);
    expect(r.bodyWrong).toBe(false);
    expect(r.checksExpected).toBe("4"); // 3 passes + the failing check
    expect(r.lastExpected).toBe("5");   // print("done") is the last line to run
    expect(r.midExpected).toBe("3");
    expect(r.midRight).toBe(true);
    expect(r.missingName).toBeNull();   // unknown name → no question, fail closed
    expect(r.missingVisit).toBeNull();  // visit beyond the trace → fail closed
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("trace-table over a call: rows land on the call site; frame rows are opt-in", async ({ page }) => {
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp));
    await page.evaluate(() => window.plp.editor.setValue(
      "def double(n):\n    return n * 2\nv = 4\nx = double(v)\ny = double(x)\nprint(y)\n"));
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const r = await page.evaluate((ctxSrc) => {
      const ctx = eval(ctxSrc);
      const shape = (q) => (q?.rows ?? []).map((row) => ({
        line: row.line, frame: row.frame ?? null, code: row.codeText,
        cells: row.cells.map((c) => `${c.name}=${c.blank ? "?" : c.value}`),
      }));
      const plain = window.plp.questions.generateQuestion("trace-table", ctx, { names: ["x", "y"] });
      const framed = window.plp.questions.generateQuestion(
        "trace-table", ctx, { names: ["n", "x", "y"], frames: true });
      const framedOff = window.plp.questions.generateQuestion(
        "trace-table", ctx, { names: ["n", "x", "y"] });
      const framedRight = Object.fromEntries(framed.blanks.map((b) => [b.id, b.expected]));
      return {
        plain: shape(plain),
        plainLabels: plain.blanks.map((b) => b.label),
        framed: shape(framed),
        framedLabels: framed.blanks.map((b) => b.label),
        framedRight: framed.grade(framedRight).correct,
        framedWrong: framed.grade({ ...framedRight, [framed.blanks[0].id]: "999" }).correct,
        framedOff: shape(framedOff),
      };
    }, ctxExpr);
    // Default (frames off): module names only, attributed to the CALL lines.
    expect(r.plain).toEqual([
      { line: 4, frame: null, code: "x = double(v)", cells: ["x=?", "y=—"] },
      { line: 5, frame: null, code: "y = double(x)", cells: ["x=8", "y=?"] },
    ]);
    expect(r.plainLabels).toEqual(["step 1 · x", "step 2 · y"]);
    // frames: true walks INTO the call — the parameter bind is its own row.
    expect(r.framed).toEqual([
      { line: 4, frame: "double()", code: "x = double(v)", cells: ["n=?", "x=—", "y=—"] },
      { line: 4, frame: null, code: "x = double(v)", cells: ["n=—", "x=?", "y=—"] },
      { line: 5, frame: "double()", code: "y = double(x)", cells: ["n=?", "x=—", "y=—"] },
      { line: 5, frame: null, code: "y = double(x)", cells: ["n=—", "x=8", "y=?"] },
    ]);
    expect(r.framedLabels).toEqual([
      "step 1 · double() · n", "step 2 · x", "step 3 · double() · n", "step 4 · y",
    ]);
    expect(r.framedRight).toBe(true);
    expect(r.framedWrong).toBe(false);
    // Same names WITHOUT the flag: `n` never appears — frame rows are opt-in.
    expect(r.framedOff).toEqual(r.plain.map((row) => ({
      ...row, cells: ["n=—", ...row.cells],
    })));
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("trace-simulation: raw line occurrences preserve loop control and final output without future rows", async ({ page }) => {
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp));
    const code = "n = 0\nwhile n < 2:\n    n = n + 1\nprint(n)\n";
    await page.evaluate((source) => window.plp.editor.setValue(source), code);
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const r = await page.evaluate(({ source }) => {
      const q = window.plp.questions.generateQuestion("trace-simulation", {
        source,
        steps: window.plp.memory.steps(),
        positions: window.plp.memory.linePositions(),
      }, { names: ["n"] });
      const sequence = Array.from({ length: q.stepCount }, (_, i) => q.revealNext(i));
      const effects = sequence.slice(0, -1).map((_, i) => q.revealEffects(i));
      const before = q.step(0);
      const wrongLine = q.gradeNext(0, { kind: "line", line: 2 });
      const rightLine = q.gradeNext(0, { kind: "line", line: 1 });
      const rightEffect = q.gradeEffects(0, {
        bindings: { changed: { n: "0" }, gone: [] }, output: { writes: false },
      });
      const wrongEffect = q.gradeEffects(0, {
        bindings: { changed: {}, gone: [] }, output: { writes: false },
      });
      return { sequence, effects, before, wrongLine, rightLine, rightEffect, wrongEffect };
    }, { source: code });
    expect(r.sequence.map((x) => x.kind === "end" ? "end" : x.line))
      .toEqual([1, 2, 3, 2, 3, 2, 4, "end"]);
    // The final failed while test is a real occurrence with no state effect.
    expect(r.effects[5].bindings.changed).toEqual({});
    // The print's output arrives on the later module-return boundary but is
    // credited to the print line that produced it.
    expect(r.effects[6].output).toEqual({ writes: true, text: "2\n" });
    // The safe current-step payload contains state but never the expected line.
    expect(r.before).toEqual({ cursor: 0, total: 8, id: "e0", before: { n: null }, terminal: false });
    expect(r.wrongLine.correct).toBe(false);
    expect(r.rightLine.correct).toBe(true);
    expect(r.rightEffect.correct).toBe(true);
    expect(r.wrongEffect.correct).toBe(false);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  test("trace-simulation: same-line loop iterations split; call return resumes at the caller", async ({ page }) => {
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp));
    const sameLine = "total = 0\nfor x in [1, 2, 3]: total = total + x\nprint(total)\n";
    await page.evaluate((source) => window.plp.editor.setValue(source), sameLine);
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const repeated = await page.evaluate((source) => {
      const q = window.plp.questions.generateQuestion("trace-simulation", {
        source, steps: window.plp.memory.steps(), positions: window.plp.memory.linePositions(),
      }, { names: ["total", "x"] });
      return {
        positionCount: window.plp.memory.linePositions().length,
        lines: Array.from({ length: q.stepCount }, (_, i) => q.revealNext(i)),
        effects: Array.from({ length: q.stepCount - 1 }, (_, i) => q.revealEffects(i)),
      };
    }, sameLine);
    expect(repeated.positionCount).toBe(3); // line mode collapsed line 2
    expect(repeated.lines.map((x) => x.kind === "end" ? "end" : x.line))
      .toEqual([1, 2, 2, 2, 2, 3, "end"]);
    expect(repeated.effects.slice(1, 4).map((x) => x.bindings.changed.total)).toEqual(["1", "3", "6"]);
    expect(repeated.effects[4].bindings.changed).toEqual({}); // exhaustion pass

    const call = "def double(n):\n    result = n * 2\n    return result\nx = double(3)\nprint(x)\n";
    await page.evaluate((source) => window.plp.editor.setValue(source), call);
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const called = await page.evaluate((source) => {
      const q = window.plp.questions.generateQuestion("trace-simulation", {
        source, steps: window.plp.memory.steps(), positions: window.plp.memory.linePositions(),
      }, { names: ["x"] });
      return {
        lines: Array.from({ length: q.stepCount }, (_, i) => q.revealNext(i)),
        effects: Array.from({ length: q.stepCount - 1 }, (_, i) => q.revealEffects(i)),
      };
    }, call);
    // The raw call-event header is not presented as if `def` ran again.
    expect(called.lines.map((x) => x.kind === "end" ? "end" : `${x.function}:${x.line}`))
      .toEqual(["<module>:1", "<module>:4", "double:2", "double:3", "<module>:5", "end"]);
    expect(called.effects[3].returnValue).toBe("6");
    expect(called.effects[3].bindings.changed).toEqual({ x: "6" });
    expect(called.effects[3].attribution.x).toMatchObject({
      kind: "caller-resume", line: 4, function: "<module>",
    });
    expect(called.lines[4]).toMatchObject({ kind: "line", line: 5 });

    // Progressive grading keeps the legacy trace-table forgiveness for
    // equivalent container spellings, including dictionary key order.
    const containerCode = "d = {'a': 1, 'b': 2}\nprint(d)\n";
    await page.evaluate((source) => window.plp.editor.setValue(source), containerCode);
    expect((await page.evaluate(() => window.plp.trace())).terminal_reason).toBe("completed");
    const containerGrade = await page.evaluate((source) => {
      const q = window.plp.questions.generateQuestion("trace-simulation", {
        source, steps: window.plp.memory.steps(), positions: window.plp.memory.linePositions(),
      }, { names: ["d"] });
      return q.gradeEffects(0, {
        bindings: { changed: { d: "{'b': 2, 'a': 1}" }, gone: [] },
        output: { writes: false },
      });
    }, containerCode);
    expect(containerGrade.correct).toBe(true);
    expect(containerGrade.perField.changedValues).toBe(true);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  });

  // The growing one-line-box widget (question-ui.createLinesInput) is the
  // answer surface for every several-line ask. It has no generator either, so
  // it is unit-checked directly: one box to start (the count must never hint
  // at how many lines print), Enter as the line-structure key, empty-Enter as
  // the submit gesture, and a collect() byte-identical to the old textarea's.
  test("createLinesInput: one box to start, Enter grows/moves, empty-Enter submits, Backspace merges, paste splits", async ({ page }) => {
    await page.goto(SITE);
    await page.waitForFunction(() => Boolean(window.plp?.questionUI));
    const r = await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      let submits = 0;
      const view = window.plp.questionUI.createLinesInput({
        placeholder: "one line…", onSubmit: () => { submits += 1; },
      });
      host.appendChild(view.el);
      const boxes = () => [...host.querySelectorAll("input.tutor-lines-input")];
      const key = (input, k) => {
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
      };
      const type = (i, text) => { const b = boxes()[i]; b.focus(); b.value = text; };
      const out = {};
      out.startCount = boxes().length;
      out.groupLabel = view.el.getAttribute("aria-label");
      out.role = view.el.getAttribute("role");
      out.hardened = boxes().every((b) => b.spellcheck === false
        && b.getAttribute("autocapitalize") === "off"
        && b.getAttribute("autocorrect") === "off"
        && b.getAttribute("autocomplete") === "off");
      out.firstHasNoDelete = boxes()[0].parentElement.querySelector(".tutor-lines-del").hidden;

      // Enter on a non-empty LAST box appends and focuses the new one.
      type(0, "alpha");
      key(boxes()[0], "Enter");
      out.afterEnter = boxes().length;
      out.focusedIsLast = document.activeElement === boxes()[1];
      out.secondHasDelete = boxes()[1].parentElement.querySelector(".tutor-lines-del").hidden === false;
      out.labels = boxes().map((b) => b.getAttribute("aria-label"));

      // Enter on a NON-last box only moves the focus (never adds).
      type(1, "beta");
      key(boxes()[0], "Enter");
      out.afterMove = { count: boxes().length, focusedIndex: boxes().indexOf(document.activeElement) };

      // "+ another line" is the no-keyboard path.
      host.querySelector(".tutor-lines-add").click();
      out.afterAdd = boxes().length;

      // Backspace at the start of an empty non-first box merges upward.
      key(boxes()[2], "Backspace");
      out.afterBackspace = { count: boxes().length, focusedIndex: boxes().indexOf(document.activeElement) };

      // Arrows walk the boxes.
      key(boxes()[1], "ArrowUp");
      out.afterUp = boxes().indexOf(document.activeElement);
      key(boxes()[0], "ArrowDown");
      out.afterDown = boxes().indexOf(document.activeElement);

      // collect() joins with "\n" and drops trailing empties — exactly the
      // string the old textarea produced.
      out.collected = view.collect();
      host.querySelector(".tutor-lines-add").click();
      out.collectedTrailingEmpty = view.collect();

      // Paste with newlines splits from the box pasted into.
      const target = boxes()[boxes().length - 1];
      target.focus();
      target.value = "";
      target.setSelectionRange(0, 0);
      const dt = new DataTransfer();
      dt.setData("text", "one\ntwo\nthree");
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      out.afterPaste = boxes().map((b) => b.value);

      // The submit gesture: Enter on an EMPTY last box drops it and submits.
      view.setValue("alpha\nbeta");
      out.afterSetValue = boxes().map((b) => b.value);
      key(boxes()[1], "Enter");            // grows
      out.beforeSubmit = boxes().length;
      key(boxes()[2], "Enter");            // empty last box → drop + submit
      out.submits = submits;
      out.afterSubmit = { count: boxes().length, text: view.collect().text };

      // One empty box alone: nothing to submit.
      view.setValue("");
      key(boxes()[0], "Enter");
      out.submitsAfterLone = submits;

      // Marking + freezing.
      view.setValue("alpha\nbeta");
      view.applyResult({ correct: false });
      out.marked = boxes().every((b) => b.classList.contains("bad"));
      view.applyResult({ correct: true });
      out.markedOk = boxes().every((b) => b.classList.contains("ok") && !b.classList.contains("bad"));
      view.freeze();
      out.frozen = boxes().every((b) => b.disabled)
        && [...host.querySelectorAll(".tutor-lines button")].every((b) => b.disabled);
      key(boxes()[0], "Enter");
      out.frozenNoGrowth = boxes().length;
      host.remove();
      return out;
    });
    expect(r.startCount).toBe(1);          // never hint at the number of lines
    expect(r.role).toBe("group");
    expect(r.groupLabel).toBeTruthy();
    expect(r.hardened).toBe(true);
    expect(r.firstHasNoDelete).toBe(true);
    expect(r.afterEnter).toBe(2);
    expect(r.focusedIsLast).toBe(true);
    expect(r.secondHasDelete).toBe(true);
    expect(r.labels).toEqual(["output line 1", "output line 2"]);
    expect(r.afterMove).toEqual({ count: 2, focusedIndex: 1 });
    expect(r.afterAdd).toBe(3);
    expect(r.afterBackspace).toEqual({ count: 2, focusedIndex: 1 });
    expect(r.afterUp).toBe(0);
    expect(r.afterDown).toBe(1);
    expect(r.collected).toEqual({ text: "alpha\nbeta" });
    expect(r.collectedTrailingEmpty).toEqual({ text: "alpha\nbeta" });
    expect(r.afterPaste).toEqual(["alpha", "beta", "one", "two", "three"]);
    expect(r.afterSetValue).toEqual(["alpha", "beta"]);
    expect(r.beforeSubmit).toBe(3);
    expect(r.submits).toBe(1);
    expect(r.afterSubmit).toEqual({ count: 2, text: "alpha\nbeta" });
    expect(r.submitsAfterLone).toBe(1);    // a lone empty box submits nothing
    expect(r.marked).toBe(true);
    expect(r.markedOk).toBe(true);
    expect(r.frozen).toBe(true);
    expect(r.frozenNoGrowth).toBe(2);
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
