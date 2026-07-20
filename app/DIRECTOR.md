# Director — authoring manual (grammar reference)

> **Dormant prototype:** lessons are currently removed from the learner-facing
> product while the core UI is redesigned. This grammar and its tests remain
> available for experiments; `app/main.mjs` does not load lesson data.

The director runs **human-authored lessons**: staged, attention-directed,
behavior-reactive walkthroughs inside the live app. The runtime
([director.mjs](director.mjs)), the stage ([stage.mjs](stage.mjs)), and the
condition library ([conditions.mjs](conditions.mjs)) implement the grammar;
**all pedagogy — pacing, wording, structure — lives in lesson files**
(`lessons/*.mjs`). Design rationale: [design/director-plan.md](../design/director-plan.md);
research grounding: [design/game-tutorial-research.md](../design/game-tutorial-research.md).

## The contract (what the runtime guarantees)

- The stage **arranges**; the **learner performs**. There is no action that
  runs code or presses buttons. `until` triggers are learner-driven only.
- Nothing is modal. One tutor speech bubble or generic popover at a time,
  Esc-dismissable. **skip** and **exit** are always visible while a lesson
  runs.
- Tutor speech types progressively. Clicking its text reveals the complete
  message, and reduced-motion preferences skip the animation.
- Tutor speech automatically avoids the pane that owns its `at` target and
  any spotlighted pane. Add `avoid: [TARGET, ...]` when a beat presents
  additional regions that must remain visible.
- Gates fail open: exit, completion, or ANY internal error restores full
  free play (`stage.reset()` on every path).
- Lessons are linted at `start()`; unknown targets/events/conditions/
  signals/beat refs are load-time errors, not runtime surprises.

## Lesson shape

```js
export default {
  id: "aliasing-1",            // stable id (progress/telemetry key)
  title: "Two names, one list",
  concept: "aliasing",         // metadata
  code: "a = [1, 2]\n…",       // optional: program set at lesson start
  beats: [ /* … */ ],
};
```

Register in `lessons/index.mjs`.

## Beat shape

```js
{
  id: "press-run",
  do: [ /* stage arrangement, applied in order on beat entry */ ],
  until: TRIGGER,              // advance condition (learner-driven)
  hints: [ { when: TRIGGER-or-idle, say: { at, md }, once? } ],
  why: "Explicit explanation shown on demand ('why?' button).",
  next: "beat-id"              // optional; default = next in array
        | [ { if: TRIGGER, then: "beat-id" }, …, "default-id" ],
}
```

- Effects (`spotlight`/`say`/`popover`/`veil`/`cue`/`pulse`) are **per-beat** —
  cleared automatically on every transition. Re-declare what should persist.
- **Gates persist across beats** — progressive disclosure accumulates
  (`allow` re-opens what an earlier beat denied).
- Only the **final** beat may omit `until` (a resting beat; learner leaves
  via exit/skip).

## `do` actions

| action | effect |
|---|---|
| `{ set: "code", value }` | replace the editor program |
| `{ gate: { deny: [...], allow: [...] } }` | capability gating (below) |
| `{ spotlight: TARGET, dim?: true }` | ring the target; `dim` adds the backdrop |
| `{ cue: { at: TARGET, motion?: "pulse" \| "bounce" \| "wiggle" } }` | animate a brief attention cue; defaults to `pulse` |
| `{ pulse: TARGET }` | backwards-compatible shorthand for a pulsing cue |
| `{ say: { at: TARGET, md, sticky?, avoid?: TARGET[] } }` | the tutor types live text over a translucent, blurred speech surface; target-aware placement keeps the teaching area visible; `**bold**`, `` `code` `` only; clicking reveals the rest; gets the beat's `why?` button |
| `{ popover: { at: TARGET, md, sticky?, avoid?: TARGET[] } }` | generic anchored note without the tutor; same rich-text, placement, and `why?` behavior |
| `{ veil: TARGET }` / `{ unveil: TARGET }` | hide/show a region (progressive disclosure) |
| `{ quiz: { kind, opts } }` | open a generated question (see app/QUESTIONS.md) |
| `{ clear: "effects" }` | clear effects mid-list (before re-staging) |

## Capabilities (gate vocabulary)

`run` · `stop` · `edit` (editor read-only) · `scrub` · `step-mode` ·
`quiz` · `console-input` (prompt shows, line mode won't engage — leave an
escape!) · `maximize` · `share`

## Targets

Strings: `run` `stop` `share` `editor` `console` `memory`
`memory-names` `memory-objects` `scrubber` `step-mode`.
Structured: `{ name: "y", scope: "global" | "<function>" }` (a Names cell —
re-anchors across re-renders), `{ line: 3 }` (editor pane + line
highlight). Never CSS selectors; never per-run uids.

## Triggers (`until`, `hints[].when`, `next[].if`)

| leaf | meaning |
|---|---|
| `{ event: "run-ended", reason: "completed" }` | a learner event matching every extra field; events: `run-started/ended/rejected`, `input-answered`, `interrupt-requested`, `edited`, `scrubbed`, `hover-name`, `chip-clicked`, `mode-changed`, `quiz-question/graded` |
| `{ event: "hover-name", name: "y", dwellMs: 1000 }` | advance only after the learner continuously hovers that name for the requested duration; leaving early cancels the pending trigger; valid in `until` only |
| `{ check: "nameIs", name: "y", value: "3" }` | condition library (below), evaluated against live state |
| `{ signal: "quizTries", gte: 3 }` | per-beat counters: `attempts` (runs ended), `quizTries`, `hintsShown`, `elapsedMs`; `gte`/`lte` |
| `{ idleMs: 20000 }` | **hints only** — no learner event for that long (lint rejects it in `until`) |
| `{ all: [...] }` / `{ any: [...] }` | composition; event leaves "latch" once matched during the beat |

## Condition library (`check:`)

`completedRun` · `endedWith{reason}` · `nameIs{scope?,name,value}`
(text form, whitespace/quote-insensitive) · `nameExists{scope?,name}` ·
`sameObject{names[],scope?}` (aliasing — same-step uid equality) ·
`outputContains{text}` · `ranLine{line}` · `raisedException{type?}` ·
`usedInput{count?}` · `sourceContains{text}`.
Adding one = a function in conditions.mjs + a row here.

## Authoring rules (research-derived; the runtime can't enforce taste)

1. One spotlight/speech focus per beat; if you need two, it's two beats.
   Use one cue motion at a time and match it to intent: pulse to notice,
   bounce to move next, wiggle to reconsider.
   Protect every simultaneously presented region with `avoid`; placement
   chooses the nearest safe pane and remains inside the viewport.
2. `until` = the learner's own action, in the real app (do-once-and-see).
   Use `dwellMs` for hover teaching gestures so the learner can observe the
   resulting highlights before the next beat replaces them.
3. Hints escalate quietly: nudge (idle) → point (more idle / attempts) →
   show. Never front-load them.
4. Complex concepts get `why:` prose; simple mechanics don't need it.
5. Teach the interface as content (Run, terminal, scrubber each earn a
   beat the first time).
6. Use signal branches to catch struggle (`quizTries`/`attempts` in
   `until`'s `any` + a `next` branch to a review beat) — never a dead end.
7. Watch telemetry (`plp.director.telemetry()`): time-per-beat, hint and
   attempt counts are the fluency metrics that matter.

## Debug/test API

`plp.director` (`start(lesson)`, `skip()`, `exit()`, `state()`,
`telemetry()`, `progress()`), `plp.stage` (gates/effects/targets),
`plp.lintLesson(lesson)`, `plp.events` (`log()`, `on()`), `plp.__eval`
(condition evaluation). D-series tests: [tests/director.spec.mjs](../tests/director.spec.mjs).
