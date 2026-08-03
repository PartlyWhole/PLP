# Phase 2 plan — full graph (ledger), first-two-topics exercises, analyzer, oracles

> Executor-facing plan. The orchestrator has already made every design
> call below. Implement the named section exactly. Verification command
> per step is given inline; the orchestrator runs the full suite.

## Design adjudications (orchestrator-owned; binding on all steps)

The concept inventory (design §3) has nodes whose predict-exact-output
intro is **not realizable** within the parents §3 assigns them, or which
depend on machinery that arrives in phase 3. Resolutions:

- **A1 — Ledger runs ahead of the loaded concept set.** The tag ledger
  (`kb/tags.ledger.json`) is the permanent allocation registry; phase 2
  appends all 48 remaining entries. The concept **modules** (and thus
  `loadKB`'s loaded set) grow topic-by-topic as exercises land, because
  the DAG is cross-topic (a concept cannot load before its parents load,
  nor satisfy inv 12 before its intro exists). K-1 is reframed from
  "ledger tag set == module tag set" to **"every loaded concept appears
  in the ledger with identical {slug, kind, parents}; the ledger is
  itself well-formed and internally consistent."** The module→ledger
  direction is now exactly enforced; the ledger→module direction may lag
  during breadth build-out. inv 12 (K-7) continues to hold over the
  loaded set at every checkpoint — matching §11's staging of inv 12 as a
  phase-3 completion.

- **A2 — Parent corrections (permanent, chosen now so the ledger append
  is right the first time).** Three §3 parent sets do not permit a
  discriminating intro and are corrected at mint time:
  - `000K str-literal-vs-number`: `[0007, 0002, 000Y]` (design `[0007,
    0002]`). Digit-text vs number has **no** discriminating
    predict-exact-output witness without a cross-kind operation; the
    minimal such operation is string concat, so `str-concat (000Y)`
    becomes an ancestor.
  - `0016 bool-values`: `[0005]` (design `[0015]`).
  - `0015 compare-ops`: `[0008, 0016]` (design `[0008]`).
    Rationale: to predict `3 < 5` you must know both that comparisons
    yield yes/no (compare-ops) **and** that yes/no is spelled
    `True`/`False` (bool-values). So bool-values must come **first**
    (intro `print(True)`, needing only print-text) and compare-ops
    second (intro `print(3 < 5)`, emitting both tags with bool-values in
    `assumed`). The design's edge direction is inverted.
  All other §3 parents are used verbatim.

- **A3 — Phase-2 wired set (concepts given intros this phase).**
  - State: `0005 0006 0007 0009 000A 000B 000C 000J 000M` (adds
    `000J print-multi-args`, `000M swap-right-side-first`).
  - Numbers: `0008 000N 000P 000Q 000R 000S` (adds `000N op-precedence`,
    `000Q floordiv-quotient`, `000R mod-remainder`,
    `000S mod-sign-of-divisor`).
  - Lists (unchanged, already wired): `000D 000E 000F 000G 000H 0021
    0023`.

- **A4 — Deferred to phase 3 (ledger entry appended now; concept prose
  + exercise deferred), each for a technical reason:**
  - `000K str-literal-vs-number`, `000T str-of-int` — discrimination
    needs string concat (a Strings-topic node); resolve with Strings.
  - `000V int-of-str` — its own witness is numeric and clean, but its
    parent `000K` is not met until phase 3; keep the conversion cluster
    together.
  - `000W float-inexact` — the analyzer cannot see "prints a long tail";
    §4.5 ties it to the focus-salience **waiver** machinery, which is a
    phase-3 deliverable (inv 17).
  - `000X bool-is-int` — needs `bool-values` (Logic); resolve with Logic.
  This means "Numbers & bools" and "State & I/O" are **complete except**
  for these 5 nodes at the phase-2 checkpoint. Recorded honestly in the
  progress file.

- **A5 — Analyzer built incrementally, not big-bang.** Phase 2 extends
  the analyzer for exactly what phase-2 exercises use plus the tuple /
  precedence / float / sign machinery: float literals, `// % **`, unary
  minus with literal-level sign tracking, multi-argument `print`,
  tuple-target assignment (swap + unpack detection), op-precedence
  detection. Strings ops, comparisons/bools, `if/for/while`, dicts,
  slices, negative-index, and the method table are added in phase 3 as
  their exercises land — so every analyzer path ships with an
  oracle-checked exercise rather than untested.

## Step order & ownership

1. **Ledger (orchestrator).** Append 48 entries to `kb/tags.ledger.json`,
   ascending tag order, parents per A2/§3. Verify: `node -e` loadKB after
   step 2. Nobody but the orchestrator writes the ledger.
2. **Concept prose (orchestrator).** `kb/concepts/state.mjs` (+000J,
   +000M), `kb/concepts/numbers.mjs` (+000N,+000Q,+000R,+000S). Full
   Concept objects: statement (from §3), wrongAnswer (from §3), rule card
   (authored, style contract). Wire nothing new into `kb/index.mjs` (the
   topic modules are already imported).
3. **Analyzer (orchestrator).** Extend `kb/analyzer/tokenize.mjs`,
   `parse.mjs`, `footprint.mjs` per A5. Verify: `node -e` footprint
   anchors + existing K-5a strings still pass.
4. **Exercises (orchestrator).** `kb/exercises/state.mjs` (+000J,+000M),
   `kb/exercises/numbers.mjs` (+000N,+000Q,+000R,+000S). Every generated
   program must satisfy footprint ⊆ assumed ∪ {focus} ∪ Structural on 40
   seeds.
5. **Oracles + K-1 reframe (orchestrator, single-writer file
   `tests/kb.spec.mjs`).** Reframe K-1 per A1. Add K-11 (inv 8 parser
   fidelity vs Python `ast`), K-12 (inv 9 type fidelity vs post-exec
   `type().__name__`), K-13 (inv 11 discrimination: authored
   `wrongAnswer` ≠ real output on every stratified sample).
6. **Verify (orchestrator).** `PLP_PORT=8633 npx playwright test`. Full
   suite green. Repair by amending this plan and re-doing the step.

## New concept prose (statements from §3; cards authored here)

- `000J print-multi-args` — stmt: "print(a, b) writes both values on one
  line with a single space between them." wrong: "the values with no
  space, or a printed comma."
- `000M swap-right-side-first` — stmt: "In a, b = b, a the whole right
  side is evaluated before either name rebinds — so the values swap."
  wrong: "both names end up with the same value."
- `000N op-precedence` — stmt: "* and / bind tighter than + and -;
  parentheses override." wrong: "20 for 2 + 3 * 4 (left to right)."
- `000Q floordiv-quotient` — stmt: "// is whole-number division: how many
  whole times the divisor fits." wrong: "a decimal answer."
- `000R mod-remainder` — stmt: "% gives the remainder left over after
  whole-number division." wrong: "the quotient instead of the remainder."
- `000S mod-sign-of-divisor` — stmt: "% takes the sign of the divisor, so
  -7 % 3 is 2." wrong: "-1 (the sign of the left operand)."

## Exercise generators (phase 2)

- `print-two-values` focus `000J`, assumed `[0005,0006]`, shapes
  `["two-names"]`, prints `print(x, y)` with two bound int names. wrong
  available: no-space / comma.
- `swap-two` focus `000M`, assumed `[0005,0006]`, shapes `["swap-print-b"]`:
  `a = p` / `b = q` / `a, b = b, a` / `print(b)` → prints original a
  (=p). Naive sequential model prints q. One line.
- `precedence-mix` focus `000N`, assumed `[0005,0008]`, shapes
  `["add-times","times-add"]`: `print(a + b * c)` / `print(a * b + c)`.
- `floor-div` focus `000Q`, assumed `[0005,0008]`, shapes `["bare-floordiv"]`:
  `print(a // b)` with a not a multiple of b (non-trivial quotient).
- `mod-basic` focus `000R`, assumed `[0005,0008,000Q]`, shapes
  `["bare-mod"]`: `print(a % b)` positive operands, non-zero remainder.
- `mod-neg` focus `000S`, assumed `[0005,000R]`, shapes `["neg-dividend"]`:
  `print(-a % b)` → Python result has divisor's sign.

## Test assertions (step 5)

- **K-1 (reframed):** ledger tags/slugs unique + charset + valid status +
  every parent present in the ledger; every `kb.concepts` entry has a
  matching active ledger entry with equal slug/kind/parents; drop the set
  equality; keep append-only K-2 as is (returns early while uncommitted).
- **K-11 inv 8:** stratified subsample; for each program, `parse()` →
  normalize to `{kind, op, children}`; in Pyodide run `ast.parse` on the
  same source, normalize identically; deep-equal. Skips constructs the
  micro-parser doesn't yet cover by only sampling wired exercises.
- **K-12 inv 9:** for each stratified program, after real execution probe
  each surviving name's `type(x).__name__`; equals the abstract store's
  final type (expose store finals from `footprint` via an added
  `finalTypes` field or a dedicated `analyzeTypes` — orchestrator picks).
- **K-13 inv 11:** for every exercise, on every stratified sample, the
  focus concept's authored `wrongAnswer` string must NOT equal the real
  one-line output (discrimination floor: a wrong answer identical to the
  truth teaches nothing). Real output via existing trace path.

## Anti-patterns (run-failing)

No weakened checks, no skips, no lowered sample counts; no `structural`
dodge; no waiver to dodge analyzer work; `kb/` imports nothing from
`app/`; ledger edited only by append (orchestrator only).
