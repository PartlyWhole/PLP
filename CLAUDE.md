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
| `app/events.mjs` | semantic event bus (learner actions; modules emit, director/tests subscribe) |
| `app/stage.mjs` | director's app-surface layer: semantic targets, capability gates, attention effects (spotlight/pulse/popover/veil) |
| `app/director.mjs` | lesson runtime: beat FSM, triggers, hints, signals, branching, telemetry — see **app/DIRECTOR.md** (authoring manual) |
| `app/conditions.mjs` | curated trace-grounded predicates for lesson triggers |
| `lessons/` | human-authored lesson data + registry (`meet-the-machine` = grammar-validation reference, placeholder content) |
| `app/questions.mjs` | generative-question engine (pure; trace-grounded memory-prediction + code questions) — see **app/QUESTIONS.md** |
| `app/quiz.mjs` | thin pilot UI over the question engine (floating panel; disposable) |
| `app/layout.mjs` | draggable gutters (CSS vars + localStorage), per-pane maximize (Esc restores) |
| `app/stream-checks.mjs` | consumer-side trace-stream invariants (`traceStreamCheck`) |
| `vendor/` | pinned third-party: Pyodide 314.0.2, PyTrace 0.1.0 (worker **patched** for sub-path — the ONLY upstream divergence, see `vendor/PATCHES.md`), CodeMirror 5.65.21, xterm.js 6.0.0 (+fit). Hashes in `vendor/PROVENANCE.md`; record any addition there |
| `tools/dev-server.mjs` | zero-dep static server simulating the `/PLP/` prefix; `--coi` for header posture |
| `tests/` | Playwright: `smoke.spec.mjs` (core flows), `emulator.spec.mjs` (X-series console), `collab.spec.mjs` (CO-series collaboration), `questions.spec.mjs` (Q-series question engine), `fastrun.spec.mjs` (F-series untraced execution) |
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
   rejections — the UI has exactly two failure paths.
3. **Two execution paths**: PyTrace ALWAYS traces (its 14 options have no
   off switch) and stops at `max_steps`, so anything past a few thousand
   executed lines can only finish untraced. Traced is the default; a
   budget terminal (`step_limit`/`trace_limit`) auto-falls back to the
   untraced path, keeping the truncated trace on screen.
   `runner.setAutoFallback(false)` disables it. Untraced runs produce NO
   records — nothing for the memory model, nothing for collab to
   replicate. In the untraced worker, output flushes are driven by the
   writes themselves, NEVER by a timer: running Python blocks that
   worker's event loop, so timer-based flushing shows nothing until the
   program ends.
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
7. **Collab**: rooms replicate the RECORD STREAM, not the panes (both are
   deterministic projections — `renderRecordToUI` is the single fan-out).
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
9. **Director**: the stage arranges, the LEARNER performs (no action runs
   code or presses buttons; `until` is learner-driven only). Effects are
   per-beat; gates persist across beats; every exit path (incl. errors)
   runs `stage.reset()` — gates fail open. Lessons are data, linted at
   start; pedagogy lives in `lessons/`, never in the runtime
   (app/DIRECTOR.md).
10. **Tests** assert via `window.plp` state, not pixels; every run ends by
   checking `plp.checkErrors()` is empty. Suite runs under the `/PLP/`
   prefix with NO headers (service-worker posture = real GitHub Pages).
   First-visit COI shim reload: `waitForFunction(() => crossOriginIsolated)`.

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

## Deployment gates

Not yet deployed. Before the first public push: (1) user consent to create
PartlyWhole/PLP and push; (2) explicit owner decision on publishing the
vendored engine code (no LICENSE in the engine repos). After deploy: re-run
the suite with `baseURL` pointed at the live site.
