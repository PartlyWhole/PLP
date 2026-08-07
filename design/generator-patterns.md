# Generator craft — the constructive rules

The quality bar (`design/exercise-quality-bar.md`) states the properties
every exercise must have AFTER it is written (E1–E14, C1–C7). This
document is its constructive counterpart: the rules that make those
properties true BY CONSTRUCTION while you write. Every rule was mined
from the existing bank — each cites a worked example, the bar property
it discharges, and the check that enforces it.

Audience: exercise authors (see `.claude/skills/kb-author`) and
reviewers (see `.claude/skills/kb-audit`). Hand-authored generators are
the policy; these rules are what make hand-authoring fast AND solid.

## G1 — The discrimination regime (the heart)

A misconception is a computable function from program to wrong output.
Authoring an exercise means choosing operand ranges so that
`wrong(P) ≠ truth(P)` **algebraically, on every seed** — never hoping
sampling catches collisions.

- State the inequality as a comment where the values are drawn.
- Encode it in the draw ranges themselves.

Worked examples in the bank:
- `kb/exercises/numbers.mjs` `div-always-float`: `a = b·k`, so truth is
  always `x.0` and the misconception always `x` — never equal.
- `kb/exercises/order.mjs`: `// (v − x)·y ≠ v·y − x whenever x·(y−1) ≠ 0`
  — the moved line always changes the output.
- `kb/exercises/forms.mjs` `write-loop-step`: the truth GROWS per pass,
  so a constant line can never reproduce it (the E10c scope rule as a
  regime).

Discharges: E6 (discrimination), E10's per-form difference laws.
Enforced by: K-oracles (wrongAnswer floor), K-10 form branches
(spot-diff A≠B, constantLine must miss), sweep flag (constant answers).

## G2 — Compute the misconception, don't describe it

The generator emits `misconception` — the wrong output FOR THIS
INSTANCE — as a plain string, single-line (unless the form is
multiline), and **consuming no rng** (ladder §R1 hard rule; fixture
safety). It doubles as executable documentation of G1's regime and
feeds the follow-up engine (`plp.kb.mc.v1`).

Worked example: `kb/exercises/numbers.mjs` precedence shapes emit
`misconception: String((a + b) * c) // strict left-to-right`.

The concept-level `wrongAnswer` prose stays documentation — never
matched at runtime. Discharges: E6, R1.1. Enforced by: K-mc
(rng-free-derived, single-line, string-typed).

## G3 — Distinct-by-construction draws

Never draw twice independently and hope the values differ — draw one
index and offset the second:

```js
const i2 = (i1 + 1 + int(rng, 0, pool.length - 2)) % pool.length;
```

or use a shared two-of helper (`pickTwo`/`twoOf` in `io.mjs`,
`functions.mjs`). The elif-chain and empty-is-falsy leaks were exactly
independent draws colliding. Discharges: E7 (no answer leaks via
collision), E6. Enforced by: sweep flag + judgment.

## G4 — Decoy discipline

Every question needs a live wrong PATH, not just a wrong value:

- the decoy bind (`quoted-or-name` in `state.mjs`: two names bound, the
  quoted one printed — "which is text?" becomes a decision);
- mirrored membership twins (`structures.mjs`: the hit and the miss are
  both real shapes, so the answer is not always `True`);
- the 9-distinct-cells grid (`lists.mjs`: every (row, col) confusion
  reads a DIFFERENT cell).

Name the decoy shape in `shapes` so K-5 proves it reachable.
Discharges: E6 (no meta-pattern shortcut). Enforced by: sweep flag
(constant answers) + judgment.

## G5 — The shape triad

Shapes are STRUCTURAL skeletons, never value regimes (a "big operands"
shape is just different literals — inv-14's hard lesson). The standard
recipe that got most cores to ≥3 shapes:

1. **direct form** — the minimal witness;
2. **named-intermediate form** — same fact through a binding;
3. **decoy/chain form** — the G4 decoy, or the fact composed with met
   material.

Where 3 structural predict-output shapes are provably impossible inside
the closure, meet the floor with a form-review sibling instead
(fill-one-blank / spot-the-difference) — §5.3 counts shapes per FOCUS
across all its exercises. Discharges: E9, C6/inv-14. Enforced by:
K-inv14.

## G6 — Pools own the invariants

All values come from `kb/pools.mjs`, and each pool documents its
guarantee AT THE POOL (`capWords` always sort before `lowWords`;
`words` never shadow `names`; `longWords` are ≥4 letters so slices
exist; error-exercise key pools carry near-misses that are never real
keys). A new value regime joins the pools file with its invariant
stated once — it is never re-derived per generator. Collision review
happens in exactly one place. Discharges: E7, E5 (confusables), G1
regimes reusable. Enforced by: judgment (pool additions get reviewed).

## G7 — rng budget discipline

Draws happen in a fixed order, shape first; no conditional draw counts
between shapes of one generator when avoidable. Reordering or
inserting draws SHIFTS EVERY LATER SEED — T-series fixtures that pin a
`(seed, program)` pair re-derive, and committed KB-REFERENCE samples
change. `misconception` and cards consume no rng (G2).

When editing an existing generator: append new behavior AFTER existing
draws, or accept and document the fixture re-derivation (precedent:
"a fixture refresh, not a weakened assertion" — kb-progress).
Discharges: E2 (determinism), fixture safety. Enforced by: K-6, K-doc
byte-identity.

## G8 — Anti-transcription placement

The answer must be computed against, never copied (E5). The rule tells
you WHERE to put the blank/probe, not just what to reject:

- a fill's blank token must not equal or trivially restate the shown
  target (`forms.mjs` fill-op: the filled token is COMPUTED against);
- a trace cell whose value is readable off its own line is a GIVEN;
- a predict answer visible verbatim as a program literal is acceptable
  only when reading that literal IS the focus (print-text,
  quoted-vs-name);
- write-the-line / fix-the-bug carry the SCOPE RULE: the blanked/buggy
  line must execute more than once or feed ≥2 later observations, and
  the generator emits `constantLine` — the plausible conceptless answer
  that must MISS the target on every seed (E10c/E10d).

Enforced by: trace-table builder, K-10 (constantLine must miss), sweep
flag + judgment.

## G9 — Pair combinators, not pair copies

One combinator, many exercises: `kb/contrast.mjs` `orderPair(lines,
from, to)` built the whole order-matters family (13 exercises) from 8
lines, with the difference guarantee delegated to G1 + K-10 (nothing
in kb/ runs Python, so in-module difference assertions are impossible
and would be lies). Follow the same shape for any new pair idiom:
combinator emits the programs; the GENERATOR guarantees the difference
by construction; the K-series verifies it by real execution.

Discharges: E10 (form fit), authoring efficiency. Enforced by: K-10.

## G10 — Cards interpolate; teach cards never leak

`variantCard` (shown AFTER grading) explains THIS instance with its
concrete values, in the style-contract voice — mechanical once G2
exists, because it interpolates the same computed values. The concept's
teach `card` (shown BEFORE the first ask) teaches the rule WITHOUT this
instance's answer. Never reproduce the concept card's own example as a
generated program (see `state.mjs` `name-then-print`: it re-rolls away
from `x = 4`). Discharges: E7, E13, E5. Enforced by: judgment (run the
card's example — its claimed output must be TRUE).

## Per-form payload reference (as-built)

Every `generate(seed)` returns `{code, shape, variant, variantCard,
misconception?}` plus the form's fields. Copy a sibling of the same
form as the template; this table is the map:

| form | extra payload | form-specific laws |
|---|---|---|
| predict-exact-output | — | one printed line unless `multiline` (E4) |
| predict-state | `probeName` | the program never prints the probed name; the K-series appends `print(<probeName>)` before footprinting |
| fill-one-blank | `blank {line,col,len,target}`, `targetOutput` | interpreter judges by output — any fill that produces the target is right; blank ≠ target (G8) |
| spot-the-difference | `contrastCode`, `aOutput` | A's output is SHOWN; A≠B on every seed (G1); BOTH programs inside the closure |
| trace-table | `probeNames` (+ exercise-level `maxBlanks`) | 2..maxBlanks COMPUTED blanks; every watched name blanked ≥1×; single-line expecteds; loops ≤3–4 passes (E12) |
| predict-the-error | `expectedError {type, line}` | provenance only — never shown, never graded against; straight-line up to the raise; ≤1 printed line before it; the raising LINE varies across shapes (E10b) |
| order-the-lines | `lines[]`, `targetOutput` | a compound block moves as ONE element; shuffle drawn at COMPILE time; every wrong order really misbehaves (E10) |
| write-the-line | `blank` (whole line), `targetOutput`, `constantLine` | scope rule; constantLine must MISS (E10c); usually `multiline` |
| fix-the-bug | `buggyLine`, `blank` (intended fix), `targetOutput`, `wrongOutput`, `constantLine` | buggy program runs CLEAN but prints `wrongOutput` ≠ target; both sides inside the closure (E10d) |
| predict-io | `stdinScript[]`, `multiline` | the transcript IS the answer; misconception = the wrong transcript |

## The enforcement map (who catches what)

| Rule | Machine check | Judgment check |
|---|---|---|
| G1 | K-oracles, K-10 form branches | regime comment present and correct |
| G2 | K-mc | misconception names a real misconception |
| G3 | — | sweep collision flag |
| G4 | K-5 shape reachability | decoy is a live decision |
| G5 | K-inv14 | shapes are structural, not value regimes |
| G6 | — | pool additions reviewed once |
| G7 | K-6, K-doc | draw order stable on edits |
| G8 | K-10 (constantLine), builder | blank placement |
| G9 | K-10 | combinator over copies |
| G10 | — | run the card's example |

House rule inherited unchanged: an invariant without a test is a wish —
and a K-series trip is a DESIGN change, never a test fix.
