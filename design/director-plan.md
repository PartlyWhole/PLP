# Director layer — implementation plan

Status: PLAN (approved research: [game-tutorial-research.md](game-tutorial-research.md)).
Division of labor: **we implement the grammar** (a runtime + vocabulary for
staged, attention-directed, behavior-reactive lessons); **humans author the
direction** (the actual lessons, their pacing, their words). The grammar
must therefore be expressive enough to encode every research rule R1–R10,
while containing zero pedagogy of its own.

## First principles

Derived from the research, stated as constraints on the design:

- **P1 — The stage is real.** Every beat happens in the live app (real runs,
  real trace, real memory model) — never a mock, screenshot, or simulated
  pane (R1, verified finding 1). The director *arranges the stage*; only
  the learner *performs*. The director never presses Run for them.
- **P2 — Attention is scarce; direct it, don't add to it.** The director
  reuses the app's existing affordances (line highlight, name hover
  highlight, chip flash, scope labels) plus a spotlight/dim/popover layer.
  It points at exactly one thing per beat (R4).
- **P3 — Show less, not more.** Progressive disclosure is a first-class
  gate over existing UI (R2). The default lesson posture is "almost
  everything hidden or inert"; beats *reveal*. (Gating is cheap for us —
  panes and controls already exist behind stable hooks.)
- **P4 — Help is a response, not a schedule.** Hints trigger from observed
  behavior (attempts, idle, wrong output) and are quiet, anchored, and
  dismissible. Nothing fires on a timer alone; nothing is modal (R5, R10).
- **P5 — Explanation exists, on demand.** Every beat may carry a "why?" —
  explicit prose for genuinely complex ideas — behind a learner-invoked
  affordance, never pushed (R6, verified finding 4).
- **P6 — The grammar is data, not code.** Lessons are declarative objects a
  human can write, read, diff, and review without touching app internals.
  Small escape hatches (named predicates) live in a curated library, not
  in lessons.
- **P7 — Measure fluency, not scores.** The director logs beat timings,
  attempts, hint usage — the metrics the research says matter (R9).
- **P8 — Interface is content.** Run, the console, the scrubber are
  teachable targets like any Python concept (R8/WASD rule). The grammar
  treats "app mechanic" and "language concept" beats identically.
- **P9 — Never trap.** Skip/exit is always available; gates fail open on
  errors; a lesson crash degrades to the normal free-play app (R10).

## Architecture (three modules + content)

```
app/stage.mjs      the app-surface abstraction: semantic targets,
                   capability gates, attention effects
app/director.mjs   the lesson runtime: beat FSM, triggers, hints,
                   signals, persistence, telemetry
app/conditions.mjs curated predicate/trigger library (trace-grounded)
lessons/*.mjs      human-authored lesson data (+ lessons/index.mjs registry)
app/DIRECTOR.md    grammar reference + authoring guide (the human's manual)
```

Wiring: modules emit semantic events the director subscribes to. We add a
tiny event bus and instrument existing modules with ~1-line `emit()` calls
(runner: run lifecycle + records; memory: scrub/hover/chip/filter; console:
input answered, output; editor: change; quiz: graded). No behavioral
changes to any existing module.

### 1. Stage (`app/stage.mjs`)

**Targets** — stable semantic names resolved to live DOM/app handles at
use time (never raw selectors in lessons):

| target | resolves to |
|---|---|
| `run`, `stop`, `quiz-btn`, `share` | header/pane buttons |
| `editor`, `editor.line(n)`, `editor.name(name)` | pane / line handle / occurrence marks |
| `console`, `console.prompt` | console pane / input affordance |
| `memory`, `memory.names`, `memory.objects` | panes/tables |
| `memory.name(scope, name)` | a Names-table cell (post-render lookup) |
| `memory.object(ref)` | Objects row via *name-path* (e.g. object reached from `cart`) — never raw uids (unstable across runs) |
| `scrubber`, `scrubber.slider`, `step-mode` | stepping controls |

**Capabilities** (gate = deny/allow; denied = hidden or inert+dimmed,
per-cap choice): `run`, `stop`, `edit`, `scrub`, `step-mode`, `filters`,
`quiz`, `console-input`, `maximize`, `share`. Default outside lessons:
all allowed (free play unchanged). Gates are re-entrant and crash-safe
(P9: a `try/finally` restores all caps on lesson exit/error).

**Attention effects** (compose; all clearable as one): 
`spotlight(target, {dim: true})` (backdrop-dim everything else),
`pulse(target)` (attention ping), `popover(target, markdown, {placement,
sticky})` (anchored, non-modal, Esc/click-away dismiss, at most one),
`veil(target)` (progressive disclosure of a sub-region, e.g. hide the
Objects table until the identity beat). Popover markdown is rendered with
the same tight constraints as system text (no HTML injection from lessons).

### 2. Director (`app/director.mjs`) — the runtime

A lesson is a linear-with-branches FSM over **beats**:

```js
export default {
  id: "aliasing-1",
  title: "Two names, one list",
  concept: "aliasing",            // metadata for the picker/curriculum
  code: "a = [1, 2]\nb = a\n...", // starting program (may be per-beat)
  beats: [ /* see grammar below */ ],
};
```

**Beat grammar** (the core deliverable):

```js
{
  id: "run-it",
  do: [                                  // stage arrangement, in order
    { set: "code", value: "..." },       // optional per-beat program
    { gate: { allow: ["run"], deny: ["edit", "scrub", "quiz"] } },
    { veil: "memory.objects" },
    { spotlight: "run", dim: true },
    { popover: { at: "run", md: "Run it and watch the right panel." } },
  ],
  until: { event: "run-ended", reason: "completed" },   // advance trigger
  hints: [                               // adaptive, quiet (P4)
    { when: { idleMs: 30000 }, popover: { at: "run", md: "Press ▶ Run." }, once: true },
    { when: { event: "run-ended", reason: "uncaught_exception" },
      popover: { at: "console", md: "It crashed — read the red line, then Run again." } },
  ],
  why: "Programs run top to bottom; the memory panel shows …",  // P5, on demand
  next: "look-at-names",                 // default; may branch:
  // next: [{ if: { signal: "attempts", gte: 3 }, then: "easier-path" },
  //        "default-beat"]
}
```

**`until`/`when` trigger language** (declarative; `all`/`any` composable):

- Event patterns: `{ event: "run-ended", reason }`, `{ event: "scrubbed",
  line }`, `{ event: "input-answered" }`, `{ event: "hover-name", name }`,
  `{ event: "chip-clicked" }`, `{ event: "quiz-graded", correct: true }`,
  `{ event: "edited" }`.
- Trace predicates (from `conditions.mjs`, evaluated against the latest
  run's records — the ground truth): `{ check: "nameIs", scope: "globals",
  name: "b", value: "[1, 2, 99]" }`, `{ check: "outputContains", text }`,
  `{ check: "sameObject", names: ["a", "b"] }` (aliasing!),
  `{ check: "ranLine", line }`.
- Signals (per-beat counters the director maintains): `attempts` (runs
  ended during this beat), `hintsShown`, `elapsedMs`, `quizTries`.
- `{ idleMs: n }` = no relevant learner event for n ms (hints only —
  `until` must always be learner-driven, P1).

**Quiz beats** reuse the existing engine: `{ do: [{ quiz: { kind:
"memory-next-line", opts: { from: 1, to: 2 } } }], until: { event:
"quiz-graded", correct: true } }` — the mastery "conclude" beat of a
kishōtenketsu arc (R3) without new question machinery.

**Runtime behaviors**: linear default with explicit branch escape (R8);
per-lesson progress + per-beat telemetry (P7) persisted to localStorage
(`plp.director.log()` for export); `skip beat` / `exit lesson` always
rendered (P9); on any internal error: clear effects, restore gates,
surface free play.

### 3. Conditions library (`app/conditions.mjs`)

Small, curated, trace-grounded predicates (each ~5 lines over
`memory.steps()` / `questions.textValue` / console text). Lessons refer to
them by name only (P6). Initial set: `nameIs`, `outputContains`,
`sameObject` (two names resolve to one uid *within the final step* — safe,
same-step comparison), `ranLine`, `usedInput`, `completedRun`,
`raisedException(type)`. Adding one = adding a function + a doc row.

### 4. Content scaffolding (NOT direction)

- `lessons/index.mjs` registry + a minimal picker UI (header dropdown;
  free play is and stays the default mode).
- **One reference lesson** shipped as *grammar validation*, explicitly
  marked placeholder: a 5-beat "meet the machine" arc (run → read names →
  scrub → answer input() → mastery quiz) chosen because it exercises every
  primitive (gates, veil, spotlight, popover, trace predicate, hint paths,
  quiz beat). Its words are stage directions for testing, not curriculum —
  the human director rewrites or replaces it.
- `app/DIRECTOR.md`: the authoring manual — full grammar reference, target
  and condition catalogs, the R1–R10 rules restated as authoring
  guidance (e.g. "one spotlight per beat", "until must be the learner's
  action", "hints escalate: nudge → point → show"), and a lesson checklist.

## What the grammar deliberately does NOT do

- No auto-play/attract-mode (P1) — no `do: [{ run: true }]`.
- No modal anything; no beat without an exit (P9).
- No pedagogy in the runtime: pacing, wording, when to twist, when to
  explain — all live in lesson data (the human's domain).
- No adaptive difficulty engine — the grammar exposes signals and
  branching; policies are authored (research supports ability-matched
  ramping but gives no algorithm worth hardcoding yet).
- No uid-based targeting (identity is per-run; name-path targeting only).

## Implementation steps (each independently verifiable)

1. **Event bus + instrumentation** — `emit()` calls in runner/memory/
   console/editor/quiz; `plp.events.log()` debug tap.
   *Check*: Playwright — scripted session produces the expected ordered
   semantic event list; existing suites untouched and green.
2. **Stage: gates** — capability deny/allow with restore-on-exit.
   *Check*: deny(`run`) makes Run inert+dimmed; runner untouched; crash
   path restores.
3. **Stage: targets + attention effects** — resolver, spotlight/dim,
   pulse, popover, veil (+ CSS).
   *Check*: DOM assertions per effect; `memory.name()` targets resolve
   after re-render (post-rAF); clearAll leaves zero artifacts.
4. **Director runtime** — lesson loader/validator (`lintLesson`: unknown
   targets/conditions/beat refs fail loudly at load), beat FSM, trigger
   evaluator, hint scheduler, signals, persistence, telemetry, skip/exit.
   *Check*: a synthetic 3-beat test lesson driven entirely by simulated
   learner events advances/branches/hints exactly per spec (D-series).
5. **Conditions library** — initial predicate set.
   *Check*: unit-style page tests against known traces (incl. `sameObject`
   on the aliasing program).
6. **Reference lesson + picker UI** — exercises every primitive.
   *Check*: end-to-end Playwright walk of all five beats as a learner
   (press Run, scrub, answer input, pass quiz), asserting gates/effects at
   each beat; then `exit` mid-lesson → free play fully restored.
7. **Docs** — app/DIRECTOR.md authoring manual; VALIDATION D-series rows;
   CLAUDE.md module rows + invariant ("the director arranges, the learner
   performs; gates fail open").

Steps 1–3 are independent of 4–5 and can land separately; 6 requires all.

## Verification strategy

- **Grammar-first testing**: the D-series drives lessons via the event
  bus and `plp.director` API (state, not pixels), matching the house
  testing rules; attention effects get DOM class assertions only.
- **Determinism**: test lessons pin their code and use trace predicates —
  no timing-dependent `until`s; `idleMs` hints tested with injected clock
  (director takes a `now()`/timer seam).
- **Regression rings**: existing S/X/Q suites must stay green after
  instrumentation (bus is additive); collab suite unaffected (director is
  local-only — see open decisions).
- **Manual pass** (human judgment, per VALIDATION practice): spotlight
  legibility, popover placement, "does it feel like a game tutorial or a
  cookie banner" — explicitly the human director's acceptance gate.

## Open decisions (need your call, none block steps 1–5)

- **D1 — Collab × director**: simplest is "starting a lesson requires solo
  mode" for v1 (a shared lesson session is a real feature with real
  design questions — who is the learner?). Default: solo-only.
- **D2 — Lesson file format**: plain `.mjs` data modules (proposed: no
  build step, diffable, schema-linted at load) vs JSON (stricter but
  clumsy for multiline code/markdown). Default: `.mjs` data.
- **D3 — Progress UI**: beat dots in the memory-pane header vs a dedicated
  strip. Default: minimal dots + lesson title chip; human director will
  redesign anyway.

## Risks

- **Popover/spotlight anchoring on live re-renders** (memory tables redraw
  per rAF): targets re-resolve on each render tick; effects must re-attach
  — mitigated by resolving through stable `data-*` hooks we control and
  re-applying effects in the same rAF as the table render.
- **Trigger races** (event fires while evaluating): the director processes
  events through a single queue; beat transitions are atomic.
- **Grammar creep**: the temptation to add pedagogy (auto-advance timers,
  forced tours) — the "does NOT do" list above is the contract; changes to
  it need explicit sign-off.
