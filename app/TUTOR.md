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
The header's 🌱 Learn segment (`#btn-tutor`, part of the world switch)
toggles it. **Collab: v1 is solo-only** — the pane
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
- **Teach first (core), discover first (edge), then no leaks**: a CORE
  concept the student has never seen is introduced by its rule card
  ("🌱 New idea!") in the same beat, right above their first question —
  fundamentals instruct before they ask. EDGE concepts (the corner-case
  traps) stay discovery-first: the surprise miss creates the felt need
  the card then answers. A concept may override via
  `introStyle: "teach-first" | "discover-first"`. Once seen, prompts
  never name the rule; it returns only in the after-miss explain card.

## The practice card surface (drills)

Practice rounds render on a dedicated **full-viewport card surface**
([practice-ui.mjs](practice-ui.mjs), `#practice`, `body.practice` hides
the header and the whole IDE grid): one card at a time — the program
(read-only CodeMirror), a one-line ask, the input, and quiet hint/skip
links, under a slim bar with topic + progress dots. The engine still runs
every program for real underneath; the card's **reveal** ("▶ it printed…")
is the graded run's actual output (the `card.reveal` contract in
tutor.mjs), and the explain face renders into the same card with the
reveal still visible. Round summaries, the topic menu, and the concept
map are full-surface cards on the same view.

Prose is dieted to the moment it applies: no round banner (the header
shows progress), the 🌱 rule **statement** rides on the first ask of a
new core concept (`ask.teach`, worked example behind "show me an
example"), spot-the-difference's program A + output ride on
`ask.context`, prompts are one line, and first-time-per-form mechanics
are a single quiet line gated by `plp.practice.v1`.

**Ask kinds on this surface**: predict-output (incl. spot-the-difference
context), predict-state, fill-one-blank, and **trace-table** — the card
renders a step table (one column per watched name, one row per executed
line where a watched name changed; the runtime traces silently FIRST
because the trace is both the answer key and the table skeleton), the
student fills every cell, one lock grades them all per-cell against the
real trace, and the reveal is "N of M steps right" plus the memory-model
link. Score is all-or-nothing; a clean first-attempt perfect table
grants met (see design/lesson-kb-binding.md §4).

**order-the-lines** (Parsons, expansion ladder §R2) is the fifth kind: the
KB emits the lines in CANONICAL order and buildKBSession draws the deal
from the round's rng (deterministic per round, guarded so the dealt
puzzle never starts solved; `loadCode` carries the shuffled join so the
editor is honest). The card renders one row per line with ↑/↓ buttons —
touch-first, no drag — and suppresses the automatic program block
(`addInteractiveCard({ program: false })`: the widget IS the program).
An element may contain a newline: a compound block (a `for` header with
its body) moves as ONE unit. Grading EXECUTES the arrangement — join,
`setValue`, reveal, trace, then `predict-output`'s grade against the
target — so any order that really prints the target is right and an
arrangement that raises simply never completes. This form grants NO met
in v1 (an arrangement is production, weaker than §4's prediction
evidence classes); stats, streak and template retirement still move.
Review shows the recorded arrangement, the verdict and what it really
printed; the retry re-deals the same items as a live widget and runs the
new arrangement for real (`retryAnswer` takes an ARRAY of item ids here,
mirroring the trace-table map branch).

**Endless mode and the score tracker.** "∞ Endless practice" on the menu
runs auto-chaining chunks: when a chunk's questions are exhausted,
`finish()` compiles the next seeded round into the SAME store (no summary
card between chunks), so the score, the question records (reviews reach
back across chunk boundaries via absolute indices), newly-met tags, and
the code stash all carry; the dot bar windows to the current chunk
(`store.chunkBase`). Every drill round tracks a session score on the
first-attempt basis (`store.score`: answered/right/streak/best, shown as
the `✓ R/N · 🔥 S` chip in the top bar; retries never move it); the
all-time best streak persists in `plp.score.v1`, and the menu's welcome
line shows the lifetime tally derived from the kb seen/missed stats.
Ending an endless run (✕) earns the whole run's summary card — dots,
newly-met chips, misses — with "∞ Go again".

**Every graded answer holds.** After grading, the round pauses on both
outcomes (kb-session emits a bare `{ pause: true }` step on the correct
branch; the wrong branch already paused on its explain card): the card
freezes with the verdict big in `.pr-verdict-slot`, the reveal under it,
and **Continue →** (Enter works — the frozen card's input is readOnly,
so the keystroke falls through to the surface). Without this beat the
one-card surface would wipe the "✓ Exactly right!" before it was read.

**Dots are the round's scoreboard and its back button.** Answered dots
color green (hit) / red (miss; a green ring = missed, then solved on
retry) and click into a **review**: the recorded snapshot (every
`question-frozen` record carries `review` — program, kind, opts/blank,
expected, teach/context) rebuilt as a read-only card — program, your
answer, verdict, the real output. Reviewing stashes the live view as DOM
and restores it untouched on "↩ Back to the round"; new runtime content
supersedes a stale review. **Try it again** re-runs and re-grades for
real (`retryAnswer` in tutor.mjs — the editor is snapshotted and
restored around the retry run), but the score of record never moves:
`rec.ok`, the kb seen/missed stats, and met grants all keep the first
attempt; the retry outcome only decorates the record (`rec.retry`) and
its dot. A skipped question's retry teaches the record its answer.
Single-answer kinds retry through a one-line input; an order-the-lines
retry re-deals the shuffled rows and runs the new arrangement; a
trace-table retry
swaps the graded table for a fresh BLANK one (the truth leaves the
screen the moment the retry starts — otherwise it would be copying),
grades the refilled cells against a real re-run, then re-renders the
table graded; a quiet "never mind" restores the recorded graded view.

Escape hatches: **←**/Esc are one gesture, "**one level up**", after the
progressive dismissal (notes drawer → review): round/summary → the menu,
map → the menu, menu → the IDE. Stepping up from a live round never ends
it — the practice surface **stashes the round's DOM** (`stashRound` /
`unstashRound`; view-level only, all round state stays in the persisted
store) and the menu leads with "▶ Continue your round". `hideSurface`
(collab go-live) keeps the same hide-not-end contract. Ending a round
that was launched from the map ("Practice this ▶"/"Try it anyway ▶")
returns to the **map** (`store.origin`), not the menu. "open in editor"
on every program block; a "put the question's program back" chip appears
if the code was edited outside; predict-state reveals link to the memory
model, and any **miss** links "🔬 step through this run" — the graded
trace is already scrubbable in the IDE; these world switches record a
history entry so browser Back returns to the card. A **📝 scratch
notes** drawer (persisted in `plp.notes.v1`, nothing reads it) rides the
top bar. A **surface router** in tutor.mjs dispatches every ui call:
drills/menu/map → practice; guided lessons → the stage below (the IDE is
*their* content). The round **summary** adds an explicit "🔍 Look back
at the ones you missed" button (practice surface only) opening the first
miss's review; miss dots render larger with an ✗ glyph and a visible
focus ring.

## History routing and the world switch

The header's top-left **world switch** (`[⌨ Code] [🌱 Learn]`, plus a
temporary `[📖 Lesson]` segment while a guided lesson is live) routes
through the existing toggle/surface APIs; `#btn-tutor` keeps its id on
the Learn segment. Surfaces are **hash-routed** (`#learn`, `#learn/round`,
`#learn/map`, `#lesson`; no hash = the IDE): main.mjs owns a tiny `nav`
(pushState per user-level transition, never inside loops — endless chunk
chaining stays on `#learn/round` and adds nothing), and `popstate` routes
through `tutor.applyRoute`, the same handlers ←/Esc use. Browser Back
mid-round lands on the menu with the round resumable; Back again reaches
the IDE. Reload with a hash restores the matching view (persistence
restores the state; the hash only routes the VIEW), and the COI shim's
first-visit reload preserves the hash. The collab room link (`#room=…`)
owns the fragment while present — nav never reads or writes it. On boot,
a persisted mid-round drill shows a **continue signal**: a small badge on
Learn plus a dismissible chip ("You're mid-round in <topic> — Continue");
dismissal is session-only, and both vanish the moment the surface opens.

## The stage, the history rail, and focus mode (guided lessons)

Opening Exercises enters **focus mode** (`#layout.focus`, owned by
app/layout.mjs): the current **beat** (the lead-in prose since the last
blocking step, plus the blocking question/action) renders on the
**stage** (`.tutor-stage`) — a full-height reading surface in the code
column — while the editor recedes to the right column, the memory pane
tucks away, and the console stays mounted as a slim always-live strip.
Locking a prediction triggers the **reveal**: the console strip grows
(`focus-reveal`) — the enlargement is the "now watch it run" cue — and
predict-state/scrub/memory beats also open the memory pane
(`focus-memory`). A static explain beat keeps the grown console so the
learner reads the card with the real output on screen; the next live
question resets it.

The narrow transcript pane holds the complete history as clickable
bubbles, tucked behind the stage head's **📜 History** toggle
(`focus-history`). **⇱ Back to editor** (or Esc) drops focus to the
classic layout — the stage falls back to its old docked position under
the code pane, transcript visible — so the app never becomes modal. The
focus flags never persist; only Exercises visibility does.

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
(×1.5) and missed (up to ×3) concepts, applies a **cold-start frontier
bias** (while few answers exist, exercises whose focus has never-seen
non-structural ancestors are down-weighted per unseen ancestor — a bias,
never a gate — fading out by ~24 answers, so cold "all"/endless rounds
deal basics first and walk outward), reserves **one slot per round for
the learner's worst concept** (highest missed/seen — the "will come back
until it's easy" promise, honored per chunk in endless mode too), and
never repeats a `(form, shape)` back to back — nor, when alternatives
exist, the same focus concept, including across endless chunk boundaries
(`finish()` passes the outgoing chunk's last key as `opts.prevKey`).
The compiler takes the learner's met set as `opts.met` (threaded from
`plp.kb.met.v1` by tutor.mjs) to feed the bias.

**predict-the-error** (expansion ladder §R3) is the sixth kind: the program
STOPS, and the learner taps the line it stops on and picks the kind from a
FIXED four-name palette (NameError · TypeError · IndexError · KeyError —
always all four, so "always X" can never become a meta-pattern). The card
suppresses the automatic program block (`program: false`): the numbered
picker rows ARE the program. Grading runs it for real, requires
`terminal_reason === "uncaught_exception"` (anything else takes the existing
"couldn't grade this run" skip path) and reads `actions.lastException()` —
the engine puts `type_name` on the terminal record and the raising LOCATION
on the last `exception` step, and the accessor merges them. Correct iff BOTH
the picked line and the picked type match; the verdict names a half-right
pick ("right line, wrong kind") while the score stays all-or-nothing. The
reveal is `Type: message — line N` (the message is omitted when the engine
exposes none). A clean first-attempt both-right answer before the final hint
GRANTS met (design/lesson-kb-binding.md §4): an unaided, engine-verified
prediction of the program's observable effect — here, its crash site.
Review shows the picker with the pick and the truth marked; the retry
re-picks and re-runs the same (deterministic) program.

**One question at a time**: every generated program produces exactly one
line of output (single-line input, Enter to submit); the one
`multiline: true` exception is `loop-for-visits-each`, where several
lines ARE the concept. Forms beyond predict-exact-output — predict-state,
fill-one-blank, spot-the-difference, trace-table, order-the-lines,
predict-the-error — plug in per exercise (design §5.2, expansion ladder
§R2/§R3). A predict-the-error program is the ONE deliberate exception to
"runs clean": it stops, and at most one line is printed before it does.

A drill round compiles a seeded, stats-weighted sequence into an
ordinary lesson script, so drills reuse the whole machinery (popup
beats, predict-then-verify, persistence — the compiled script is stored
verbatim, so reload restores the identical round).

Ground truth is always the engine: exercises generate programs, never
answers. A miss (wrong or skipped) shows the program's `variantCard`
(interpolating the exact values asked) or the concept's canonical rule
card, and bumps `plp.kb.v1` per-CONCEPT stats (`{seen, missed}`, keyed by
permanent tag; one-time migration from the legacy `plp.drills.v1`
template store). A clean first-attempt correct answer (predict-output,
predict-state, or an all-correct trace-table) additionally grants
the concept **met** in `plp.kb.met.v1` (see
`design/lesson-kb-binding.md`), which feeds the menu's frontier entry.
The generated catalogue of every concept and exercise is
[../curriculum/KB-REFERENCE.md](../curriculum/KB-REFERENCE.md) (a build
artifact, byte-exact by the K-doc test; regenerate with
`node tools/kb-docgen.mjs --write`).

(The original hand-authored template bank, `app/drills.mjs` +
`curriculum/CURRICULUM.md`, was retired when the KB reached parity.)

## Progress & mastery UI

- **Topic meters**: menu topic buttons carry a met/total mastery meter
  (`.t-meter`, computed by `topicProgress` in kb-session.mjs over the met
  map); an empty track at zero, a ✓ at full. The welcome card states
  "You know **N** of M ideas so far."
- **Round summary**: a finished practice round records a `summary` card
  (pure model: `summarizeRound` in [progress.mjs](progress.mjs)) —
  headline, per-question dot row (filled = right, open amber ring =
  still open), 🌱 newly-met chips, "coming back for you" line — and the
  end controls add "Keep going: {frontier-thickest topic} ▶".
- **My map** ([concept-map.mjs](concept-map.mjs)): the whole concept DAG
  as seven topic lanes of chips — met (filled ✓), frontier (breathing
  glow), locked (dimmed, never hidden) — with an SVG edge underlay
  measured from the DOM. A chip's detail card shows the concept
  statement, cross-topic prerequisites as jump links, and
  **Practice this ▶** (or **Try it anyway ▶** on a locked chip), which
  starts a targeted round on that one concept (`buildKBSession`'s
  `focus` option: the concept's own exercises, 4 questions — capped at 2
  when the concept has a single exercise — id
  `drill-{topic}-{tag}-{seed}`). A focus round always teaches the
  focused concept on its first ask, regardless of `introStyle` or prior
  sightings: the learner explicitly asked to learn it.
- **Start here**: a brand-new profile (nothing met, nothing answered)
  gets a primary "🌱 Start here — your first lesson" control at the top
  of the menu, launching the guided `u1-state-io` unit; it retires as
  soon as any experience exists.
- Debug hooks: `plp.tutor.progress()`, `plp.tutor.met()`,
  `plp.tutor.frontier()`, `plp.tutor.mapModel()`, `plp.tutor.showMap()`.
- Design tokens: learner surfaces speak the `--t-*` custom properties
  (style.css `:root`); a miss renders amber (information), never red;
  correct answers get a one-shot bloom; all motion honors
  `prefers-reduced-motion`.

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
  twin of the console's `showUpTo`). Grading forgives trailing whitespace,
  trailing blank lines, and content-equivalent container display (spacing
  around commas/colons inside brackets/parens/braces, repr quote style) —
  never a content difference. Hints are available pre-lock;
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
