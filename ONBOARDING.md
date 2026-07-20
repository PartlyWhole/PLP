# PLP Engineering Onboarding — from first clone to senior judgment

This guide teaches the system the way the system teaches Python: **do
first, one concept at a time, with the reasons behind every rule** (that's
not a coincidence — see [design/game-tutorial-research.md](design/game-tutorial-research.md)).
It links to the authoritative docs rather than duplicating them; when this
guide and an as-built doc disagree, the as-built doc wins and this guide
has a bug.

**How to use it**: Parts 0–2 are your first day. Part 3 is your first
week. Parts 4–5 are your first month, read alongside real tasks. Parts
6–8 are the entry→senior material: read them early, understand them
gradually. Every part ends with exercises against the live app.

- [Part 0 — First hour: do, don't read](#part-0--first-hour-do-dont-read)
- [Part 1 — The domain](#part-1--the-domain)
- [Part 2 — Architecture tour](#part-2--architecture-tour)
- [Part 3 — The invariants, and the incidents behind them](#part-3--the-invariants-and-the-incidents-behind-them)
- [Part 4 — Subsystem deep dives](#part-4--subsystem-deep-dives)
- [Part 5 — Testing and the evidence culture](#part-5--testing-and-the-evidence-culture)
- [Part 6 — Design case studies (senior judgment)](#part-6--design-case-studies-senior-judgment)
- [Part 7 — Working practices](#part-7--working-practices)
- [Part 8 — The growth ladder](#part-8--the-growth-ladder)
- [Appendix A — Glossary](#appendix-a--glossary)
- [Appendix B — Document map and reading order](#appendix-b--document-map-and-reading-order)
- [Appendix C — Quick reference](#appendix-c--quick-reference)

---

## Part 0 — First hour: do, don't read

Don't read architecture yet. Get the system under your fingers.

```sh
npm install                      # once; Playwright only
node tools/dev-server.mjs        # → http://127.0.0.1:8619/PLP/
```

1. **Open the app** at `http://127.0.0.1:8619/PLP/`. The page may reload
   once on first visit — that's the cross-origin-isolation service worker
   installing (Part 1 explains why). The badge should read
   `isolation: isolated`.
2. **Press Run ▶.** The first run downloads ~12 MB of Python runtime;
   watch the console narrate it. Then: output appears in the terminal,
   and the memory model fills in on the right.
3. **Answer the prompt.** The sample program calls `input()`. Click the
   terminal, type your name, press Enter. This is a real terminal
   (xterm.js): try re-running and pressing **Ctrl+C** mid-wait.
4. **Scrub time.** Drag the slider in the memory pane fully left, then
   step forward with ▶ one line at a time. Watch three things move
   together: the highlighted line, the binding canvas, the console.
5. **Meet the debug API.** Open the browser devtools console and type:
   ```js
   plp.records().length          // raw trace records of the last run
   plp.memory.steps()[5]         // one complete engine snapshot
   plp.console.text()            // the transcript, from the source of truth
   plp.checkErrors()             // stream invariants — must be []
   ```
   `window.plp` is not a debugging afterthought — **it is the app's
   contract surface**. Every Playwright test asserts through it, and so
   will you.
6. **Inspect the dormant Director prototype.** The learner-facing Lesson
   control is deprecated during the core UI redesign. Run the D-series tests
   to exercise `app/director.mjs` and its preserved reference lesson.
7. **Run the tests.**
   ```sh
   npx playwright test           # ~2 min, all series
   ```
8. **See degraded mode.** Open `http://127.0.0.1:8619/PLP/?nonisolated`,
   run the sample. It ends with "program asked for input, but live input
   is unavailable" — that's the app being honest about a missing browser
   capability, not a bug (Part 1).

**Exercises**
- Change the sample program to crash (`1 // 0`), run, and find the
  exception three ways: terminal, memory pane's last step, and
  `plp.records().at(-1).exception`.
- In devtools: `plp.memory.goTo(0)` then `plp.memory.stepCount()`. Why is
  the count one more than the number of executed lines? (Answer in
  README "Stepping model".)

---

## Part 1 — The domain

### What this product is

A static, build-free web app that runs and *traces* Python in the
browser, then renders the trace three ways: a terminal (what the program
did), a memory model (what the interpreter's state was, line by line),
and — through the director — guided lessons over both. There is no
server; it deploys as a GitHub Pages **project site** under `/PLP/`.

### The engine, in ten sentences

[PyTrace](vendor/pytrace/) executes one Python program per run inside a
module Web Worker (Pyodide = CPython compiled to WebAssembly) and streams
a **record stream**: one `header`, many `step`s, optional `diagnostic`s,
exactly one `terminal`. Each `step` is a *complete snapshot* — call
stack, bindings, closure cells, a bounded reachable heap, output deltas —
so any moment of execution can be re-rendered without re-running.
Scalars are encoded inline; structured values live in a per-step `heap`
keyed by `uid`, and **uids are only meaningful within a single step**.
Budgets (`max_steps`, heap/container/output caps) end runs honestly with
distinct terminal reasons (`completed`, `uncaught_exception`,
`step_limit`, `interrupted`, `killed`, `needs_input`, …). Only
`builtins.input` is hooked for interactive input; there is **no EOF** in
the wire contract and interrupts are not catchable as
`KeyboardInterrupt`. The engine never inspects objects it can't inspect
safely — imported/builtin internals appear as truthful `opaque` markers,
and budget victims as visible `elided` markers. The facade
schema-validates every record before we see it; cross-record checks are
*our* job ([app/stream-checks.mjs](app/stream-checks.mjs)). The full
integration contract lives in the Engine Pilot repo:
`~/Pilot/FRONTEND-INTEGRATION-GUIDE.md` — the single most important
external document; read Parts I–II and IV of it during your first week.

### The browser constraints that shape everything

- **Live input and cooperative interrupt need `crossOriginIsolated`**
  (SharedArrayBuffer). GitHub Pages can't send COOP/COEP headers, so we
  ship [coi-serviceworker.js](coi-serviceworker.js), which reloads the
  page once on first visit. `?nonisolated` opts out → **degraded mode**:
  pre-supplied stdin only, hard-kill interrupt, `needs_input` terminals.
  Both modes are first-class and tested.
- **COEP `require-corp` bans cross-origin fetches** → everything is
  vendored, pinned, and hash-recorded ([vendor/PROVENANCE.md](vendor/PROVENANCE.md)).
  No CDNs, ever.
- **Project-site serving** → every URL must be relative or
  `import.meta.url`-derived. One vendored file is patched for this
  (the PyTrace worker; [vendor/PATCHES.md](vendor/PATCHES.md) — the ONLY
  upstream divergence). The dev server simulates the `/PLP/` prefix so
  these bugs surface locally.
- **No build step** — plain ES modules. What you write is what ships.

The distilled "engine facts that shape the UI" list in
[CLAUDE.md](CLAUDE.md) is worth memorizing; two you'll hit in your first
test: flood programs must use C-level ops (`"\n".join(map(...))`) or they
trip `max_steps` first, and interrupt demos need ms-scale C work per
iteration or the interrupt lands as `engine_error`.

**Exercises**
- Run with devtools Network open: verify zero cross-origin requests.
- In degraded mode, press Stop during a slow loop. Compare
  `plp.runner.summary()` (`killed`, `trace_complete: false`) with the
  isolated-mode result (`interrupted`, `trace_complete: true`).

---

## Part 2 — Architecture tour

### The one diagram

```
                       editor.getValue()
                              │
                     ┌────────▼────────┐  one live session, one run at a time
                     │  runner.mjs     │  (PyTrace worker in the background)
                     └────────┬────────┘
                              │  record stream (header/steps/diagnostics/terminal)
             ┌────────────────┼──────────────────────┐
   renderRecordToUI (the single fan-out, runner.mjs)  │ collab hooks
             │                │                       │ (mirror records
      ┌──────▼─────┐   ┌──────▼──────┐         ┌──────▼──────┐  to the room)
      │ console    │   │ memory      │         │ collab      │
      │ (terminal) │   │ (tables +   │         │ (followers  │
      │            │   │  scrubber)  │         │  replay)    │
      └──────┬─────┘   └──────┬──────┘         └─────────────┘
             │                │
             └── deterministic projections: same records ⇒ same panes
                              │
                    events.mjs (semantic learner events)
                              │
              ┌───────────────┼───────────────┐
        ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼──────┐
        │ director  │   │ questions │   │ your tests │
        │ + stage   │   │ + quiz    │   │            │
        └───────────┘   └───────────┘   └────────────┘
```

The sentence to internalize: **the record stream is the source of truth;
every pane is a deterministic projection of it.** The console renders
output deltas; the memory model renders snapshots; collab replicates the
records themselves and replays them through the *same* fan-out
(`renderRecordToUI` in [app/runner.mjs](app/runner.mjs)) so a follower's
screen cannot drift from the driver's. Scrubbing is re-projection of a
prefix. This one property is why time travel, late-join replay, and
deterministic tests are all cheap here.

Around that core sit two decoupling layers:

- **[app/events.mjs](app/events.mjs)** — modules *emit* semantic learner
  events (`run-ended`, `scrubbed`, `hover-name`, `quiz-graded`, …);
  the director and tests *subscribe*. Emitters don't know listeners
  exist.
- **`window.plp`** — the debug/contract API assembled in
  [app/main.mjs](app/main.mjs). Tests, lessons' condition predicates, and
  your devtools sessions all go through it.

### Reading order (follow it — each module assumes the previous)

1. [app/events.mjs](app/events.mjs) (5 min — the vocabulary)
2. [app/runner.mjs](app/runner.mjs) (+ its collab hooks)
3. [app/console.mjs](app/console.mjs) with [app/CONSOLE.md](app/CONSOLE.md)
4. [app/memory.mjs](app/memory.mjs) with [app/MEMORY.md](app/MEMORY.md)
5. [app/stage.mjs](app/stage.mjs) → [app/conditions.mjs](app/conditions.mjs)
   → [app/director.mjs](app/director.mjs) with [app/DIRECTOR.md](app/DIRECTOR.md),
   then [lessons/meet-the-machine.mjs](lessons/meet-the-machine.mjs)
6. [app/questions.mjs](app/questions.mjs) with [app/QUESTIONS.md](app/QUESTIONS.md)
7. [app/collab.mjs](app/collab.mjs) with [app/COLLAB.md](app/COLLAB.md)
8. Glue: [app/main.mjs](app/main.mjs), [app/editor.mjs](app/editor.mjs),
   [app/layout.mjs](app/layout.mjs), [index.html](index.html),
   [tools/dev-server.mjs](tools/dev-server.mjs)

**Exercises**
- Trace one record by hand: run a 3-line program, take
  `plp.records()[4]`, and find where each field ends up on screen.
- Subscribe live: `plp.events.on(e => console.log(e.type, e))`, then run,
  scrub, hover. Predict each event before it fires.

---

## Part 3 — The invariants, and the incidents behind them

[CLAUDE.md](CLAUDE.md) lists the load-bearing invariants tersely. Here is
*why each exists* — most were paid for with a real bug in this repo's
history. Senior engineers don't memorize rules; they can re-derive them.

**1. Guard re-entrancy BEFORE resetting any per-run state**
([runner.mjs](app/runner.mjs)). The failure mode: a second `run()` call
clears `records[]`, *then* gets rejected — and the live run's record log
is gone. The reference implementation this repo descends from shipped
that bug. Rule generalized: validate preconditions before mutating.

**2. Render at most once per animation frame while records stream**
([memory.mjs](app/memory.mjs)). Traces arrive at thousands of records/sec;
per-record DOM work is O(n²) main-thread time and freezes the tab. The
rAF-throttle pattern appears in the memory model, and its collab twin —
**one `handle.change` per frame, never per record** — exists for the same
reason plus history bloat.

**3. …and hidden tabs never fire rAF.** Discovered live in this repo: a
run finished in a background tab left the memory pane stuck on "no
steps" — `requestAnimationFrame` simply doesn't fire when
`document.hidden`. The fix is a timeout fallback. The senior lesson:
headless/visible test environments can't catch this class — Playwright
pages report visible. Some bugs need adversarial *environments*, not
adversarial inputs.

**4. Input echo happens exactly once, through exactly one path**
(`runner.provideInput`). History: with the terminal emulator, we disabled
the engine's echo and echoed locally in the console's line discipline —
and the very first test run caught programmatic input
(`plp.provideInput`) silently missing its echo, because it bypassed the
terminal. The fix moved the echo to the single choke point both paths
share, and made typed characters an erasable *preview*. Rule generalized:
when something must happen exactly once, give it exactly one owner.

**5. Every object target resolves to exactly one object pill under every
filter combination** ([app/MEMORY.md](app/MEMORY.md)). The display filters
(name-reachable-only, inline bases/functions/modules, hidden bindings)
each carve the Data In Memory list down; the invariant that keeps them honest
is closure under reachability *from visible names*. There is a DOM sweep
test asserting zero dangling targets. When you add a filter, that sweep is
your safety net.

**6. Uids are per-step, per-run.** The engine's identity encoding
guarantees nothing across steps or runs. Anything that compares uids
across runs (or targets them from lesson files) is wrong by
construction — which is why stage targets and question payloads use
*names and paths*, never uids.

**7. `term.write` is asynchronous.** The one flake this repo has had in
its own suites: reading `console.buffer()` immediately after a replay
races xterm's parser. Every buffer assertion polls. If you see a
console-related flake, check this first.

**8. The stage arranges; the learner performs; gates fail open**
([app/DIRECTOR.md](app/DIRECTOR.md)). There is deliberately no director
action that runs code or presses buttons (`until` triggers are
learner-events only; the linter rejects `idleMs` in `until`). And every
exit path — completion, user exit, *any* internal error — runs
`stage.reset()`. A lesson bug must degrade to free play, never to a
locked app. The crash test literally ships a beat that throws.

**9. CSS can defeat the `hidden` attribute.** Found by screenshot during
director work: the quiz panel's `display: flex` overrode `[hidden]` and
the panel had been visible-when-closed for its entire life — no state
assertion caught it because state said `hidden: true`. The lesson:
DOM-visibility contracts need a visual or computed-style check at least
once; state and pixels can disagree.

**10. Presence staleness is checked at read time** ([app/collab.mjs](app/collab.mjs)).
Background tabs throttle timers, so TTL *pruning* can lag by minutes; a
dead driver would wedge the room's run lock. The roster is therefore
filtered through a freshness window wherever it's *read*. Generalized:
in browsers, never trust a background timer to fire on time; make reads
defensive instead.

**Exercises**
- Break invariant 2 on purpose (comment out the rAF throttle, run a
  10k-step loop) and feel the tab freeze. Revert.
- Find the zero-dangling-chips sweep in [tests/smoke.spec.mjs](tests/smoke.spec.mjs)
  and explain to a rubber duck why it must pass with filters both on
  *and* off.

---

## Part 4 — Subsystem deep dives

Each subsystem: what it owns, the decisions that define it, where its
full documentation lives, and exercises. Read the linked doc *before* the
module source.

### 4.1 Runner ([app/runner.mjs](app/runner.mjs))

Owns the PyTrace session and the run lifecycle. Defining decisions: the
two-failure-path contract (pre-stream rejections vs terminal records —
nothing else exists); `renderRecordToUI` as the shared driver/follower
fan-out; terminal reasons mapped to human closing lines (`END_NOTES`);
`echo_stdin` disabled only when live input is possible. The session
object survives the engine's internal worker recycling (every 20 runs) —
you never re-create it.

*Exercises*: drive every terminal reason from the console (the
VALIDATION R4 row lists the programs). Explain why `run()` never rejects
after the first record.

### 4.2 Console ([app/console.mjs](app/console.mjs) · [app/CONSOLE.md](app/CONSOLE.md))

A real terminal (vendored xterm.js) over a **chunk store that remains
the source of truth** — the screen is a deterministic replay view
(`X0a`/`X0b` in [VALIDATION.md](VALIDATION.md)). Owns the inline input
line discipline (preview-and-erase, history, byte limits, Ctrl+C/Ctrl+D)
and scrub-time reconstruction. Knows nothing about lessons or collab.

*Exercises*: write a `\r` progress-bar program and watch it overwrite;
print ANSI colors and inspect `plp.console.term.buffer` cell attributes;
explain why `text()` ≠ `buffer()` in general.

### 4.3 Memory model ([app/memory.mjs](app/memory.mjs) · [app/MEMORY.md](app/MEMORY.md))

Owns the visual binding canvas, contextual reference paths, object ordering,
the **display-filter pipeline** (six toggleable constituents; read the doc's
rationale table), **line-step scrubbing**
(synthetic position 0; each position shows the state its line *produced*;
engine-step mode preserves raw semantics), scope-aware textual hover
highlighting (including strings/comments), active hover phases, and the
trace-derived scope info that powers it.

*Exercises*: toggle every filter from devtools and predict each change
before `refresh()`; run the `[[0,0]]*3` aliasing program and narrate the
repeated ids and object pills; add a throwaway seventh filter locally (hide
`None` bindings, say), then delete it. You now know the pipeline.

### 4.4 Questions & quiz ([app/questions.mjs](app/questions.mjs) · [app/QUESTIONS.md](app/QUESTIONS.md) · [app/quiz.mjs](app/quiz.mjs))

The engine is pure and DOM-free: generators produce serializable
questions with `grade()` closures; memory questions are *trace-grounded*
(blanks are the diff between real snapshots). The quiz panel is
explicitly disposable pilot UI. Determinism under explicit options is
what makes the Q-series exact.

*Exercises*: generate each kind from devtools with explicit options;
explain why `generateQuestion` returns `null` rather than a degenerate
question; sketch (don't build) a new kind and check it against the
"Extending" section of the doc.

### 4.5 Director stack ([app/events.mjs](app/events.mjs) · [app/stage.mjs](app/stage.mjs) · [app/conditions.mjs](app/conditions.mjs) · [app/director.mjs](app/director.mjs) · [lessons/](lessons/) · [app/DIRECTOR.md](app/DIRECTOR.md))

The grammar/pedagogy split: the runtime implements beats, gates,
attention effects, triggers, hints, signals, branching, telemetry — and
contains **zero curriculum**; lessons are human-authored data, linted at
load. Grounded in the verified research
([design/game-tutorial-research.md](design/game-tutorial-research.md))
and the plan ([design/director-plan.md](design/director-plan.md)).
Gates persist across beats; effects don't. Structured targets re-anchor
across the memory pane's re-renders.

*Exercises*: author a 3-beat lesson for `for` loops in a scratch file and
`plp.director.start(yourLesson)` it — the linter will teach you the
grammar; add a `usedScrubber` condition predicate locally; read
`plp.director.telemetry()` after a lesson and say which beat needs
rewording (that *is* the fluency metric).

### 4.6 Collab ([app/collab.mjs](app/collab.mjs) · [app/COLLAB.md](app/COLLAB.md) · [tools/collab-vendor-build/](tools/collab-vendor-build/))

Rooms replicate **the record stream, not the panes**, over an Automerge
doc `{code, run}` carried concurrently by three free transports (public
sync relay, WebRTC-via-Nostr, BroadcastChannel) with *emergent* fallback
— no switchover state machine, because idempotent sync makes "whichever
pathway lives, carries" correct. Driver = whoever pressed Run, for that
run only. Presence/scrub is ephemeral, never in the doc. The vendored
bundle is *built*, not fetched (WASM-inlining pitfall — read the comment
at the top of [tools/collab-vendor-build/build.mjs](tools/collab-vendor-build/build.mjs)),
and the invite link is a **bearer capability**: anyone with it can read
and write forever. Trip hazards: `plp.collab.records()` is `null` for
the driver (use `plp.records()`); Leave does a full page reload on
purpose.

*Exercises*: open two tabs on a `?transports=tabs` room and watch
character-level merge of simultaneous edits; run in tab A and verify tab
B's transcript is string-equal (`plp.console.text()`); read the
fault-injection test (`tests/collab.spec.mjs`) and explain what SIGKILL
proves that a graceful shutdown wouldn't.

### 4.7 Shell, layout, serving ([app/main.mjs](app/main.mjs) · [app/layout.mjs](app/layout.mjs) · [index.html](index.html) · [tools/dev-server.mjs](tools/dev-server.mjs))

Wiring, the `window.plp` contract, pane gutters/maximize (sizes persist
in localStorage; Esc restores), COI shim bootstrap, and the 80-line
prefix-simulating dev server (`--coi` flips header posture). The serving
rules in [CLAUDE.md](CLAUDE.md) §1 are absolute.

*Exercises*: add `--prefix foo` to the dev server and see the app still
work (that's the relative-URL discipline paying off); find what breaks if
you deliberately introduce a root-absolute path (then revert).

---

## Part 5 — Testing and the evidence culture

The repo's testing philosophy, in order of importance:

1. **[VALIDATION.md](VALIDATION.md) is the contract.** Every feature has
   a row: the feature, the *best possible evidence* for it, and current
   coverage (honest GAPs included). Adding a feature means adding a row —
   ideally before the code. The matrix is organized in series that map
   1:1 to spec files: S (smoke), X (emulator), Q (questions),
   D (director), CO (collab).
2. **Assert state, not pixels.** Tests drive `window.plp` and the event
   bus. DOM assertions are reserved for features whose contract *is* the
   DOM (gates, effects, chips, style classes). Screenshots are for
   humans.
3. **Prefer independent oracles.** The strongest assertions compare two
   things that could disagree: `console.engineText()` vs the
   stream-check reconstruction; follower records vs driver records;
   line-mode state vs engine-mode state for the same step. A test that
   checks code against itself proves little.
4. **Every run ends with `plp.checkErrors()` → `[]`.** The consumer-side
   stream checker catches integration mistakes the moment they're
   introduced, in whatever test happens to be running.
5. **Serve tests like production.** The suite runs under the `/PLP/`
   prefix with NO headers — the service-worker posture, i.e. real GitHub
   Pages. First-visit reload is ridden out with
   `waitForFunction(() => crossOriginIsolated)`.

**Flake taxonomy** (all three observed and fixed here — recognize them):
- *Async rendering*: `term.write` and rAF-scheduled table renders → poll
  (`expect.poll`) after any action that triggers a redraw.
- *Suite-order state*: a test passing alone but failing in sequence →
  look for shared state the previous test perturbed (found once in the
  X-series; fixed by polling, not by reordering).
- *Environment-dependent timers*: background-tab throttling — the class
  of bug automated suites structurally miss; compensate with defensive
  code (read-time freshness, timeout fallbacks) and manual passes.

**Test-program craft** (engine facts, will bite you otherwise): flood
output with C-level ops, not Python loops (`max_steps`); interrupt demos
need `sum(range(100_000))`-scale work per iteration; never grep raw
records for source text (the header embeds the whole program).

**Exercises**
- Pick any GAP row in VALIDATION.md and write the test (see Part 8 for
  curated picks).
- Take one existing assertion and make it *stronger* by adding an
  independent oracle. If you can't, explain why it's already maximal.

---

## Part 6 — Design case studies (senior judgment)

Six real decisions from this repo's history, each with the reasoning
pattern to take with you.

**Case 1 — Exactly-once echo.** *Problem*: with engine echo on plus a
local terminal echo, input lines double; with both off, they vanish; two
UI paths (typed vs programmatic) must agree. *Options*: echo in the
terminal's line discipline; echo in the engine; echo at the runner.
*Decision*: engine echo off in live mode; typed characters are an
erasable preview; the one echo lives in `runner.provideInput`, the choke
point every path crosses. *Principle*: *exactly-once behaviors get
exactly one owner, placed at the narrowest shared point.*

**Case 2 — Line-step semantics.** *Problem*: the engine's truthful
before-the-line snapshots made the scrubber feel wrong (highlight and
state permanently off-by-one for learners). *Options*: relabel; explain
in docs; re-group. *Decision*: keep the raw engine mode intact, but
default to a *derived* position space — one position per executed line,
showing the state it produced, with a synthetic "before the program
runs" anchor. *Principle*: *don't average two mental models; build each
one honestly and let the user switch.*

**Case 3 — Display policy as filters.** *Problem*: the raw heap view
drowned learners (builtin `object` base, function/module objects). *Options*:
hardcode a curated view; hide things ad hoc. *Decision*: a pipeline of
individually toggleable filters over untouched records, with one
invariant (object targets always resolve) enforced across all combinations, and
truth markers (`opaque`/`elided`) dimmed but never hidden. *Principle*:
*opinionated defaults, inspectable mechanism, reversible in code — and
never let simplification become dishonesty.*

**Case 4 — Collab replicates records, not panes.** *Problem*: what do
peers share — text? DOM? screen state? *Decision*: replicate the record
stream and let every peer re-project it through the same fan-out function
the driver uses; presence stays ephemeral. Followers can't drift, late
joiners replay for free, and the doc history stays meaningful.
*Principle*: *sync the source of truth, not its projections — and make
sure there is exactly one projection function to share.*

**Case 5 — Vendored xterm vs hand-rolled ANSI.** *Problem*: terminal
fidelity (`\r`, colors, cursor). *Process*: research the engine contract
first (EOF impossible, interrupts uncatchable — so those were struck from
scope), inventory options with costs (250-line subset vs 337 KB
dependency), plan with acceptance criteria (X-series written before
code), migrate behind the *same* module API so the old tests gated the
new implementation. *Principle*: *scope against the contract, not the
wishlist; adopt dependencies behind your own API so the suite diff
measures exactly what changed.*

**Case 6 — Director: grammar vs pedagogy.** *Problem*: game-quality
tutorials need sequencing, gating, attention, adaptivity — but curriculum
judgment is human. *Decision*: implement an expressive, lintable grammar
(beats/gates/effects/triggers/signals) with hard non-goals (no autoplay,
no modals, no built-in pacing policy) and put every word and every beat
in data files. The research doc's verified findings became runtime
*constraints* (e.g. `idleMs` is grammatically illegal in `until` because
help must be a response, never a schedule). *Principle*: *encode values
as invariants of the mechanism; keep taste in data where domain experts
can own it.*

---

## Part 7 — Working practices

- **Docs live beside code.** Substantial modules carry an as-built `.md`
  sibling (CONSOLE/MEMORY/QUESTIONS/DIRECTOR/COLLAB). If your change
  makes the doc wrong, the doc change goes in the same commit.
- **Decisions live in [design/](design/).** Research reports and plans,
  written *before* implementation, kept after — they're why Part 6 could
  be written. Nontrivial features start with one.
- **Vendoring rules**: pinned versions, sha256 in
  [vendor/PROVENANCE.md](vendor/PROVENANCE.md), upstream divergences
  documented in [vendor/PATCHES.md](vendor/PATCHES.md) (currently exactly
  one, and it should stay countable on one hand). Built artifacts record
  their recipe (collab bundle).
- **The loop**: research (verified, with refuted-claims lists) → plan
  (contract, impact, steps with per-step checks, open decisions) →
  implement smallest-coherent-change → verify in widening rings →
  final-diff review. You'll find each stage's artifacts in the history.
- **Commit hygiene**: one coherent change per commit; message says *why*;
  VALIDATION/docs updated in the same commit; suite green before commit.
- **Deployment gates** ([CLAUDE.md](CLAUDE.md)): not yet public; the
  engine-licensing decision and push consent are explicit human gates.
- **When you're stuck**: reproduce first; read the as-built doc second;
  the engine guide third; only then the source. If the answer wasn't in
  the docs, your fix includes the doc line that would have saved you.

---

## Part 8 — The growth ladder

Five levels. Every task is real (most are open GAP rows in
[VALIDATION.md](VALIDATION.md)); each level names the understanding it
certifies. Do them in order; the codebase is the curriculum.

**L1 — Projections & tests** (first weeks)
Close E3/E4 (editor highlight follows position; cleared at anchor), C3
(`end=""` partial lines), C5 (empty input line is valid). *Ready when*:
you can add a state-based Playwright test without looking at existing
ones, and explain the stepping model from memory.

**L2 — Engine semantics** Close R6 (Stop in BOTH postures — you'll need
the ms-scale-work fact), M9 (cycles), M10/M11 (elision markers + flags
via tiny budgets — you'll drive the engine's options directly). *Ready
when*: you can predict a program's terminal reason and step count before
running it.

**L3 — Subsystem ownership** Close R3 (re-entrancy guard proof), X4/X5
(cursor-movement + malformed-escape corpus for the emulator), P6 (live
follow/detach). Rebuild the collab vendor bundle from the recipe and
verify the hash discipline. *Ready when*: you can review a PR touching
console/memory and cite the invariant it threatens.

**L4 — The product layer** Author a *real* lesson (not the placeholder):
pick one concept (aliasing is ready — `sameObject` exists), write the
kishōtenketsu arc, add any missing condition predicate, run five humans
or five honest self-sessions, read `plp.director.telemetry()`, and
revise. Also: strengthen one Q-series generator (e.g. blank-selection
options). *Ready when*: your lesson's telemetry drove a change you can
defend with Part 6-style reasoning.

**L5 — Design authority** Do a design-doc-first feature end to end.
Curated candidates: DR12 (collab × director — who is the learner in a
shared lesson?); an engine EOF proposal (protocol change writeup against
the wire contract); adaptive question difficulty over quiz telemetry
(the research doc's open question #4). *Ready when*: your design doc
survives adversarial review — someone tried to refute it and the doc
already contained the answer. That's the bar this repo's research and
plans set.

---

## Appendix A — Glossary

| term | meaning |
|---|---|
| record | one element of a run's stream: `header` / `step` / `diagnostic` / `terminal` |
| step | a complete per-line snapshot (stack, bindings, heap, output deltas) |
| position | line-step mode's unit: one executed source line (+ synthetic position 0); ≠ raw step index |
| uid | per-step heap identity; never compare across steps/runs |
| data id | the clickable data<sub>N</sub> identity handle in the memory canvas |
| chunk store | the console's authoritative output log; the xterm screen is its projection |
| echo | the transcript copy of an accepted input line (exactly once, via `runner.provideInput`) |
| beat | one unit of a lesson: arrange (`do`) → learner acts (`until`) → advance |
| gate | a capability the stage can deny (run/edit/scrub/…); fails open |
| veil / spotlight / say / popover / cue / pulse | the stage's per-beat attention effects; `say` types through the illustrated tutor, and `cue` selects pulse/bounce/wiggle motion |
| signal | per-beat fluency counter (`attempts`, `quizTries`, `hintsShown`, `elapsedMs`) |
| driver / follower | collab roles per run: who executes vs who replays |
| degraded mode | non-isolated posture: pre-supplied stdin, hard-kill interrupt |
| posture | how isolation is achieved: real headers (`--coi`) vs service-worker shim |
| oracle | the independent source of truth a test compares against |

## Appendix B — Document map and reading order

Day 1: this guide Parts 0–2 → [README.md](README.md).
Week 1: [CLAUDE.md](CLAUDE.md) → engine guide (`~/Pilot/FRONTEND-INTEGRATION-GUIDE.md`,
Parts I–II, IV) → [app/CONSOLE.md](app/CONSOLE.md) + [app/MEMORY.md](app/MEMORY.md).
Month 1: [app/DIRECTOR.md](app/DIRECTOR.md) + [app/QUESTIONS.md](app/QUESTIONS.md)
+ [app/COLLAB.md](app/COLLAB.md) → [design/](design/) (research + plan) →
[VALIDATION.md](VALIDATION.md) end to end.
Reference forever: [vendor/PROVENANCE.md](vendor/PROVENANCE.md),
[vendor/PATCHES.md](vendor/PATCHES.md).

## Appendix C — Quick reference

```sh
node tools/dev-server.mjs            # http://127.0.0.1:8619/PLP/ (GH-Pages posture)
node tools/dev-server.mjs --coi      # real-headers posture
npx playwright test                  # all series; PW_ALL_BROWSERS=1 for 3 engines
npx playwright test tests/director.spec.mjs -g "hints"   # one test
```

Debug API essentials: `plp.run()` · `plp.records()` · `plp.checkErrors()`
· `plp.console.text()/buffer()/term` · `plp.memory.steps()/goTo()/filters/refresh()`
· `plp.events.log()/on()` · `plp.director.start()/state()/telemetry()` ·
`plp.stage.gate()/spotlight()/reset()` · `plp.quiz.newQuestion()/check()`
· `plp.lintLesson()` · `plp.__eval({check…})` · `plp.collab`.

Engine facts you will forget at your peril: uids are per-step; no EOF;
interrupts uncatchable; `stdinLines` ignored when isolated; flood tests
need C-level ops; interrupt tests need ms-scale iterations; the header
record embeds the full source.
