// Editor durability uses a real persistent Chromium profile so this test
// crosses a browser-process shutdown, not only an in-page reload.

import { test, expect, chromium } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE = new URL("/PLP/", process.env.PLP_BASE_URL ?? "http://127.0.0.1:8633").href;

async function openApp(profile) {
  const context = await chromium.launchPersistentContext(profile, { headless: true });
  const pages = context.pages();
  const page = pages.length ? pages[0] : await context.newPage();
  await page.goto(SITE);
  await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.plp));
  return { context, page };
}

test("editor code survives reload and a browser restart", async () => {
  const profile = mkdtempSync(join(tmpdir(), "plp-editor-profile-"));
  let context = null;
  const source = "persisted_after_restart = [1, 2, 3]\n";

  try {
    let opened = await openApp(profile);
    context = opened.context;
    let page = opened.page;

    await page.evaluate((code) => window.plp.editor.setValue(code), source);
    await page.reload();
    await page.waitForFunction(() => crossOriginIsolated === true && Boolean(window.plp));
    expect(await page.evaluate(() => window.plp.editor.getValue())).toBe(source);

    await context.close();
    context = null;

    opened = await openApp(profile);
    context = opened.context;
    page = opened.page;
    expect(await page.evaluate(() => window.plp.editor.getValue())).toBe(source);
    expect((await page.evaluate(() => window.plp.run())).terminal_reason).toBe("completed");
    expect(await page.evaluate(() => window.plp.checkErrors())).toEqual([]);
  } finally {
    await context?.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
