# Baseline audit register — 2026-08-07

Phase 0 of `design/exercise-expansion-plan.md`, run under
`.claude/skills/kb-audit`. Scope: the full bank — 176 exercises × 40
seeds (9,520 generated programs + execution variants: contrast sides,
probe-augmented, constant-spliced, intended-fix), all REALLY executed
under python3 with a terminal-faithful `input()` shim; plus all 83
concept-card examples executed. Suite state at audit: K-series green,
full suite 170 passed / 1 pre-existing skip (main @ f605ddc).

## Findings

### HIGH

| # | Exercise | Rule | Evidence | Adjudication |
|---|---|---|---|---|
| H1 | `call-slots-in` (functions, 002G) | G1/E6 | shape `number-minus-call` draws `big = v + d`, `d ∈ 2..9` independent of `v`; when `d == v` the truth `big − v` EQUALS the misconception `v` — 4/40 seeds non-discriminating (e.g. seed 11: `v=6, big=12`, truth `6`, misconception `6`) | **fix**: draw `d` avoiding `v` (offset draw, G3) |

### MEDIUM

| # | Exercise | Rule | Evidence | Adjudication |
|---|---|---|---|---|
| M-1 | `err-str-plus-int` (strings, 002P) | E10b | both shapes crash on line 3 → the answer is constantly "TypeError, line 3" across 40 seeds — the exact meta-pattern E10b names | **fix**: add/adjust a shape so the raising line varies |
| M-2 | `shadow-state` (functions, 002E) | E4 | prints 2 lines on 22/40 seeds without `multiline`; its sibling `local-vanishes` declares `multiline: true` for the same reason | **fix**: add `multiline: true` (data-only, rng-safe) |

### LOW / deferred (recurring-audit watchlist)

Variety floors (E9/E14) — small distinct-program counts in 12 seeds:
`range-start-contrast` (3), `or-value-contrast` (3), `fill-range-stop`
(4), `repeat-vs-concat` (4), `range-step-contrast` (5). Each sits in a
deliberately narrow value regime (prior quality-wave constraints:
repeat-vs-concat needs n ≥ 3; range contrasts need endpoint-visible
differences). Widening pools shifts existing seeds (G7 fixture cost)
for marginal gain — **deferred** to a dedicated variety pass, not
churned mid-expansion.

### Inherent (adjudicated acceptable, with reasons)

- **Two-valued answer spaces** (`bool-and-or-not`, `chain-compare`,
  `compare-values`, `in-list`, `in-checks-keys`, `in-list-spot`,
  `text-compare`): the concept's answer space IS {True, False}; the
  mirrored-pair decoy discipline (G4) is present, so the decision is
  real on every seed.
- **`nothing-comes-back` constant `None`**: the concept's every witness
  is None — the E6 "inherent" example class.
- **`fill-mod` `%` / `fill-precedence-op` `+` constant tokens**: the
  blank token is constant but the TARGET varies per seed; the decision
  (which operator produces this target) is the concept. Documented
  atomic-concept fills.
- **`bool-prints` 3 distinct programs**: only True/False exist —
  previously documented inherent (inv-14 record).
- **`float-tail` 4 distinct programs**: the value pool guarantees the
  printed tail (the exercise carries the bank's one focus-salience
  waiver); widening would break the guarantee.
- **`err-index-range` / `err-key-missing` 2 distinct answers**: raising
  line varies across shapes; two values is genuine variation for a
  2-shape error exercise.
- **M6 "answer visible verbatim" class (~60 exercises)**: adjudicated
  as a CLASS. In predict forms the answer being one of several shown
  literals is the selection decision itself (which branch prints, which
  item survives the break, which value did `b` capture) — E5 violation
  requires NO decision, which spot-checks did not find. Exemplars
  checked: `if-runs`, `break-stops`, `copy-then-rebind`, `dict-lookup`,
  `name-then-print` (E5's explicit exemption: reading the literal IS
  the focus).

### Checker artifacts (sweep-tool gaps, not bank defects)

- `local-vanishes` / `probeGone: true`: the graded answer is the
  canonical "gone" token; the sweep compared the misconception against
  the probe's pre-crash print. Sweep harness should model `probeGone`.
- `trace-table` programs printing >1 line: the E4 line law does not
  apply to the table form (per-cell single-line expecteds are the E12
  rule, which K-10 enforces).

## Card-example check (J3)

All 83 concept-card ```py examples executed: 78 print exactly what
their prose claims; the 4 error-concept cards raise exactly the
claimed type/message/line (NameError `totl` @2, TypeError @2,
IndexError @2, KeyError `'cy'` @2); the io card consumes stdin as
described. **Zero false card claims.**

## Coverage statement

Checked mechanically: M1 (clean/raise-as-declared), M2 (line law), M3
(all per-form discrimination laws incl. constantLine-must-miss,
aOutput fidelity, buggy→wrongOutput, canonical→target), M4 (constant
answers), M5 (program variety, 12-seed floor), M6 (verbatim-answer
heuristic, adjudicated). Checked by judgment: flagged items only, plus
the card corpus. NOT checked this pass: J1 natural-code and J6
difficulty-ramp reads over unflagged exercises (last full judgment
sweep: the 29-item quality wave), M8 pool-bypass. K-series not re-run
(green at audit start; re-run scheduled at each expansion batch).

## Addendum — Phase-1 backfill skip register (2026-08-07)

The misconception backfill (expansion plan Phase 1) added computed
misconceptions across the bank; these shapes were SKIPPED, each with an
in-code comment, because every candidate wrong is barred (multi-line or
empty under K-mc's laws) or can collide with the truth under the
current draws (G1 has no algebraic guarantee and draws are frozen, G7):

- state/strings: index-char (all shapes; "count from 1" undefined at
  i=0, collides on doubled letters), index-negative near-end shape
  ("yellow" doubled l), text-compare (all shapes; the case-blind model
  coincides with truth on many draws).
- loops/logic: loop-total product-items (1-draws collide), break-stops,
  continue-skips-one, if-runs "runs" paths, empty-is-falsy truthy
  shapes (empty-transcript wrongs barred), chain-compare ascending
  shape (grouped reading equals truth), compare-values equal shape,
  bool-and-or-not all-collide readings.
- lists/structures: aggregate-one-value sum/max/min (confusable twins
  collide on uniform draws), grid-lookup swapped-read (r==c), 
  concat-builds-new (the wrong model predicts the true output),
  in-list not-found (no printable wrong), dict-get missing-key /
  assign-get, in-checks-keys key-absent (wrong model agrees with truth).
- numbers/forms: plain-arith + fill-arith-op (0008's authored wrong IS
  "a slip, no reasoned misconception"), text-from-int str-then-word,
  int-from-text subtract (wrong model predicts an error, not a line),
  fill-bool-op and-false (both fills print the target), swap-latent-state
  (the wrong model predicts the truth for the probed name — only the
  other name discriminates).

These are candidates for future value-regime redesigns (a G7-breaking
change with fixture costs) — recorded here so a later variety pass can
weigh them deliberately.
