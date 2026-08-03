# Side-work prompt: KB hardening and consumers (parallel-safe)

> Prompt for a session running IN PARALLEL with the main KB integration
> line. Self-contained: read the two referenced documents first, then
> work the tasks in order. The ownership boundary below is the most
> important section — the main session is actively editing the files it
> reserves, and a collision costs more than any task here is worth.

## Two-stage workflow: Fable plans, Opus executes — fully autonomous

You are running on Fable 5. Run BOTH stages in one continuous session
with no approval gates: do not enter plan mode, do not pause to ask
whether to proceed — plan, then dispatch execution, then verify, then
stop. The only reasons to stop early are a hard blocker outside your
ownership boundary or a destructive action (there are none in scope).

**Stage A — planning (you, Fable 5).** Produce a comprehensive,
file-level implementation plan and write it to
`design/kb-sidework-plan.md`. Do NOT implement anything in this stage —
no file outside that plan document changes. The plan will be executed
by Opus subagents in fresh contexts, so it must be mechanically
followable without re-deriving anything: every design decision is made
HERE, in the plan, not left to the executor. Required detail per task:

- Every file to create, with its exports, function signatures, and a
  skeleton (or full listing where the content is short — the workflow
  YAML and the CLI wrapper should appear in the plan verbatim).
- For each algorithm (ledger diff verdicts, placement bisection): exact
  rules as numbered lists, edge cases enumerated, tie-breaking and
  ordering specified, worked example traced by hand (e.g. one full
  placement run over the current 20-node graph, question by question).
- For each test file: a table of test cases — name, setup, exact
  assertion — not a paragraph of intent. Include the failure-mode tests.
- Exact error/violation message formats (tests will assert on them).
- The order of implementation steps and the verification command after
  each step.
- A short "decisions made" list with one-line justifications, and an
  "open questions" list that must be EMPTY at the end of planning — if
  a question cannot be closed from the design doc and the repo, close
  it with a stated default rather than passing it downstream.

Stage A ends when `design/kb-sidework-plan.md` is complete and the
tasks below have no remaining unstated decisions. Then move straight to
Stage B — no approval step.

**Stage B — execution (Opus 4.8 subagents, dispatched by you).** The
executor model is **Opus 4.8 specifically — NOT Opus 5**. The Agent
tool's `model` parameter only offers aliases (and `"opus"` may resolve
to Opus 5), so pin the model via a project agent definition instead:
create `.claude/agents/kb-implementer.md` with frontmatter

```yaml
---
name: kb-implementer
description: Implements one task from design/kb-sidework-plan.md exactly as planned
model: claude-opus-4-8
---
```

and a body that restates the executor rules (implement the named plan
section exactly; no design changes; blockers → `## Execution notes`).
Before dispatching real work, send one trivial probe to
`subagent_type: kb-implementer` asking it to report its model ID;
if it does not report Opus 4.8, fix the definition before proceeding
rather than falling back to an alias. Then launch the implementation —
one agent per task (Tasks 1–3 are file-disjoint, so they may run in
parallel). Each
agent's prompt must be self-contained: point it at
`design/kb-sidework-plan.md`, name exactly which plan section and which
files it owns, restate the ownership boundary, and instruct it to
implement the plan EXACTLY — no revisiting design decisions. If a plan
defect blocks an agent, it records the blocker under a
`## Execution notes` heading in the plan file and returns; small
mechanical deviations (a rename, a missed import) are fine and get
logged under the same heading.

**Stage C — verification and repair loop (you, Fable 5).** When the
agents return: read their reports and any Execution notes, resolve any
logged blocker by amending the plan yourself (you own the design), and
re-dispatch a fresh `kb-implementer` agent (Opus 4.8) for just the
affected step. Then run the
full verification (`npx playwright test`) yourself and confirm
`git status` stays inside the ownership boundary. Iterate until the
Definition of done holds; only then end, reporting what was built, what
deviated from the plan, and the final suite result.

## Context

This repo (PLP — static, build-free GitHub Pages site under `/PLP/`;
plain ES modules; no CDN; Playwright tests driven via `window.plp`) is
mid-way through replacing its flat 44-template drill bank with a tagged
concept-DAG knowledge base:

- **Design:** `design/knowledge-base-design.md` (complete, authoritative
  — read §2.5 tags/ledger, §7.3 narrow interface, §9 invariants).
- **State:** integration phase 1 is DONE and green: `kb/` exists
  (20-tag append-only ledger, 16 intro exercises, footprint analyzer,
  `loadKB()` in `kb/index.mjs`), enforced by the K-series in
  `tests/kb.spec.mjs`. Run `npx playwright test tests/kb.spec.mjs` to
  see it pass before touching anything.
- **Main session (NOT yours):** phases 2–5 — appending the remaining 48
  ledger entries, widening the analyzer grammar, authoring exercises for
  every topic, docgen, and eventually wiring the tutor to the KB.

## Running concurrently with the phase-runner session

A second session may be executing `design/kb-phase-runner-prompt.md`
against this same repo, growing `kb/` from 20 concepts to 68 and later
editing `app/`. Three consequences you must design around:

1. **Run in a git worktree.** Before any work, create one
   (`git worktree add ../PLP-sidework HEAD`) and do everything there —
   you only ever READ `kb/`, so a snapshot is enough, and it keeps your
   changes out of the other session's diff. Say in your final report
   which worktree path holds the work.
2. **Use your own test port.** The suite's dev server binds one port
   with `reuseExistingServer: false`, so two concurrent runs kill each
   other. Always run as `PLP_PORT=8733 npx playwright test`.
3. **Your tests must be KB-content-agnostic.** The concept graph is
   changing under you. Derive every expectation from `loadKB()` at
   runtime — never hard-code a concept count, an exercise id list, or a
   "converges in ≤ N questions" constant. Assert *properties* (converges
   at all; a correct-everything student ends with every exercisable
   concept met; placement is deterministic) rather than magic numbers,
   so the tests stay green as the graph grows from 20 nodes to 68.

## Ownership boundary — hard rules

You may READ everything. You may MODIFY or CREATE only:

- `design/kb-sidework-plan.md` (Stage A's sole output)
- `.claude/agents/kb-implementer.md` — the Opus 4.8 executor pin. The
  phase-runner session may have created it already; if it exists and
  pins `claude-opus-4-8`, REUSE it unchanged rather than rewriting it.
- `.github/**` (new; Stage B)
- `tools/check-ledger.mjs`, `tools/kb-placement.mjs` ONLY — the rest of
  `tools/` belongs to the phase runner (it adds `tools/kb-docgen.mjs`)
- `tests/ledger-check.spec.mjs`, `tests/placement.spec.mjs` (new; Stage B)
- `design/lesson-kb-binding.md` (new; Stage B, from the plan's outline)
- `VALIDATION.md`, `CLAUDE.md` (additive rows/bullets only, at the end
  of Stage B) — these two are YOURS exclusively; the parallel
  phase-runner session is required to park its doc rows elsewhere, so
  append freely but never reflow or reorganize existing sections.

You must NOT touch (main-session territory, active edits in flight):
`kb/**`, `tests/kb.spec.mjs`, `tests/tutor.spec.mjs`, `app/**`,
`curriculum/**`, `index.html`. In particular: do not append to
`kb/tags.ledger.json` (no minting the functions sub-graph, no
`copy-is-shallow` — those are sequenced after the main line to avoid
ledger merge conflicts), and do not modify `kb/index.mjs` even if a task
would be easier with a new export — consume `loadKB()` as-is.

## Task 1 — CI enforcement of tag-ledger permanence

Today the append-only guarantee for `kb/tags.ledger.json` is enforced
only by a local approximation (K-2 diffs the working copy against
`HEAD`). It cannot see multi-commit drift or history rewrites. Build the
real check:

1. `tools/check-ledger.mjs` — a zero-dependency Node script:
   `node tools/check-ledger.mjs <base-ref>`. Reads the ledger at
   `<base-ref>` (via `git show`) and in the working tree, and exits
   non-zero unless: the base entries are a strict prefix (same order);
   each prefix entry's `tag`, `kind`, `parents` are unchanged (slugs are
   renamable by design); a `status` change is only ever
   `active → split | merged-into` and must add a non-empty `successors`
   array whose tags exist; new entries append at the end with unique
   tags in Crockford base-32 (no I L O U). Clear one-line-per-violation
   output.
2. `.github/workflows/kb-ledger.yml` — on pull_request and on push to
   main: checkout with enough history (`fetch-depth: 0`), run the script
   against the PR base (or the previous commit on push). No Playwright,
   no browser download, no npm install — the script must run on bare
   Node. Keep the workflow under ~30 lines.
3. `tests/ledger-check.spec.mjs` — pure-Node tests of the script's
   verdicts using synthetic before/after ledger pairs passed via temp
   files or a testable exported function (structure the script as a pure
   `checkLedger(before, after) → violations[]` plus a thin CLI so tests
   never need git). Cover: legal append; illegal deletion; illegal tag
   edit; illegal parent edit; legal slug rename; legal split with
   successors; illegal status flip without successors; duplicate new tag.

## Task 2 — placement diagnostic as a second KB consumer

Design §11 phase 5 names placement as "a second consumer of the narrow
interface". Build it now against the 20-node phase-1 graph — it must
keep working unchanged as the graph grows, because it may only use
`loadKB()` (`concepts`, `structural`, `exercises`, `ancestors`,
`frontier`, `offerable`).

1. `tools/kb-placement.mjs` — pure module, no DOM, no engine:
   - `startPlacement(kb)` → session object.
   - `nextProbe(session)` → the exercise to ask next, or `null` when
     placement has converged. Strategy (keep it simple and justified in
     comments): probe the deepest concepts whose ancestors are not yet
     contradicted — a correct answer marks the focus AND all its
     ancestors met (answering the deep question is evidence for the
     lineage); a wrong answer marks the focus unmet and schedules its
     parents as the next probes. This bisects the DAG in far fewer
     questions than walking the frontier from the roots.
   - `recordAnswer(session, exerciseId, correct)` → updated session.
   - `result(session)` → `{met: Set<tag>, frontier: Set<tag>}` suitable
     for seeding the drill runtime's per-concept records later.
   - Determinism: any tie-breaking must be stable (sort by tag), no RNG.
2. `tests/placement.spec.mjs` — pure-Node: a student who answers
   everything correctly converges with all exercisable concepts met in
   ≤ (number of leaf-ish probes) questions, far fewer than 16; a student
   who misses everything converges to an empty met set; a student
   simulated as "knows exactly ancestors(names-share-list)" is placed
   with exactly that met set; convergence is guaranteed (no infinite
   probe loops) and the same answer sequence always yields the same
   placement.

## Task 3 — design note: binding guided lessons to KB concepts

The guided tutor's authored units (`curriculum/u1-state-io.mjs`) carry a
hand-written `skills: [...]` array that nothing reads. Write
`design/lesson-kb-binding.md` (design only — NO code changes; the files
involved are main-session territory) specifying:

- The mapping from u1's skill strings to KB tags, and the authoring rule
  for future units (lessons declare `concepts: [tags]` instead of ad-hoc
  skill strings; the lesson linter cross-checks tags against the KB).
- When a lesson marks a concept met: which step outcomes count (a
  correct `predict-output` ask focused on the concept — mirroring the
  drill rule from design §2.8 — versus merely watching a demo, which
  must NOT count).
- How lesson-granted met-ness and drill-granted met-ness share one
  record store, and what the tutor menu can do with the frontier
  ("continue where the lesson left off").
- A migration sketch for u1 and a test plan (which T-series tests gain
  assertions), sized so the main session can execute it inside phase 4.

Keep it under ~150 lines, decision-first, no option menus.

## Definition of done (verified in Stage C)

- `npx playwright test` fully green, including your two new spec files.
- `git status` shows changes ONLY inside your ownership boundary.
- One additive K-row block in `VALIDATION.md` for the ledger-check and
  placement features, and (if the CI workflow lands) one CLAUDE.md
  bullet noting that ledger permanence is CI-enforced.
- Do not push, deploy, or open PRs — leave everything as local commits
  or working-tree changes for review alongside the main session's work.

## Explicitly out of scope (sequenced after the main line)

Functions sub-graph minting; vocabulary-gap nodes (`copy-is-shallow`,
case-methods); anything touching the analyzer, exercises, or drill/tutor
runtime; spaced repetition; classroom telemetry.
