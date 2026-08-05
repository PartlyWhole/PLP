# KB integration — progress checkpoint

> Machine-and-human readable state for the autonomous phase runner
> (`design/kb-phase-runner-prompt.md`). The runner reads this FIRST and
> updates it LAST in every phase. It is the single source of truth for
> "where are we" — a fresh session with no memory of prior work resumes
> from this file alone.

## Settings (the invoking user sets these; the runner obeys them)

| Setting | Value | Meaning |
|---|---|---|
| `commits` | `off` | `off` = leave all work in the working tree. `checkpoint` = one commit per completed phase (only if the user's message authorized commits). |
| `executor-model` | `claude-opus-4-8` | Pinned via `.claude/agents/kb-implementer.md`. Never silently fall back to an alias. |
| `stop-after-phase` | `4` | The runner halts after this phase and reports. Phase 5's retirement step is gated regardless (see the runner prompt). |

## Phase status

| Phase | Title | Status | Evidence |
|---|---|---|---|
| 1 | The spine (kb/ + K-series, zero app changes) | **DONE** | 20-tag ledger, 16 intro exercises, analyzer (tokenize/parse/footprint), `loadKB()`; full suite 80 passed / 1 pre-existing fixme skipped |
| 2 | Full graph, first two topics | **DONE** | 68-tag ledger (all allocated); analyzer extended (floats, `// % **`, unary minus + literal sign, multi-arg print, tuple/swap assignment, op-precedence); 6 new intro exercises (State 000J/000M; Numbers 000N/000Q/000R/000S) → 22 exercises / 26 loaded concepts; oracles online (K-oracles: inv 8 parser fidelity vs Python `ast`, inv 9 type fidelity, inv 11 discrimination); K-1 reframed to ledger-ahead. **Full suite: 81 passed / 1 pre-existing fixme skipped** (`PLP_PORT=8633 npx playwright test`). See "Phase-2 deferrals" below. |
| 3 | Full breadth + docgen | **DONE** (breadth + oracles + inv 13/14/15/17) | All 68 §3 concepts wired with intros; analyzer completed to the full §4.1 grammar (strings, comparisons, booleans, `if/elif/else`, `for`/`while`/`break`/`continue`/for-else, dicts, tuples, slices, negative index, `len/sum/max/min/range/list/str/int`, `append/extend/get`); 64 intro exercises across all 7 topics; interpreter oracles online (K-oracles: inv 8 parser fidelity vs Python `ast` on expression programs, inv 9 type fidelity, inv 11 discrimination); inv 13 focus-salience + float-inexact waiver; inv 17 waiver hygiene; **inv 15 docgen DONE** — `kb/docgen.mjs` (pure) + `tools/kb-docgen.mjs` (Node CLI via python3) + `K-doc` fidelity test (executes every recorded sample in real Pyodide, byte-compares to committed `curriculum/KB-REFERENCE.md`; `KB_UPDATE_FIXTURES=1` is the sole writer; python3 and Pyodide produce identical bytes); **inv 14 DONE** — every core concept has ≥3 program-shapes (structural shape additions across all topic generators, plus 6 form-review exercises — fill-mod, mod-vs-floordiv, fill-bool, fill-range-stop, range-start-contrast, range-step-contrast — for the atomic concepts where 3 structural predict-output shapes are impossible within the closure); compiled sessions never repeat `(form, shape)` consecutively (K-inv14 checks both; compiled asks carry form+shape metadata). 75 exercises. **Full suite: 88 passed / 1 pre-existing fixme skipped**. |
| 4 | App wiring, forms, selection | **DONE** | (a) `app/kb-session.mjs` (PURE §6 selection over loadKB: level 3:1 × novelty × miss-rate, no-consecutive-(exercise,shape), `TEMPLATE_TO_CONCEPT`, `migrateStats`, `spliceBlank`); (b) `app/tutor.mjs` rewired — `startDrill` sources rounds from the KB (id kept `drill-<topic>-<seed>`), stats moved to `plp.kb.v1` keyed by concept TAG with one-time migration from `plp.drills.v1`, menu unchanged (8 buttons); (c) `predict-state` form (`app/questions.mjs` generator reading the probed name's final value from the trace, quote/whitespace-forgiving; tutor routes it through predict-then-verify) + 2 latent-state KB exercises; (d) `fill-one-blank` form (tutor async grade path: substitute token → run filled program → interpreter judges by output equalling the target) + 2 fill KB exercises + `blank`/`targetOutput` schema. plus (e) `spot-the-difference` (a `say` card renders program A with its real output, then predict-output on program B; contrast tag ∈ assumed ∩ ancestors(focus)) + 1 contrast exercise. **All four §5.2 forms shipped.** K-series form-aware (K-5/inv13 check both programs; K-10 verifies predict-state footprints, fill targets, and spot-diff A-outputs by real execution; K-4 enforces the contrast rule). Verified live in-browser (all forms). **Full suite: 86 passed / 1 skipped**; drill-bank + 8-button + drill-round T-series tests unedited. `app/drills.mjs` unwired but unmodified. |
| 5 | Expansion + retirement | **DONE** (retirement explicitly user-authorized) | `copy-is-shallow` (0025) fully wired: analyzer element-objId tracking (a shallow copy shares its elems array; mutation through one outer + read of the other emits 0025), concept + intro exercise, K-series green — drill parity complete. `0026 input-pauses-for-value` + the 12-node functions sub-graph (0027–002J) minted: ledger entries + full prose in the UNWIRED `kb/concepts/pending.mjs` (loading without intros would trip K-7; ledger-ahead is the designed mechanism). **Retirement executed**: `app/drills.mjs` + `curriculum/CURRICULUM.md` deleted, `plp.drills` export removed, the six drill-bank/CURRICULUM T-series tests deleted with K-series successors named in VALIDATION.md (mostly-basics preserved as new K-inv18 = design inv 18), TUTOR.md drill section rewritten for the KB. **Full suite: 106 passed / 1 pre-existing skip.** |

### Phase-2 deferrals (State & Numbers complete *except* these 5 edges)

§11 nominally completes State & Numbers in phase 2, but 5 nodes have no
contract-valid predict-exact-output intro until phase-3 machinery exists.
Their ledger entries are allocated; concept prose + exercise land in phase 3:

- `000K str-literal-vs-number` (State) — no discriminating witness without a
  cross-kind op (str-concat); resolves with Strings. Ledger parents already
  corrected to `[0007, 0002, 000Y]` so the phase-3 intro is realizable.
- `000T str-of-int`, `000V int-of-str` (Numbers) — the conversion cluster
  descends from `000K`; keep together with Strings.
- `000W float-inexact` (Numbers) — the analyzer cannot see "prints a long
  tail"; §4.5 ties it to the salience-**waiver** machinery (inv 17, phase 3).
- `000X bool-is-int` (Numbers) — needs `bool-values` (Logic); resolves with
  Logic. `0015 compare-ops` / `0016 bool-values` ledger edge inverted so
  bool-values (intro `print(True)`) precedes compare-ops (intro `print(3<5)`).

## Ledger high-water mark

Last append: `002J` (82 entries — the 68 §3 tags, plus 0025
`copy-is-shallow` (wired), 0026 `input-pauses-for-value` and the 12-node
functions sub-graph 0027–002J (minted with prose in the unwired
`kb/concepts/pending.mjs`; exercises to follow with analyzer support)).
Historical phase-2 note: `0024` (68 entries). Phase 2
appended the remaining 48 in ascending tag order. Phase 3 corrected one
uncommitted parent (`0017 if-runs-or-skips`: `[0016]`→`[0015]`, so an `if`
test can be a comparison — see P3 decisions). `copy-is-shallow` (would be
`0025`) is NOT minted (deferred — see decisions). The orchestrator is the
ONLY writer of `kb/tags.ledger.json`. With `commits: off` the ledger is
uncommitted, so tags are not yet permanent; K-2 returns early.

## Decisions log (append one line per phase-level decision)

- P1: data files are `.mjs` modules, not `.json` — identical import in
  browser and Node, no fetch, no import attributes.
- P1: `kb/rng.mjs` duplicates `mulberry32` rather than importing from
  `app/questions.mjs` (which pulls in DOM-adjacent `memory.mjs`);
  K-rng pins both streams so they cannot drift.
- P1: structural tags are permitted in any footprint and never listed in
  `assumed` (design §2.8), enforced by `loadKB()` on load.
- P2 (executor mechanism): the pinned `kb-implementer` agent could not be
  hot-loaded mid-session (the agent registry is fixed at session start),
  and the Agent `model` param exposes only aliases (`opus` ≠ guaranteed
  4.8). Adaptation: the orchestrator implemented the tightly-coupled crux
  itself (ledger, all concept prose, analyzer, exercises, test oracles) —
  which the role split already assigns to it — and reserves
  `general-purpose` executors (no model override → inherit the parent's
  Opus 4.8) for the file-disjoint mechanical breadth in phase 3. The
  `.claude/agents/kb-implementer.md` definition (pinned to
  `claude-opus-4-8`) is in place for a future session that starts with it
  registered.
- P2 (A1 ledger-ahead / K-1 reframe): the tag ledger is the permanent
  allocation registry and legitimately runs ahead of the loaded concept
  set during breadth build-out (the DAG is cross-topic; a concept cannot
  load before its parents, nor satisfy inv 12 before its intro exists).
  K-1 changed from "ledger tag set == module tag set" to "every loaded
  concept matches an active ledger entry; ledger self-consistent." inv 12
  (K-7) still holds over the loaded set at every checkpoint (matches §11
  staging inv 12 as phase-3).
- P2 (A2 parent corrections): three §3 parent sets were corrected at mint
  time because §3's parents give no discriminating intro — `000K` gains
  `str-concat`; the `compare-ops`↔`bool-values` edge is inverted
  (bool-values first). See `design/kb-phase-2-plan.md` §A2 for rationale.
- P2 (A4 deferrals): 5 State/Numbers edges deferred to phase 3 (see
  Phase-2 deferrals above) — each blocked on phase-3 machinery, not a
  shortcut.
- P2 (A5 analyzer incremental): the analyzer covers the phase-2 subset now
  (arithmetic, floats, unary sign, multi-arg print, tuple/swap,
  precedence); strings/comparisons/branches/loops/dicts/slices/methods are
  added in phase 3 as their exercises land, so every analyzer path ships
  with an oracle-checked exercise rather than untested.
- P3 (if-test parent): `if-runs-or-skips` (0017) parent changed
  `[bool-values]`→`[compare-ops]`. An `if` test is normally a comparison,
  so compare-ops (which already has bool-values as its own parent) must
  precede `if`; without it, `break`/`continue` intros (which need a
  per-item comparison in the loop body) had no valid closure. Propagates
  compare-ops to all if-descendants. Uncommitted ledger edit.
- P3 (row-2 refinement): `quoted-vs-name` (0007) now fires only when a
  string literal's TEXT is a bound name (the genuine `"x"` vs `x`
  confusion), not whenever any name is loaded — otherwise plain print
  labels like `"big"` in branch/loop programs spuriously charged 0007
  outside the focus's closure.
- P3 (loop-accumulate/build-list are for-only): these are children of
  `loop-for-visits-each`, so a `while` counter (`n = n - 1`) charges only
  `accumulate-rebind`, never `loop-accumulate` (analyzer gates on
  for-depth, not loop-depth).
- P3 (branch intros use bool literals / literal comparisons, not names):
  `if`/`else`/`elif` focuses depend only on bool-values/compare-ops, not
  `name-holds-value`, so their intros test `if True:` / `if 5 > 3:` — one
  printed line, still discriminating, footprint inside the closure.
- P3 (range intros one-line): only `loop-for-visits-each` is `multiline`;
  `range-*` intros use `print(list(range(…)))` — one bracketed line that
  still shows endpoint inclusion.
- P3 (vocabulary-gap resolution — defines drill parity, gates phase-5
  retirement): `.upper/.lower` KEEP-but-no-node (display-only, folded into
  strings; not a drill-parity exercise); `.pop/.insert/.remove` DROP (no
  node; list-mutation family already covered by append/index-assign — not
  in the analyzer's method set); adjacent string literals DROP (unparseable
  in the subset); `list * int` DROP (no node); shallow-copy-of-nested →
  `copy-is-shallow` **DEFER not mint** (see below); remove-while-iterating
  DROP (out of scope); comprehensions DROP (explicitly outside §4.1).
- P3 (copy-is-shallow deferred): the vocab-gap default was to mint it, but
  detecting it needs element-level objId tracking — a shallow copy shares
  *nested* objIds accessed through subscripts (`b = a[:]; b[0].append(x)`),
  which the analyzer's value model (elements carry no objId) does not
  represent. Rather than ship a brittle syntactic heuristic or a second
  salience waiver, it is deferred: mint the tag and add element-objId
  tracking together in a later pass. Drill parity for the
  "shallow-copy-of-nested" construct is therefore the one unmet item.
- P3 (float-inexact salience waiver): `float-inexact` (000W) has no
  syntactic witness (§4.5); its exercise `float-tail` carries the run's one
  `focus-salience` waiver in `kb/waivers.json`. Budget is `max(3, ⌈5%⌉)=4`;
  1 used. K-inv17 asserts it fires (000W never emitted) and is well-formed.
- P4 (topic picker is a practice pool, not frontier-gated): a fresh
  student's KB `offerable` for a specific topic is empty (mastery-gated), so
  a topic button would yield nothing. The drill/practice UI therefore draws
  from the topic's exercise POOL weighted by §6 weights (level 3:1 × novelty
  × miss-rate), avoiding consecutive `(exercise, shape)` repeats — matching
  the existing drill UX. The mastery-gated `frontier`/`offerable` stay on
  `loadKB()` for a future adaptive/placement consumer.
- P4 (record shape kept `{seen, missed}`): the drill-round T-series test
  pins `toEqual({seen, missed})` for a bumped entry, so the persisted stat
  is NOT extended with a `streak`/`met` field. The review staircase (a
  per-concept consecutive-correct streak, §6.3) is therefore approximated by
  novelty + miss-rate; adding the streak field would require editing that
  pinned test, which the runner prompt asked to keep unedited.
- P4 (stats keyed by concept TAG in `plp.kb.v1`): a tag is permanent, so
  mastery survives slug renames / exercise rewrites. One-time migration from
  the legacy template-keyed `plp.drills.v1` via `TEMPLATE_TO_CONCEPT` +
  `migrateStats`, guarded by the presence of `plp.kb.v1`. `drillStats()`
  (test-facing) reads the new store; each answered question bumps its focus
  tag.
- P4 (lesson id + menu unchanged): `buildKBSession` keeps the id format
  `drill-<topic>-<seed>` and `kbTopics` mirrors `drillTopics` (same ids +
  titles), so the drill-round test and the 8-button menu test pass unedited;
  the drill-BANK tests (which hit `window.plp.drills` directly) are
  unaffected because `app/drills.mjs` is unwired but unmodified.
- P4c (predict-state reads the trace, no separate probe): the trace the
  tutor already runs captures every name's final value (`snapshotAt` →
  `textValue`), so predict-state grades the probed name's value SYNCHRONOUSLY
  against that trace — no `print(repr(a))` execution needed. `normalizeAnswer`
  already forgives whitespace + quote style, which is exactly the §13 Q4
  default for this form. The displayed program never prints the probed name;
  the K-series footprints it augmented with `print(<probeName>)` (that read is
  what makes the concept observable — see `footprintSource`).
- P4d (fill-one-blank — the interpreter is the judge): the exercise carries
  the full correct `code`, a `blank {line,col,len,target}`, and a
  JS-computed `targetOutput`. K-10 VERIFIES `targetOutput` by real execution
  (interpreter ground truth). At runtime the tutor splices the typed token
  in, runs the filled program, and reuses predict-output grading with the
  target as the answer — so ANY fill whose real output equals the target is
  correct, and a non-parsing fill just grades wrong (no traceback).
- P4e (spot-the-difference reuses say + predict-output): rather than a new
  handler, a `say` card renders program A (```py fence) with its real output,
  loadCode puts program B in the editor, and a normal predict-output ask
  grades B. The exercise carries `code` (A), `contrastCode` (B), and
  `aOutput` (A's output, K-10-verified by real execution). BOTH programs must
  stay inside the closure (K-5 iterates `footprintSources`), the focus is
  salient in A (the `+=` program), and `contrast` (0021) ∈ assumed ∩
  ancestors(focus) (K-4). All four §5.2 forms are now shipped.
- P4 (forms are review exercises): the 2 predict-state and 2 fill-one-blank
  KB exercises are `role: "review"` over concepts that already have a
  predict-output intro (000H/000M, 0008/0006) — they add form variety
  without disturbing the one-intro-per-concept coverage (K-7) or the
  cold-start chain (K-8).
- P3-docgen (inv 15): `kb/docgen.mjs` is pure (imports only `kb/`, takes the
  real sample outputs as an argument); `docSamples(kb)` lists the programs to
  execute (spot-diff → A+B, predict-state → code+read-of-probe, else code)
  keyed by `${id}|${label}`; `renderReference(kb, outputs, waivers)` is
  deterministic (tag-sorted, no clock/RNG). The `K-doc` test executes every
  sample in real Pyodide and byte-compares to the committed
  `curriculum/KB-REFERENCE.md`; `KB_UPDATE_FIXTURES=1` is the ONLY writer.
  `tools/kb-docgen.mjs` (owned by this session) uses system `python3` and
  produces IDENTICAL bytes (Pyodide is CPython), verified by
  `node tools/kb-docgen.mjs --check`. So a KB change without a doc rebuild, a
  hand edit to the doc, or a stale sample output all fail the suite. Provenance:
  each sample re-generates from `(exerciseId, k=0)`. `CURRICULUM.md` untouched.
- P3-inv14 (variety floors, user-directed "full ≥3 for every core"): shapes
  are STRUCTURAL skeleton differences (never value regimes — a "big operand"
  shape is just different literals and does not count). Structural additions
  where the closure permits (chains, named intermediates, decoy binds,
  direct-literal forms, multi-store sequences); where 3 structural
  predict-output shapes are provably impossible within the closure (mod —
  chaining % drags in mod-sign; bool-values — only True/False exist;
  range-* — every witness is print(list(range(…)))), the floor is met by
  form-review exercises (fill-one-blank / spot-the-difference), which is what
  §5.3 counts: shapes accrue per FOCUS across all its exercises. Two edges
  found and kept during the grind: a while-loop counter must not charge
  loop-accumulate (for-only), and `xs = list(range(n))` needs 0006 in
  assumed (it IS an ancestor via 001E→000D). The session compiler's
  no-repeat key tightened from (exercise, shape) to (form, shape); compiled
  asks now carry form+shape metadata so K-inv14 checks adjacency exactly.
- P3-inv14 (fixture note): the T-series fill-one-blank test re-derived its
  seed (2, `print(14 ___ 8)`) after generator changes shifted per-seed
  samples — a fixture refresh, not a weakened assertion.
- Binding (met map is a sibling store): the spec's "one shared store" is
  implemented as `plp.kb.met.v1` (tag → {at, source}) BESIDE the pinned
  `plp.kb.v1` {seen, missed} stats — the pinned drill-round test forbids
  extending the stat record, and met-ness is §2.8 evidence while seen/missed
  is §6.3 scheduling weight: different lifecycles, one key space (tags).
- Binding (what grants met): only kind `predict-output`, correct, first
  attempt (structural — the form has no retries), before the final hint.
  predict-state/fill-one-blank/spot-diff answers bump stats but do not
  grant met (conservative reading of §2.8 "correct prediction"; extending
  grant-eligibility to predict-state is a one-line change if wanted).
- Binding (frontier gate on the menu): with met EMPTY the frontier is
  always non-empty ({print-text}), so the "drill what you just learned"
  entry is gated on `met.length > 0`, keeping the pinned 8-button
  fresh-visit menu; with mastery it becomes 9 buttons.
- Teach-first (owner-directed refinement of §5.4 "no spoilers"): a
  concept UNSEEN in the student's stats gets its rule card as an
  instructional "🌱 New idea!" say-card in the same beat, directly above
  their first question on it (one per concept per round; deterministic —
  gated on the stats snapshot, so persisted rounds rebuild identically).
  Seen concepts stay unspoiled: prompts never name the rule; it returns
  only after a miss. Rationale: an intro exercise introduces exactly one
  atomic concept (§2.8), so its first encounter should instruct before it
  asks; the §2.8 met-rule is unaffected (the card teaches the rule, never
  the specific program's answer, and the prediction is still the
  student's own).
- Teach-first is KIND-AWARE (follow-up refinement): core → teach-first
  (fundamentals instruct before they ask); edge → discover-first (the
  corner-case traps' pedagogy IS the surprise — the miss creates the felt
  need the card answers, §10.3's alias-trap argument). Optional
  per-concept override `introStyle: "teach-first" | "discover-first"`,
  validated by loadKB; no concept currently overrides.
- Practice card surface (owner-approved ground-up redesign): drills leave
  the IDE entirely — a full-viewport one-card view (`app/practice-ui.mjs`,
  `body.practice`) with program-in-card (read-only CM), one-line prompts,
  in-card "▶" reveal from the graded run (`card.reveal` contract; stage
  handles lack it and stay byte-identical), explain-in-the-same-card,
  progress dots, and full-surface menu/map/summary. A surface ROUTER in
  tutor.mjs dispatches ui calls (drills/menu/map → practice; guided
  lessons → the focus stage — the IDE is their content) with teardown on
  switch. Prose diet: round banner deleted; 🌱 teach = ask.teach
  (statement + collapsed example; reload-safe), spot-diff pair =
  ask.context; prompts one line, numbering → dots; first-time-per-form
  mechanics lines gated by plp.practice.v1. Escape hatches: ←/Esc hide
  (round resumable — collab go-live shares the path), open-in-editor +
  restore chip, predict-state → memory model. Shared widgets extracted to
  app/tutor-widgets.mjs so both surfaces render identical cards/meters.
- Graded-beat feedback loop (owner report: "it doesn't tell me if I got it
  right"): the one-card surface wiped the verdict when a CORRECT answer
  advanced straight to the next ask. Fix at the data level, not a timer:
  kb-session emits a bare `{pause: true}` step on the correct branch (new
  step type, linted; wrong/skip already paused on the explain), so every
  graded card HOLDS — verdict prominent (`.pr-verdict-slot` above the
  reveal), Continue →, Enter falls through the frozen card. Rode along
  (owner-requested): question-frozen records carry a `review` snapshot
  (program/kind/opts/blank/expected/teach/context) → dots become the
  scoreboard AND back-buttons (green hit / red miss / green ring =
  solved-on-retry) opening a review card; "Try it again" re-runs and
  re-grades for real around an editor snapshot/restore, but rec.ok, kb
  seen/missed, met grants, and the summary all keep the FIRST attempt
  (retry only decorates rec.retry); wrong reveals link "🔬 step through
  this run" (the graded trace is already in the memory model); 📝 scratch
  notes drawer (plp.notes.v1, write-only); Esc dismisses progressively.
  T-24/T-25 cover it (correct-answer-holds + dots-review tests).
- Order-matters + trace-table (owner-requested, subagent-planned and
  -implemented, orchestrator-integrated): (1) 13 order-contrast
  spot-the-difference siblings via kb/contrast.mjs orderPair — one moved
  line changes the result; A≠B outputs verified under real python3 across
  40 seeds each; no ledger change (order is a variation discipline, not a
  concept; design §5.5). (2) FIFTH FORM `trace-table` (design §5.2.5):
  exercise declares {code, probeNames, maxBlanks?}; rows/blanks/expected
  derive from the REAL trace at runtime (traceTableQuestion in
  questions.mjs over snapshotAt/diffSnapshots; changed-cells-only blanks,
  givens carried, elision cap); execTraceTable traces silently first (the
  trace is the answer key), one lock grades per-cell (container-forgiving)
  all-or-nothing, met on clean first-attempt perfect table (binding §4
  amended — stronger witness); review shows the graded table, retry
  disabled for tables in v1. First wave: trace-rebind (000B), trace-sum
  (001J), trace-alias (000H — one append changes BOTH columns in one row).
  K-series extended (footprintSources probe appends, K-10 trace-table
  branch: 2..maxBlanks, all names blanked, single-line expecteds); docgen
  renders end-holdings; lists spot-diff fixture re-derived 143→199. Pool
  87→103 exercises.
- Wave 3 (owner: branch-rebind + dict traces + table retry): MINTED 002K
  branch-picks-binding (core, parents else-otherwise + accumulate-rebind —
  the deferred branch-rebind trace's legal home; ledger 82→83, analyzer
  rule: plain-name rebind at ifDepth>0 emits 002K, zero fallout across all
  108 pre-existing exercise programs). New: branch-rebind intro (3 shapes),
  trace-branch (if-else always rebinds exactly once — both rows real),
  trace-dict-build (001S; build-two-keys + overwrite-key — the middle row
  is the only moment the first value exists). Table RETRY in review
  (subagent): "Try it again" swaps the graded table for a blank one (truth
  leaves the screen — otherwise it's copying), grades a real re-run
  per-cell, "never mind" restores; score-of-record semantics identical to
  single-input retries. Pool 105→108, concepts 69→70 wired.
- Quality-bar codification + systematic sweep (owner: "compile the
  properties we iterated and review everything"): the accumulated bar now
  lives in design/exercise-quality-bar.md (C1–C7 concepts, E1–E14
  exercises, each traced to its origin, machine- vs judgment-enforced).
  Mechanical sweep (12–60 seeds real execution) + two judgment reviewers
  over all exercises/concepts adjudicated every flag: 29-item fix wave —
  highs: if-runs last-literal meta (27/60 seeds now break it),
  empty-is-falsy never-ran branch (truthy shapes added), repeat-vs-concat
  A==B on n=2 (half of seeds! n now 3..4), fill-bool retired (provably
  unfixable in ancestors(0016): every legal variant is transcription or
  ungradable) → replaced by fill-bool-op at 001A; bool-values' review-tier
  gap is DOCUMENTED as open (needs a future mint). Mediums: while-count-down
  constant-0 landing (varied step), for-else-runs dead `if False:` (real
  search shapes), copy first-number meta (rebound-read counter-shapes),
  floor-div/bool-arith/text-compare spreads, precedence-mix card misstating
  the misconception. Ramp: +9 review-tier exercises (fill-aggregate where
  exactly one builtin fits, in-list-spot mirrored pairs, fill-dict-key,
  unpack-vs-pack, branch-boundary-order, quoted-vs-name-spot,
  floordiv-divisor-spot, fill-precedence-op, concat-vs-append→legal 0021
  single-concept redesign). Four closure-wall deviations documented (000G/
  000P sibling contrasts illegal — redesigned inside closure). 000K lane
  state→numbers. All concept cards' example claims execution-verified
  TRUE. Pool 119→128. Sweep re-run post-fix: remaining flags all
  adjudicated-inherent classes.
- Full KB review (3 parallel audit agents: DAG structure, exercise depth,
  learner journey) → update wave. Verdicts: graph SOUND, reorganization
  not worth append-only churn; depth and selection were the real gaps.
  Landed: (1) selection intelligence — frontier-biased cold start
  (0.2^unseenAncestors penalty fading over first 24 answers; opts.met
  threaded), guaranteed worst-concept slot per round/chunk (makes the
  welcome's "comes back until easy" true), concept-level no-repeat with
  cross-chunk prevKey, focus rounds force teach-first + cap count 2 on
  single-exercise pools, "🌱 Start here" u1 on-ramp for fresh profiles,
  honest welcome copy; predict-state now grants met (binding §4 amended).
  (2) content — 5 exercise bug-fixes (JS-true card, elif/falsy word
  collisions, no-op slot write, always-True text-compare, transcription
  fill), 10 depth additions (predict-state for mutation concepts 001S/
  0023/000G/0025, trace-tables 001K/001N, fills 0011/001H, spot-diffs
  0020/0022), index-char lane fix lists→strings. (3) MINT 002M
  in-checks-membership (core; parents 000D+0016; analyzer row52b for
  in/not-in on list/str — previously a hard error; 3-shape intro
  in-list). (4) design-doc errata (§3.6 bool edge direction, 000K
  parents, method whitelist). Deferred by graph contract: fill-bool
  de-transcription (needs an exercisable bool ancestor), None-as-value
  mint (functions wiring). Pool 108→119, concepts 70→71 wired, ledger
  83→84. Lists fixture re-derived 199→69→162 (pool grew twice).
- UI revamp (owner-approved plan, executed in 9 phases): focus mode — the
  beat panel promoted to a full-height stage in the code column, editor
  receded right, console a slim always-live strip that GROWS as the reveal
  cue (explain beats keep it; the next question resets), memory pane
  per-beat (`focus-memory`), transcript behind 📜 History, ⇱ Back to
  editor → classic dock (non-modal preserved), flags never persisted;
  tutor-scoped design tokens (`--t-*`) with amber-miss/growth framing and
  a one-shot success bloom; per-topic mastery meters + welcome mastery
  line (`topicProgress`); round summaries (`app/progress.mjs`, pure,
  reload-restoring) with a frontier-thickest "Keep going" suggestion; the
  learner concept map (`app/concept-map.mjs`: 7 lanes, longest-path
  layering + barycenter, SVG edge underlay per the mm-binding-lines
  precedent, in-lane edges only with cross-topic prerequisites as detail
  jump links) and targeted practice (`buildKBSession` `focus` option:
  one concept's own exercises, 4 questions,
  `drill-{topic}-{tag}-{seed}`). T-series DOM contracts evolved with the
  UI (stage geometry, 9/10-button menu); `window.plp` and all K-series
  contracts unchanged.

## Pending doc rows — MERGED (2026-07-30)

Both sessions are done and the merge is complete: the side-work worktree's
deliverables were copied into the main tree (`tools/check-ledger.mjs`,
`tools/kb-placement.mjs`, `tests/ledger-check.spec.mjs`,
`tests/placement.spec.mjs`, `.github/workflows/kb-ledger.yml`,
`design/lesson-kb-binding.md`, `design/kb-sidework-plan.md` — its LC/P
suites pass unmodified against the evolved 68-concept KB), and the rows
below were folded into `VALIDATION.md` (K-series table refreshed to full
breadth, K11–K17 + KT1–KT6 added, K-LC/K-PL appended) and `CLAUDE.md`
(invariant 10 extended with ledger-ahead + KB-REFERENCE regeneration;
side-work's CI-enforcement bullet added as invariant 11). The sections
below are retained as the historical record of what was parked.

**VALIDATION.md rows to add:**
- Analyzer full-subset coverage (floats, `// % **`, unary minus + literal
  sign tracking, multi-arg print, tuple/swap assignment, op-precedence) →
  best evidence: `tests/kb.spec.mjs` K-5, K-5a → covered.
- Parser fidelity vs Python `ast` (inv 8) → `tests/kb.spec.mjs` K-oracles.
- Abstract type fidelity vs runtime `type().__name__` (inv 9) → K-oracles.
- Exercise discrimination floor (inv 11) → K-oracles.
- 26 loaded concepts / 22 intro exercises across State, Numbers, Lists.

**CLAUDE.md invariant-10 clarification to add:** the tag ledger may run
ahead of the loaded concept set during phase-2/3 breadth build-out (K-1 is
directional: loaded ⊆ ledger, exact match on the intersection; still
append-only, tags still permanent once committed).

**VALIDATION.md rows to add (phase 3):**
- Full-subset analyzer (strings, comparisons+chains, booleans+truthiness,
  `if/elif/else`, `for`/`while`/`break`/`continue`/for-else, dicts, tuples,
  slices, negative index, aggregates, conversions, method table) → K-5,
  K-5a, K-oracles.
- 64 intro exercises spanning all 7 topics; 68 concepts loaded (all §3).
- Focus salience (inv 13) + waiver hygiene (inv 17) → K-inv13, K-inv17.
- Generated reference `curriculum/KB-REFERENCE.md`, drift-guarded byte-for-byte
  with real-execution outputs (inv 15) → `tests/kb.spec.mjs` K-doc;
  regen via `node tools/kb-docgen.mjs --write` or `KB_UPDATE_FIXTURES=1`.
- App wiring: KB drives the practice UI (`app/kb-session.mjs`), all four §5.2
  forms (predict-exact-output, predict-state, fill-one-blank,
  spot-the-difference) → T-series drill-round + predict-state + fill-one-blank
  + spot-the-difference tests; mastery keyed by concept tag in `plp.kb.v1`.

## Open blockers

(none — the executor-mechanism issue was adapted around, not blocking)

## Deferred work + resumption plan (for the next session)

The suite is green at 88 passed / 1 skipped. Remaining work:

1. **Phase 3 — DONE** (breadth, oracles, inv 13/14/15/17, docgen). The one
   phase-3 remnant: **mint `copy-is-shallow`** once the analyzer gains
   element-level objId tracking (shallow copies sharing nested objIds
   through subscripts). Then drill parity is complete.
2. **Phase 4 — DONE** (all of a/b/c/d + all four §5.2 forms;
   `stop-after-phase: 4`). Phase 5 (functions sub-graph + retirement) stays
   out of scope; retirement is user-gated.
3. **Guided-unit lesson↔tag binding — DONE** (executed against the side-work
   spec `design/lesson-kb-binding.md`): u1 `skills` → `concepts:
   ["0006","0009","000A","000B"]` with `focus: "0009"` / `focus: "000B"` on
   its two graded asks (input-boundary steps unfocused — known gap until an
   input concept is minted); load-time lint (`lintLessonConcepts` in
   kb-session, wired into `lintLesson`) rejects unknown/structural/
   out-of-unit focus tags; `grantMet(tag, source)` writes the shared met map
   `plp.kb.met.v1` (tag → {at, source}, idempotent, first grant wins) — the
   stats store `plp.kb.v1` keeps its pinned {seen, missed} shape, so the met
   map is a sibling store, not a record extension; met granted ONLY on a
   clean first-attempt correct predict-output before the final hint
   (lessons via `ask.focus`, source "lesson"; practice rounds via
   `ask.concept`, source "drill" — both surfaces feed the one store);
   post-lesson menu computes `frontierTags(met)` and prepends "⭐ Drill what
   you just learned" → `drillTopicFor(frontier)` (fresh visits keep the
   pinned 8-button menu — the entry appears only once mastery exists);
   debug API `plp.tutor.met()` / `plp.tutor.frontier()`. Three T-series
   tests cover the spec's §7a–d plan (lint rejection + u1 lints clean;
   wrong/demo grants nothing, clean correct grants with source; post-final-
   hint correct grants nothing; frontier feeds the 9-button menu).
   **Full suite: 91 passed / 1 skipped.**

Where things stand: the KB's breadth + analyzer + oracles + integrity, and
the full app wiring — the KB drives the practice UI with ALL FOUR §5.2
forms (predict-exact-output, predict-state, fill-one-blank,
spot-the-difference) — are complete and green (86 passed / 1 skipped).
Remaining (inv 14 ≥3-shapes variety, docgen, and the guided-unit lesson↔tag
binding spec'd in the side-work worktree's `design/lesson-kb-binding.md`)
are independent; a future session resumes cleanly from this green baseline.

## Deferred / out of scope (do not drift into these)

Functions **exercises** (phase 5 mints nodes only); spaced repetition;
classroom telemetry; live-site deploy validation; anything owned by the
parallel side-work session (`.github/**`, `tools/check-ledger.mjs`,
`tools/kb-placement.mjs`, `tests/ledger-check.spec.mjs`,
`tests/placement.spec.mjs`, `design/lesson-kb-binding.md`).
