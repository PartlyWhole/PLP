# Director — authoring manual (grammar reference)

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
- Nothing is modal. One popover at a time, Esc-dismissable. **skip** and
  **exit** are always visible while a lesson runs.
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
  hints: [ { when: TRIGGER-or-idle, popover: { at, md }, once? } ],
  why: "Explicit explanation shown on demand ('why?' button).",
  next: "beat-id"              // optional; default = next in array
        | [ { if: TRIGGER, then: "beat-id" }, …, "default-id" ],
}
```

- Effects (`spotlight`/`popover`/`veil`/`pulse`) are **per-beat** — cleared
  automatically on every transition. Re-declare what should persist.
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
| `{ pulse: TARGET }` | brief attention ping |
| `{ popover: { at: TARGET, md, sticky? } }` | anchored note; `**bold**`, `` `code` `` only; gets the beat's `why?` button |
| `{ veil: TARGET }` / `{ unveil: TARGET }` | hide/show a region (progressive disclosure) |
| `{ quiz: { kind, opts } }` | open a generated question (see app/QUESTIONS.md) |
| `{ clear: "effects" }` | clear effects mid-list (before re-staging) |

## Capabilities (gate vocabulary)

`run` · `stop` · `edit` (editor read-only) · `scrub` · `step-mode` ·
`quiz` · `console-input` (prompt shows, line mode won't engage — leave an
escape!) · `maximize` · `share`

## Targets

Strings: `run` `stop` `quiz-btn` `share` `editor` `console` `memory`
`memory-names` `memory-objects` `scrubber` `step-mode`.
Structured: `{ name: "y", scope: "global" | "<function>" }` (a Names cell —
re-anchors across re-renders), `{ line: 3 }` (editor pane + line
highlight). Never CSS selectors; never per-run uids.

## Triggers (`until`, `hints[].when`, `next[].if`)

| leaf | meaning |
|---|---|
| `{ event: "run-ended", reason: "completed" }` | a learner event matching every extra field; events: `run-started/ended/rejected`, `input-answered`, `interrupt-requested`, `edited`, `scrubbed`, `hover-name`, `chip-clicked`, `mode-changed`, `quiz-question/graded` |
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

1. One spotlight/popover focus per beat; if you need two, it's two beats.
2. `until` = the learner's own action, in the real app (do-once-and-see).
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
