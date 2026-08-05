# The expansion ladder

The planned growth path for the KB and its exercise forms, synthesized
from three planning passes (selection depth; new forms; functions +
input). Each rung lands independently green (full suite, K-series,
docgen byte-identity, quality bar design/exercise-quality-bar.md). This
document is the roadmap of record: contracts changed, sizing, and the
decisions already made — implementation sessions execute rungs from
here without re-litigating them.

## Rung overview and dependency graph

```
R1 selection depth  ──────────────────────────────┐  (no deps; no ledger change)
R2 Parsons form ──────────────┐                   │
R3 predict-the-error ─────────┴─ (R2 first: forms │
   + error-family mints           plumbing proven │
                                  before contract │
                                  change)         │
R4a input() rung (A0 + predict-io)  — independent ├─ any order after R1–R3
R4b functions waves (A1..A4, waves 1–5) ──────────┘
R5 write-the-line  (after R3; scope rule below)
   fix-the-bug     = composition of R3+R5, build later, never a third path
```

## R1 — Selection depth (no ledger change, zero fixture risk by design)

1. **Misconception follow-ups.** Generators emit an rng-free
   `misconception` field (the concrete wrong answer for THIS instance —
   ~15 generators already compute it for their variantCards); tutor
   matches the learner's normalized answer against it on a miss, bumps a
   NEW store `plp.kb.mc.v1`, and the compiler reserves a follow-up slot
   (parallel to the worst-concept slot, merged on collision) preferring
   the contrast exercise for that confusion. Concept-level `wrongAnswer`
   prose stays documentation — never matched.
   HARD RULE: computing `misconception` consumes no rng (fixture safety).
2. **The `challenge` role.** DECIDED CONTRACT: a challenge introduces
   ZERO new things — `braids: [tags]` (⊆ assumed, disjoint from the
   focus lineage), `assumed ⊆ ancestors(focus) ∪ braids ∪ ancestors(braids)`
   (the K-4 relaxation, scoped to this role only), and the compensating
   dynamic gate: dealt only when focus AND all of assumed are met.
   Gate = pool FILTER, never weight-zero (`weightedPick` returns pool[0]
   on all-zero totals — latent hazard, fix in passing). Challenges bump
   stats on focus only and never grant met. First 8 challenges are
   specced and legality-checked in the R1 plan (chal-alias-in-loop,
   chal-accumulate-until-break, chal-filter-build, chal-dict-under-branch,
   chal-slice-of-concat, chal-sum-of-built-list, chal-while-grows-string,
   chal-grid-total) in a new kb/exercises/challenges.mjs.
3. **Hard siblings.** `difficulty: "hard"` on review/challenge siblings;
   availability-gated on met(focus); exempt from the mastery ×0.25 and
   half the template-retirement decay — preference for hard material
   EMERGES as easy templates fade, no boost constant. Five specced
   (alias-chain-hard, precedence-gauntlet-hard, range-countdown-hard,
   trace-while-two-names-hard, grid-far-corner-hard).

Phases: misconception plumbing → challenge role (K-4 edit + K-chal
tests + kb/index offerable branch) → hard siblings. Sizing M total.

## R2 — Parsons: `order-the-lines` (new form, no contract change)

- Generator emits canonical `lines` (a compound block moves as ONE
  unit) + `targetOutput`; the SHUFFLE is drawn at COMPILE time in
  buildKBSession (deterministic per round; reload/review/retry rebuild
  identically). Guard: reshuffle if the draw equals canonical.
- GRADING: execute the student's arrangement (fill-one-blank pattern);
  any order that truly prints the target is correct; non-completing
  runs grade wrong. Positional-exact grading rejected (violates
  interpreter-first).
- K-10 gains: canonical runs clean and prints the target; the dealt
  shuffled state does NOT (machine-enforced discrimination).
- UI: ↑/↓ row buttons (touch-first, no drag dependency), new renderer
  beside renderTraceTable; card option `program: false` (the widget IS
  the program); loadCode still carries the shuffled join for
  open-in-editor honesty.
- NO met grant in v1 (arrangement is production evidence, weaker than
  §4's prediction classes; revisit with data).
- First five: order-copy-timing (000C), order-rebind-last-wins (000A),
  order-noncommutative-steps (000B), order-loop-total (001J),
  order-append-then-print (000G). Sizing M.

## R3 — predict-the-error + the error-literacy family

- ANALYZER CONTRACT (minimal): every would-raise throw gains
  `raiseKind`; three new detections (str+int TypeError — design §4.4
  already claims it; literal index ≥ len; literal key ∉ literal-dict
  keys); `footprint(src, { expectRaise: true })` returns the partial
  footprint up to the raise + `{ raises: {line, kind} }`. Default-path
  behavior byte-identical. Raising exercise programs are straight-line
  up to the raise (discipline; K-10 verifies against reality).
- MINTS (appends after 002M; next Crockford ids): `errors-are-information`
  (core, parent 0006; NameError folded in as its canonical witness —
  a separate NameError child would make the parent's intro
  footprint-illegal), plus edges type-error-str-int (parents: EAI +
  000K), index-error-out-of-range (EAI + 000E), key-error-missing
  (EAI + 001R). Lanes: state/strings/lists/structures — no new topic.
- FORM: program + "tap the line it stops on, pick what kind" — line
  picker + fixed 4-name error palette (shown from day one, E6). Graded
  against the REAL terminal exception (type_name + location.line via a
  new `actions.lastException` accessor). Reveal = type, message, line
  (learner frames only). MET GRANTED on first-attempt both-right
  (it IS the §4 evidence class; amend the binding doc in the same
  commit).
- DOCGEN TRAP (contained): CPython message wording drifts across
  versions — the reference renders ONLY "Type (line N)", never message
  text. K-oracles skips the execute-probe for raising exercises.
- First four: err-name-unbound, err-str-plus-int, err-index-range,
  err-key-missing. Sizing M–L (analyzer S–M + mints + form plumbing).

## R4a — input(): A0 + the `predict-io` form (independent rung)

- A0: `input` joins the analyzer builtins (returns str, emits 0026). S.
- EXEC: tutor auto-answers each live rendezvous from the ask's
  `stdinScript` (new `input-requested` event emitted at the existing
  step record; `queueMicrotask(provideInput(next))`); script exhausted →
  interrupt (invariant 2 — never wedge). Degraded fallback:
  `trace({stdinLines})` passes through to the engine's pre-supplied
  stdin.
- GRADING: full console transcript (prompts + single-path echo +
  output) from the chunk store via `ctx.consoleText`; also accept the
  echo-stripped variant. The stdin script is SHOWN as chips on the card
  (the typing is scaffolded; the placement is what's tested).
- DOCGEN: python3-piped stdin never echoes → the reference records
  program output only + a labeled stdin line; K-doc reads an
  echo-excluding console accessor. K-10 branch runs via a new
  `plp.traceWithStdin(lines)` helper and asserts script length ==
  rendezvous count.
- 0026 exercises live in state (closure = print/names/ints only):
  greet-and-echo, two-questions. The int(input()) bridge CANNOT be a KB
  exercise (K-4) — it becomes a hand-authored u1 lesson ask, and u1
  gains 0026 in its concepts so the existing input steps finally grant.
  Sizing M–L.

## R4b — Functions: analyzer A1–A4 + wiring waves 1–5

- ANALYZER: def/return grammar (top-level defs, bare-name params,
  STRAIGHT-LINE bodies — no if/loop/nested def/user-call inside a body:
  recursion and maybe-return merges deliberately out of subset);
  call relaxation (footprint judges unknown names); per-call abstract
  frames (params bound left-to-right = the 002F witness; local-first
  read-through; writes always local; pre-scan read-before-local-assign
  → would-raise so UnboundLocalError can never diverge silently);
  return-value + consumed-result tracking (002A/B/C/G/H); locals/shadow
  (002D/E); objId pass-through for 002J. Rule→tag table + 15 anchor
  cases specced in the R4 plan. `hasCompound` gains "def" (inv-8 skip).
  Pieces A0 S, A1 M, A2 M, A3 S–M, A4 S.
- WAVES (each: concepts pending.mjs → kb/concepts/functions.mjs,
  intros in kb/exercises/functions.mjs, new topic "Functions" once,
  KB-REFERENCE regen): W1 0027/0028 (def-then-done, call-count
  [multiline — once-per-call IS the concept], called-or-not spot-diff);
  W2 0029/002F (param-gets-value, pick-the-argument fill,
  args-computed-first); W3 002A/002G/002B/002C/002H (return-then-use,
  call-slots-in, shout-trap [the classic two-line None case, multiline],
  return-or-print spot-diff, early-exit, nothing-comes-back
  predict-state, two-calls-chain trace-table); W4 002D/002E
  (local-vanishes via the NEW predict-state "gone" answer token —
  form extension, one canonical token + UI chip; shadow-untouched);
  W5 002J (same-list-inside, append-or-rebuild spot-diff vs 000H).
- TRACE-TABLE DECISION: wave-1..3 tables watch MODULE-LEVEL names only
  (works today — frames are filtered out; the call line's position
  carries the returned binding). Frame-aware tables DEFERRED. Add the
  row-attribution anchor test before W3's table ships.
- DECIDED: none-is-a-value NOT minted — 002B/002H are its introduction
  (a standalone node has no natural pre-functions witness; contingency
  append documented if dict.get-default evidence emerges). 002G's
  redundant 0008 parent is ACCEPTED (any parents edit trips check-ledger
  — verified; the redundancy is behaviorally near-inert; one-line
  comment at wiring time). Total R4b sizing: L (~300 analyzer lines,
  ~20 exercises, 5 PR-waves).

## R5 — write-the-line (conditional GO, after R3)

fill-one-blank with a line-spanning blank; grading and syntax-error
paths already exist. SCOPE RULE (goes into the quality bar as the
form's E5/E6 clause): the blanked line must execute MORE THAN ONCE or
feed ≥2 distinct later observations — so no constant line can fake the
target. Mobile hardening: autocapitalize/autocorrect off + curly-quote
normalization. First two: write-loop-step (001J), write-build-append
(001K). fix-the-bug is R3+R5's composition — never a third grading
path. Sizing S–M.

## Standing constraints (all rungs)

Ledger append-only (check-ledger CI); K-doc byte-identity regenerated
in the same commit as any pool change; seed fixtures re-derived per
their documented derivations when pools grow; quality bar applies to
every new exercise; window.plp API grows but never breaks; suite stays
green at every rung boundary.
