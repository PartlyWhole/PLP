# Phase 3 plan — full breadth, docgen, invariants 13/14/17

> Orchestrator-owned decisions binding on all steps. Builds on phase 2.

## Scope

Wire intros for **every** remaining non-structural concept so inv 12 holds
over all 68 (+1 minted) nodes: the 5 phase-2 deferrals (000K, 000T, 000V,
000W, 000X), Strings (000Y 000Z 0010 0011 0012 0013 0014), Logic (0015 0016
0017 0018 0019 001A 001B 001C 001D), Loops (001E…001Q), Dicts/Tuples
(001R…001Y), new Lists (001Z 0020 0022 0024), plus the vocab-gap mint
`copy-is-shallow`. Then docgen + invariants 13/14/17.

## Design decisions

- **P3-analyzer — extend to the full §4.1 grammar.** Indentation-based
  suites; `if/elif/else`, `for`, `while`, `break`, `continue`, for/while
  `else`; comparisons + chains; `and/or/not`; truthiness; dict/tuple
  literals; slices (`a:b`, open-ended, full `[:]`); negative index;
  str `+`/`*`; conversions `str/int`; `len/sum/max/min/range/list`; method
  table `append/extend/pop/insert/remove/get/upper/lower`. Branch stores
  merge (differing type ⇒ ⊤, excluded from finalTypes so inv 9 never probes
  a conditionally-bound name); loop body analysed once with a type fixpoint.

- **P3-range-intros single-line.** Only `loop-for-visits-each` carries
  `multiline: true` (design §5.2). `range-*` intros use
  `print(list(range(…)))` → one bracketed line, so they stay single-line
  and still discriminate (endpoint inclusion is visible in the list).

- **P3-000K/000T** discriminate via string concat (now an ancestor of 000K,
  and of 000T through it): `print("2" + "3")` → `23` (wrong `5`);
  `print(str(3) + "4")` → `34` (wrong `7`).

- **P3-000W float-inexact** carries a **focus-salience waiver** (§4.5): the
  analyzer cannot see "prints a long tail", so `float-inexact` is not in the
  footprint; the waiver documents the salience exception and the value pool
  guarantees the tail always appears (`0.1 + 0.2` family). This is the run's
  one legitimate waiver; budget is `max(3, ⌈5% × exercises⌉)`.

- **P3-compare-ops/bool-values** ledger edge already inverted in phase 2:
  `bool-values` intro `print(True)`; `compare-ops` intro `print(3 < 5)`
  (emits both tags, bool-values in assumed).

- **P3-vocabulary-gap resolution (defines parity; gates phase-5
  retirement).** For each drill construct with no KB node:
  | construct | decision |
  |---|---|
  | `.upper()` / `.lower()` | KEEP — already whitelisted; map to string ops (no new node; they are display-only, folded into str handling with no discriminating node of their own → covered by str concept coverage) |
  | `.pop()` / `.insert()` / `.remove()` | KEEP methods in the analyzer; no dedicated node (list-mutation family already covered by append/index-assign) — drop from *drill parity* (no KB exercise) |
  | adjacent string literals (`"a" "b"`) | DROP — outside the subset (unparseable) |
  | `list * int` (list repeat) | DROP — no node; not minted |
  | shallow-copy-of-nested | MINT `copy-is-shallow` |
  | remove-while-iterating | DROP — mutation-during-iteration is out of scope |
  | comprehensions | DROP — explicitly outside the subset (§4.1) |
  Default per phase notes: mint `copy-is-shallow`, drop the rest. Each call
  recorded in the progress decisions log.

- **P3-docgen.** `kb/docgen.mjs` (pure: builds the reference model from the
  KB), `tools/kb-docgen.mjs` (Node CLI wrapper), and an env-gated fixture
  updater in the K-series (`KB_UPDATE_FIXTURES=1`, the only writer, executes
  samples in real Pyodide) → `curriculum/KB-REFERENCE.md`. Doc fidelity
  (inv 15): committed reference byte-identical to a fresh regeneration.

## Invariants

- inv 13 (explanation coverage): the focus tag's analyzer evidence is
  referenced by the selected card (variant card required when a generator
  spans operations).
- inv 14 (variety floors): ≥3 shapes per core concept; no consecutive
  `(form, shape)` repeats in a compiled session; all declared shapes/variants
  reachable (K-5 already covers reachability).
- inv 17 (waiver hygiene): every waiver fires; budget ≤ max(3, ⌈5%⌉); ruleId
  exists; issue non-empty; waivers appear in the doc.

## Step order

1. Analyzer extension (orchestrator) + local anchors.
2. Concept prose for all remaining nodes (orchestrator) + new concept
   modules (strings, logic, loops, structures) + wiring.
3. Exercises for all remaining nodes (orchestrator, possibly fanned to
   file-disjoint executors once the analyzer is stable).
4. Waiver for float-inexact; vocab-gap mint copy-is-shallow.
5. Docgen + fixture spec + KB-REFERENCE.md.
6. inv 13/14/17 tests.
7. Full suite; checkpoint.
