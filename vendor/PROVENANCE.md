# Vendored artifact provenance

Engines are consumed **read-only** from their local repositories.
Re-verify with: `shasum -a 256 -c` style comparison of the table below.

| Source | Checkpoint |
|---|---|
| ~/Desktop/PyGameEngine (pygame-host) | `29448b0` |
| ~/Desktop/PyTrace (pytrace-engine 0.1.0) | `cef3cb0` |

## File hashes (sha256)

```
667d0e7014be9a508987e0fa93e0a56f8cdd281fef24503b4f91812cf6726702  vendor/pygame-host/schema/pygame-host-1.schema.json
b391a5f90d845be387a01a11d47b3252e90adc6e7441ab2d3a134b1b2a9b48aa  vendor/pygame-host/src/host.mjs
64d3f939579539c89bcb569f53f43bdb3442750b52fbdd29d1c034846fd87419  vendor/pygame-host/src/py/runtime.py
f862c7ed11ad398fffdb82fb9bb1b82abfb45b3f6653a6e31af950ca4b670ec7  vendor/pygame-host/src/py/transform.py
c963d22858f6bcb8f41586a2142f03905ab370c88ea22a86a2736e95fac2a8f3  vendor/pyodide/pyodide-lock.json
c7eccdfeb7a8419d61f910f0685b45cd5610b7ff5bbe844c3c1050ee6623b641  vendor/pyodide/pyodide.asm.mjs
f7a8a169e513791e18fa0790fb69d6f2656b779e9012ba57e03e973f0df0b39f  vendor/pyodide/pyodide.asm.wasm
955d2088bbb7fc79a73c4802aca2370c1d95bfdfaffa4121e0faebda2b0ea3f9  vendor/pyodide/pyodide.mjs
101a9c94ca6304c1478c89b7b595136b9a51b4289bdc5b467d86db553efee9b3  vendor/pyodide/python_stdlib.zip
ff89b87b38e2ef42bb89020afe73edf19e394ad14bcf350ddb36de85401701a1  vendor/pytrace/browser/host.mjs
037dd13182641b54f57060aeb09b4e717e3cd94a04370d2751cb87eceae76836  vendor/pytrace/browser/protocol.mjs
abfc382850715421b596986c9b7f7e1b42a7cbfe36a38dd3326d1c5e5a471975  vendor/pytrace/browser/validation.mjs
78025c94d6b05c9050706d6bc45312d24707f014b5c4c5bfbdab201d0b6c5fd2  vendor/pytrace/browser/worker.mjs
4f7fd124a0a1eed09dff069dc1e3d2d030a052ce1dc27705290deec343c4a19b  vendor/pytrace/dist/pytrace_engine-0.1.0-py3-none-any.whl
94f26e2b91a65d4928e66f05115f4a005b9e724d360c79485aa50abbdf49fb3b  vendor/pytrace/schema/trace-engine-1.schema.json
```

## Notes

- `vendor/pytrace/browser/worker.mjs` is the ONLY file that differs from
  upstream bytes (see PATCHES.md). Upstream hash for comparison:
  `3412aa66684ce08c8484e04054e46707bf1d249f42744e204547262e8c972f00`
- `vendor/pyodide/` core files come from PyTrace's pinned npm package
  (pyodide 314.0.2, `~/Desktop/PyTrace/node_modules/pyodide/`).
- Third-party additions (pygame-ce wheel, coi-serviceworker, CodeMirror 5)
  are appended below when vendored, with their origin URLs.

## Third-party additions (pinned, fetched 2026-07-16)

```
cb4110ae867f54702354a50c98a8c07adb30a23fb2922421ae593c1f307b117d  vendor/pyodide/pygame_ce-2.5.7-cp314-cp314-pyemscripten_2026_0_wasm32.whl
d12bd536e27e39a773d7dc7adb1a1167d24002293e97ac81c995fb00cf8d4d5a  coi-serviceworker.js
eb494ea972d2661ef86f7f6ac656dd6786d721e49c9c1b46e1eb967e4b6f9bf3  vendor/codemirror/codemirror.css
e98aac5ffa07bae58acd4ff07c4293059f8921c0ae0eba506929d8c6f41c9288  vendor/codemirror/codemirror.js
19a59ca387addb04e95002c9adbe2b8c231427ce49369ac537107e3088a6947c  vendor/codemirror/python.js
```

| File | Origin | Integrity |
|---|---|---|
| pygame_ce wheel | https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pygame_ce-2.5.7-cp314-cp314-pyemscripten_2026_0_wasm32.whl | sha256 matches `vendor/pyodide/pyodide-lock.json` entry exactly |
| coi-serviceworker.js | https://cdn.jsdelivr.net/npm/coi-serviceworker@0.1.7/coi-serviceworker.js (MIT) | pinned 0.1.7 |
| CodeMirror 5 | https://cdn.jsdelivr.net/npm/codemirror@5.65.21/ (MIT): lib/codemirror.js, lib/codemirror.css, mode/python/python.js | pinned 5.65.21 |

## xterm.js (added 2026-07-18, PLP full-emulator console)

From npm tarballs `@xterm/xterm@6.0.0` and `@xterm/addon-fit@0.11.0` (both
MIT; LICENSE vendored at `vendor/xterm/LICENSE`). Self-contained ESM
bundles — zero imports, no CDN/network use, COEP-safe.

```
b336ec65a086c056d4804b3d4c2347da5663d3f23c3f25be866467bd8857ad59  vendor/xterm/xterm.mjs
854a7c0fb70e8b1a083c16797ab827299fb18744f5ad34f227b48337e33293c6  vendor/xterm/xterm.css
2d87e1bddc73be9111de8beee5370c3bb7aac9c94e18e6f245f02ca741ef1769  vendor/xterm/addon-fit.mjs
b569f629d00f2626a8100df2a1798210535621e42164dfd426a6fe5aac7b0ccd  vendor/xterm/LICENSE
```

## automerge-collab bundle (added 2026-07-18, live collaboration)

`vendor/automerge-collab.mjs` is BUILT (not fetched): esbuild bundle of
pinned npm packages, recipe + lockfile in `tools/collab-vendor-build/`
(recipe adapted from the pygame-playground repo, the origin of this
collaboration stack). Rebuild with `cd tools/collab-vendor-build && npm
install && npm run build` — the output is deterministic for the locked
dependency set. Contents (all MIT): `@automerge/automerge` 2.2.9 (WASM
inlined as base64, self-initializing), `@automerge/automerge-repo` 2.5.6,
`…-network-websocket` 2.5.6, `…-network-broadcastchannel` ^2.5.6,
`trystero` ^0.25.3 (Nostr strategy), `cbor-x` ^1.6.4, plus the local
`trystero-adapter.mjs` (automerge-repo NetworkAdapter over trystero,
appId `plp-collab`). Self-contained ESM — no CDN/network use at import
time, COEP-safe; the network endpoints it *dials* when a room starts are
`wss://sync.automerge.org` and trystero's public Nostr relays.

```
19fd214196f4bf31f676bf630b836b8c7292e43c8d3fd1d33fb37879cd5ae819  vendor/automerge-collab.mjs
```

Dev-only (NOT served, NOT vendored): `@automerge/automerge-repo-sync-server`
0.2.8 as a devDependency — spawned by `tests/collab.spec.mjs` as a local
throwaway relay for fault-injection tests.
