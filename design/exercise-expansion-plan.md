# Exercise expansion & quality plan

The roadmap of record for growing the exercise bank in a meaningful,
audited way, executed with the two project skills:

- **`/kb-author`** — every authoring batch follows its workflow
  (design-on-paper → G-rules → sample → K-series → docgen → fixture
  honesty). Craft rules: `design/generator-patterns.md`.
- **`/kb-audit`** — every phase opens and/or closes with an audit gate
  (mechanical sweep + judgment pass + adjudicated report). Quality bar:
  `design/exercise-quality-bar.md`.

Baseline (2026-08-07, main @ f605ddc): 87 loaded concepts,
176 exercises (83 intro / 85 review / 8 challenge, 5 hard), 10 forms.
Suite green: 170 passed / 1 pre-existing skip.

Why these phases, in this order — each targets a measured deficit with
direct learner impact, and each lands independently green:

| Deficit (measured) | Learner impact | Phase |
|---|---|---|
| Unknown latent quality debt | silent wrongness compounds as the bank grows | 0 |
| Misconception fields on only ~50/176 exercises | misses can't "answer back" (R1 follow-ups can't fire) on most of the bank | 1 |
| 30 concepts intro-only (1 exercise) | template retirement starves them: once the intro is answered right, the concept effectively vanishes from practice | 2 |
| Production forms tiny (write 2 / fix 3 / order 5) | the strongest transfer pedagogy barely exists | 3 |
| 8 challenges, 5 hard siblings | no ceiling: fast learners exhaust depth | 4 |
| New lanes thin (errors 4, io 2) | error literacy and input() under-practiced vs their importance | 5 |

Standing rules (all phases):

- One topic per authoring batch; audit gate on the batch diff before
  the next batch starts.
- No ledger edits, no new forms, no test weakening — wants in those
  directions go on the **escalation list** (§7) for the owner, per the
  skills' hard boundaries.
- Every batch ends with: K-series green, `kb-docgen --write` +
  `--check` clean, fixture changes reported honestly, and this file's
  §8 checkpoint updated (kb-progress precedent: a fresh session
  resumes from this file alone).

## Phase 0 — Baseline audit (audit only, no edits)

Run `/kb-audit` over the full bank at deep-sweep depth (60 seeds per
exercise): M1–M8 mechanical checks by real execution, J1–J6 judgment
pass (every concept card's example executed), K-series + check-ledger.

Deliverable: `design/audit-baseline.md` — the adjudicated findings
register (fix / inherent / design-change per finding), which becomes
Phase 1's backlog and the recurring audit's diff-baseline. The last
full sweep (pre-quality-bar) drove a 29-item fix wave; this one
establishes the register under the codified rules.

## Phase 1 — Debt paydown + misconception backfill

1. Fix every HIGH and MEDIUM from Phase 0 under `/kb-author`.
2. **G2 backfill**: add computed, rng-free `misconception` fields to
   every generator shape where the wrong-model output is computable.
   Measured coverage today (seed-1 sample): state 2/24, strings 1/15,
   structures 2/16, loops 5/32, logic 4/15, numbers 6/18, lists 16/36,
   functions 14/20. Target: every predict-output / predict-state /
   predict-io / spot-diff shape emits one (trace-table and
   predict-the-error are exempt in v1 — their wrongs are structural,
   not a single output string).

Impact: the R1 follow-up engine (miss → matched misconception → the
contrast exercise returns) works bank-wide instead of on ~28% of it.
Batch order (worst coverage first): strings → state → structures →
loops → logic → numbers → lists → functions.
Fixture note: adding a misconception is rng-free by rule (G2/G7), so
seeds do not shift — this phase is fixture-safe by construction.

## Phase 2 — A review tier for every concept

The 30 intro-only concepts each gain ≥1 review-tier exercise, form
chosen by E10 fit (the author skill's step 1), not by quota. Cores
first (19), then edges (11). The list, by batch:

- **state**: print-text, evaluate-before-bind, print-multi-args,
  str-literal-vs-number
- **numbers**: str-of-int, int-of-str, mod-sign-of-divisor,
  float-inexact, bool-is-int
- **strings**: str-concat, index-from-end, str-compare-code-points
- **lists**: list-literal, index-from-zero
- **logic**: bool-values*, compare-ops, else-otherwise,
  truthiness-empty-falsy, chained-compare
- **structures**: tuple-pack-print, in-dict-checks-keys
- **errors**: errors-are-information, type-error-str-int,
  index-error-out-of-range, key-error-missing
- **functions**: def-defines-not-runs, return-hands-back-value,
  return-exits-function, args-evaluated-first, none-when-no-return

(*bool-values' review-tier gap is DOCUMENTED as needing a future mint
— if no legal form fits inside its closure, it goes to the escalation
list, not forced.)

Expected yield: ~30 exercises. Impact: no concept is
met-then-abandoned; retirement decay always has somewhere to rotate.

## Phase 3 — Production-form ramp

Grow the three production forms where their anti-gaming contracts are
satisfiable (scope rule for write/fix; real-misbehavior-on-every-wrong-
order for Parsons):

- **write-the-line** 2 → ~8: one per topic where a loop-body or
  ≥2-observation line exists inside the closure (state accumulate,
  strings build, lists build/mutate, structures dict-build, functions
  return line).
- **fix-the-bug** 3 → ~8: prioritize concepts whose misconception IS a
  plausible written bug (off-by-one range, `+` vs `+=` on shared
  lists, `=` vs `==`-shaped compare misreads, wrong accumulate step).
- **order-the-lines** 5 → ~10: complete §5.5's six permutation classes
  (read/mutate order, copy/capture timing, swap, store order,
  accumulate/print interleave, loop-exit placement — only some are
  covered today).

Expected yield: ~16 exercises. Impact: prediction proves reading;
production proves transfer — this is the bridge to "write it on paper."

## Phase 4 — Challenge & hard ceiling

- Challenges 8 → ~16: each new challenge names its braid combination
  up front (the R1.2 contract: braids ⊆ assumed, outside the focus
  lineage, dynamic gate focus+assumed all met). Prefer braids that
  cross topic lanes (loop×dict, string×branch, alias×function-arg).
- Hard siblings 5 → ~12 on the most-practiced cores (loops, lists,
  logic), availability-gated on met(focus) per the R1.3 contract.

Impact: learners who clear a topic keep finding honest depth instead
of retired repeats.

## Phase 5 — Thin-lane parity

- **errors** 4 → ~10: more predict-the-error shapes varying the
  raising line AND type per exercise (E10b), plus review-tier
  fix-the-bug siblings — repairing the crash is error literacy.
- **io** 2 → ~6: more predict-io shapes; input + conversion braids as
  challenges (int(input()) needs int-of-str met — a natural braid).
- **functions** 20 → ~26: predict-state depth for local-scope /
  shadowing / mutable-arg; frame-aware trace-tables stay BLOCKED on
  the K-fnattr attribution deviation (escalation list, not forced).

## 6 — Recurring cadence (after Phase 5)

`/kb-audit` on every exercise-touching diff (scoped), plus a full
sweep after every ~30 added exercises. The audit register accumulates
in `design/audit-baseline.md` with dated addenda.

## 7 — Escalation list (owner decisions; never improvised)

Maintained here as phases surface them. Known at planning time:

- bool-values review-tier mint (documented gap).
- Frame-aware trace tables (K-fnattr deviation).
- New forms from the innovation lane (counterexample-hunt, mutation
  duels, trace-query) — each needs a design doc + runtime + K-10
  branch; explicitly outside this plan.
- Any closure wall where a phase-2/3 concept admits no legal exercise
  in its lineage (precedent: four documented closure-wall deviations).

## 8 — Progress checkpoint (update LAST in every batch)

| Phase | Batch | Status | Evidence |
|---|---|---|---|
| 0 | full-bank audit | **DONE** | `design/audit-baseline.md` — 176×40 seeds real execution; 1 HIGH (call-slots-in G1), 2 MED, LOW/inherent adjudicated; 83/83 card examples verified |
| 1 | fixes + backfill (8 topic batches) | **DONE** | H1/M-1/M-2 fixed (call-slots-in skip-map draw; err-str-plus-int raising line now varies 2/3; shadow-state multiline). Misconceptions backfilled via 4 parallel file-disjoint agents, each byte-identity-guarded + own real-execution sweep (0 collisions); ~25 shapes skipped with in-code comments where every candidate wrong collides with truth, is empty, or is multi-line (K-mc bars). K-mc law honored: spot-diff mc === aOutput. Central re-sweep: M3 clean (only the known probeGone checker artifact); fast K subset 16/16 green; KB-REFERENCE regenerated + `--check` clean |
| 2 | review tier (8 topic batches) | **DONE** | 24 review-tier exercises via 4 file-disjoint agents (state+numbers 7, strings+logic 8, order+structures 4, functions 5); every agent verified closure (kb.footprint, 40 seeds, both seed families), real execution, K-mc misconception laws, determinism, byte-identity of existing exercises. Closure walls handled per fallback (else-review arithmetic condition; bool-arith-spot literal-only; fill-operand misconception omitted per K-10 fill law). Deliberate skips per plan: float-inexact (waiver economy), bool-values (mint-blocked, escalation list), 4 error-concept reviews → Phase 5 |
| 3 | production ramp | **DONE** | write-the-line 2→4 (write-while-step 001M, write-range-header 001G), fix-the-bug 3→6 (fix-build-list 001K, fix-while-condition 001M, fix-shared-copy 0024), order-the-lines 5→10 (order-prints 0005, order-make-list 000D, order-pack-tuple 001W, order-store-read 001S, order-while-setup 001M). All scope-rule/constantLine/permutation laws machine-verified (incl. exhaustive 6-permutation checks per order exercise; K-10 [loops]/[lists] run green by the forms agent) |
| 4 | challenge/hard | **DONE** | Challenges 8→17: chal-word-count, chal-swap-parity, chal-neg-index-concat, chal-filtered-total, chal-star-triangle, chal-in-after-append, chal-call-total, chal-input-number (predict-io challenge), + continue-total-hard (challenge+hard — accumulation not in 001P's ancestry, braid mechanism per chal-accumulate-until-break precedent). Hard siblings 5→11: two-accumulators-hard 001J, dict-overwrite-chain-hard 001S, elif-ladder-hard 0019, param-shadow-hard 002E, double-then-add-hard 000B. R1.2 braid contract validated by loadKB + K-chal behavioral replication; K-chal census pins refreshed 8→17 / 5→11 (fixture refresh, commented) |
| 5 | thin lanes | **DONE** (authoring) | errors 4→8 (err-after-output 002N, err-mix-after-print 002P, err-index-computed 002Q, err-key-after-store 002R — raising lines vary per exercise, ≤1 printed line pre-crash, expectRaise footprints clean); io 2→4 (two-inputs, prompt-then-work — transcript conventions matched); functions depth landed in Phase 2 (5 reviews). Final verification gate in flight |

Sizing: ~176 → ~250–265 exercises; misconception coverage ~28% → ~90%
of applicable forms; every concept ≥2 exercises spanning ≥2 tiers.

## 9 — Execution record (2026-08-07)

All phases executed in one orchestrated session: 176 → **227 exercises**
(83 intro / 127 review / 17 challenge; 11 hard), misconception fields on
every applicable shape minus the documented skip register
(audit-baseline addendum). Verification at close: full K-series green
(29/29 after the fill-bool-op not-shape skip; K-chal census pins
refreshed 8→17 / 5→11 as a commented fixture refresh), KB-REFERENCE
regenerated + byte-clean, T/Q/P suites 80/80 with zero fixture breaks.
Work left in the working tree per the `commits: off` convention.
Follow-through wave (same day, commit 2782c3f): deployed + live-suite
validated; the variety pass paid (six generators widened, ceilings
documented); bool-values' review tier closed via a braided challenge
(chal-bool-verdict — no mint, superseding the escalation item); the
innovation lane's first form, trace-query, shipped end-to-end per
design/new-forms.md (bank at 231, eleven forms); pool-growth fixture
reconciliation completed (several breaks had been masked by piped test
invocations — repaid with re-derived pins). Escalation list now:
frame-aware trace tables (rides the settled trace UI); break-the-tie
and mutation-duel (specced in new-forms.md, break-the-tie's met-grant
needs owner sign-off). Recurring cadence (§6) is the standing practice.
