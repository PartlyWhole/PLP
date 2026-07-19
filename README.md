# PLP — Python Learning Platform

A minimal, build-free static site that runs Python in the browser (Pyodide via
the PyTrace engine) with:

- **Code editor** (left, CodeMirror 5)
- **Memory model** (right): a Names table (globals + call-stack frames) and an
  Objects table (heap: id, type, contents), updating live while the program
  runs, with a step scrubber to replay execution
- **Console** (bottom): terminal-style interleaved stdout/stderr with inline
  `input()` answering
- All panes drag-resizable and maximizable

## Run locally

```sh
node tools/dev-server.mjs          # http://127.0.0.1:8619/PLP/  (GitHub Pages simulation, COI via service worker)
node tools/dev-server.mjs --coi    # same, with real COOP/COEP headers
```

The site must be served under the `/PLP/` prefix (the dev server does this) —
it deploys as a GitHub Pages *project* site.

`?nonisolated` on the URL demonstrates degraded mode (no live input; runs that
ask for input end `needs_input`; Stop hard-kills).

## Test

```sh
npm install
npx playwright test        # add PW_ALL_BROWSERS=1 for firefox+webkit
```

Tests drive the app through the `window.plp` debug API.

## Notes

- Vendored runtime (`vendor/`): Pyodide 314.0.2, PyTrace engine 0.1.0,
  CodeMirror 5.65.21 — copied from the Engine Pilot reference repo; see
  `vendor/PROVENANCE.md` and `vendor/PATCHES.md` (one deliberate divergence:
  `pytrace/browser/worker.mjs` resolves Pyodide relative to itself so the
  site works from a project sub-path).
- First run downloads ~12 MB of runtime; subsequent runs are instant.
- `.nojekyll` is required (GitHub Pages/Jekyll would drop files otherwise).
