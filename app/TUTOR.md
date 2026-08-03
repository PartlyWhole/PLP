# Tutor — as-built documentation (phase 1)

The training feature (learner-facing label: **Exercises**): a
transcript-feed side pane plus a lesson runtime, using the live app as the
laboratory. The learner-facing menu offers DRILLS ONLY (one question at a
time); the guided curriculum units still run on the same machinery but are
reachable only via `plp.tutor.start(unitId)` (tests/debug — product
direction is exercises-first). Design and trajectory:
[design/tutor-plan.md](../design/tutor-plan.md); pedagogy constraints:
[design/game-tutorial-research.md](../design/game-tutorial-research.md).

## Modules

- **[tutor.mjs](tutor.mjs)** — the runtime. Interprets lesson scripts,
  owns session state and persistence, connects asks/actions to the app.
- **[tutor-ui.mjs](tutor-ui.mjs)** — the pane: transcript cards, controls
  strip, markdown-lite renderer (`renderMd`). DOM only, no sequencing.
- **[question-ui.mjs](question-ui.mjs)** — shared question renderers
  (extracted from quiz.mjs; both the quiz panel and tutor cards use them).
- **[../curriculum/](../curriculum/)** — content. `index.mjs` registry;
  one lesson module per unit. Data only, linted at `start()`.

The pane is the leftmost, full-height column (`#tutor-pane`,
`--col-tutor`), collapsible; visibility and width persist in `plp.layout`.
The header 🎓 button toggles it. **Collab: v1 is solo-only** — the pane
hides when a room goes live and `start()` refuses while active.

## Audience: younger students (style contract)

Learner-facing text and type follow a deliberate contract (rationale in
the session notes / commit message):

- **Type**: larger base sizes everywhere a learner reads (cards 15px,
  popup 16px, answer box 15px mono, editor 14.5px, console 14px),
  line-height ≥1.5, short text blocks. Reading effort must not compete
  with thinking effort.
- **Language**: short sentences, one idea each; concrete verbs; second
  person; no idioms ("long tail", "lock it in"). Real technical terms are
  KEPT and glossed in plain words — vocabulary is curriculum.
- **Errors are information**: growth-framed feedback ("Not yet — take
  another look", "…will come back so you can beat it"), brief genuine
  praise on success, never shame. The reveal run stays the reward — no
  points/gamification chrome.
- **Buttons say what they do**: "Check my answer ▶", "Skip this one",
  "Give me a hint" — never terse adult UI verbs. Big targets.
- **No concept leak**: drill prompts never name the rule being tested;
  the rule arrives in the explain card after the attempt.

## Two reading surfaces, one history

The narrow pane holds the complete transcript as clickable bubbles; the
current **beat** (the lead-in prose since the last blocking step, plus the
blocking question/action) also opens in the **beat panel** — a roomy
reading surface DOCKED in the layout grid under the CODE pane, above the
console, sharing the code column (bounded by the same vertical divider).
The question sits in the same eye-line as the program it asks about, and
can never occlude a pane. Esc or ✕ collapses it (the grid row returns to
the editor); closing changes nothing about the lesson.

Clicking any feed bubble (re)opens it in the popup: static cards are
rebuilt from their descriptors; the LIVE card (question inputs,
construction workspaces) is **reparented** — typed answers and workspace
state survive close/reopen — leaving a "current step — open" stub in the
feed. Hints arriving during an ask append to the open popup. The pane
controls (Continue, Back to units) are mirrored in the popup footer.

**Review context**: every recorded card is stamped with the program it was
about (`prog` → index into deduplicated `store.programs`). Reopening a
bubble while the editor holds DIFFERENT code prepends a context card
showing that program, with a stash-safe "load this program" button — an
old card's "this program"/line talk must never silently refer to code
that is no longer there.

## Drill mode (questions-only practice)

`plp.tutor.startDrill(topic, {seed?, count?})` — rapid-fire practice with
no lesson narrative, sourced from the **concept-DAG knowledge base**
([kb-session.mjs](kb-session.mjs) over `kb/`, design in
`design/knowledge-base-design.md`). Every question is a KB exercise: one
focus concept, a seeded deterministic program generator, and a
machine-checked guarantee that the program uses at most one concept the
student hasn't met (`footprint ⊆ assumed ∪ {focus} ∪ Structural`, the
K-series). 7 topics (state & I/O, numbers, strings, lists, logic, loops,
structures); selection weights core concepts 3:1 over edge, boosts unseen
(×1.5) and missed (up to ×3) concepts, and never repeats a
`(exercise, shape)` back to back.

**One question at a time**: every generated program produces exactly one
line of output (single-line input, Enter to submit); the one
`multiline: true` exception is `loop-for-visits-each`, where several
lines ARE the concept. Forms beyond predict-exact-output — predict-state,
fill-one-blank, spot-the-difference — plug in per exercise (design §5.2).

A drill round compiles a seeded, stats-weighted sequence into an
ordinary lesson script, so drills reuse the whole machinery (popup
beats, predict-then-verify, persistence — the compiled script is stored
verbatim, so reload restores the identical round).

Ground truth is always the engine: exercises generate programs, never
answers. A miss (wrong or skipped) shows the program's `variantCard`
(interpolating the exact values asked) or the concept's canonical rule
card, and bumps `plp.kb.v1` per-CONCEPT stats (`{seen, missed}`, keyed by
permanent tag; one-time migration from the legacy `plp.drills.v1`
template store). A clean first-attempt correct answer additionally grants
the concept **met** in `plp.kb.met.v1` (see
`design/lesson-kb-binding.md`), which feeds the menu's frontier entry.
The generated catalogue of every concept and exercise is
[../curriculum/KB-REFERENCE.md](../curriculum/KB-REFERENCE.md) (a build
artifact, byte-exact by the K-doc test; regenerate with
`node tools/kb-docgen.mjs --write`).

(The original hand-authored template bank, `app/drills.mjs` +
`curriculum/CURRICULUM.md`, was retired when the KB reached parity.)

## Step vocabulary

```js
{ say: md, pocket?, pause? }              // prose card; pause = Continue gate
{ loadCode: source }                      // stash learner code once; reset panes
{ action: md, await: { event, count? } }  // learner performs; events bus completes
{ ask: { kind, opts?, hints?, attempts? } }
{ done: md }
// any step: { if: { lastAnswer: value | [values] } }
```

Sequencing is strictly ordered with one-shot `if` detours keyed on
`lastAnswer` (`"correct" | "wrong" | "skipped"`). This is deliberately
smaller than the removed director's beat grammar; it grows only when a
lesson being authored demands it.

## Asks

- **Generated kinds** (memory-*, code-*, expression-sequence): built from
  the current context via `generateQuestion`; rendered by question-ui in a
  transcript card with Check/Skip. Wrong answers get `attempts` retries
  (default 2) with authored `hints` cards between; the last failure reveals.
  A kind that can't generate here (e.g. no trace) records a system note and
  moves on with `lastAnswer = "skipped"`.
- **predict-output** (predict-then-verify): the card takes a free-text
  prediction FIRST; "Lock in & run ▶" triggers a real, visible Trace, then
  grades against what the engine actually printed (`outputUpTo`, the pure
  twin of the console's `showUpTo`). Grading forgives trailing whitespace
  and trailing blank lines, nothing else. Hints are available pre-lock;
  there are no post-reveal retries.

## Persistence and the code stash

`plp.tutor.v1` holds `{ lessonId, resumeIndex, lastAnswer, cards, stash,
lastLoadedCode }`. Cards are serializable descriptors; interactive cards
are recorded only in frozen form at resolution, so a reload during a
blocking step re-creates it live (no duplicates). Reload during a `pause`
resumes past it.

The learner's program is stashed before the first `loadCode` / try-it.
Exit restores it **only if** the editor still holds exactly the code the
lesson last loaded; any learner edit survives.

## Events

Emits `lesson-started/step/ended` and the existing `quiz-question` /
`quiz-graded` vocabulary (events.mjs). Action steps complete via bus
events only — including `run-ended`, which the untraced Run path now also
emits.

## Debug/test API

`plp.tutor`: `start(unitId)`, `exit()`, `state()`, `feed()`, `continue()`,
`ask()`, `submit(answers?)`, `lockPrediction(text?)`, `skip()`,
`lintLesson`. `plp.layout`: `setTutorVisible/isTutorVisible`.
T-series tests: [tests/tutor.spec.mjs](../tests/tutor.spec.mjs).

## Known limits (phase 1)

- One unit shipped (u1 state+I/O). Units 2+ and the checker harness
  (write-program / write-lines), visuals library, and skill mastery are
  later phases of the plan.
- Generated asks on reload regenerate from a possibly-empty trace and then
  skip; predict-output re-asks cleanly.
- `attempts`/hints apply per ask; there is no cross-lesson adaptivity yet.
