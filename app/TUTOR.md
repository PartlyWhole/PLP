# Tutor — as-built documentation (phase 1)

The guided-training feature: a transcript-feed side pane plus a lesson
runtime that walks a student through curriculum units using the live app as
the laboratory. Design and trajectory: [design/tutor-plan.md](../design/tutor-plan.md);
pedagogy constraints: [design/game-tutorial-research.md](../design/game-tutorial-research.md).

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

## Two reading surfaces, one history

The narrow pane holds the complete transcript as clickable bubbles; the
current **beat** (the lead-in prose since the last blocking step, plus the
blocking question/action) also opens in a floating **popup** — the roomy
reading surface. The popup is deliberately NON-MODAL: no backdrop, the
whole app stays usable (you read the editor while predicting), closing it
changes nothing about the lesson, and its header is a drag handle so it
can never permanently occlude a pane a task points at. Esc or ✕ closes.

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

`plp.tutor.startDrill(topic, {seed?, count?})` — rapid-fire corner-case
practice with no lesson narrative. [drills.mjs](drills.mjs) holds ~18
parameterized **program generators** (topics: numbers, strings, lists,
logic, loops, structures), each targeting one misconception from the
exercise bank; a drill round compiles a seeded, stats-weighted sequence
into an ordinary lesson script, so drills reuse the whole machinery
(popup beats, predict-then-verify, persistence — the compiled script is
stored verbatim, so reload restores the identical round).

Ground truth is always the engine: templates generate programs, never
answers. A miss (wrong or skipped) shows the template's `explain`
scaffold and bumps `plp.drills.v1` per-template stats
(`{seen, missed}`), which weight future template selection toward weak
spots (unseen 1.5×, missed up to 3×). Generator rules — deterministic
under a seed, always prints, no nondeterministic output (sets, `is` on
cached ints), no exceptions, no input() — are documented at the top of
drills.mjs.

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
