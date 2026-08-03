# PLP — Python Learning Platform (repo guide)

Static, build-free GitHub Pages site: run/trace Python in the browser with
a code editor, a live memory model, and a terminal-emulator console.
Deploys as a **project site** (`https://partlywhole.github.io/PLP/`) — the
sub-path is a load-bearing constraint (see Serving rules).

## Commands

```sh
node tools/dev-server.mjs            # http://127.0.0.1:8619/PLP/ (GH-Pages simulation, COI via service worker)
node tools/dev-server.mjs --coi      # same, with real COOP/COEP headers
npx playwright test                  # full suite (smoke + emulator); needs `npm install` once
```

No build step exists anywhere — plain ES modules, vendored dependencies.

## Layout

| Path | What |
|---|---|
| `index.html` | shell: COI-shim bootstrap, pane markup, classic-script CodeMirror, `app/main.mjs` module entry |
| `app/main.mjs` | wiring + `window.plp` debug API (tests assert through it; keep it stable) |
| `app/runner.mjs` | PyTrace session: run guard, record fan-out, terminal-reason notes, single input-echo path; routes to the untraced path and owns the auto-fallback |
| `app/fastrun.mjs` + `app/fastrun-worker.mjs` | untraced execution: plain Pyodide, no trace hooks, no step limits — the only way large programs finish (see invariant 3) |
| `app/console.mjs` | terminal emulator — see **app/CONSOLE.md** (as-built doc) |
| `app/memory.mjs` | Names/Objects tables, toggleable display filters, line-step scrubbing — see **app/MEMORY.md** (as-built doc) |
| `app/editor.mjs` | CodeMirror 5 wrapper (single file, line highlight, collab splice/change hooks) |
| `app/collab.mjs` | live collaboration: shared editor + shared run/scrub over Automerge, multi-transport (ws + WebRTC/Nostr + BroadcastChannel) — see **app/COLLAB.md** |
| `tools/collab-vendor-build/` | esbuild recipe that produces `vendor/automerge-collab.mjs` (never served; rebuild only to change pinned versions) |
| `app/events.mjs` | semantic event bus (learner actions; modules emit, tests subscribe) |
| `app/questions.mjs` | generative-question engine (pure; trace-grounded memory-prediction, output-prediction + code questions) — see **app/QUESTIONS.md** |
| `app/question-ui.mjs` | shared question renderers (payload-shape router used by quiz panel + tutor cards) |
| `app/quiz.mjs` | thin pilot UI over the question engine (floating panel; disposable) |
| `app/tutor.mjs` + `app/tutor-ui.mjs` | guided tutor: lesson runtime + transcript-feed pane with beat popup — see **app/TUTOR.md**; plan in `design/tutor-plan.md` |
| `app/kb-session.mjs` | KB-backed practice: compiles seeded, §6-weighted drill rounds from `kb/` exercises into lesson scripts; lesson↔concept binding helpers (`lintLessonConcepts`, `frontierTags`) — see design/lesson-kb-binding.md |
| `kb/` | concept-DAG knowledge base (design in `design/knowledge-base-design.md`): append-only `tags.ledger.json`, concept + exercise data modules, footprint analyzer (`analyzer/`), `index.mjs` = `loadKB()` narrow interface. Standalone by contract: imports NOTHING from `app/` (loads in plain Node for the K-series) |
| `curriculum/` | authored lesson scripts (data only, linted at start); `index.mjs` registry; **KB-REFERENCE.md** = the generated KB reference (build artifact — never hand-edit) |
| `app/layout.mjs` | draggable gutters (CSS vars + localStorage), per-pane maximize (Esc restores) |
| `app/stream-checks.mjs` | consumer-side trace-stream invariants (`traceStreamCheck`) |
| `vendor/` | pinned third-party: Pyodide 314.0.2, PyTrace 0.1.0 (worker **patched** for sub-path — the ONLY upstream divergence, see `vendor/PATCHES.md`), CodeMirror 5.65.21, xterm.js 6.0.0 (+fit). Hashes in `vendor/PROVENANCE.md`; record any addition there |
| `tools/dev-server.mjs` | zero-dep static server simulating the `/PLP/` prefix; `--coi` for header posture |
| `tests/` | Playwright: `smoke.spec.mjs` (core flows), `emulator.spec.mjs` (X-series console), `collab.spec.mjs` (CO-series collaboration), `questions.spec.mjs` (Q-series question engine), `fastrun.spec.mjs` (F-series untraced execution), `tutor.spec.mjs` (T-series guided tutor), `kb.spec.mjs` (K-series knowledge base) |
| `VALIDATION.md` | feature → best-evidence → coverage matrix; add a row when adding a feature |
| `README.md` | user-facing doc incl. **Stepping model** and **Memory model display rules** |
| `ONBOARDING.md` | engineer onboarding: architecture tour, invariants-with-incidents, design case studies, growth ladder |

The engines' authoritative integration reference is
`~/Pilot/FRONTEND-INTEGRATION-GUIDE.md` (Engine Pilot repo — also the
source of the vendored assets and test machinery).

## Load-bearing invariants (do not break casually)

1. **Serving**: every URL must be relative or `import.meta.url`-derived —
   never root-absolute (breaks under `/PLP/`). No CDN/cross-origin fetches
   (COEP `require-corp` via `coi-serviceworker.js`; `?nonisolated` opts out
   → PyTrace degraded mode). `.nojekyll` must exist.
2. **Runner**: reject a concurrent `run()` BEFORE resetting any per-run
   state. After the first record, failures are terminal records, not
   rejections — the UI has exactly two failure paths. **Every run must
   reach a terminal state on every path** (success, throw, interrupt):
   a run that never ends wedges the buttons solo and wedges the whole
   room in collab, because `canRun()` is false for a live run — including
   the driver's own. A cooperative interrupt is a request, not a
   guarantee: interrupting at the stdin rendezvous leaves Pyodide's
   `runPythonAsync` unsettled, so the host arms a deadline and forces an
   ending (app/fastrun.mjs; regression F-4b, L-series).
3. **Two execution paths**: PyTrace ALWAYS traces (its 14 options have no
   off switch) and stops at `max_steps`, so anything past a few thousand
   executed lines can only finish untraced. **Run = untraced** (the
   default; `runner.run()`), **Trace = traced** (`runner.trace()`). A
   budget terminal (`step_limit`/`trace_limit`) keeps the truncated trace
   and points at Run; `runner.setAutoFallback(true)` opts into re-running
   untraced instead. Untraced runs produce NO records, so collab shares
   them as an output stream rather than a record stream (invariant 7). In
   the untraced worker, output flushes are driven by the writes
   themselves, NEVER by a timer: running Python blocks that worker's
   event loop, so timer-based flushing shows nothing until the program
   ends.
4. **Console**: the chunk store is the source of truth; the xterm screen is
   a deterministic replay view. Input echo happens exactly once, only in
   `runner.provideInput` (live mode runs with `echo_stdin: false`;
   degraded keeps engine echo). `term.write` is async — poll `buffer()` in
   tests.
5. **Memory model**: render at most once per animation frame while records
   stream (traces arrive at thousands/sec; per-record rendering freezes the
   tab). The Objects-table policy is the `displayFilters` flag set
   (chip-reachable only, inline class bases, inline plain functions,
   dimmed-never-hidden opaque); elided markers always render; every chip
   must resolve to a row regardless of flag state (app/MEMORY.md).
6. **Stepping**: line-step mode (default) = synthetic position 0 + one
   position per executed line, each showing the state that line *produced*.
   Engine-step mode keeps raw before-the-line semantics. `memory.goTo()`/
   `stepCount()` are position-space; `memory.steps()` is always raw.
7. **Collab**: rooms replicate what the driver's ENGINE emitted, not the
   panes. A traced run shares its RECORD STREAM (`renderRecordToUI` is
   the single fan-out); an untraced run has no records, so it shares one
   ordered console OUTPUT stream (stdout/stderr/echo) instead, capped at
   `SHARED_OUTPUT_CAP`. `run.mode` says which.
   Driver mirrors records one `handle.change` per animation frame, never
   per record. Presence/scrub is ephemeral, never in the doc. Transports
   run concurrently (idempotent sync); no fallback state machine
   (app/COLLAB.md).
8. **Trust boundary**: records from the local engine are schema-validated by
   its facade; records arriving over collab are NOT — any peer holding a
   room link can write arbitrary JSON into the doc. Everything crossing
   that boundary passes `isRenderableRecord` (app/record-guard.mjs) before
   reaching `renderRecordToUI`, and renderers never interpolate a uid into
   markup or a selector unescaped. General rule: a component whose
   invariants assume trusted input must not be handed an untrusted source
   without a gate (this is exactly how the collab XSS arose).
9. **Tests** assert via `window.plp` state, not pixels; every run ends by
   checking `plp.checkErrors()` is empty. Suite runs under the `/PLP/`
   prefix with NO headers (service-worker posture = real GitHub Pages).
   First-visit COI shim reload: `waitForFunction(() => crossOriginIsolated)`.
10. **Knowledge base**: `kb/` imports nothing from `app/` (it must load in
   plain Node); `kb/tags.ledger.json` is APPEND-ONLY — tags are permanent,
   never deleted, edited, or reused (splits/merges flip `status` and add
   successors, per design/knowledge-base-design.md §2.5). Every exercise
   obeys `footprint ⊆ assumed ∪ {focus} ∪ Structural` on every generated
   program — the K-series enforces all of this; edits that trip it are
   design changes, not test fixes. The ledger may run AHEAD of the loaded
   concept set during breadth build-out (K-1 is directional: every loaded
   concept must match its active ledger entry exactly; a ledger tag with no
   loaded concept yet is expected). `curriculum/KB-REFERENCE.md` is a
   build artifact — never hand-edit; regenerate with
   `node tools/kb-docgen.mjs --write` (K-doc enforces byte-identity with
   real-execution outputs).
11. **Ledger permanence is CI-enforced**: `.github/workflows/kb-ledger.yml`
   runs `node tools/check-ledger.mjs <base-ref>` (bare Node, no installs)
   against the PR base / previous push commit, rejecting any deletion,
   tag/kind/parents edit, or status flip without successors in
   `kb/tags.ledger.json`; the K-series working-copy diff (K-2) is only the
   local approximation.

## Engine facts that shape the UI (from the integration guide + source)

- Live input/cooperative interrupt need `crossOriginIsolated`; degraded
  mode = pre-supplied stdin + hard kill (`killed`, synthetic terminal,
  `trace_complete: false`).
- `stdinLines` is IGNORED in live mode; `input()` waits forever for
  `provideInput` — always keep an interrupt escape.
- Only `builtins.input` is hooked; no EOF exists in the wire contract;
  interrupts are not catchable as `KeyboardInterrupt`; `isatty()` is False.
- Scalars encode inline; identity (uids) is per-step and per-run — never
  compare uids across runs.
- Interrupt demos need ms-scale C work per iteration (`sum(range(100_000))`)
  or the interrupt can land as `engine_error`.
- Flood-output test programs must use C-level ops (`"\n".join(map(...))`) —
  per-iteration Python loops trip `max_steps` (default 1000) first.

## Deployment

Live at `https://partlywhole.github.io/PLP/` (GitHub Pages, main branch).
Re-run the suite with `PLP_BASE_URL` pointed at the live site after
significant changes.
