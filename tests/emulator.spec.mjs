// X-series: full-emulator console acceptance tests (VALIDATION.md).
// Evidence surface is xterm's screen-buffer API + the chunk store — state,
// never pixels.

import { test, expect } from "@playwright/test";

const SITE = "/PLP/";

async function gotoIsolated(page) {
  await page.goto(SITE);
  await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.plp));
}

async function runProgram(page, source) {
  await page.evaluate((src) => window.plp.editor.setValue(src), source);
  return page.evaluate(() => window.plp.run());
}

test.describe("PLP emulator (X-series)", () => {
  test("X0a/X0b: chunk store matches engine reconstruction; replay is deterministic", async ({ page }) => {
    await gotoIsolated(page);
    const summary = await runProgram(page, 'import sys\nprint("out1")\nsys.stderr.write("err1\\n")\nprint("out2")\n');
    expect(summary.terminal_reason).toBe("completed");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);

    // X0a: engineText() equals the deltas in arrival order (stdout then
    // stderr per step, as the runner appends them).
    const { engineText, expected } = await page.evaluate(() => {
      const steps = window.plp.records().filter((r) => r.kind === "step");
      let expected = "";
      for (const s of steps) expected += (s.output?.stdout_delta ?? "") + (s.output?.stderr_delta ?? "");
      return { engineText: window.plp.console.engineText(), expected };
    });
    expect(engineText).toBe(expected);

    // X0b: scrub away and back — buffer byte-identical.
    const before = await page.evaluate(() => window.plp.console.buffer());
    await page.evaluate(() => window.plp.memory.goTo(0));
    await page.evaluate(() => window.plp.memory.goTo(window.plp.memory.stepCount() - 1));
    await expect.poll(() => page.evaluate(() => window.plp.console.buffer())).toBe(before);
  });

  test("X2: \\r overwrites render as a progress line, not accumulated lines", async ({ page }) => {
    await gotoIsolated(page);
    const summary = await runProgram(page,
      'for i in range(5):\n    print(f"\\r{i * 25}%", end="")\nprint()\nprint("done")\n');
    expect(summary.terminal_reason).toBe("completed");
    const buffer = await page.evaluate(() => window.plp.console.buffer());
    const progressLines = buffer.split("\n").filter((l) => l.includes("%"));
    expect(progressLines).toEqual(["100%"]); // one line, final value only
    expect(buffer).toContain("done");
  });

  test("X3: ANSI SGR colors land as cell attributes", async ({ page }) => {
    await gotoIsolated(page);
    const summary = await runProgram(page, 'print("\\x1b[31mred\\x1b[0m plain")\n');
    expect(summary.terminal_reason).toBe("completed");
    const cells = await page.evaluate(() => {
      const buf = window.plp.console.term.buffer.active;
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y);
        const s = line?.translateToString(true) ?? "";
        if (s.startsWith("red plain")) {
          const r = line.getCell(0); // 'r' of red
          const p = line.getCell(4); // 'p' of plain
          return { redFg: r.getFgColor(), redIsPalette: r.isFgPalette(), plainDefault: p.isFgDefault() };
        }
      }
      return null;
    });
    expect(cells).not.toBeNull();
    expect(cells.redIsPalette).toBeTruthy();
    expect(cells.redFg).toBe(1); // ANSI red
    expect(cells.plainDefault).toBeTruthy();
  });

  test("X6/X7: inline typing with editing + echo exactly once (engine echo off)", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue('name = input("Name? ")\nprint("hi", name)\n'));
    await page.evaluate(() => { window.__run = window.plp.run(); });
    await page.waitForFunction(() => window.plp.console.isWaiting(), null, { timeout: 180_000 });

    // X6 precondition: live-mode run disables the engine's echo.
    const echoOpt = await page.evaluate(() =>
      window.plp.records().find((r) => r.kind === "header").options.echo_stdin);
    expect(echoOpt).toBe(false);

    // X7: type with a correction — "Anx" ⌫ "n" → "Ann".
    await page.click("[data-role=console-term]");
    await page.keyboard.type("Anx");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("n");
    await page.keyboard.press("Enter");

    const summary = await page.evaluate(() => window.__run);
    expect(summary.terminal_reason).toBe("completed");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);

    // X6: the line appears exactly once on screen and once in the transcript.
    const buffer = await page.evaluate(() => window.plp.console.buffer());
    expect(buffer.match(/Ann/g)).toHaveLength(2); // "Name? Ann" + "hi Ann"
    expect(buffer).toContain("Name? Ann");
    expect(buffer).toContain("hi Ann");
    expect((await page.evaluate(() => window.plp.console.text())).match(/Ann/g)).toHaveLength(2);
  });

  test("X9: Ctrl+C in the terminal interrupts the run (cooperative under COI)", async ({ page }) => {
    await gotoIsolated(page);
    await page.evaluate(() => window.plp.editor.setValue(
      // ms-scale C work per iteration so the interrupt lands in bytecode
      "while True:\n    s = sum(range(100_000))\n"));
    await page.evaluate(() => { window.__run = window.plp.run(); });
    await page.waitForFunction(() => window.plp.memory.steps().length > 5, null, { timeout: 180_000 });
    await page.click("[data-role=console-term]");
    await page.keyboard.press("Control+C");
    const summary = await page.evaluate(() => window.__run);
    expect(summary.terminal_reason).toBe("interrupted");
    expect(summary.trace_complete).toBe(true);
  });

  test("X11: flood stays responsive; transcript complete; scrollback bounded", async ({ page }) => {
    await gotoIsolated(page);
    // map/join run at C level: floods output without flooding trace steps
    // (a per-iteration Python loop would trip max_steps first).
    const summary = await runProgram(page, 'print("\\n".join(map("line {}".format, range(1500))))\n');
    expect(summary.terminal_reason).toBe("completed");
    // Transcript fidelity: every line is in the store.
    const text = await page.evaluate(() => window.plp.console.text());
    expect(text).toContain("line 0\n");
    expect(text).toContain("line 1499\n");
    // Screen holds the tail; buffer length bounded by scrollback + viewport.
    const { bufLines, scrollback, rows, tail } = await page.evaluate(() => {
      const t = window.plp.console.term;
      return {
        bufLines: t.buffer.active.length,
        scrollback: t.options.scrollback,
        rows: t.rows,
        tail: window.plp.console.buffer().split("\n").at(-2) ?? "",
      };
    });
    expect(bufLines).toBeLessThanOrEqual(scrollback + rows);
    expect(tail).toContain("line 149"); // tail region shows the end of output
    // Responsiveness probe: the page answers quickly after the flood.
    const t0 = Date.now();
    await page.evaluate(() => 1 + 1);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test("X12/X14: fit on maximize; zero cross-origin requests", async ({ page }, testInfo) => {
    const external = [];
    const expectedOrigin = new URL(testInfo.project.use.baseURL).origin;
    page.on("request", (req) => {
      if (new URL(req.url()).origin !== expectedOrigin) external.push(req.url());
    });
    await gotoIsolated(page);
    const summary = await runProgram(page, 'print("x" * 200)\n'); // long line for wrap check
    expect(summary.terminal_reason).toBe("completed");

    // The console pane is already full-width; maximizing grows its HEIGHT.
    const rowsBefore = await page.evaluate(() => window.plp.console.term.rows);
    await page.click('#console-pane [data-max="console-pane"]');
    await expect.poll(() => page.evaluate(() => window.plp.console.term.rows)).toBeGreaterThan(rowsBefore);
    // Replay after resize keeps the long line intact end-to-end.
    await page.evaluate(() => window.plp.memory.goTo(0));
    await page.evaluate(() => window.plp.memory.goTo(window.plp.memory.stepCount() - 1));
    // term.write is async — poll until the replay lands.
    await expect.poll(() => page.evaluate(() => window.plp.console.buffer().replace(/\n/g, "")))
      .toContain("x".repeat(200));
    await page.keyboard.press("Escape"); // restore
    expect(external).toEqual([]); // X14: fully self-contained (COEP-safe)
  });
});
