# Autonomous phase runner: KB integration phases 2–5

> Prompt for a session that carries the concept-DAG knowledge base from
> its current state to full breadth and app integration, unattended.
> Self-contained. You are the ORCHESTRATOR: you own design decisions,
> the tag ledger, and verification; you delegate mechanical
> implementation to pinned subagents.

## Read first, in this order

1. `design/kb-progress.md` — where the work stands, and the settings you
   must obey. This is the resume point; trust it over any assumption.
2. `design/knowledge-base-design.md` — the authoritative design.
   §11 is the phase roadmap; §9 is the invariant table; §2.5 (tags),
   §4 (analyzer), §6 (selection), §7 (schemas) are the reference
   sections you will return to constantly.
3. `CLAUDE.md` — repo invariants. Invariant 10 governs `kb/`.
4. `kb/index.mjs` and `tests/kb.spec.mjs` — the shape everything must
   keep fitting.

## Operating mode

Fully autonomous: no approval gates, no "shall I proceed?", no pausing
between phases. Work the phase loop below until `stop-after-phase` in
the progress file is reached, a hard gate fires, or a blocker you cannot
resolve appears. The user is not watching — asking a question ends the
run, so only do it when a gate genuinely requires it.

**Roles.** You (orchestrator) do: phase planning, ALL tag-ledger
appends, all concept prose (statements, wrong answers, rule cards),
design adjudication, verification, and the progress-file update.
Subagents do: mechanical implementation inside a named file set.

**Executor subagents.** Use the `kb-implementer` agent pinned to
`claude-opus-4-8` (`.claude/agents/kb-implementer.md`; create it if
absent, with a body restating: implement the named plan section exactly,
no design changes, log blockers). Probe it once with a trivial
model-ID question before real dispatch; if it does not report Opus 4.8,
fix the definition rather than falling back to the `opus` alias.

**File-disjointness is the parallelism rule.** Two agents may run
concurrently only if their file sets do not intersect. `tests/kb.spec.mjs`
and `kb/tags.ledger.json` are single-writer files — never two agents,
and the ledger is never an agent's at all.

**A parallel side-work session may be running.** It executes
`design/kb-sidework-prompt.md` from a git worktree and owns these files
exclusively — never edit them, even to add an obviously-correct row:
`VALIDATION.md`, `CLAUDE.md`, `.github/**`, `tools/check-ledger.mjs`,
`tools/kb-placement.mjs`, `tests/ledger-check.spec.mjs`,
`tests/placement.spec.mjs`, `design/lesson-kb-binding.md`. Because
`VALIDATION.md` and `CLAUDE.md` are off-limits, accumulate the doc rows
and invariant bullets your phases would normally add under a
`## Pending doc rows` heading in `design/kb-progress.md`, ready for the
user to merge — mention this in the final report. You DO own
`.claude/agents/kb-implementer.md` and `tools/kb-docgen.mjs`.

## The phase loop

For each phase N, in order:

1. **Plan.** Write `design/kb-phase-N-plan.md`: every file, every
   export, every test case (name / setup / exact assertion), the step
   order, the verification command per step, and a decisions list with
   one-line justifications. Close every open question with a stated
   default — the executors must never have to decide anything.
2. **Orchestrator-only work.** Append ledger entries (single writer,
   sequential); author concept prose to the style contract (short
   sentences, one idea each, second person, technical terms kept and
   glossed); make any design call the plan surfaced.
3. **Dispatch.** Fan out the phase's implementation steps to
   `kb-implementer` agents, respecting file-disjointness and the
   dependency order in the phase notes below. Give each agent: the plan
   path, its exact section, its owned files, the ownership boundary, and
   the anti-patterns list.
4. **Verify.** Run the full suite yourself — not just the K-series — as
   `PLP_PORT=8633 npx playwright test`. (The port is explicit because a
   parallel session runs on 8733; `reuseExistingServer` is false, so two
   runs sharing a port kill each other.) Read failures yourself; do not
   delegate diagnosis of an invariant failure.
5. **Repair.** Fix by amending the plan and re-dispatching a fresh agent
   for the affected step. Never by weakening a check (see anti-patterns).
6. **Checkpoint.** Update `design/kb-progress.md`: phase status +
   evidence, ledger high-water mark, decisions log, blockers. If
   `commits` is `checkpoint`, make one commit for the phase. Then start
   phase N+1 immediately.

## Phase notes — dependency order and parallelism

**Phase 2 — full graph, first two topics.** Strictly serial at the
front: you append the remaining 48 ledger entries and write their
concept prose before any code moves. Then, in order: (a) ONE agent
extends `kb/analyzer/**` to the full §4.1 grammar — branches with store
merge and `⊤`/`untypeable-name`, loop one-pass fixpoint, comparisons and
chains, bool ops, dict/tuple, the full call/method tables, literal-level
sign tracking, semantic rules 6, 7, 10–15. It is one coherent codebase;
do not split it across agents. (b) THEN two agents in parallel:
`kb/exercises/state.mjs` and `kb/exercises/numbers.mjs`, intros for all
20 concepts of those topics. (c) THEN one agent adds the Pyodide oracles
to `tests/kb.spec.mjs`: inv 8 (`ast.parse` normal-form diff vs the
micro-parser), inv 9 (post-execution `type().__name__` vs the abstract
store), inv 11 (discrimination — authored `wrongAnswer` differs from the
real output on every sample). Zero app changes this phase.

**Phase 3 — full breadth + docgen.** (a) Four agents in parallel, one
per file: `kb/exercises/strings.mjs`, `logic.mjs`, `loops.mjs`,
`structures.mjs` — intros for every remaining concept, including the
`multiline: true` intro for `loop-for-visits-each`. (b) You resolve the
vocabulary-gap table: for each drill construct with no KB node
(`.upper/.lower`, `.pop/.insert/.remove`, adjacent string literals,
`list*int`, shallow-copy-of-nested, remove-while-iterating,
comprehensions) decide drop-or-mint, defaulting to the design's
recommendation (mint `copy-is-shallow`; drop the rest). Record each call
in the decisions log — this table defines "parity" and therefore gates
phase 5's retirement. (c) One agent for docgen: `kb/docgen.mjs` +
`tools/kb-docgen.mjs` + the env-gated fixture updater spec
(`KB_UPDATE_FIXTURES=1`, the only writer, executing samples in real
Pyodide) → `curriculum/KB-REFERENCE.md`. (d) One agent for the remaining
invariants: variety floors (13, 14) and waiver hygiene (17). CURRICULUM.md
stays authored and live — do not touch it this phase.

**Phase 4 — app wiring.** The first phase that edits `app/`. Serial,
riskiest last: (a) one agent builds `app/kb-session.mjs` as a PURE
module (imports only `kb/`, takes records as an argument) emitting the
existing lesson-step vocabulary, with §6 selection — offerable set, 1–2
intro cap, weights level 3:1 × novelty 1.5 × miss-rate × review
staircase, no consecutive `(form, shape)` repeats — plus
`TEMPLATE_TO_CONCEPT` and `migrateStats`. (b) One agent rewires
`app/tutor.mjs`: `startDrill` keeps its name and signature, stats move
to `plp.kb.v1` keyed by tag with one-time migration from
`plp.drills.v1`, menu stays "Everything" + 7 topics so the 8-button test
passes UNEDITED. (c) One agent adds `predict-state` to
`app/questions.mjs` (probe line, sync grading). (d) LAST, alone:
`fill-one-blank`, which needs an async grade path in the ask handling —
the single riskiest edit; if it destabilizes the suite, revert it and
log it as deferred rather than reworking the tutor's control flow.
`app/drills.mjs` is not modified in this phase, only unwired.

**Phase 5 — expansion, then a hard stop.** Mint the functions sub-graph
(~12 ledger entries + concept prose); exercises for them are explicitly
out of scope. **Then STOP.** The retirement step — deleting
`app/drills.mjs`, its T-series tests, and `curriculum/CURRICULUM.md` —
is user-gated: report that phases are complete, state whether the
phase-3 parity table is satisfied, and ask for an explicit go-ahead.
Never delete learner-facing content autonomously.

## Anti-patterns — these fail the run, not the test

The invariants are the product. When a check fails, the code is wrong
until proven otherwise.

- **Never weaken a check to make it pass**: no lowering sample counts
  (40 seeds, 5 stratified), no `test.skip`/`test.fixme`, no relaxing an
  assertion, no deleting a case. CLAUDE.md invariant 10: edits that trip
  the K-series are design changes, not test fixes.
- **Never use a waiver to dodge analyzer work.** Waivers are for genuine
  analyzer false-positives, must fire, and are capped at
  `max(3, ⌈5% × exercises⌉)`. Reaching for a third waiver means fix the
  rule instead.
- **Never mark a concept `structural` to avoid authoring its exercise.**
  Structural means "no discriminating witness exists" (§2.6), not
  "inconvenient".
- **Never edit `kb/tags.ledger.json` except by appending**, and never
  from a subagent. A tag is permanent the moment it is committed.
- **Never let `kb/` import from `app/`.** It must load in plain Node.
- **Never touch the parallel session's files** (see the progress file's
  deferred list), and never deploy or run against `PLP_BASE_URL`.

## Ending the run

Stop when `stop-after-phase` is reached, a hard gate fires (phase 5
retirement), or a blocker needs a human. Always leave: the progress file
current, the suite green, and a final report stating what shipped per
phase, every decision logged, anything deferred, and the exact suite
result. If you stopped on a blocker, state the smallest question that
unblocks you.
