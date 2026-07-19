import { defineConfig, devices } from "@playwright/test";

// The dev server intentionally sends NO COOP/COEP headers: tests exercise
// the coi-serviceworker path exactly as GitHub Pages will serve it, under
// the simulated /PLP/ project prefix.
const PORT = 8631;

const browsers = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
];
if (process.env.PW_ALL_BROWSERS) {
  browsers.push(
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  );
}

export default defineConfig({
  testDir: "tests",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1, // one Pyodide interpreter per page; serialize for stability
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command: `node tools/dev-server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/PLP/index.html`,
    reuseExistingServer: false,
  },
  projects: browsers,
});
