# PLP validation matrix

Every user-facing feature, the best evidence that validates it, and current
coverage. Evidence preference order: (1) Playwright assertion through
`window.plp` (state, not pixels), (2) DOM assertion where the DOM *is* the
feature, (3) consumer-side stream-check invariants, (4) timing/counting
measurements, (5) manual human judgment (feel, visuals). "S-n" = covered by
`tests/smoke.spec.mjs` test n. "GAP" = not yet automated.

## Editor

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| E1 | Python syntax highlighting | DOM: CodeMirror emits `cm-keyword`/`cm-string` spans for a known source | GAP (low value; visual) |
| E2 | Edits feed the next run | Set source via `plp.editor.setValue`, run, assert output reflects the edit | S-2..S-4 (implicitly) |
| E3 | Current-line highlight follows scrub position | DOM: exactly one `.cm-active-step` line; its index matches the position's line under the current mode's semantics | GAP (asserted indirectly via counter/event text) |
| E4 | Highlight cleared at start anchor and on reset | DOM: zero `.cm-active-step` after `goTo(0)` (line mode) and after reset | GAP |

## Runner / session

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| R1 | First-run boot with status + console notice | Status badge transitions `starting Python… → running… → completed`; boot notice line present | partial (S-1 asserts completion, not transitions) |
| R2 | Warm reruns near-instant | Timing: second `plp.run()` of a trivial program completes < 2 s | GAP |
| R3 | Re-entrancy guard before state reset | Start a long run, call `plp.run()` again → rejects; first run's `records()` array is unclobbered and still completes | GAP |
| R4 | Terminal reasons → console closing notes | One program per reason (`completed`, `uncaught_exception`, `interrupted`, `killed`, `needs_input`, `step_limit`, `trace_limit`) → assert `summary.terminal_reason` AND the console note text. `engine_error`: not reliably drivable; code-review the switch instead | S-1 (completed), S-2 (uncaught), S-5 (needs_input); GAP: interrupted, killed, step_limit, trace_limit |
| R5 | Exception summary line (type, message, line) | `1//0` at a known line → console contains `ZeroDivisionError` + `(line N)`, styled stderr | S-2 (partial: type only) |
| R6 | Stop: cooperative under COI / hard-kill degraded | COI: interrupt a loop with per-iteration ms-scale C work → `interrupted`, `trace_complete: true`. Degraded: same → `killed`, `trace_complete: false`, records end with synthetic terminal | GAP |
| R7 | Diagnostics surfaced (quiet list suppressed) | Thread program → console shows `⚠ unsupported_thread`; no `host_limit_unavailable` line ever appears | GAP |
| R8 | Stream invariants hold on every run | `plp.checkErrors()` returns `[]` after every test's run (seq/step contiguity, output byte offsets, in-step ref resolution, terminal counts) | S-1..S-4 (spot); make it a per-test epilogue |
| R9 | Session survives worker recycle | 21 quick runs all `completed` (recycle after 20) | GAP (engine-verified; cheap to add) |
| R10 | Run rejection (pre-stream) rendered, no records | Invalid option via a direct `session.run` → console "run failed", `records()` empty | GAP |

## Console

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| C1 | stdout/stderr interleaved in program order | Program alternating `print`/`sys.stderr.write` → `plp.console.text()` equals expected merged transcript; stream-check byte reconstruction corroborates | GAP (order asserted only within stdout) |
| C2 | stderr styled distinctly | DOM: stderr chunks carry `.stderr` class | S-2 (containText only) — add class assertion |
| C3 | Partial-line output (`end=""`) | `print("a", end="")` ×3 then newline → transcript `aaa\n`, no injected breaks | GAP |
| C4 | Inline input flow | On `input` step: row visible with prompt placeholder; Enter → row hides, engine echoes `prompt+line\n` exactly once, run proceeds | S-1 |
| C5 | Empty line is a valid input | Reply `""` → run proceeds, echo is just the newline | GAP |
| C6 | Input rejected when nothing waiting | `plp.provideInput("x")` while idle → throws; console shows "input rejected" | GAP |
| C7 | DOM cap with full-fidelity memory | 3000-print flood → DOM chunk count ≤ cap+1 with cap notice; `plp.console.text()` still contains all 3000 lines; page stays responsive | GAP |
| C8 | Scrub reconstruction | At a mid position: transcript = output through that position's state step + banner; at position 0: "no output yet"; at last position: full live view returns | S-1, S-4 (partial) |
| C9 | Degraded `needs_input` explanation | Non-isolated run of an input program → explanatory closing note | S-5 |

## Memory model — tables

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| M1 | Names: globals section + frames root→active with active marker; module frame not duplicated | Program two calls deep → table text contains sections in order, `← active` on innermost only, no `<module>()` section | partial (S-1 asserts names exist) |
| M2 | Closure environments section | Closure program (`make_counter`) → `closure env N` section with cell bindings | GAP |
| M3 | Scalars render inline per encoding (int/str/bool/None/float/bytes/complex/range/elided) | One program binding each kind → Names cells match expected strings; no `obj` chips for scalars | GAP (spot-covered) |
| M4 | Ref chips resolve; click flashes/scrolls target row | Zero dangling chips (S-3's DOM sweep); click dispatch → target row gains `.flash` | S-3 (dangling=0); GAP (click) |
| M5 | Chip-reachable display policy | S-3's assertions: reachable rows present, unreachable builtin base absent | S-3 |
| M6 | Class bases inline by name; builtin base omitted | `class Puppy(Dog)` text; no `opaque` row | S-3 |
| M7 | Opaque rows dimmed but shown when learner data reaches them | `f = open(...)`-style program → `opaque` row present with `.dim` class | GAP |
| M8 | Aliasing: one row, many chips | `[[0,0]]*3` → outer list's three chips share one uid; heap has exactly 2 list rows | S-4 (via names presence) — strengthen with uid equality |
| M9 | Cycles render | `loop.append(loop)` → row's own uid appears as chip inside itself | GAP |
| M10 | Elision markers visible | Run with tiny `max_heap_nodes`/`max_container_elems` via direct session options → `⟨elided⟩` text + flags row shows `heap_elided`/`container_elided` | GAP |
| M11 | Flags row renders set flags only | Same run: only tripped flags appear | GAP |

## Memory model — stepping

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| P1 | Line mode default; position 0 anchor | `lineMode()` true; `goTo(0)` → `line 0/N`, empty tables, "before the program runs", no highlight, console "no output yet" | S-1 |
| P2 | Grouping: one position per executed line; iterations collapse | 4-line grid program → `stepCount()` = 5; raw steps > positions; comprehension position labeled `(k engine steps)` | S-4 |
| P3 | Produced-state semantics | Position "line 1" shows the binding line 1 created | S-4 |
| P4 | Engine-step mode toggle | Uncheck → counter `step k/n`, before-line semantics (state at step `line N` lacks line N's effect) | S-4 (counter only) — add semantics assertion |
| P5 | Prev/next/slider parity | `goTo(i)`, next, prev round-trips index | GAP (trivial) |
| P6 | Live follow + resume-at-end | During a slow run: view tracks latest; scrub back → frozen while records grow; slider to end → follows again | GAP |
| P7 | Render throttling under load | 10k-step trace: page responsive; renders ≈ animation frames, not records (instrument via rAF counter) | GAP (perf) |

## Layout / shell

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| L1 | Gutter drag resizes with floors | Pointer drag → `--col-left`/`--row-console` change; cannot shrink below minimums | GAP |
| L2 | Sizes persist | Reload → CSS vars restored from localStorage | GAP |
| L3 | Maximize/restore per pane; Esc; single-maximized invariant | Class toggling per pane; Esc clears; maximizing B unmaximizes A; editor refresh() called (no blank CodeMirror) | GAP |
| L4 | COI badge truthful in both postures | Isolated: `isolated` + green, capabilities from header record; `?nonisolated`: `none (degraded)` + red | S-1/S-5 (implicit) — assert badge text |
| L5 | COI shim ride-out; `?nonisolated` unregisters SW | First-visit reload survives (`waitForFunction(crossOriginIsolated)`); nonisolated page reports false | S-1..S-5 (helper does this every test) |
| L6 | Sub-path serving correctness | Entire suite runs under `/PLP/` prefix with no COOP/COEP headers (config); zero 404s in network log | all (by config); 404 sweep GAP |
| L7 | Debug API surface | `window.plp` exposes the documented members (guards accidental removal) | GAP (one-liner) |

## Deployment (per release, against the live URL)

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| D1 | GitHub Pages serving (MIME, `.nojekyll`, SW scope) | Re-run the full Playwright suite with `baseURL` pointed at the live site | not yet deployed |
| D2 | Cold-cache boot UX | Manual: first visit on a throttled connection shows boot notice; run completes | manual |
| D3 | Human-judgment pass | Manual: drag feel, maximize feel, focus behavior, input row ergonomics, scrub smoothness on a big trace | manual |

## Standing rules

- Every automated test ends by asserting `plp.checkErrors()` is empty (R8) —
  it catches integration mistakes at the moment of introduction.
- Tests assert through state (`window.plp`), not pixels; DOM assertions are
  reserved for features whose contract IS the DOM (chips, classes, caps).
- Engine-behavior claims (echo-once, interrupt semantics, recycle, budgets)
  are validated against the engine's documented contract — a failure here
  means OUR wiring broke, not the engine.
