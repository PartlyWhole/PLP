// F-series: untraced ("fast") execution path — the way large programs run.
// PyTrace always traces and stops at max_steps, so anything beyond a few
// thousand executed lines can only finish on this path (app/fastrun.mjs).

import { test, expect } from "@playwright/test";

const SITE = "/PLP/";

// Far beyond the engine's max_steps (1000) when traced.
const BIG = "total = 0\nfor i in range(200000):\n    total += i\nprint('sum:', total)\n";

async function boot(page) {
  await page.goto(SITE);
  await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.plp));
}

test.describe("F-series: untraced execution", () => {
  test("F1: a program far past max_steps completes untraced, with correct output", async ({ page }) => {
    await boot(page);
    await page.evaluate((src) => window.plp.editor.setValue(src), BIG);
    const summary = await page.evaluate(() => window.plp.run(), null);
    expect(summary.terminal_reason).toBe("completed");
    expect(summary.traced).toBe(false);
    expect(await page.evaluate(() => window.plp.console.text())).toContain("sum: 19999900000");
    // Untraced means untraced: no records, nothing for the memory model.
    expect(await page.evaluate(() => window.plp.memory.steps().length)).toBe(0);
  });

  test("F2: Trace on a too-large program reports the budget and points at Run", async ({ page }) => {
    await boot(page);
    await page.evaluate((src) => window.plp.editor.setValue(src), BIG);
    const summary = await page.evaluate(() => window.plp.trace());
    // Honest: asking to trace does not silently re-execute the program.
    expect(summary.terminal_reason).toBe("step_limit");
    const state = await page.evaluate(() => ({
      screen: window.plp.console.buffer(),
      steps: window.plp.memory.steps().length,
    }));
    expect(state.screen).toContain("step limit reached");
    expect(state.screen).toContain("press Run to execute the whole program");
    // The truncated trace stays on screen: the first max_steps are scrubbable.
    expect(state.steps).toBe(1000);

    // Opt-in: auto-fallback re-runs it untraced in one press.
    await page.evaluate(() => window.plp.runner.setAutoFallback(true));
    const fell = await page.evaluate(() => window.plp.trace());
    expect(fell.terminal_reason).toBe("completed");
    expect(fell.traced).toBe(false);
    expect(await page.evaluate(() => window.plp.console.text())).toContain("sum: 19999900000");
    expect(await page.evaluate(() => window.plp.memory.steps().length)).toBe(1000);
    await page.evaluate(() => window.plp.runner.setAutoFallback(false));
  });

  test("F3: input() blocks and echoes exactly once, same as the traced path", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.plp.editor.setValue(
      'name = input("Your name? ")\nfor i in range(50000):\n    pass\nprint("hi", name)\n'));
    await page.evaluate(() => { window.__run = window.plp.run(); });
    await page.waitForFunction(() => window.plp.console.isWaiting(), null, { timeout: 120_000 });
    await page.evaluate(() => window.plp.provideInput("Ada"));
    const summary = await page.evaluate(() => window.__run);
    expect(summary.terminal_reason).toBe("completed");
    const text = await page.evaluate(() => window.plp.console.text());
    expect(text).toContain("Your name? Ada");
    expect(text).toContain("hi Ada");
    expect(text.match(/Ada/g)).toHaveLength(2); // prompt echo + program output, no double echo
  });

  test("F4: Stop interrupts an untraced infinite loop", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.plp.editor.setValue('print("looping")\nwhile True:\n    pass\n'));
    await page.evaluate(() => { window.__run = window.plp.run(); });
    await page.waitForFunction(() => window.plp.console.text().includes("looping"), null, { timeout: 120_000 });
    expect(await page.evaluate(() => window.plp.runner.isRunning())).toBe(true);
    await page.evaluate(() => window.plp.interrupt());
    const summary = await page.evaluate(() => window.__run);
    expect(summary.terminal_reason).toBe("interrupted");
    expect(await page.evaluate(() => window.plp.runner.isRunning())).toBe(false);
  });

  test("F4b: Stop while waiting at input() always ends the run", async ({ page }) => {
    // Regression: interrupting at the stdin rendezvous wakes the worker and
    // Pyodide consumes the SIGINT, but runPythonAsync never settles — the
    // run hung forever (and in a room, wedged every peer). The host now
    // forces an ending if the worker misses the interrupt deadline.
    await boot(page);
    await page.evaluate(() => window.plp.editor.setValue('name = input("Who? ")\nprint("hi", name)\n'));
    await page.evaluate(() => { window.__run = window.plp.run(); });
    await page.waitForFunction(() => window.plp.console.isWaiting(), null, { timeout: 120_000 });

    await page.evaluate(() => window.plp.interrupt());
    const summary = await page.evaluate(() => window.__run);   // must not hang
    expect(["interrupted", "killed", "uncaught_exception"]).toContain(summary.terminal_reason);
    expect(await page.evaluate(() => window.plp.runner.isRunning())).toBe(false);
    // The terminal must stop showing a live prompt.
    expect(await page.evaluate(() => window.plp.console.isWaiting())).toBe(false);

    // The runner is reusable afterwards (the worker may have been replaced).
    const next = await page.evaluate(() => {
      window.plp.editor.setValue("print('still works')\n");
      return window.plp.run();
    });
    expect(next.terminal_reason).toBe("completed");
    expect(await page.evaluate(() => window.plp.console.text())).toContain("still works");
  });

  test("F5: tracebacks show only the learner's frames, never engine internals", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.plp.editor.setValue(
      'def half(n):\n    return n // 0\n\nprint("before")\nprint(half(4))\n'));
    const summary = await page.evaluate(() => window.plp.run());
    expect(summary.terminal_reason).toBe("uncaught_exception");
    const text = await page.evaluate(() => window.plp.console.text());
    expect(text).toContain("ZeroDivisionError: division by zero");
    expect(text).toContain("line 2, in half");   // the learner's call chain survives
    expect(text).not.toContain("_pyodide");      // engine frames do not
    expect(text).not.toContain("eval_code_async");
    expect(text).not.toContain("python314.zip");
  });

  test("F6: Run and Trace are distinct — only Trace fills the memory model", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.plp.editor.setValue('x = 1\ny = x + 2\nprint("y is", y)\n'));

    const traced = await page.evaluate(() => window.plp.trace());
    expect(traced.terminal_reason).toBe("completed");
    expect(traced.traced).toBeUndefined();       // traced summaries come from the engine
    expect(await page.evaluate(() => window.plp.memory.steps().length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);

    // The default Run executes the same program with no trace at all.
    const plain = await page.evaluate(() => window.plp.run());
    expect(plain.terminal_reason).toBe("completed");
    expect(plain.traced).toBe(false);
    expect(await page.evaluate(() => window.plp.console.text())).toContain("y is 3");
    expect(await page.evaluate(() => window.plp.memory.steps().length)).toBe(0);
  });
});
