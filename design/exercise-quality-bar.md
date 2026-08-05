# The exercise & concept quality bar

Every property below was earned during development — most trace to a
specific owner complaint or audit finding. New exercises and concepts are
held to ALL of them; reviews sweep the whole bank against them. Machine
enforcement is noted per property (K-series test or sweep script); the
rest are judgment properties for review passes.

## Concept properties

| # | Property | Origin | Enforcement |
|---|---|---|---|
| C1 | Ledger discipline: tag exists in the append-only ledger, active, 4-char Crockford base-32; the loaded concept matches its ledger entry exactly | design §2.5 | K-1, check-ledger CI |
| C2 | Kind honesty: `core` = bread-and-butter that deserves teach-first; `edge` = a genuine trap whose surprise IS the pedagogy (discover-first) | intro-style design | review judgment |
| C3 | Parents are the real prerequisites, in teachable order — the frontier walk unlocks the concept exactly when a student could learn it; no redundant transitive edges on NEW mints | DAG audit | K-3 + pre-wire review |
| C4 | Machine visibility: an analyzer rule emits the tag; the concept's own exercises make it salient | 002K/002M mints | K-inv13 |
| C5 | Prose contract: one-sentence statement (second person, concrete, accurate); short card with a runnable example whose claimed output is TRUE; `wrongAnswer` names the actual misconception | style contract + audits | review judgment (run the card's example!) |
| C6 | Depth floor: ≥1 intro exercise; cores reach ≥3 program shapes; cores deserve a review-tier exercise | K-7/K-inv14 + depth audit | K-7, K-inv14 (shapes); review (review-tier) |
| C7 | Lane coherence: the concept surfaces in the topic lane a learner would look in | index-from-zero fix | review judgment |

## Exercise properties

| # | Property | Origin | Enforcement |
|---|---|---|---|
| E1 | Closure contract: `footprint ⊆ assumed ∪ {focus} ∪ Structural` on every generated program (both sides of a pair, probes appended); `assumed ⊆ ancestors(focus)`; `focus ∉ assumed` | design §2.8 | K-4, K-5 |
| E2 | Determinism: same seed → same program, always | design §5 | K-6 |
| E3 | Real execution: every program runs clean and is gradable; the interpreter is the only answer key | form laws §5.1 | K-10, K-oracles |
| E4 | One printed line unless `multiline` — and multiline ONLY where several lines ARE the concept | §5.2 | K-10 |
| E5 | **No transcription**: the answer must require computation, never copying — a fill's blank token must not equal (or trivially restate) the shown target; a trace-table cell whose value is a literal readable off its line is a GIVEN, not a blank; a predict answer visible verbatim as a program literal is only acceptable when reading that literal IS the focus (print-text, quoted-vs-name) | owner: "brain-dead… x = 1"; fill-value fix | trace-table builder; sweep flag + judgment |
| E6 | **Discrimination**: a learner without the concept must be able to get it WRONG — the designed wrong answer differs from the right one on every seed; no meta-pattern shortcut (e.g. "the answer is always True"); spot-diff A-output ≠ B-output on every seed | text-compare fix; K-oracles | K-oracles (wrongAnswer floor), sweep flag (constant answers) + judgment |
| E7 | **No answer leaks**: nothing shown BEFORE grading (prompt, teach card, spot-diff context, program A output) reveals the answer; independent random draws must not collide into a leak (distinct-word discipline) | elif-chain/empty-is-falsy fix | sweep flag + judgment |
| E8 | **Natural code**: programs a human would plausibly write — no dead code, no no-op writes, no immediately-overwritten binds, no `if True:` outside deliberate intro scaffolding | slot-write-order/swap-vs-sequential fixes | judgment |
| E9 | Seed diversity: values, shapes, and answers vary meaningfully across seeds; every declared shape/variant reachable | K-5 reachability + depth audit | K-5 (reachability); sweep flag (variety) |
| E10 | Form fit: mutation/latent state → predict-state; many-steps-in-between → trace-table; one-line-moved → spot-the-difference (with order-matters discipline §5.5); reverse-engineering → fill-one-blank; **order-IS-the-idea → order-the-lines** (Parsons, ladder §R2 — only where a wrong arrangement really misbehaves: it raises, or prints something else on every seed; the deal is shuffled at compile time and graded by executing the learner's arrangement, so "which order works" must be a question the interpreter can settle) | owner's form requests | review judgment |
| E10b | **predict-the-error** (ladder §R3) is the one form whose program deliberately does NOT complete: it must be straight-line up to the raise, print at most one line before it, and vary the raising LINE across its shapes (a form whose answer is always "line 2" is a meta-pattern, not a prediction). `expectedError` is provenance for the K-series only — never shown, never graded against; the real terminal exception is the answer key | ladder §R3 | K-5 (raise line + type↔tag), K-10 (real `uncaught_exception`, ≤1 line before the crash), K-oracles (wrongAnswer ≠ the "{type} (line {line})" rendering) |
| E11 | Difficulty ramp: within a topic, intros are honestly easy and reviews honestly discriminate; no core stuck at intro-only difficulty | depth audit | review judgment + C6 |
| E12 | Trace-table tightness: 2..maxBlanks COMPUTED blanks; every watched name blanked ≥1×; expected values single-line; loops ≤3–4 iterations; blanks sit where the focus concept fires | trace-table design + E5 | K-10 branch + builder |
| E13 | Explain honesty: `variantCard` (shown AFTER grading) explains THIS instance's values in the style-contract voice; teach `card` (shown BEFORE the first ask) teaches the rule WITHOUT this instance's answer | prose contract | judgment |
| E14 | Retirement compatibility: an exercise is written to be re-dealt (values vary), because selection retires templates answered right — an exercise whose seeds all look identical defeats retirement | repetition fix | sweep flag (program variety) |

## Selection properties (system-level, for completeness)

Frontier-biased cold start; guaranteed worst-concept return; concept-level
no-repeat incl. across endless chunks; template retirement 1/(1+0.75·right);
mastery yield ×0.25; intro fade once seen — all weights, never gates.
Enforced by the T-series selection-policy properties.
