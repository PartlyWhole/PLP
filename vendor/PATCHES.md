> Note: this vendor tree was copied verbatim from the Engine Pilot reference
> repo (~/Pilot) for the PLP site; the provenance/patch records below are
> inherited from there and remain accurate (same bytes, same single worker.mjs
> divergence).

# Vendored-artifact patches

Exactly **one** vendored file diverges from its audited upstream bytes:
`vendor/pytrace/browser/worker.mjs`. Everything else in `vendor/` is
byte-identical to upstream (see PROVENANCE.md hashes; the worker's upstream
hash is recorded there too so the divergence is explicit).

## Why

Upstream `worker.mjs` loads Pyodide from the **origin-root-absolute** path
`/node_modules/pyodide/…`. That resolves only when the app is served at the
origin root. This site deploys as a GitHub Pages **project site**
(`https://partlywhole.github.io/<repo>/`), a user-approved decision (plan §2,
D1), so the vendored copy resolves Pyodide **relative to the worker file**
instead: `vendor/pytrace/browser/worker.mjs` → `../../pyodide/` →
`vendor/pyodide/`.

The import stays a **static import with a relative specifier** (relative
specifiers resolve against the importing module's URL), so upstream's module
structure and evaluation order are preserved exactly. (An earlier draft used
top-level `await import(...)`; it was discarded because suspending module
evaluation races the host's initialize message — the static form has no such
hazard and was verified live.)

## Exact diff vs upstream (`~/Desktop/PyTrace/browser/worker.mjs`, checkpoint `cef3cb0`)

```diff
@@ -1,4 +1,7 @@
-import { loadPyodide } from "/node_modules/pyodide/pyodide.mjs";
+// PILOT-SITE PATCH 1/2 (vendor/PATCHES.md): resolve Pyodide relative to this
+// file instead of the origin root, so the site works from a GitHub Pages
+// project path (/<repo>/). Upstream specifier: "/node_modules/pyodide/pyodide.mjs"
+import { loadPyodide } from "../../pyodide/pyodide.mjs";
 
 import {
   INPUT_CANCELLED,
@@ -57,7 +60,8 @@ async function initialize(message) {
     ({ bytes: stdinBytes, header: stdinHeader } = inputViews(message.stdinBuffer));
   }
   pyodide = await loadPyodide({
-    indexURL: new URL("/node_modules/pyodide/", self.location.origin).href,
+    // PILOT-SITE PATCH 2/2 (vendor/PATCHES.md). Upstream: new URL("/node_modules/pyodide/", self.location.origin).href
+    indexURL: new URL("../../pyodide/", import.meta.url).href,
   });
   if (interruptView) {
     pyodide.setInterruptBuffer(interruptView);
```

## Coverage

Every PyTrace path in the site's smoke suite (`tests/smoke.spec.mjs`) runs
through this patched worker, so the patch is exercised by trace runs, live
input, cooperative interrupt, degraded-mode kill, and the coexistence test.

## Rules

- Any further divergence from upstream bytes requires renewed user approval
  (plan §8).
- If upstream PyTrace changes, re-vendor and re-apply exactly this patch;
  update both this file and PROVENANCE.md.
