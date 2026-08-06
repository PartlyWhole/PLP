# Generative questions - as-built documentation (dormant pilot)

The learner-facing Quiz control is intentionally hidden while the UI is being
redesigned. The engine, floating panel, and debug/test API remain available as
experimental infrastructure.

The question system uses five modules:

- **[questions.mjs](questions.mjs)** — the engine. Pure (no DOM): consumes a
  question context and produces serializable Question objects with a
  `grade()` closure. This is the durable part.
- **[construction.mjs](construction.mjs)** - pure memory-graph and expression
  construction contracts and graders.
- **[construction-ui.mjs](construction-ui.mjs)** - interactive graph and
  evaluation renderers.
- **[question-ui.mjs](question-ui.mjs)** - the shared payload-shape router:
  renders any Question into a container, returns `{ collect, applyResult,
  line, wide }`. Used by the quiz panel AND tutor transcript cards.
- **[quiz.mjs](quiz.mjs)** - the floating question shell (thin chrome over
  question-ui).

The tutor (app/TUTOR.md) sequences questions into lessons; the engine
stays policy-free.

The construction model is documented in
[CONSTRUCTION.md](CONSTRUCTION.md).

## Context

```js
const ctx = {
  source: plp.editor.getValue(),        // the program text
  steps: plp.memory.steps(),            // raw trace records (last run)
  positions: plp.memory.linePositions() // executed-line positions -> state step index
};
```

Memory questions are **trace-grounded**: answers come from what the program
actually did. Construction answers retain bindings, identity-bearing data,
nested references, and aliasing. Code and expression-sequence questions need
only the source. Snapshots respect the memory model's display filters, so
questions match what the student sees in the panes.

## Question kinds (registry: `questionGenerators`)

| kind | asks | options |
|---|---|---|
| `memory-construct` | construct a complete graph for one trace position from a blank, partial, or complete starter | `{position, mode: "blank" | "partial" | "complete"}` |
| `memory-next-line` | update the graph produced by line N for the next executed line | `{from, to}` position indices, or `{seed}` to self-pick a pair with an observable diff |
| `memory-line-to-line` | update a graph across a multi-line span (X → Y) | same |
| `expression-sequence` | construct the semantic action order for one supported expression or simple statement | `{line}` 1-based, or `{seed}` |
| `code-order` | the program's lines, shuffled — put them in working order (indentation preserved as a cue) | `{seed}` |
| `code-structure` | `mode: "structure"`: detail lines given, write the structural lines (def/for/if/return/…); `mode: "details"`: the reverse | `{mode}` |
| `code-args` | one call expression with its arguments blanked | `{line}` 1-based, or `{seed}` |
| `trace-simulation` | progressively predict each raw executed source-line occurrence, then that occurrence's watched binding/output effects; finish by predicting program end | `{names: [...], maxEvents = 24}` |
| `trace-table` | walk the program line by line, filling in what each watched name holds after each step; graded per blank against the real trace | `{names: [...], maxBlanks = 8}` |
| `predict-output` | type the program's exact output — whole program, or "printed so far" at one executed line (`outputUpTo`, the pure twin of the console's `showUpTo`) | `{position}` linePositions index; default last. Grading forgives trailing whitespace/blank lines only |

All generators are deterministic under explicit options (`seed` uses a
mulberry32 PRNG). A generator returns `null` when it can't build a sensible
question here (e.g. no observable memory diff, no calls, no trace yet).

Memory questions use graph construction by default.

### trace-simulation payload + grading

The progressive simulation combines two trace projections. Raw `event: "line"`
records define the control-flow sequence, preserving repeated occurrences of a
single physical line. `memory.linePositions()` remains the produced-state
boundary for the final occurrence in each contiguous location group; repeated
raw lines inside one group use the following raw-line snapshot. This avoids
both line mode's one-line-loop collapse and its call-event function-header
position.

The question exposes safe current-step methods rather than future rows:

```js
q.step(cursor)                 // current watched state; no expected line
q.gradeNext(cursor, answer)    // {kind:"line", line:N} or {kind:"end"}
q.effectPrompt(cursor)         // controls for the already-selected line
q.gradeEffects(cursor, answer) // changed-name map + output + return value
q.revealNext(cursor)           // explicit current-phase reveal only
q.revealEffects(cursor)
```

For an ordinary call, a callee return owns its return value while any caller
binding that becomes visible at resumption carries `caller-resume` attribution
to the original call site. Nested/suspended calls, disappearing watched names,
incomplete traces, and traces over 24 raw line occurrences fail closed in v1.
The practice runtime persists only committed history and the current phase,
never uncommitted future truth.

### trace-table payload + grading

Rows are kept only where at least one watched name was added or changed
(globals scope, same display filtering as `predict-state`); the changed
cells are blanks, unchanged watched names show their carried value as
givens, unbound names render `—`:

```js
{
  kind: "trace-table", prompt,
  names,                                     // the watched-name columns
  rows: [{ step, line, codeText,
           cells: [{ name, value, blank, blankId? }] },
         { elided: true },                   // maxBlanks elision marker
         …],
  blanks: [{ id, label: "step N · name", expected }],
  grade(answersById) => { correct, perBlank: {id: bool}, expected }
}
```

If blanks would exceed `maxBlanks`, the leading rows whose blanks fit in
`maxBlanks − 2` are kept, an `{elided: true}` row marks the gap, and the
final row keeps its blanks. Per-blank grading forgives what predict-state
forgives: `normalizeAnswer` equality, else `canonicalizeContainers`
equality (the exact repr is still reported as `expected`). `correct` is
all-or-nothing. The generator returns `null` when no watched name ever
binds or changes. Rendered by `renderTraceTable` (question-ui.mjs); the
tutor's `trace-table` ask (`{ kind, probeNames, maxBlanks, prompt }`)
traces silently first, then builds and grades the table.

## Question object contract

```js
{
  kind, prompt,
  // payload by kind: construction graph, evaluation cards,
  // lines ([{text|indent+blankId}]), items ([{id,text}]), before/after strings…
  blanks: [{ id, label, expected }],       // fill-in kinds
  grade(answers) => { correct, perBlank|perIndex, expected }
}
```

Legacy text-blank grading is whitespace-insensitive and quote-style-insensitive
(`normalizeAnswer`), so `'hi'` ≡ `"hi"` and `[3,5]` ≡ `[ 3, 5 ]`.
Values render in student-typable text form (`textValue`): scalars as Python
literals, containers by contents (`[3, 5]`, `{"a": 1}`), instances as
`Cls(attr=…)`, cycles as `…`.

## Extending

- **New question kind**: add an entry to `questionGenerators` with
  `{ label, needsTrace, generate(ctx, opts) }`. The quiz panel renders by
  payload shape; give a new shape its own renderer branch (or ship a
  custom UI — the engine doesn't know the quiz exists).
- **New blank-selection policies** (e.g. blank *all* names, blank names but
  not values): generators own their blanking; add options rather than new
  kinds where it's a variation.
- **Curriculum sequencing / difficulty**: compose at a higher layer by
  calling `generateQuestion` with chosen kinds/options; the engine stays
  policy-free.

## Debug/test API

`window.plp.questions` (the whole engine module) and `window.plp.quiz`
(panel: `open/close/toggle`, `newQuestion(kind?, opts?)`, `check()`,
  `current()`, `currentAnswer()`). Q-series tests:
  [tests/questions.spec.mjs](../tests/questions.spec.mjs).

## Known limits (pilot)

- Code questions parse with regexes (structural-line list, single-level
  call args) — fine for learner-scale programs, not a Python parser.
  `code-args` skips nested calls; `code-structure` classifies by leading
  keyword only.
- Memory questions require the trace and the source to match (`ctx` is
  captured together; editing after a run without rerunning makes code and
  memory kinds disagree about lines).
- Expression sequences cover the curated subset listed in
  [CONSTRUCTION.md](CONSTRUCTION.md), not arbitrary Python syntax.
- Grading is textual equivalence, not semantic (e.g. `{"a":1,"b":2}` typed
  in a different key order counts as wrong; dict ordering in Python is
  insertion order, so the canonical form is defensible but strict).
