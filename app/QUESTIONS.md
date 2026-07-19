# Generative questions — as-built documentation (pilot)

Two modules:

- **[questions.mjs](questions.mjs)** — the engine. Pure (no DOM): consumes a
  question context and produces serializable Question objects with a
  `grade()` closure. This is the durable part.
- **[quiz.mjs](quiz.mjs)** — a deliberately thin pilot UI (floating panel,
  kind picker, New/Check). Disposable; exists to exercise the engine until
  the real product UI is designed.

## Context

```js
const ctx = {
  source: plp.editor.getValue(),        // the program text
  steps: plp.memory.steps(),            // raw trace records (last run)
  positions: plp.memory.linePositions() // executed-line positions -> state step index
};
```

Memory questions are **trace-grounded**: answers come from what the program
actually did, so they are always truthful and grading is exact. Code
questions need only the source. Snapshots respect the memory model's
display filters, so questions match what the student sees in the panes.

## Question kinds (registry: `questionGenerators`)

| kind | asks | options |
|---|---|---|
| `memory-next-line` | given the memory produced by line N, fill in the blanks for the next executed line (changed/added bindings are blanked; unchanged shown) | `{from, to}` position indices, or `{seed}` to self-pick a pair with an observable diff |
| `memory-line-to-line` | same, but across a multi-line span (X → Y) | same |
| `code-order` | the program's lines, shuffled — put them in working order (indentation preserved as a cue) | `{seed}` |
| `code-structure` | `mode: "structure"`: detail lines given, write the structural lines (def/for/if/return/…); `mode: "details"`: the reverse | `{mode}` |
| `code-args` | one call expression with its arguments blanked | `{line}` 1-based, or `{seed}` |

All generators are deterministic under explicit options (`seed` uses a
mulberry32 PRNG). A generator returns `null` when it can't build a sensible
question here (e.g. no observable memory diff, no calls, no trace yet).

## Question object contract

```js
{
  kind, prompt,
  // payload by kind: given/target snapshots ({entries:[{scope,name,value,blankId}]}),
  // lines ([{text|indent+blankId}]), items ([{id,text}]), before/after strings…
  blanks: [{ id, label, expected }],       // fill-in kinds
  grade(answers) => { correct, perBlank|perIndex, expected }
}
```

Grading is whitespace-insensitive and quote-style-insensitive
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
`current()`). Q-series tests: [tests/questions.spec.mjs](../tests/questions.spec.mjs).

## Known limits (pilot)

- Code questions parse with regexes (structural-line list, single-level
  call args) — fine for learner-scale programs, not a Python parser.
  `code-args` skips nested calls; `code-structure` classifies by leading
  keyword only.
- Memory questions require the trace and the source to match (`ctx` is
  captured together; editing after a run without rerunning makes code and
  memory kinds disagree about lines).
- Grading is textual equivalence, not semantic (e.g. `{"a":1,"b":2}` typed
  in a different key order counts as wrong; dict ordering in Python is
  insertion order, so the canonical form is defensible but strict).
