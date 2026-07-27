# Tutor — plan for the guided-training feature

Status: design (2026-07-27). Successor to the removed director/stage/lessons
prototype (recoverable at `4fbd3a7^`); grounded in
[game-tutorial-research.md](game-tutorial-research.md) and the exercise bank
`python_exercises.md` (Desktop; to be adapted into `curriculum/`).

## 1. What we're building

A guided training experience that walks a student through the fundamentals
of Python with high precision, using the live app as the laboratory. The
student is continuously asked to **do** one of two things:

1. **Write code** — all of a program, or the missing parts of one.
2. **Predict code** — the output and/or memory state of a whole program,
   or the state/output *after a specific line*.

Between (and inside) those asks, the tutor provides scaffolding in words
**and** in visuals/animations, escalating only on demonstrated need. All of
it accumulates in a persistent, scrollable **Tutor pane** — a chat-history
style feed docked beside the existing three panes.

The conceptual trajectory (each item becomes a unit, §7):

1. The state + I/O model — every program is `(state, input) → (state′, output)`
2. Variable bindings as the concrete realization of "state"
3. Getting input (`input()`; mention key presses for games — awareness only)
4. Producing output (`print()`; mention rendering/sound — awareness only)
5. Data types — precision about what value has what type, and why it matters
6. `if`/`elif`/`else` — the structure *and* the logic patterns
7. Lists and 2D lists — precise use, aliasing, identity
8. Loops — structure and patterns (accumulator, filter, search, early exit)
9. Combinations of the above
10. Functions — frames, scope, arguments, return values

## 2. What exists vs. what's missing

Build on (already shipped, tested, dormant or live):

| Asset | Reuse |
|---|---|
| Question engine (`questions.mjs`) — 7 kinds, deterministic, `grade()` closures | The assessment core. Extended, not replaced |
| Construction workspaces (`construction*.mjs`) — memory-graph builder, evaluation tray | The answer medium for memory prediction |
| Memory pane visual grammar (boxes = names, pills = data, dataN identity) | Tutor visuals speak the SAME vocabulary |
| Events bus (`events.mjs`) — learner-action events | Drives `await` steps, behavior-triggered hints |
| Runner two-path model (Run untraced / Trace traced) | Ground truth for grading; check-runs are real, visible runs |
| Console chunk store + `showUpTo(steps, index)` | Output-up-to-a-line ground truth |
| Editor `highlightLine`, memory hover/chip highlights | In-place attention direction |
| Research rules R1–R10 (`game-tutorial-research.md`) | Pedagogy constraints (see §8) |
| Exercise bank `python_exercises.md` | Content source for units 5–9 |

Missing (the feature):

- **Output prediction** — no question kind asks "what does this print?"
- **Free code writing with behavioral grading** — code kinds are fill-in
  blanks graded textually; nothing runs the student's code and checks what
  it *does*.
- **A checker harness** — run a program against scripted stdin, capture
  output/final memory, compare against a spec, always reach terminal state.
- **Sequencing** — the engine is deliberately policy-free ("curriculum
  sequencing composes at a higher layer"); that higher layer doesn't exist.
- **The Tutor pane** — no persistent instructional surface; the quiz panel
  is a floating one-question-at-a-time debug shell.
- **Visuals/animations as scaffolding** — nothing renders an explanatory
  diagram; the memory pane only shows real runs.
- **Progress/adaptivity** — no persistence of mastery, no hint escalation.

## 3. Architecture

New modules (each pure where possible, mirroring the engine/UI split the
question system already uses):

```
curriculum/               authored content, one module per unit
  index.mjs               unit registry + skill graph
  u1-state-io.mjs …       lesson scripts (data, no DOM)
app/tutor.mjs             lesson runtime: interprets scripts, owns session
                          state, subscribes to events, drives everything
app/tutor-ui.mjs          the Tutor pane: transcript feed, cards, controls
app/question-ui.mjs       question renderers EXTRACTED from quiz.mjs so
                          transcript cards and the quiz panel share them
app/checker.mjs           behavioral grading harness over the runner
app/visuals.mjs           parameterized explanatory widgets (SVG/DOM),
                          reduced-motion aware
app/questions.mjs         + new kinds: predict-output, write-program,
                          write-lines, predict-value (§5)
app/TUTOR.md              as-built doc (written when built, per repo custom)
```

Data flow:

```
curriculum script ──▶ tutor.mjs ──▶ tutor-ui.mjs (transcript cards)
                        │  ▲                │
        loadCode/ask/…  │  └── events.mjs ──┘  (learner actions)
                        ▼
        editor / runner / memory / console  (the real app — unchanged)
                        ▲
        checker.mjs ────┘  (grading runs = ordinary visible runs)
```

`window.plp.tutor` exposes `start(unitId)`, `state()`, `answer()`, `feed()`
etc. for the T-series Playwright tests (invariant 9: assert via `plp`).

The existing panes are **not forked**. The tutor arranges and observes; the
student performs in the real editor/console/memory panes (research R1, R10 —
never a separate practice sandbox, never modal).

## 4. The Tutor pane (chat history)

A fourth column (leftmost; collapsible to a tab) added to `index.html` +
`layout.mjs` with its own gutter and localStorage-persisted width.

The pane is a **transcript feed** — an append-only history of cards:

- **tutor card** — prose scaffolding; markdown subset (`**bold**`, `` `code` ``,
  fenced code). Fenced code blocks get a *"↪ try it"* affordance that loads
  the snippet into the editor (stashing the student's code, §9) — this is
  the exercise bank's "run the REPL derivation yourself" made one-click.
- **visual card** — a widget from `visuals.mjs`, optionally with a replay
  button (animations run once, politely, and are replayable).
- **question card** — an embedded question: prompt + the same renderer the
  quiz panel uses (via `question-ui.mjs`) + Check / Hint / Skip. After
  grading, the card freezes to show the answer given, the verdict, and any
  per-blank marks; feedback and follow-up scaffolding arrive as new cards
  below it. Wrong answers never dead-end (R6 of the old authoring rules):
  the hint ladder ends in the full derivation.
- **action card** — "do this in the app" (e.g. *Run the program*, *Scrub to
  line 4*, *Change line 2 so the output becomes 12*). Completes itself by
  observing the events bus, then the tutor continues. A quiet "stuck?"
  affordance appears only after idle/behavior triggers (R5).
- **learner card** — echo of what the student did/answered, so the feed
  reads as a genuine two-sided history.

Session controls live in the pane head: unit picker, progress dots,
pause/exit (always visible, nothing modal — fail-open like the director's
gates). The transcript for the active unit persists in localStorage so a
reload restores the conversation.

## 5. New question kinds and the checker

### 5.1 `predict-output` (needsTrace or self-grounding)

"What does this program print?" / "What has been printed *after line N*?"

- Whole-program: expected = concatenated stdout/stderr chunks of the last
  completed run (or a checker run the tutor performs silently first — no:
  runs are always visible; the tutor runs it *after* the student commits a
  prediction, which is itself the pedagogy — predict, then watch it run).
- After-line-N: expected = output chunks up to the trace position for line
  N (the console's `showUpTo` mapping, exposed as a pure helper).
- Answer UI: a monospace textarea (or per-line inputs for short outputs).
  Grading normalizes trailing whitespace per line; everything else exact —
  precision is the point of the curriculum, sloppy matching would undermine
  unit 5.

### 5.2 `write-program` (authored spec, behavioral grading)

The author supplies a task: prompt, optional starter code, and a spec:

```js
{
  kind: "write-program",
  prompt: "Read two integers and print their product.",
  starter: "",                       // or scaffold with locked lines
  checks: [
    { stdin: ["3", "4"], stdout: "12\n" },
    { stdin: ["0", "9"], stdout: "0\n" },
    { finalState: { name: "total", value: "12" } },   // optional, traced
  ],
}
```

Grading = `checker.mjs` runs the student's editor content once per check.

### 5.3 `write-lines` (partial writing)

Authored blanks by **line ranges the author chooses** (unlike the regex
`code-structure` heuristic): locked lines render read-only in the editor
(CodeMirror `markText` read-only ranges), the student writes the rest in
place — in the real editor, not a form. Grading is behavioral (the same
`checks` spec), with textual comparison only as a hint source ("your line 3
differs from the reference"). This sidesteps the pilot's known limit of
regex parsing and strict textual equivalence.

### 5.4 `predict-value` (self-grounding micro-questions)

For the data-types unit: "value AND type of `-7 // 2`?" Two fields (value,
type). Ground truth comes from tracing the one-liner `x = <expr>` and
reading the snapshot — the platform's trace-grounded ethos applied to
authored micro-questions: authors write expressions, never answers, so the
answer key cannot be wrong.

### 5.5 `checker.mjs` contract

`check(code, spec) → { pass, output, terminal, records?, diff }`.

- Uses the **existing runner instance** — check runs are ordinary, visible
  runs (the student watches their program run; the console shows the real
  transcript). Respects invariant 2: never starts while a run is live;
  surfaces `run-rejected` as "finish/stop the current run first".
- stdin: in live (isolated) mode, `stdinLines` is ignored by the engine, so
  the checker answers `input()` prompts via `runner.provideInput` as they
  arrive; in degraded mode it passes `stdinLines`. Same spec, both postures.
- Termination: arms a deadline per check (reusing the interrupt-deadline
  pattern from `fastrun.mjs`); a student's accidental `while True:` ends in
  a terminal state and a gentle "it never finished — what would make the
  loop stop?" card, not a wedge (invariant 2's hard lesson).
- Path choice: `stdout`-only checks Run (untraced — always finishes);
  `finalState` checks Trace, with the step-budget terminal handled as
  "program too long to trace" feedback (invariant 3).

## 6. Visuals and animations (`visuals.mjs`)

Small library of parameterized, replayable widgets. Two hard rules:

1. **Same visual grammar as the memory pane** — boxes are names, typed
   pills are values, dataN pills carry identity, solid vs dashed arrows
   mean what they already mean. The visuals *teach the instrument* the
   student then reads during real runs; a second vocabulary would tax the
   very working memory we're trying to spare.
2. Respect `prefers-reduced-motion`; every animation has a static final
   frame and a replay control; nothing autoplays more than once.

Initial vocabulary (one per unit need, built when its unit is built):

| widget | teaches | unit |
|---|---|---|
| `stateMachine` | state box + program → state′ + output; animate one tick | 1 |
| `bindingAnim` | name box sprouting an arrow to a pill; rebinding vs mutation side-by-side | 2, 7 |
| `ioTimeline` | program ↔ console lanes; `input()` pauses the program lane | 3, 4 |
| `typeTag` | a value with its type badge; coercion arrows (`"3"` → `int("3")` → `3`) | 5 |
| `indexRuler` | the between-the-characters ruler from exercise 2.1 | 5, 7 |
| `branchRail` | a value token flowing through if/elif/else diamonds; taken path lights, untaken dims | 6 |
| `gridView` | 2D list as row-reference pills — makes `[row]*3` aliasing visible *before* the trap | 7 |
| `loopUnroll` | one loop, unrolled iterations sliding past; break/continue as exits/skips | 8 |
| `frameStack` | call frames pushing/popping with arguments crossing and return value coming back | 10 |

Plus in-place attention direction: a thin `point()` helper (highlight a
line, pulse a Names cell, ring a pane) — resurrected as a ~100-line subset
of the removed `stage.mjs` (git `4fbd3a7^`) rather than rebuilt; we take
targets/cues and leave gates/veils/popovers behind.

The best animation we own is the app itself: many "visuals" are **directed
replays** — the tutor loads code, traces it, and scrubs the memory pane
between two positions while narrating. Prefer that to a bespoke widget
whenever the live pane can show the idea (R4).

## 7. Curriculum: content model and trajectory

### 7.1 Lesson script shape

Authored data, no DOM, linted at load (unknown refs are load-time errors —
the director's best idea, kept):

```js
export default {
  id: "u2-bindings", unit: 2, title: "Names and state",
  skills: ["bind", "rebind", "read-before-write"],
  steps: [
    { say: "…" },
    { show: { widget: "bindingAnim", args: {...} } },
    { loadCode: "x = 3\ny = x\nx = 5\nprint(y)" },
    { ask: { kind: "predict-output" } },                  // engine-generated
    { ask: { kind: "memory-construct", opts: { position: 2, mode: "partial" } } },
    { do: "trace", await: { event: "run-ended" } },       // action card
    { say: "…", if: { lastAnswer: "wrong" } },            // branch
    { ask: { kind: "write-program", spec: {...} } },      // authored
  ],
  hints: { /* per-ask ladders: nudge → mechanism visual → derivation */ },
};
```

Steps run strictly in order with simple `if:` branches keyed on the last
result and per-lesson signals (attempts, hintsShown) — deliberately less
general than director beats; a conversation is linear with detours, and the
authoring cost of a full trigger grammar is what left the director unused.

### 7.2 Unit trajectory (kishōtenketsu per unit: introduce → develop → twist → mastery)

| unit | core idea | twist | exercise-bank sources |
|---|---|---|---|
| 1 | state + I/O: run the preloaded sample, watch memory change line by line — the model *is* the pane | same program, different input → different trajectory | new content; R1: zero prose before first Run |
| 2 | bindings are the state; rebinding vs reading | `a, b = b, a` (RHS-first) | 4.3; is-vs-== seed from 1.4 |
| 3+4 | input/output as the state boundary; echo, prompts, one awareness card each for keys/graphics | `print` returns `None`; `input` always returns `str` | new; bridges into unit 5 |
| 5 | data types: value+type precision drills (`predict-value`), conversions | `"10" < "9"`; `0.1 + 0.2`; `True + True` | 1.1–1.4, 2.1–2.3, 4.1, 7.1 |
| 6 | branching structure and logic patterns | stacked-if vs elif (grade_a/grade_b); shadowed FizzBuzz | 7.1–7.4, 9.2 |
| 7 | lists, aliasing, identity; 2D grids | `copy[0][0] = 9` mutates `grid`; `[row]*3` | 3.1–3.4, 4.2, 8.4 |
| 8 | loops: accumulator, filter, search, break/continue | mutate-while-iterating; `for/else` | 8.1–8.4, 9.1 |
| 9 | combinations: trace + build small real programs | word frequency capstone decomposed into named prior skills | 9.3–9.5, 6.1 |
| 10 | functions: frames, scope, args, return | mutating a list argument vs rebinding a parameter | 3.1's closing note; new content; `frameStack` + memory pane frames |

The exercise bank's four-part structure maps 1:1 onto platform moves:
**Exercise** → question card (predict/write); **Scaffolding** → tutor cards
whose REPL derivations are "↪ try it" runnable snippets; **Pocket of
knowledge** → a collectible summary card (the transcript becomes the
student's reference notebook); **its »verify« step** → the mandated
run-after-predict, which the platform performs for real.

Memory-model display filters become curriculum instruments: unit 10 turns
`hideFunctionBindings` off when teaching that `def` binds a name, etc. —
they were designed for exactly this.

### 7.3 Adaptivity and progress

- Per-skill mastery counters updated by question results (skill atoms, not
  a linear score); a unit's mastery task gates the "next unit" suggestion
  but never locks anything (R10: never block the doing).
- Hint ladders per ask; behavior-triggered quiet hints from events (idle,
  repeated failed runs, never scrubbing when a scrub would answer it) — R5.
- Progress + transcript in localStorage (`plp.tutor.progress.v1`);
  telemetry mirrors the director's fluency metrics: time-to-correct-
  prediction, hint count, attempts (R9 — not quiz-score deltas).

## 8. Pedagogy constraints inherited (research doc, enforced by design)

R1 first contact is a real Run, not prose · R3 one concept per unit,
twist included · R4 attention via existing affordances · R5 hints are
behavior-triggered and quiet · R6 explicit depth on demand ("why?" cards)
· R7 the interface is content (unit 1 teaches Run/console/scrubber
explicitly) · R8 ramp with demonstrated ability · R10 nothing modal,
everything skippable, text in small anchored doses.

## 9. Invariants and risks

- **Runner (inv 2, 3)**: the checker adds no third failure path — it only
  observes terminal records; deadlines guarantee termination of grading
  runs; `stdout` checks use Run, `finalState` checks use Trace with the
  budget terminal surfaced as feedback.
- **Serving (inv 1)**: no new fetches; curriculum ships as ES modules,
  relative imports only.
- **Editor ownership**: `loadCode` stashes the student's current code
  (keyed alongside `plp.editor.code.v1`) and the pane offers "restore my
  code" on exit — the tutor must never destroy student work.
- **Collab (inv 7, 8)**: v1 is solo — the Tutor pane hides in a live room
  (the transcript is local state; sharing it is a designed feature, not an
  accident to leak). Runs the tutor triggers in a room would share like any
  run; hiding the pane avoids the question entirely for now.
- **Tests (inv 9)**: T-series spec asserting via `plp.tutor`; every test
  ends with `plp.checkErrors()`. VALIDATION.md rows per shipped phase.
- **Content risk**: authoring is the long pole (the director died of
  content starvation, not code). Mitigation: the exercise bank pre-writes
  units 5–9; phase 1 ships exactly one excellent unit before any framework
  generalization; every framework feature must be demanded by a concrete
  lesson already being written.

## 10. Phasing (each phase lands runnable + tested + documented)

1. **Skeleton + first unit** — Tutor pane, transcript cards, lesson
   runtime (linear + `if:` branches), `question-ui.mjs` extraction,
   `predict-output`, directed-replay moves; ship unit 1 (state + I/O)
   end-to-end. T-series tests; TUTOR.md.
2. **Writing code** — `checker.mjs`, `write-program`, `write-lines`,
   `predict-value`; ship unit 2 (bindings) and unit 5 (data types), the
   two units that stress prediction precision and writing respectively.
3. **Visual scaffolding** — `visuals.mjs` core widgets (`stateMachine`,
   `bindingAnim`, `typeTag`, `branchRail`, `gridView`), `point()` attention
   helper; retrofit units 1–5; ship units 6–7.
4. **Adaptivity + full trajectory** — hint ladders, skill mastery,
   progress persistence, stuck detection; ship units 8–10 and the
   combination capstones.
5. **Later / explicitly out of scope now**: shared-room tutoring, authored
   lesson hot-reload tooling, teacher dashboards, spaced-repetition review.

## 11. Open questions (defaults chosen, flag to revisit)

- Pane side: defaulting to **left** (reading order: instruction → code →
  result); trivial to flip.
- Predict-before-run enforcement: default **soft** (the Run button works;
  the tutor just asks first) — gating Run behind a committed prediction is
  a one-line gate if we want it stricter.
- Whether unit 3+4 (I/O) is one unit or two: drafted as one with two
  lessons; the trajectory list keeps them distinct conceptually.
- `predict-output` strictness on whitespace: exact-minus-trailing chosen;
  revisit after watching real students.
