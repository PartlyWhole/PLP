# Game-Inspired Trace Exercise UI

Status: **Standard interface implemented; scaffold progression deferred**  
Last updated: 2026-08-07  
Implementation authority: **Granted by user on 2026-08-07**

## 1. Clarified intent

"Gamified" describes the interaction and presentation, not a new progression
system.

The trace exercise should feel like a polished puzzle game:

- One clear objective at a time.
- Direct interaction with the program.
- Immediate, restrained feedback.
- A visible execution path built through the learner's actions.
- Satisfying transitions when a step is completed.
- A strong completion moment when the whole trace is finished.

PLP does not need an additional game economy, mission system, badge catalog, or
competitive layer.

## 2. Decision status

### User decisions

- The trace exercise should use a modern, elegant interface.
- The interface may borrow interaction patterns and visual polish from games.
- Gamification applies primarily to the UI, not to the learning-progress model.
- Learners should eventually be able to perform the whole trace themselves on
  paper.
- A wrong answer remains counted as wrong, but the answer stays private while
  the learner retries. The learner may explicitly reveal it.
- Previous trace information must not disclose future answers.

### Existing behavior to preserve

- First-attempt scoring.
- Private retry and explicit reveal.
- Solved-on-retry provenance.
- Existing practice dots, score, topic meters, and concept mastery.
- Existing round summaries and review navigation.
- Existing knowledge-base exercise authoring format.
- Progressive trace generation from the real execution stream.
- Verified-history-only trace review.
- Reload-safe active trace state without persisted future truth.

### Implemented decisions

- Use a stable two-pane trace workspace on desktop.
- Select the next line directly from the source-code gutter.
- Replace variable toggles with a compact before-and-after state editor.
- Collapse completed trace history into a quiet execution rail or drawer.
- Use game-like motion to show control and state moving through the program.
- Preserve Guided and Paper as possible future scaffolding levels, without
  treating them as unlockable rewards. This implementation delivers Standard.

## 3. Scope

### In scope

- Trace-exercise layout.
- Visual hierarchy.
- Direct code-line selection.
- Effects-entry interaction.
- Trace-history presentation.
- Feedback and transitions.
- Conditional, loop, call, and return presentation.
- Keyboard, touch, responsive, and reduced-motion behavior.
- UI wording for retry, reveal, and completion.
- Compatibility with existing scoring, persistence, and mastery.

### Out of scope

- Points or XP.
- Virtual currency.
- Missions or daily quests.
- Public or private leaderboards.
- Lives, energy, or attempt limits.
- Daily streaks.
- New badges or collectible rewards.
- New concept-map evidence tiers.
- New social features.
- Speed scoring.
- Changes to the knowledge-base authoring contract.

## 4. Product goal

Make tracing feel like manipulating a live execution puzzle rather than filling
out a growing web form.

The learner should remain oriented around three questions:

1. Where is control now?
2. Which line executes next?
3. What does that line produce?

Every visual element should help answer one of those questions or review an
answer the learner has already established.

## 5. Design principles

### 5.1 Code is the game board

The source listing remains fixed throughout the exercise. The learner acts on
the code directly instead of choosing from a newly rendered list of code
buttons on each step.

### 5.2 One active decision

The screen presents either:

- Choose the next line, or
- Record the selected line's effects.

It never presents both as competing tasks.

### 5.3 Stable spatial layout

The program, state, action area, and controls stay in consistent locations.
Completing a step changes content and emphasis, not the overall layout.

### 5.4 History stays available but quiet

Verified history is legitimate learner information, but it should not push the
active task down the page or dominate attention.

### 5.5 Feedback shows causality

Motion communicates:

- Which line was committed.
- How control moved.
- Which values changed.
- When a call entered or left a function.

Motion is never decorative noise.

### 5.6 Mistakes are low-drama

A wrong answer keeps the learner's work editable and provides a private,
phase-specific nudge. It does not flash red, shake the screen, or expose truth.

### 5.7 Game polish must not leak answers

The UI may animate verified past execution. It must not highlight feasible
future lines, reveal the number of remaining steps, or preview future state.

## 6. Desktop workspace

```text
+--------------------------------------------------------------------------+
| TRACE                              4 steps built   History   Scratchpad   |
+--------------------------------------+-----------------------------------+
| PROGRAM                              | CURRENT STEP                      |
|                                      |                                   |
|  1   n = 0                    done   | State before                      |
|  2   while n < 2:             x2     |  n = 1                            |
|  3       n = n + 1            active |                                   |
|  4   print(n)                        | Which line executes next?         |
|                                      |                                   |
|      Program ends                    | Click a line in the program.      |
|                                      |                                   |
|                                      |       Reveal    Check next line > |
+--------------------------------------+-----------------------------------+
| Last step: line 3 changed n from 0 to 1                         expand   |
+--------------------------------------------------------------------------+
```

### Program pane

- Approximately 55 to 65 percent of desktop width.
- One stable, syntax-highlighted source listing.
- Line numbers double as large selection targets.
- Current selection uses a quiet accent background and focus ring.
- Past execution uses subtle marks or occurrence counts.
- Blank lines remain visible but are not selectable.
- **Program ends** appears directly below the final source line as an execution
  destination.

### Current-step pane

- Approximately 35 to 45 percent of desktop width.
- Contains state before, the active prompt, response controls, private
  feedback, and primary actions.
- Uses one visually dominant primary action.
- Does not scroll independently during ordinary short traces.

### History strip

- Shows the last committed step in one line.
- Opens the complete trace as a drawer.
- Never changes the vertical position of the current-step controls.

## 7. Next-line interaction

### Prompt

- First step: **Which line executes first?**
- Later steps: **Which line executes next?**

### Selection

- Clicking a source line selects it.
- Only one source line or Program ends may be selected.
- Selection is visible through color, a solid gutter marker, and
  `aria-pressed` state.
- Arrow keys move focus between selectable lines.
- Enter or Space selects the focused line.
- The learner explicitly activates **Check next line**.

### Past-execution markers

Past markers may show:

- A quiet check for one past occurrence.
- A compact count such as `x2` for repeated past occurrences.
- A different mark for a step that was revealed.

Markers must describe committed history only.

### Wrong selection

The selected line remains selected and editable.

Feedback examples:

- "That line does not execute next. Re-check the active condition."
- "Control is still inside the function. Try another line."
- "The loop has just returned to its condition."

The final wording must be generated from already known structure without
revealing the correct destination. If a safe specific nudge is unavailable,
use the generic current behavior.

## 8. Effects interaction

After the line is correct, the same pane transitions to its effects without
moving the program or losing the selected-line highlight.

```text
CURRENT STEP

Line 3
n = n + 1

What changes after this line?

NAME              BEFORE       AFTER
n                      1       [ 2        ]
total                  4         unchanged

( ) No visible effect
[ ] Prints output
[ ] Returns a value

                             Reveal effects    Check step >
```

### State rows

- Every watched name stays visible.
- Each row shows its before value.
- Each row begins as **unchanged**.
- Activating a row reveals or focuses its after-value input.
- Deactivating it returns the row to unchanged.
- Newly bound names show `unbound` as the before value.
- A future version may support an explicit `gone` state when the underlying
  trace generator supports that answer.

### No visible effect

**No visible effect** is an affirmative answer, not the absence of selections.

It is mutually exclusive with:

- Changed watched names.
- Output.
- Return value.
- Any other learner-visible effect category.

This is especially important for condition checks, loop exhaustion, function
definitions, and control-transfer steps.

### Output

- Selecting **Prints output** reveals a multiline exact-output field.
- The prompt says "Output produced by this line."
- Whitespace behavior remains consistent with existing grading.

### Return value

- Return input appears only when the current line can produce a function
  return under the trace contract.
- It remains visually separate from caller-state changes.

### Wrong effects

- No individual field receives correct or incorrect styling.
- No expected value appears.
- The learner's entries remain intact.
- Feedback identifies only the category that deserves reconsideration when
  that can be done without leaking partial truth.

Fallback message:

> Something in this step's effects is not right. Try again or reveal this
> phase.

## 9. Compact execution history

The default history view shows only the most recent committed step:

```text
Last step: L3   n: 0 > 1                                      History v
```

Expanded history uses a compact timeline, not large cards:

```text
1   L1   n: unbound > 0
2   L2   no visible effect
3   L3   n: 0 > 1
4   L2   no visible effect
```

History rules:

- Preserves repeated occurrences of the same source line.
- Marks revealed and solved-after-retry steps without changing their content.
- Shows calls, returns, output, and caller resumption in concise language.
- May be collapsed at any time.
- Is restored exactly across reload.
- Contains only committed steps.

## 10. Conditionals and loops

### Conditions

The next-line choice is already the learner's answer about control flow. Do not
also ask True or False unless condition evaluation is the specific exercise
objective.

After a step is committed, the history may summarize past truth:

```text
L3 condition true > entered L4
```

### Loops

- Repeated executions receive separate history entries.
- The source gutter may show a past occurrence count.
- The final failed loop condition remains a real step.
- No total iteration count is shown in advance.
- A no-effect control step requires an explicit No visible effect answer.

## 11. Function calls and returns

Function movement needs stronger spatial explanation than ordinary line
execution.

### Entering a call

After the learner correctly selects the first callee line, show a quiet context
breadcrumb:

```text
CONTEXT
module > double()
```

The breadcrumb appears only after the control-flow answer is established.

### Inside a function

- The active function name remains visible near the current-step label.
- The selected source line remains the primary location cue.
- Frame-local state may be shown only when the authored exercise explicitly
  watches it.

### Returning

Separate return production from caller resumption:

```text
RETURN FROM double()

Returned value              [ 6 ]

Caller resumes at line 4
x: unbound >                [ 6 ]
```

This presentation does not reveal the value. It explains why a return line can
produce an effect in the caller.

## 12. Retry and reveal

Existing scoring behavior remains unchanged.

### Retry

- The first wrong attempt is counted once.
- The correct answer remains hidden.
- The learner may retry indefinitely.
- Correcting the phase advances normally.
- History may mark the committed step as solved after retry.
- Retry never rewrites the first-attempt score or mastery evidence.

### Reveal

- The learner may reveal only the current phase.
- **Reveal next line** reveals the current destination, then moves to effects.
- **Reveal effects** reveals and commits only the current step's effects.
- The history marks the resulting step as revealed.
- No later line or effect is disclosed.

### Skip

- Skip remains available as a quiet secondary action.
- It should not compete visually with Check or Reveal.
- It may live in an overflow menu on narrow layouts.

## 13. Feedback and motion

### Step commit

Use a 150 to 200 ms transition:

1. The selected source line receives a committed marker.
2. Changed values crossfade from before to after.
3. A thin execution trail moves to the selected line.
4. The history strip updates.
5. The next-line phase fades in.

### Correct answer

- Quiet accent-to-success transition.
- No modal interruption.
- No full-screen celebration between steps.
- Optional small haptic response on supported touch devices, if this can be
  enabled without permission prompts.

### Wrong answer

- No red screen flash.
- No shaking controls.
- No negative sound.
- A restrained amber note appears next to the active controls.
- Focus remains in the learner's current work.

### Completed trace

Use one stronger but still elegant moment:

- The completed execution route draws from beginning to end.
- Changed-state highlights replay once at a readable speed.
- A concise completion panel appears.
- Existing round score and mastery behavior remain the source of truth.

```text
TRACE COMPLETE

L1 > L2 > L3 > L2 > L3 > L2 > L4 > END

8 executed steps
2 decisions corrected privately

                            Review trace    Next problem >
```

## 14. Scaffolding modes

These modes concern pedagogy and UI density, not rewards.

### Guided

- Full state-before display.
- Explicit effect categories.
- Function-context explanation.
- Phase-specific hints.
- Expanded history available.

### Standard

- Compact state-before display.
- Direct source-line selection.
- Before-and-after effects editor.
- Collapsed history by default.

### Paper

- Learner completes the trace before correctness feedback.
- Rows are added one at a time, so total trace length is not disclosed.
- Program ends is selected explicitly.
- Submission identifies the first divergence.
- The learner may replay from that divergence in Standard mode.

Whether modes are always selectable or recommended based on experience remains
an open product decision. They should not require points, badges, or unlock
currency.

## 15. Visual system

### Surfaces

- One continuous workspace.
- Thin dividers instead of nested cards.
- Slightly raised current-step pane if additional separation is needed.
- Code background shared between source and current-line excerpt.

### Color roles

- Accent: active selection and primary action.
- Success: independently verified committed work.
- Amber: retry, reveal, and attention without alarm.
- Neutral: past execution and unchanged state.
- Color is never the only indicator.

### Typography

- Existing readable sans-serif for prompts and controls.
- Existing monospace stack for code and values.
- Tabular numerals for line numbers and state values.
- Small uppercase section labels used sparingly.
- Current prompt is the largest text within the exercise workspace.

### Controls

- One primary action per phase.
- Reveal is secondary but visible.
- Skip is quiet.
- Buttons use consistent verbs:
  - Check next line
  - Check step
  - Reveal next line
  - Reveal effects
  - Next problem

### Iconography

- Use simple execution dots, checkmarks, counts, and disclosure chevrons.
- Avoid trophy, coin, flame, heart, and lock imagery inside the trace exercise.
- Icons always have accessible text or labels.

## 16. Responsive behavior

### Wide desktop

- Side-by-side Program and Current step panes.
- History as bottom drawer.

### Narrow desktop and tablet

- Program remains above or beside the current step depending on available
  width.
- Primary actions remain visible without horizontal scrolling.

### Mobile

- Program occupies a sticky upper region with a bounded height.
- Current step appears below or as a nonmodal bottom sheet.
- History opens separately.
- Source-line selection targets are at least 44 CSS pixels high where
  practical.
- The on-screen keyboard does not cover the primary action or active input.
- No horizontal page overflow at 360px.

## 17. Accessibility

- Complete operation by keyboard.
- Visible focus on every source line and control.
- Source-line choices form one accessible pressed-button group.
- Program ends participates in the same group.
- Screen readers announce:
  - Current phase.
  - Current function context.
  - Selected line.
  - State-before values.
  - Committed result.
  - Retry or reveal provenance.
- Selection, history state, and correctness never rely on color alone.
- Reduced-motion mode replaces movement with immediate state changes.
- Zoom to 200 percent does not hide the active decision or primary action.

## 18. Persistence and compatibility

The UI redesign must preserve these contracts:

- Active cursor, phase, draft, misses, reveals, and committed history restore
  after reload.
- Persisted state contains no future execution sequence or answer-derived
  signature.
- Debug records, memory panes, and console remain unable to expose the private
  oracle.
- Existing review records continue to render.
- Existing trace-table authoring continues to map to the progressive runtime.
- Existing practice scoring, streak, topic, and mastery stores keep their
  meaning.
- Existing non-trace exercises are not visually or behaviorally changed unless
  a shared control requires a compatible refinement.

## 19. Acceptance criteria

### Layout and orientation

- **UI1:** The source listing remains in a stable position throughout a trace.
- **UI2:** The active prompt and primary action remain visible as history grows.
- **UI3:** Completing a phase does not replace the entire exercise card or
  cause a large scroll jump.
- **UI4:** The interface shows only one active decision at a time.
- **UI5:** The active line, phase, and function context are identifiable without
  relying only on color.

### Next-line selection

- **UI6:** The learner selects the next line directly from the source gutter.
- **UI7:** Only one line or Program ends can be selected.
- **UI8:** Every nonblank source line remains a visually plausible choice.
- **UI9:** Past occurrence counts never contain future execution information.
- **UI10:** A wrong line remains editable and reveals no correct destination.

### Effects

- **UI11:** Every watched name shows its before value.
- **UI12:** Unchanged, changed, output, return, and no-visible-effect answers are
  explicit.
- **UI13:** No visible effect is mutually exclusive with visible effects.
- **UI14:** A wrong submission reveals no correct field or partial grading.
- **UI15:** Return value and caller-state change are visually distinguishable.

### History and completion

- **UI16:** The default history surface occupies one compact row.
- **UI17:** Expanded history preserves every repeated executed-line occurrence.
- **UI18:** Revealed and solved-after-retry steps retain their provenance.
- **UI19:** The completed route can be reviewed without rerunning the private
  oracle.
- **UI20:** Trace completion presents existing score and mastery truth without
  inventing a new reward system.

### Responsive and accessible operation

- **UI21:** The complete trace can be performed by keyboard.
- **UI22:** Reduced-motion mode preserves every state transition semantically.
- **UI23:** The layout has no horizontal overflow at 360px.
- **UI24:** At 200 percent zoom, the active prompt and primary action remain
  reachable.
- **UI25:** Screen-reader announcements identify phase, selection, context, and
  committed result.

### Recovery and compatibility

- **UI26:** Reload restores the exact active trace UI and learner draft.
- **UI27:** Finishing or replacing a round cannot resurrect an old trace.
- **UI28:** No learner-facing or debug-visible surface exposes future truth.
- **UI29:** Existing first-attempt score and mastery semantics remain unchanged.
- **UI30:** Existing knowledge-base trace exercises require no authoring change.

## 20. Verification ownership

| Area | Evidence | Owner |
|---|---|---|
| Visual hierarchy and game-like feel | Direct rendered experience | User |
| No-leak and retry behavior | Automated browser tests | Engineering |
| Trace semantics | Question-engine and generated-bank tests | Engineering |
| Keyboard and responsive behavior | Browser and accessibility checks | Engineering |
| Persistence | Reload and lifecycle tests | Engineering |
| Whether learners understand effects controls | Small usability test | Product/User |
| Whether Paper mode transfers to paper tracing | Observed learner behavior | Product/User |

## 21. Implementation milestones

### Milestone 1: Stable trace board

Status: **Implemented**

- Fixed source listing.
- Direct gutter selection.
- Persistent current-step pane.
- Program ends destination.
- Compact history strip.

### Milestone 2: Effects editor

Status: **Implemented**

- Before-and-after state rows.
- Explicit unchanged and no-visible-effect answers.
- Output and return controls.
- Call and caller-resume presentation.

### Milestone 3: Feedback polish

Status: **Implemented for Standard**

- Step-commit motion.
- Low-drama wrong feedback.
- Trace-completion route playback.
- Reduced-motion equivalent.

### Milestone 4: Responsive and accessible behavior

Status: **Implemented for the Standard layout**

- Keyboard source navigation.
- Labeled button state and screen-reader phase announcements.
- Stacked mobile board.
- Touch-target, overflow, and reduced-motion verification.

### Milestone 5: Scaffold progression

Status: **Deferred pending learner testing**

- Guided presentation.
- Standard presentation.
- Paper trace entry and first-divergence review.
- Learner testing of transfer to paper.

## 22. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Game styling distracts from reasoning | Source code remains the visual anchor |
| Motion leaks future control flow | Animate committed history only |
| Full history overwhelms the current task | Collapse it to a one-line strip |
| Direct line clicking becomes a guessing game | Require effects after every correct line |
| No-effect steps feel ambiguous | Require an explicit No visible effect answer |
| Function returns remain conceptually confusing | Separate return production from caller resumption |
| Wrong feedback accidentally reveals a category | Use generic fallback when safe specificity is unavailable |
| Mobile input hides controls | Stack the board and keep actions in the current-step pane |
| UI redesign alters scoring | Treat existing tutor state as authoritative |
| Paper mode cascades one early error | Report first divergence rather than marking every later row wrong |

## 23. Implementation decisions and follow-ups

### Decided for Standard

1. The visual character is a polished coding puzzle.
2. Trace history opens from a compact strip below the board.
3. Standard is the only implemented presentation level.
4. The effects editor requires an explicit No visible effect interaction.
5. Past source occurrences use a checkmark, then ×N for repeats.
6. Motion is restrained to committed-step and completion feedback.

### Future product questions

- Whether subtle optional sound or haptics belong in scope.
- Whether Guided and Paper modes should be added after learner testing.
- Whether mobile benefits from a sticky or sheet-style current-step pane after
  testing the simpler stacked layout.

## 24. Implementation outcome

The Standard UI was implemented in the isolated
`codex/practice-ux-shaping` worktree without changing the knowledge-base
authoring contract or tutor scoring. Automated coverage pins the stable source
board, explicit effect choice, verified-history-only marks, function context,
repeat counts, completion route, keyboard navigation, narrow layout, reduced
motion, private retries, persistence, and concealed oracle behavior.
