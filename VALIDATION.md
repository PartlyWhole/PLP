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
| E5 | Browser-local code persistence | Edit → reload preserves exact buffer; close and relaunch a persistent browser profile → same buffer; receive shared code → Leave reload preserves it | persistence suite, CO-1 |

## Runner / session

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| R1 | First-run boot with status + console notice | Status badge transitions `starting Python… → running… → completed`; boot notice line present | partial (S-1 asserts completion, not transitions) |
| R2 | Warm reruns near-instant | Timing: second `plp.run()` of a trivial program completes < 2 s | GAP |
| R3 | Re-entrancy guard before state reset | Start a long run, call `plp.run()` again → rejects; first run's `records()` array is unclobbered and still completes | GAP |
| R4 | Terminal reasons → console closing notes | One program per reason (`completed`, `uncaught_exception`, `interrupted`, `killed`, `needs_input`, `step_limit`, `trace_limit`) → assert `summary.terminal_reason` AND the console note text. `engine_error`: not reliably drivable; code-review the switch instead | S-1 (completed), S-2 (uncaught), S-9 (needs_input); GAP: interrupted, killed, step_limit, trace_limit |
| R5 | Exception summary line (type, message, line) | `1//0` at a known line → console contains `ZeroDivisionError` + `(line N)`, styled stderr | S-2 (partial: type only) |
| R6 | Stop: cooperative under COI / hard-kill degraded | COI: interrupt a loop with per-iteration ms-scale C work → `interrupted`, `trace_complete: true`. Degraded: same → `killed`, `trace_complete: false`, records end with synthetic terminal | GAP |
| R7 | Diagnostics surfaced (quiet list suppressed) | Thread program → console shows `⚠ unsupported_thread`; no `host_limit_unavailable` line ever appears | GAP |
| R8 | Stream invariants hold on every run | `plp.checkErrors()` returns `[]` after every test's run (seq/step contiguity, output byte offsets, in-step ref resolution, terminal counts) | S-1..S-4 (spot); make it a per-test epilogue |
| R9 | Session survives worker recycle | 21 quick runs all `completed` (recycle after 20) | GAP (engine-verified; cheap to add) |
| R10 | Run rejection (pre-stream) rendered, no records | Invalid option via a direct `session.run` → console "run failed", `records()` empty | GAP |

## Untraced execution (F-series = `tests/fastrun.spec.mjs`)

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| U1 | A program far past `max_steps` completes untraced with correct output | 200k-iteration loop → `completed`, exact sum in transcript, `memory.steps()` empty (untraced means no records) | F-1 |
| U2 | Trace on a too-large program reports the budget honestly (no silent re-run) and points at Run; opt-in auto-fallback still works | `trace()` → `step_limit`, console shows "step limit reached" + "press Run"; `steps()` 1000; then `setAutoFallback(true)` → `completed`/`traced:false` with full output | F-2 |
| U10 | Run and Trace are distinct actions | `trace()` fills the memory model; `run()` on the same program produces output with `steps()` 0 | F-6 |
| U11 | Untraced runs replicate to peers as an output stream | room + `run()` → follower console gets the output, is told "untraced: no memory model", keeps `steps()` 0; late joiner replays it; a following traced run restores the memory model | CO (untraced run) |
| U3 | `input()` parity: blocks on the SAB rendezvous, echoes exactly once | isolated run → `isWaiting()` true, `provideInput`, transcript `Your name? Ada` + output, exactly 2 occurrences | F-3 |
| U4 | Stop interrupts an untraced infinite loop (SIGINT via interrupt buffer) | `while True: pass` → `isRunning()` true, interrupt → `interrupted`, not running | F-4 |
| U5 | Tracebacks show learner frames only, never engine internals | nested call raising ZeroDivisionError → `line 2, in half` present; `_pyodide`/`eval_code_async`/`python314.zip` absent | F-5 |
| U6 | No regression: tracing still works normally | small program → traced, steps > 0, `checkErrors()` empty | F-6 |
| U7 | Output is live during a tight loop (flush driven by writes, not timers) | implicit in F-4: output must appear while Python blocks the worker event loop, else the test times out | F-4 (regression guard) |
| U12 | Stop while waiting at `input()` always ends the run | untraced run parked at the stdin rendezvous → interrupt → terminal reason within the deadline, `isRunning()` false, prompt cleared, runner reusable | F-4b |
| U8 | Degraded (non-isolated) untraced mode: no SAB, `input()` reports EOF | `?nonisolated` untraced run of an input program → EOF notice, no hang | GAP |
| U9 | Untraced runs are local-only (no records for collab to share) | room + untraced run → peers see no shared run | GAP |

## Shared-run lifecycle (L-series = `tests/collab-runlock.spec.mjs`)

A room holds one shared run; every other peer's Run is gated while
`run.status === "running"`, and `canRun()` is false for one's *own* live
run too. So any path that fails to reach `done` wedges the entire room,
driver included. Each row asserts a way a run can end still releases it.

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| L1 | Stop during an untraced shared run releases the lock | peer locked while streaming → interrupt → `interrupted`; both peers' `canRun()` true; peer drives the next run | L-1 |
| L2 | Stop during a traced shared run releases the lock | ms-scale C work per iteration → interrupt → terminal; peer can drive next | L-2 |
| L3 | A run parked at `input()` is stoppable and releases the lock | driver stops instead of answering → terminal reason, lock lifts, prompt cleared | L-3 (untraced), L-3b (traced) |
| L4 | A crashing run releases the lock | `1 // 0` → `uncaught_exception`, shared status `done` | L-4 |
| L5 | Alternating drivers never wedge | 3 runs alternating peers, each releases | L-5 |
| L6 | Simultaneous Run on both peers leaves the room usable | both press Run → neither wedges; both `canRun()` return true | L-6 |
| L6b | **KNOWN DEFECT**: after a simultaneous-Run race, a later unrelated run is sometimes killed (`interrupted`, ~25%). A stale last-writer-wins `run` write makes the new driver think it was usurped, and the usurped handler interrupts its own run | L-6b (`test.fixme`, reproduction kept in-tree) | OPEN |
| L7 | A vanished driver's lock is released by presence | crashed tab → roster drops → lock lifts | CO (ungraceful close) |

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
| C8 | Scrub reconstruction | At a mid position: transcript = output through that position's state step + banner; at position 0: "no output yet"; at last position: full live view returns | S-1, S-8 (partial) |
| C9 | Degraded `needs_input` explanation | Non-isolated run of an input program → explanatory closing note | S-9 |

## Memory model - visual canvas

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| M1 | Scope cards: globals + frames root to active with active marker; module frame not duplicated | Program two calls deep → cards appear in order, active card marked, no `<module>()` card | partial (S-1 asserts names exist) |
| M2 | Closure environment scope card | Closure program (`make_counter`) → closure card with cell bindings | GAP |
| M3 | Scalars render as paired typed value pills per encoding (int/str/bool/None/float/bytes/complex/range/elided) | One program binding each kind → type and value match; no invented data id | S-4 (int spot check); broader encodings GAP |
| M4 | Contextual reference arrows resolve to rendered objects | Hover a bound id → solid incoming paths active; hover indirectly held object → dashed parent path active; no dangling targets | S-3, S-4, S-5 |
| M5 | Name-reachable display policy | Reachable pills present; unreachable builtin base absent | S-3 |
| M6 | Class-valued bindings hidden by default; advanced view restores classes with bases inline and builtin base omitted | Default Dog/Puppy program shows only its instance; toggle `hideClassBindings` OFF → `class Puppy(Dog)` pill and no `opaque` builtin pill | S-3, S-11 |
| M7 | Opaque pills dimmed but shown when learner data reaches them | `f = open(...)`-style program → opaque pill present with `.dim` class | GAP |
| M8 | Aliasing: repeated compact id pills | `a = [1,2]; b = a` → both bindings show the same compact data<sub>N</sub>; the canonical entry shows `data<sub>N</sub> : list · 2 items`; one list data node; two hover paths | S-4 |
| M9 | Cycles render without recursive duplication | `loop.append(loop)` → expanded list contains an internal reference to its own existing pill | GAP |
| M10 | Elision markers visible | Run with tiny `max_heap_nodes`/`max_container_elems` via direct session options → `⟨elided⟩` text + flags row shows `heap_elided`/`container_elided` | GAP |
| M11 | Flags row renders set flags only | Same run: only tripped flags appear | GAP |
| M12 | Hovering a Names binding highlights scoped whole-word source matches, including string literals; leaving clears all marks | source with identifier + string matches, hover/leave DOM mark counts | S-7 |
| M13 | Compound data renders as one `data<sub>N</sub> : type · description` pill and expands or collapses in place | One control per Data In Memory row; click list pill → `aria-expanded` true and indexed child pills visible; click again collapses | S-4 (single control + expand); collapse GAP |
| M14 | Clicking a data pill surfaces it | Click an indirectly held child's unified data pill → its data node becomes first in the Data In Memory list | S-5 |
| M15 | Binding-pill navigation preserves order | Click a binding pill in an overflowing data list → matching canonical pill scrolls to its vertical level; data-node order is unchanged. A non-overflowing list keeps scroll position 0 | S-4 (short list), S-10 (overflow alignment + order) |
| M16 | Beginner class filtering removes Python-generated class-body metadata while preserving raw trace truth | Scrub every line-step position in a `Dog` program → no dunder name boxes; switch to engine steps and turn `hideClassBindings` OFF → `__module__` and `__qualname__` return | S-4 |

## Memory model — stepping

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| P1 | Line mode default; position 0 anchor | `lineMode()` true; `goTo(0)` → `line 0/N`, empty canvas, "before the program runs", no highlight, console "no output yet" | S-1 |
| P2 | Grouping: one position per executed line; iterations collapse | 4-line grid program → `stepCount()` = 5; raw steps > positions; comprehension position labeled `(k engine steps)` | S-8 |
| P3 | Produced-state semantics | Position "line 1" shows the binding line 1 created | S-8 |
| P8 | A finished trace rests at the start anchor, not the last step | after `trace()`: `stepIndex()` 0, counter `line 0/N`, nothing bound; stepping to 1 reveals the first line's effect; the console still shows the completed run (repositioning is silent, so it is not a learner scrub) | S-2 |
| P4 | Engine-step mode toggle | Uncheck → counter `step k/n`, before-line semantics (state at step `line N` lacks line N's effect) | S-8 (counter only); add semantics assertion |
| P5 | Prev/next/slider parity | `goTo(i)`, next, prev round-trips index | GAP (trivial) |
| P6 | Live follow + resume-at-end | During a slow run: view tracks latest; scrub back → frozen while records grow; slider to end → follows again | GAP |
| P7 | Render throttling under load | 10k-step trace: page responsive; renders ≈ animation frames, not records (instrument via rAF counter) | GAP (perf) |

## Generative questions (Q-series = `tests/questions.spec.mjs`)

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| Q1 | memory-next-line: blanks = trace diff (changed/added), unchanged shown | explicit `{from,to}` → blank labels/expected match hand-computed diff; right/wrong grading | Q-1 |
| Q2 | memory-line-to-line spans lines incl. frame locals | target inside a call → scoped `total()` entries present, ≥1 blank | Q-2 |
| Q3 | Grading tolerance (whitespace, quote style) | `'…'` vs `"…"`, padded spacing both accepted | Q-1, Q-4 |
| Q4 | code-order shuffles + grades by position | seeded shuffle differs from source; sorted-back order correct, reversed wrong | Q-3 |
| Q5 | code-structure structure/details modes complementary | blanked-line sets for both modes equal the keyword classification | Q-4 |
| Q6 | code-args blanks call arguments | known line → `before`/expected args; grade right/wrong | Q-5 |
| Q7 | quiz pilot renders + checks; graceful without trace | panel question, fill → correct, wrong → `.bad` mark; after reset `newQuestion` → null | Q-6 |
| Q8 | Determinism under explicit seed/options | same opts → same question (spot: implied by fixed expectations in Q-1..Q-5) | implicit |
| Q9 | Memory construction graph preserves nested data and aliases while ignoring learner-local data ids | rename every target data id consistently → correct; remove a binding → binding-area failure | Q-3 |
| Q10 | Blank memory builder creates names, typed scalars, data, and references; Check displays graph feedback | construct `x → int · 3` from blank → correct; change to 4 → incorrect | Q-8 |
| Q11 | Expression evaluation sequence for augmented assignment includes target read, RHS literal/list construction, overloaded operation, and store | `items += [4]` exact action list; correct order passes, reverse fails | Q-4, Q-8 |
| Q12 | Construction type fields allow typing and filtering without showing advanced types initially | empty data-type field suggests five common types; typing `gen` narrows to `generator` and commits it | Q-8 |

## Guided tutor (T-series = `tests/tutor.spec.mjs`)

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| T1 | Practice surface: Exercises hidden by default; the header toggle opens the full-viewport card view (`body.practice` hides header + IDE); visibility persists; the surface's ← leaves | DOM: `body.practice` + `#practice` visible across toggle + reload; header/#layout hidden; menu = welcome card + 9 controls | T-1 |
| T22 | Surface routing: drills/menu/map on the practice card view, guided lessons on the focus stage; switching tears the outgoing surface down; hiding never ends a round | guided start → stage + focus, exit → practice menu, no stale popup; `hideSurface()` mid-round keeps lessonId + waiting | routing + edge-flow tests |
| T23 | The card is the interface: program in-card (read-only CM), one-line prompt, in-card "▶ it printed/holds" reveal from the graded run, explain face in the same card, 🌱 `ask.teach` statement + collapsed example, `ask.context` for spot-diff, first-time-per-form mechanics line (once, `plp.practice.v1`), open-in-editor + restore chip, reload rebuilds the card | practice-DOM assertions across the migrated drill tests + edge-flow test | T-series practice tests |
| T2 | `predict-output`: trace-grounded whole-program and after-line-N grading; forgives trailing whitespace and content-equivalent container display (comma/colon spacing inside `[] () {}`, repr quote style) — never content (text spacing, print's between-args space, case) | generate at default and explicit `position`; right/trailing/internal-space/case answers graded as specified; `[1,2, 3]` ≡ `[1, 2, 3]`, `{"a":1}` ≡ `{'a': 1}`; wrong-content and gap-between-prints stay wrong; `expected.text` matches engine output | T-2 |
| T3 | Lesson lint: malformed steps rejected at start | five malformed step shapes → five errors via `plp.tutor.lintLesson` | T-3 |
| T4 | Unit 1 end-to-end: loadCode resets panes; actions complete via real events (run-ended, scrubbed ×3, input-answered); predict-then-verify grades against the actual run; `if:` branches fire on lastAnswer; pocket + done cards | full drive through `plp.tutor` with real trace runs and console input rendezvous; `checkErrors()` empty after final run | T-4 |
| T5 | Transcript persistence: reload restores every card and the resume point | card count equality (store vs DOM) across reload; finished state intact | T-4 |
| T6 | Learner code stash: exit restores the pre-lesson program only when the editor holds unedited lesson code; learner edits survive | exit-after-lesson restores original; exit-after-manual-edit keeps the edit | T-4, T-5 |
| T7 | Ask retry ladder: wrong answers re-grade until attempts exhausted | engine-level right/wrong grading of a generated ask (full ladder UI exercised manually) | T-6 (partial; ladder DOM = GAP) |
| T8 | Solo-only in collab: pane hides when a room goes live; `start()` refuses | room live → `isTutorVisible()` false, `start()` returns null | GAP (manual; add to CO-series when tutor+collab interact) |
| T9 | Stage: beats take center stage in focus (stage fills the code column left of the receded editor, above the slim console); ⇱ Back to editor falls back to the classic dock (old geometry: same left/right as editor, below it, above console) with lesson state unchanged; bubble click reopens; reparenting preserves typed answers; static bubbles rebuild read-only | DOM drive: focus geometry + classic-fallback geometry assertions; bubble hop → live card back in feed with typed value; reopen → value intact | stage test |
| T18 | Reveal-in-card: locking shows the run's real output in the card; the explain keeps it visible; the next question resets; predict-state shows the probed value with a memory-model escape into the IDE | `.pr-reveal` appears on lock with output text, persists through the explain face, absent on the next card; memory link → IDE with populated trace | reveal-in-card test |
| T19 | Topic meters + welcome mastery line: menu topic buttons show met/total; zero shows a calm empty track; totals cover every non-structural concept exactly once | pure `topicProgress` totals vs loadKB; meter DOM present, no count text at zero | meters/summary test |
| T20 | Round summary: a finished round records headline, per-question dot row (filled/open), newly-met chips, missed line; end controls suggest the frontier-thickest next topic; reload restores the summary card | seeded 2-question round driven to `done`; summary card contents + "Keep going" control + post-reload restore | meters/summary test |
| T21 | Concept map: 7 lanes cover every non-structural concept once; cold-start frontier is exactly print-text; met/frontier/locked chips render; a frontier chip's Practice-this starts a targeted round (concept's own exercises, 4 questions, `drill-{topic}-{tag}-{seed}`) | pure `mapModel` invariants + deterministic double-build; stage DOM chip-state counts; targeted-round store shape | concept map test |
| T10 | Review context: reopening a bubble about an earlier program shows that program in a context card with a stash-safe load button; no context card when the editor matches | popup test: old action bubble → `.tutor-context` holds program 1; load → editor restored; re-review → no context card | popup test |
| T11–T17 | RETIRED — the hand-authored drill bank (`app/drills.mjs` + `curriculum/CURRICULUM.md`) was deleted once the KB reached parity. Each retired guarantee has a K-series successor: compilation determinism → K6; clean/gradable/one-line generation → K10; mostly-basics mix → K-inv18; variant-matched explanations → K14 (salience) + variant cards; doc exactness → K17 (KB-REFERENCE byte-identity) | — | K-series (below) |
| T13 | Drill round: seeded session, per-CONCEPT miss stats persist and weight selection, misses show the concept/variant card, reload restores the identical round from the stored compiled script | drill e2e: wrong → pause + `{seen:1,missed:1}` keyed by tag; reload → same lessonId, next ask; skip counts as miss; end card | drill round test |

## Knowledge base (K-series = `tests/kb.spec.mjs`)

`design/knowledge-base-design.md` through full breadth and app wiring: all
68 concepts (4 structural / 47 core / 17 edge — the §2.4 budget exactly),
69 exercises across all four §5.2 forms, the footprint analyzer over the
complete §4.1 grammar (branches, loops, comparisons, booleans, strings,
dicts, tuples, slices, conversions, methods), interpreter oracles, and the
generated reference. Invariant numbers = design §9.

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| K1 | Tag ledger well-formed; every LOADED concept matches its active ledger entry byte-for-byte (inv 3). The ledger may run ahead of the loaded set during breadth build-out — the agreement is directional | tags unique + Crockford charset, slugs unique; per loaded tag: active status + identical slug/kind/parents | K-1 |
| K2 | Tag permanence: the ledger is append-only; committed tags never change tag/kind/parents (inv 4) | working copy vs `git show HEAD:` — committed entries are a structural prefix | K-2 (local approximation; K-LC below is the real-VCS CI check) |
| K3 | Concept graph is a DAG, fully reachable from the structural roots (inv 1, 2) | Kahn toposort (cycle printed on failure); BFS from roots covers all nodes | K-3 |
| K4 | Static contract: `assumed ⊆ ancestors(focus)`, `focus ∉ assumed`, structural tags never listed, `contrast ∈ assumed` (inv 5) | closure computation + set inclusion per exercise | K-4 |
| K5 | One-new-thing contract on every generated program: `footprint ⊆ assumed ∪ {focus} ∪ Structural`; analyzer total; declared shapes/variants reachable (inv 6, 7) | 40 seeds per exercise (`fnv1a32(id) ^ k`), analyzer on each (all executed sources for multi-program forms); excess tags fail with evidence lines | K-5, anchored by K-5a (design §10.2 hand-computed footprints reproduced exactly, incl. the `b = b + [x]` contrast and the latent-alias warning) |
| K6 | Determinism: same (exercise, seed) → identical program; selection pure over the met set (inv 16) | double-generate deep-equal across two `loadKB()` instances | K-6 |
| K7 | Every non-structural concept has ≥1 intro exercise (inv 12) | join exercises→focus over concepts — all 64 non-structural covered | K-7 |
| K8 | Dynamic contract + cold start: frontier boots at `print-text`, the E1–E7 chain reaches `names-share-list`, the diamond (both `name-from-name` AND `append-mutates`) gates aliasing, nothing offerable assumes an unmet concept | pure walk over `frontier`/`offerable` asserting the §10.3 unlock sequence | K-8 |
| K9 | kb/ RNG cannot drift from the app's (`kb/` imports nothing from `app/` by contract) | mulberry32(42) pinned 5-value stream asserted against both copies | K-rng (Node) + K-10 preamble (browser) |
| K10 | Every exercise generates clean, gradable programs under real execution; one output line unless flagged `multiline` (inv 10) | 5 stratified seeds per exercise (first occurrence of each shape/variant): trace → `completed`, predict-output buildable, line-count check, `checkErrors()` empty | K-10 |
| K11 | Parser fidelity: the hand-written micro-parser's tree equals Python's own `ast` normal form (inv 8) | per stratified sample, s-expression normalization of both trees compared byte-for-byte (expression programs; compound statements covered by inv 9/10 instead) | K-oracles |
| K12 | Type fidelity: the abstract store's end-state types equal runtime `type(x).__name__` after real execution (inv 9) | per stratified sample, a probe prints each surviving name's runtime type; branch-ambiguous (⊤) names excluded by construction | K-oracles |
| K13 | Discrimination: every focus concept's authored `wrongAnswer` differs from the real output on every sample (inv 11) | wrongAnswer ≠ executed output per stratified sample | K-oracles |
| K14 | Focus salience: every exercise actually exercises its focus tag, or carries a live `focus-salience` waiver (inv 13) | footprint-contains-focus over 40 seeds; the one waiver (float-inexact — no syntactic witness for "prints a long tail") must fire | K-inv13 + K-inv17 |
| K15 | Waiver hygiene: every waiver fires, budget ≤ max(3, ⌈5%⌉), known ruleId, non-empty issue (inv 17) | audit of `kb/waivers.json` against sampled generations | K-inv17 |
| K16 | Variety floors: ≥3 program-shapes per core concept (across all its exercises); no consecutive `(form, shape)` repeats in a compiled session (inv 14) | shape-union per core ≥3; 30 compiled sessions × 12 questions scanned for adjacent repeats | K-inv14 |
| K17 | Doc fidelity: `curriculum/KB-REFERENCE.md` is byte-identical to a fresh regeneration, every sample output obtained by real execution, provenance-stamped (inv 15) | regenerate in Pyodide → byte-compare; `KB_UPDATE_FIXTURES=1` is the only writer; `tools/kb-docgen.mjs --check` (system python3) produces identical bytes | K-doc |
| K18 | Compiled sessions are mostly basics: core-focus questions ≥ 60% (inv 18, inherited from the retired drill bank's T14) | three seeded 10-question "all" rounds compiled in Node; core fraction of ask concepts | K-inv18 |

## KB practice & lesson binding (T-series additions)

The KB drives the practice UI (`app/kb-session.mjs` compiles §6-weighted
rounds; `app/tutor.mjs` runs them) and guided lessons bind to concept tags
(`design/lesson-kb-binding.md`). Mastery: stats keyed by tag in
`plp.kb.v1`; the met map in `plp.kb.met.v1` (both surfaces write through
`grantMet`).

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| KT1 | predict-state: latent state is examinable — grades a name the program never printed, via a real probe run; quote-style forgiving (§5.2, §13 Q4) | alias exercise: `a` mutated through `b`, never printed; correct/wrong literals graded by executed `print(a)` | predict-state test |
| KT2 | fill-one-blank: the typed token is substituted, run for real, judged by output equality — any fill that truly produces the target is correct | intended token correct; a wrong token wrong; grading is async through the real engine | fill-one-blank test |
| KT3 | spot-the-difference: program A shown WITH its real output (executed, not authored); the student predicts program B | contrast pair `b += [x]` vs `b = b + [x]`; A's shown output is engine truth; B graded by execution | spot-the-difference test |
| KT4 | Lesson↔KB binding lint: unknown / structural / out-of-unit `focus` tags rejected at lesson load; the shipped u1 lints clean | bad-fixture lint surfaces each violation; u1 (concepts 0006/0009/000A/000B, focus 0009+000B) → no errors | binding lint test |
| KT5 | Met grants: only a clean first-attempt correct `predict-output` before the final hint grants met (design §2.8); wrong answers, demo steps, and post-final-hint corrects grant nothing; source recorded ("lesson"/"drill") | u1 drive-through: wrong → no grant; correct → `{000B: {at, source: "lesson"}}`; both-hints-then-correct → no grant | binding grant tests |
| KT6 | The met set feeds the frontier and the menu: `kb.frontier(met)` computes newly-unlocked concepts; the post-lesson menu adds "Drill what you just learned"; fresh visits keep the 8-button menu | after a grant: frontier non-empty, 9 buttons; fresh visit: 8 buttons | binding menu test + pane test |

## Security (SEC-series)

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| SEC1 | Remote (collab) records are validated before rendering; malformed ones are dropped with a visible notice | hostile peer writes records with a string `uid` + wrong-typed/unknown kinds → follower shows "ignored malformed record", no script runs, no injected element, page still functional | CO hostile-peer 1 |
| SEC2 | The record guard has no false positives on genuine engine output | ordinary shared run → follower matches driver exactly, no drop notice | CO hostile-peer 2 |
| SEC3 | uid/target values are injection-safe in both HTML attributes and CSS selectors | unit: `renderValue({kind:"ref",uid:'"><img …'})` escapes the attribute (verified against pre-fix output, which did break out) | manual unit check + SEC1 |
| SEC4 | Relay reachable only via Caddy; the raw sync port is not exposed | external probe of :3030 filtered; systemd `IPAddressDeny=any`/`IPAddressAllow=localhost` on the unit | live server check |
| SEC5 | SSH is key-only | `sshd -T` reports `passwordauthentication no`, `kbdinteractiveauthentication no`, root prohibit-password | live server check |
| SEC6 | Foreign browser origins cannot use the relay | curl with allowed origins → 200; `evil.example.com`, `notpartlywhole.org` → 403 | live server check |
| SEC7 | Room store cannot fill the disk | hourly disk guard prunes least-recently-used rooms above the cap; weekly prune at 90 days | installed + syntax-checked (behavioural test GAP) |
| SEC8 | No secrets or operator data in the repo | `git grep` for credential patterns and the server IP over tracked non-vendor files → none; `.claude/`, `.env`, keys gitignored | audit before publish |

## Layout / shell

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| L1 | Gutter drag resizes with floors | Pointer drag → `--col-left`/`--row-console` change; cannot shrink below minimums | GAP |
| L2 | Sizes persist | Reload → CSS vars restored from localStorage | GAP |
| L3 | Maximize/restore per pane; Esc; single-maximized invariant | Class toggling per pane; Esc clears; maximizing B unmaximizes A; editor refresh() called (no blank CodeMirror) | GAP |
| L4 | COI badge truthful in both postures | Isolated: `isolated` + green, capabilities from header record; `?nonisolated`: `none (degraded)` + red | S-1/S-9 (implicit); assert badge text |
| L5 | COI shim ride-out; `?nonisolated` unregisters SW | First-visit reload survives (`waitForFunction(crossOriginIsolated)`); nonisolated page reports false | S-1..S-9 (helper does this every test) |
| L6 | Sub-path serving correctness | Entire suite runs under `/PLP/` prefix with no COOP/COEP headers (config); zero 404s in network log | all (by config); 404 sweep GAP |
| L7 | Debug API surface | `window.plp` exposes the documented members (guards accidental removal) | GAP (one-liner) |

## Deployment (per release, against the live URL)

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| D1 | GitHub Pages serving (MIME, `.nojekyll`, SW scope) | Re-run the full Playwright suite with `baseURL` pointed at the live site | not yet deployed |
| D2 | Cold-cache boot UX | Manual: first visit on a throttled connection shows boot notice; run completes | manual |
| D3 | Human-judgment pass | Manual: drag feel, maximize feel, focus behavior, input row ergonomics, scrub smoothness on a big trace | manual |

## Full terminal emulator (xterm.js) — ADOPTED

Status: implemented; "E-suite" = `tests/emulator.spec.mjs`. Automated:
X0a/X0b, X2, X3, X6, X7, X9, X11, X12, X14 (E-suite) and X1 (via the
migrated smoke suite running byte-for-byte prior assertions through
`text()`/`buffer()`). Remaining gaps: X4 (cursor movement/clear corpus),
X5 (malformed-escape corpus), X8 (byte-limit UI rejection), X13 (selection
— manual), X15 (code-inspection: no Python-visible changes were made).
The C-series rows above now execute against the emulator via the same
`plp.console` API; C7's DOM cap is superseded by X11's scrollback bound.

Adopting an emulator swaps the console's evidence surface: assertions move
from DOM `textContent` to xterm's **screen-buffer API**
(`term.buffer.active.getLine(y).translateToString()`, `getCell()` for
colors/attributes) — still state, never pixels. Two architectural
invariants make everything below testable:

- **X0a — chunk store stays the source of truth.** The raw delta array (and
  `plp.console.text()`) remains authoritative; the emulator is a *view*.
  Evidence: after any run, `text()` equals the stream-check reconstruction,
  regardless of what the screen shows.
- **X0b — deterministic replay.** Feeding the same deltas after `term.reset()`
  yields an identical buffer. Evidence: capture buffer text at live end,
  scrub to 0 and back, buffers byte-equal. (This is what makes scrubbing
  valid at all in an emulator.)

| # | Feature | Best evidence | Notes |
|---|---|---|---|
| X1 | Byte-faithful plain output | Buffer text for a control-code-free program equals the DOM console's current behavior (regression baseline) | run the existing C-series against buffer API |
| X2 | `\r` overwrite | Progress-bar program (`print(f"\r{i}%", end="")`) → final buffer line contains only the last value; line count does not grow per update | the headline emulator win |
| X3 | ANSI SGR colors | `\x1b[31merror\x1b[0m` → `getCell()` reports the fg color on those cells; reset returns to default | assert attributes, not rendering |
| X4 | Cursor movement / clear | Program emitting cursor-up + erase-line → buffer matches the expected final grid | pick 2–3 canonical sequences |
| X5 | Unknown sequences degrade safely | Feed malformed/unsupported escapes → no raw garbage in buffer, no throw, subsequent output intact | fuzz-ish; small fixed corpus |
| X6 | Inline input discipline, echo exactly once | Run with `echo_stdin: false` (assert it in the header record's merged options); type at the prompt → prompt+line appears exactly once in buffer; `provideInput` called with the typed line | replaces C4; double-echo is the classic bug |
| X7 | Line editing + history | Backspace mid-line, arrow-up recall → submitted line matches edited text | our code, not xterm's — xterm has no line editor |
| X8 | Input constraints enforced UI-side | Oversized line (> `max_input_line_bytes`) → UI error, run continues waiting; no `engine_error` terminal | protects the wire contract |
| X9 | Ctrl+C / Ctrl+D keys | Ctrl+C during a loop → `interrupted` (COI). Ctrl+D → visible "EOF unsupported" notice, run still waiting | EOF remains protocol-impossible; validate the *message* |
| X10 | Scrub replay correctness | At mid position: buffer equals replay of deltas through that position's state step; position 0 → empty buffer + banner | X0b makes this meaningful |
| X11 | Flood throughput + bounded scrollback | 3000-line flood: page responsive (use `term.write` callback backpressure); scrollback length = configured cap; `text()` still complete | replaces C7; scrollback cap is the new DOM cap |
| X12 | Resize/fit on pane drag + maximize | After drag/maximize: `term.cols/rows` changed, no wrapped-line corruption of a known long line | pairs with L1/L3 |
| X13 | Selection + copy | Programmatic selection of a known region → clipboard/selection text matches | manual fallback acceptable |
| X14 | Self-containment under COI | Network log shows zero cross-origin requests after adding the vendored bundle; suite still passes under COEP | vendoring rule (guide §7) |
| X15 | Truthfulness unchanged | `isatty()` still False; no fake terminal size advertised to Python | emulator is presentation-only; the engine sees nothing new |

Migration rule: land the emulator behind the SAME `plp.console` debug API
(`text()`, `showUpTo()`, input hooks) so the existing C-series tests keep
passing unmodified before any X-series is added — the diff between suites
then measures exactly what the emulator changed.

## Live collaboration (CO-series)

"CO-n" = covered by `tests/collab.spec.mjs`. Hermetic scenarios run over
BroadcastChannel-only rooms (`?transports=tabs`); the follower/driver
equality bundle = records deep-equal, transcript equal, step count equal,
`checkErrors()` empty on both sides.

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| CO1 | Create/join a room; joiner adopts the code | Two pages, tabs transport: `collab.start()` → hash link → joiner `isActive()` and editor equals creator's | CO-1 |
| CO2 | Two-way live editor sync | Edits on each side reach the other (char-level merge, no clobber) | CO-1 |
| CO3 | Transport gating (a room only uses its `&via=` pathways) | tabs/p2p rooms: zero websockets to sync.automerge.org opened during the scenario | CO-1, CO-6 |
| CO4 | Shared run: follower replays memory model + console exactly | Driver runs; follower equality bundle; follower memory tables render; end note present | CO-2 |
| CO5 | Late joiner replays a finished run from record 0 | Third page joins after completion → equality bundle | CO-2 |
| CO6 | Re-run resets followers and replays the new run | Second run → follower transcript is the new run only | CO-2 |
| CO7 | `input()` prompt + echo reach followers; follower never enters line mode | Driver answers input; follower transcript has prompt+echo, `isWaiting()` false throughout | CO-3 |
| CO8 | Run lockout while a peer's run streams; released after | Follower `canRun()` false + `run()` null during; true after; roles then swap successfully | CO-3 |
| CO9 | Shared scrubbing with local detach/re-attach | Scrub on driver → follower position follows; follower scrub → detached, ignores driver; scrub to end → re-attached | CO-4 |
| CO10 | Relay death mid-stream is survivable; sync resumes on relay return | ws-ONLY room via local sync server: kill mid-stream → follower stalls (< driver count); restart → converges to full equality bundle | CO-5 |
| CO11 | Pure-P2P room (WebRTC via public Nostr signaling) | Separate browser contexts, `transports=p2p`, loopback ICE seam: join + shared run + zero sync-server sockets | CO-6 (SKIPS if relays unreachable — network-dependent by design) |
| CO12 | Roster count + leave/goodbye | Both sides show ● 2; leave drops peer promptly (goodbye; 15 s TTL backstop) | CO-1 (count); GAP (graceful leave — exercised manually) |
| CO13 | Lazy loading: solo pays zero collab cost | No `vendor/automerge-collab.mjs` request until Share/`#room=` | GAP (low value; import is behind `start`/`join` by construction) |
| CO14 | Room link pasted into a live tab joins via hashchange, no reload | Solo page + `location.hash = #room=…` → active + code adopted, reload-marker still set | CO-lifecycle-1 |
| CO15 | Ungraceful close (crash, no goodbye): badge drops and a dead driver's run lock releases via read-time freshness (20 s) | B drives a run, goodbye suppressed, tab closed mid-stream → A's badge → 1 and `canRun()` → true within the staleness window; A then runs successfully | CO-lifecycle-2 |
| CO16 | Transient remote editor activity | A remote insert or replacement briefly highlights changed text and shows its inferred caret only on the receiver; both DOM marks remove themselves after 1.8 s | CO-1 |
| CO17 | Live peer cursor and selection presence with unobtrusive attribution | Move/select on A → B shows A-colored caret/range and anonymous name; A has no self marker; the name fades to `opacity: 0` (staying in the DOM for hover) and re-announces only after a pause; Leave removes B's marks from A | CO-1 |
| CO18 | Remotely inserted or deleted text is never decorated, and a peer is exactly one caret | after remote insert and remote delete: zero `.cm-remote-edit`/`.cm-remote-cursor`, exactly one `.cm-peer-cursor` per peer (design/collab-presence.md) | CO-1 |

## Standing rules

- Every automated test ends by asserting `plp.checkErrors()` is empty (R8) —
  it catches integration mistakes at the moment of introduction.
- Tests assert through state (`window.plp`), not pixels; DOM assertions are
  reserved for features whose contract IS the DOM (chips, classes, caps).
- Engine-behavior claims (echo-once, interrupt semantics, recycle, budgets)
  are validated against the engine's documented contract — a failure here
  means OUR wiring broke, not the engine.

## Knowledge base — ledger permanence & placement (side-work additions)

| # | Feature | Best evidence | Coverage |
|---|---|---|---|
| K-LC | Tag-ledger permanence enforced against real VCS history (append-only; slug renames legal; splits/merges require successors) | `tools/check-ledger.mjs` pure `checkLedger(before, after)` verdicts pinned verbatim; CI runs it against the PR base via `.github/workflows/kb-ledger.yml` (bare Node, no browsers) | LC-1…LC-13 (`tests/ledger-check.spec.mjs`) |
| K-PL | Placement diagnostic: deterministic deepest-first DAG bisection over `loadKB()` only; correct answers credit the lineage, wrong answers contradict the subtree | Pure-Node property tests derive every expectation from `loadKB()` at runtime (no hard-coded counts): perfect student converges in fewer questions than concepts; all-wrong ends empty; lineage student placed exactly; same answers ⇒ same placement | P-1…P-7 (`tests/placement.spec.mjs`) |
