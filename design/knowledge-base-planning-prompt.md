# Planning prompt: a tagged concept-DAG knowledge base for Python practice exercises

> Standalone planning prompt — self-contained, no codebase required.
> Hand everything below the line to a capable model or team. The output
> is a design document, not code.

---

Plan — do not implement — a knowledge base for teaching Python
fundamentals through prediction exercises, modeled in spirit on the
**Stacks Project** (the mathematics reference): a self-contained,
tagged, dependency-ordered body of content whose structural claims are
all machine-verified. Produce a single design document.

## The product this serves

Assume a delivery platform with these capabilities (design to this
interface; do not design the platform itself):

- It can **execute any small Python program** and capture its exact
  printed output. This is the grading mechanism: the student predicts a
  program's output, then the program really runs, and the interpreter's
  own output is the answer key. There are no authored answers anywhere.
- Exercises are **procedural generators**: seeded, deterministic
  functions that emit a small program (and metadata). Same seed, same
  program. Endless numeric variation, no repeats between rounds.
- It can persist small per-student records (e.g. mastery counters) on
  the student's device, and can show a short "rule card" explanation
  after a missed answer.

The audience is students meeting Python for the first time, skewing
young (upper primary through early secondary).

## Pedagogical ground rules (already validated; inherit, do not relitigate)

1. **One question at a time.** Every exercise asks exactly one thing,
   and every generated program prints exactly one line of output
   (exceptions only where multiple lines ARE the concept, and flagged).
2. **The interpreter is the only answer key.** Exercises generate
   programs, never answers. A surprising output is a true fact about
   Python, never a bug in an answer key.
3. **Predict, then verify.** The student commits to an exact prediction
   — every character, spaces included (only trailing whitespace
   forgiven) — before the program runs. Precision is the curriculum:
   "roughly right" hides exactly the misunderstandings being trained
   (`5` vs `5.0`, `x` vs `"x"`, a missing space).
4. **No spoilers.** The question never names the rule being tested; the
   rule arrives after the attempt, when it answers a felt need.
5. **One question, one rule.** A miss earns an explanation of exactly
   the rule that was tested, using the actual values from that
   question — never a survey of related ideas.
6. **Errors are information.** Growth-framed language ("Not yet — take
   another look"; missed ideas "come back so you can beat them"), brief
   genuine praise, no shame, no gamification chrome (no points, streaks,
   badges — the reveal is the reward).
7. **Style contract for all student-facing text**: short sentences, one
   idea each; concrete verbs; second person; no idioms; real technical
   terms KEPT and glossed in plain words — vocabulary is curriculum.
8. **Generator hygiene**: deterministic under a seed; always prints
   something; deterministic output only (no set-ordering, no `is` on
   interned ints, no wall clock); no exceptions (tracebacks are not
   typeable answers); no `input()`; programs stay tiny.

## The vision

Replace a flat catalogue of exercise topics with:

1. **A concept graph.** Nodes are *atomic concepts* (e.g. "a name holds
   a value", "positions count from zero", "`/` always yields float",
   "two names can share one list"). Edges are prerequisites. The graph
   is a DAG rooted in a small set of true fundamentals, so **every
   concept has a traceable lineage to the roots**. Every node carries a
   **stable opaque tag** (Stacks-style: short, permanent, never reused)
   plus a human-readable slug that may change.
2. **Exercises bound to the graph.** Every exercise declares exactly one
   **focus concept** and a set of **assumed concepts**; the assumed set
   must lie within the ancestors of the focus. An exercise never
   exercises anything outside `ancestors(focus) ∪ {focus}` — so a
   student who has met the ancestors meets **at most one new thing**.
3. **Verified footprints.** Each generated program's **concept
   footprint** — the set of concepts its code actually uses — is
   *computed from the code, not declared by the author*, and checked
   against the exercise's declared closure. Lineage on the honor system
   rots; lineage checked on every generated program is the product.
4. **Greater variety** along every axis: multiple exercise forms, many
   program shapes per concept, rich value/name pools.
5. **A knowledge base that is data.** Concepts, exercises, generator
   metadata, and rule cards are declarative artifacts decoupled from any
   delivery runtime — the same KB could drive drills, guided lessons,
   placement diagnostics, or a printed workbook. The human-readable
   curriculum reference becomes a **generated artifact** of the KB, with
   sample programs and outputs verified by execution.

## Hard requirements (each needs a real design in the plan, not a nod)

**R1 — Concept atoms and tags.** Define a granularity rubric: what makes
a concept atomic enough to be one node? Give worked examples of correct
splitting (is "negative indexing" its own node or part of "indexing"? is
"`%` takes the divisor's sign" separate from "`%` is remainder"?) and of
over-splitting to avoid. Include a total concept-count budget for the
scope below, with justification. Define the tag scheme: format,
allocation, permanence policy, and what happens to tags when a concept
is later split or merged.

**R2 — The one-new-thing contract, formally.** Define precisely: what it
means for an exercise to "introduce" its focus concept; what it means
for a student to have "met" a concept (first exposure? first correct
answer? a mastery bar?). Then the static contract —
`footprint(program) ⊆ assumed ∪ {focus}` and
`assumed ⊆ ancestors(focus)` — and the dynamic contract: selection only
offers an exercise when every assumed concept has been met. Handle the
cold start: the very first exercise must be answerable from nothing but
root concepts.

**R3 — The footprint analyzer.** Design the mechanism that computes a
generated program's concept footprint. Weigh honestly: a real Python AST
parse (exact, heavier), a lightweight tokenizer (cheap, approximate), or
a hybrid (heuristics while authoring, AST verification in the test
suite). Decide. Specify the mapping from syntax observations to concept
tags — including concepts that syntax alone cannot see: aliasing looks
like plain assignment; mutation-vs-rebind, evaluation order, and
capture-at-assignment-time all need **semantic rules** (e.g. "assignment
where the right side is a name currently bound to a list ⇒ aliasing").
List every concept in your graph that needs a semantic rule, and give
each rule. State what the analyzer cannot catch and how tests
compensate.

**R4 — Exercise forms and variety.** Prediction-of-exact-output is form
one. Define an **exercise-form abstraction** so new forms slot in
without touching the concept graph: candidates include
predict-value-and-type, predict-state (which name holds what at the
end), fill-one-blank, choose-which-line-changes-x, spot-the-difference
between two programs, write-one-line. For each form you include: how it
is graded interpreter-first, and how it preserves the one-question rule.
Then define variety *within* a form: program-shape archetypes per
concept, value pools, naming pools, and a concrete, checkable variety
metric (e.g. distinct shapes per concept ≥ N; no two consecutive
questions share a shape).

**R5 — Explanations and focus disclosure.** Rule cards attach to
*concepts* (one canonical explanation per concept, in the style
contract), with optional per-variant specializations that must reference
the concrete values of the question asked. Define the precedence between
concept-card and variant-card. Focus is never revealed before the
attempt; it is recorded after, for mastery tracking.

**R6 — Selection, mastery, and the frontier.** Define DAG-aware
selection: the student's **frontier** (concepts whose prerequisites are
all met), per-concept mastery scoring, review scheduling for mastered
concepts, and how "missed ideas return more often" and novelty boosts
work in DAG terms. Basics should still dominate a session (roughly 3:1
over corner cases — keep a core/edge distinction or derive it from graph
depth; your choice, justified). Show the algorithm behaves sensibly for
a brand-new student with no history.

**R7 — Modularity and schemas.** Concrete schemas (JSON-Schema-like or
TypeScript-interface-like) for Concept, Exercise, Generator, Variant,
and RuleCard, plus a proposed file layout. The KB must be consumable
through one narrow, documented interface, with no dependence on any
particular delivery runtime.

**R8 — Generated documentation.** Design the pipeline that generates the
human-readable curriculum reference from the KB: per-concept pages with
full lineage (ancestor chain to the roots), attached exercises, and
sample programs with outputs obtained by actually executing them. Decide
what is authored prose (concept descriptions, rule cards) versus what is
generated (structure, lineage, samples, outputs, counts), and how an
automated check verifies the generated artifact never drifts from the
KB.

**R9 — Invariants → tests.** A table of every structural invariant with
its enforcing automated check: DAG acyclicity; every concept reachable
from the roots; tag uniqueness and permanence; `assumed ⊆
ancestors(focus)` for every exercise; footprint ⊆ closure across sampled
generations; every concept has ≥1 exercise or is explicitly marked
"structural" (teachable only in passing); one-line output; explanation
coverage (a multi-operation exercise family must explain the operation
actually asked); variety floors; documentation fidelity; determinism
under seeds. House rule: **an invariant without a test is a wish.**

## Scope of content to plan for

The fundamentals trajectory, roughly: state and I/O (assignment,
evaluation, printing) → numbers and booleans (arithmetic, precedence,
division family, conversions, float inexactness, bool-as-int) → strings
(operations, indexing, slicing, immutability, code-point comparison) →
lists and aliasing (indexing, aggregation, in-place mutation, 2D grids,
shared references, shallow copies, iterate-while-mutating) → conditions
and logic (comparisons, branching, elif chains, boolean operators,
truthiness, operand-returning and/or, chained comparisons) → loops and
ranges (accumulator, list-building, while, range semantics, break /
continue / for-else) → dicts and tuples (lookup, membership semantics,
get-with-default, the counting idiom, tuple-by-comma, unpacking).
Functions (frames, arguments, return, scope) are the known next
expansion: the graph must have room for them, but exercises for them are
out of scope.

## Failure modes — design against each explicitly

1. **Granularity explosion.** Hundreds of micro-concepts make the DAG
   unmaintainable and the frontier meaninglessly narrow. The R1 budget
   is the guard; show it holding on the worked examples.
2. **Sterile roots.** If early exercises may use only root concepts,
   they risk vacuity (`x = 4` then `print(x)` is fine; ten near-copies
   of it are not). Show how variety keeps the early frontier
   interesting, and whether some roots are "structural" — never directly
   exercised (e.g. "a program runs top to bottom").
3. **Analyzer friction.** If the footprint checker false-positives,
   authoring stalls. Define the escape hatch (explicit, logged,
   test-visible waivers) and its abuse guard.
4. **Semantic invisibility.** The concepts that don't appear in syntax
   (aliasing, mutation-vs-rebind, capture time, evaluation order) are
   exactly the ones this curriculum most needs to track. R3's semantic
   rules must cover every one; name them.
5. **Pedagogy erosion.** Every ground rule at the top must have an
   identifiable home in the new design. None may be dropped silently.

## Worked examples the plan must contain

- A **15–25 node slice of the DAG**, from the roots to "two names, one
  list" (aliasing), drawn as a diagram with tags, including at least one
  diamond (a concept reachable by two independent ancestor paths).
- **Three fully specified exercises** as schema instances — one
  root-level, one mid-graph (e.g. focus: "`/` always yields float"), one
  deep (e.g. focus: "`+=` mutates the shared list") — each with
  generator pseudocode, declared assumed set, two example generated
  programs *with their outputs*, and the computed footprint
  demonstrating the contract holds.
- **One decomposition walkthrough**: take a classic compound exercise
  ("`b = a; b.append(3); print(a)` — what prints?") and show how it
  becomes concept nodes, prerequisite edges, and a chain of
  one-new-thing exercises in the new scheme.

## Anti-goals

No implementation in this task. No gamification. No LLM-generated
exercises at runtime — generators stay deterministic and human-reviewable.
No dependence on any specific web framework, storage system, or build
pipeline: the KB is data plus pure functions.

## Process and output

Work breadth-first: settle R1–R3 (the foundations) before R4–R8. Make
decisions — where alternatives exist, pick one and justify it in two
sentences; never present option menus. Keep a running open-questions
list, capped at five, each with a recommended default. Structure the
design document as: vision recap (brief) → concept model (R1, R2) →
footprint analyzer (R3) → exercise forms and variety (R4, R5) →
selection and mastery (R6) → schemas and layout (R7) → generated docs
(R8) → invariants/tests table (R9) → worked examples → phased roadmap
(each phase independently shippable and testable; phase 1 deliberately
small: the DAG slice plus one concept exercised end to end) → open
questions.

Before writing anything, sanity-check your granularity rubric: hand-
classify ten familiar beginner exercises (a float division, a slice, an
aliasing trap, a truthiness check, an elif chain, a range off-by-one, a
`+=`-on-shared-list, a `str(3) + "4"`, a swap, a dict membership) into
concept nodes and confirm the result feels neither atomized nor lumped.
If the rubric fails that dry run, fix the rubric first — the whole
design rests on it.
