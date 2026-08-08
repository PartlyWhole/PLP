# New exercise forms — the innovation lane

Design of record for the three forms proposed after the expansion plan
(owner-authorized 2026-08-07). Each exploits a platform asset the
existing ten forms under-use: the full per-step trace, the interpreter
as a data-oracle, and the misconception engine. Implementation order:
**trace-query now** (this session), break-the-tie and mutation-duel
specced here for the next.

Every form obeys the two form laws (§5.1): the interpreter/trace is the
only answer key; the student commits exactly one prediction. Every form
ships with: a kb payload contract, a K-10 branch stating what it
verifies by real execution, a met-grant decision, a docgen branch, and
T-series coverage.

## 1. trace-query (IMPLEMENTED)

**What**: one pointed question about the execution *process*, graded
against the real trace. Where trace-table asks for the whole story,
trace-query asks for the single fact a misconception gets wrong.

**kb payload** (kb/ stays trace-agnostic, like trace-table):

```js
{ form: "trace-query",
  generator → { code, query, prompt, misconception?, variantCard, … } }

query :=
  { type: "runs", line }                 // how many times does line L run?
  | { type: "last-line" }                // which line runs last?
  | { type: "value-when", name, line, visit }  // what does NAME hold just
                                         // after line L's visit-th run?
```

The ANSWER is never authored — the runtime derives it from the trace
(`trace-query` generator in app/questions.mjs over the same raw
line-event projection trace-simulation uses; `value-when` follows
trace-table's produced-state convention). The kb generator authors the
`prompt` (interpolating the concrete line/name) and, per G1/G2, a
rng-free `misconception` whose value regime guarantees it differs from
the derived answer (e.g. runs-count under break: the naive answer is
the full item count; the regime places the break so the true count is
always smaller).

**Grading**: single one-line answer; numbers exact, values via
`normalizeAnswer` (the predict-state forgiveness). **Met: not granted
in v1** — a single process fact is weaker evidence than a full
prediction (Parsons precedent); stats bump on the focus tag.

**K-10 branch**: for each stratified seed — traced run completes;
`generateQuestion("trace-query", ctx, {query})` returns a question;
the derived answer is non-empty, single-line, and identical across two
builds; the authored misconception differs from the derived answer.

**Docgen** (as built): docgen is stdout-only, so the reference shows
the program, the query prompt, and the program's own printed output —
it never STATES the derived answer (nothing stated ⇒ nothing that can
rot; K-doc byte-identity unchanged in mechanism). The authoring-time
oracle is a python3 `sys.settrace` sweep (CPython semantics = Pyodide
semantics = PyTrace's record stream), run across all seeds before the
exercises shipped; the K-10 branch re-derives in the real engine on
every suite run.

**First exercises** (topic files): `tq-break-count` (001N — "how many
times does the body print?" naive = all items), `tq-while-count`
(001M — passes of a while body; naive = one-too-many), 
`tq-accumulate-when` (001J — the accumulator's value after a mid-loop
visit; naive = one step ahead/behind).

## 2. break-the-tie (SPECCED)

**What**: programs A and B shown with the SAME output for the shown
input; the learner supplies an input value on which they diverge.
Inverse direction: production knowledge — driving the machine, not
simulating it. Edge concepts are counterexamples by nature, so the
pairs come from the existing contrast families (`+` vs `+=` under an
alias, `/` vs `//` off the clean-multiple regime, `str*int` vs
`int*int`).

**kb payload**: `{ code, contrastCode, valueHole: {line, col, len},
tieValue, targetKind: "diverge" }` — both programs carry the same hole;
`tieValue` is the shown agreeing input (K-verified: A(tie) === B(tie)).

**Grading**: splice the learner's value into BOTH programs, execute
both; correct iff outputs differ (and both complete cleanly). The
interpreter stays the only judge; any genuinely-diverging value wins.

**K-10 branch**: tieValue really ties; at least one diverging value
exists in the drawn pool (existence by construction, verified by
sweeping the pool); the authored misconception value (a plausible
non-diverging pick) really ties.

**Met**: grants met on first-attempt success — production evidence,
stronger than prediction (binding §4 ranking); needs owner sign-off
before wiring, flagged here.

**Runtime**: a fill-one-blank-shaped ask over a pair; grading runs two
programs (the spot-diff + fill machinery composed). No new UI widget —
the pair renders as spot-diff context, the answer box is the fill box.

## 3. mutation-duel (SPECCED)

**What**: one real output shown; 2–3 programs differing by a one-token,
misconception-mapped mutation; the learner picks which program produced
it. Every distractor's output is real (executed, verified different),
and every mutation is tagged with the misconception it embodies — a
wrong pick feeds `plp.kb.mc.v1` with named-misconception signal.

**kb payload**: `{ programs: [{code, mutation: {tag, note}}...],
answerIndex, shownOutput }` — `shownOutput` K-verified as
`programs[answerIndex]`'s real output, all other programs' outputs
K-verified DIFFERENT from it (and from each other).

**Grading**: a selection, graded locally against `answerIndex` — legal
under interpreter-first because every option's output is
execution-verified at build time (the K-10 branch is the oracle).
**Met: no grant** (recognition evidence, weakest class).

**Runtime**: needs one new widget (program picker — three read-only CM
panes with radio selection); the only form of the three requiring UI
work, hence last.

## Frame-aware trace tables (status, not a new form)

The progressive trace runtime already renders function context (brief
§11: breadcrumb, return-vs-caller-resume separation) and K-fnattr pins
call-site attribution for module bindings. What remains for
frame-LOCAL watched names: the trace-table/simulation builders only
watch globals scope. Extending `probeNames` into callee frames needs a
per-frame name column model and a policy for frame lifetime rows
(locals vanish at return — the "gone" answer). That is a
questions.mjs + practice-runtime feature riding on the new trace UI;
it should land as its own change after the trace UI settles, not
inside this lane. (Ledger note: no mint required.)

## Bank-side integration rules (all three forms)

Selection: new-form exercises are `role: "review"` (or challenge where
the composition demands braids), so they slot into the §6 weights with
no selection-policy change. The kb-author/kb-audit skills cover them:
their payload rows join generator-patterns.md's table as they ship.
