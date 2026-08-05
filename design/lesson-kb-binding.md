# Binding guided-tutor lessons to KB concepts

> Design note. Specifies how authored guided-tutor lessons
> (`curriculum/u1-state-io.mjs` and its siblings) attach to the tagged
> concept-DAG knowledge base (`design/knowledge-base-design.md`). The
> actual code changes are main-session **phase-4** work; this note is the
> spec that phase-4 executes against. No code is changed by this note.

## 1. Scope

Lessons and drills both teach KB concepts, but only drills currently
carry any concept binding. Lessons carry a dead `skills: [...]` string
array that nothing consumes. This note replaces that array with real KB
tags and defines exactly when completing a lesson step marks a concept
**met** — so lesson progress and drill progress write into one shared
mastery store, and the tutor menu can reason over the frontier
(`kb.frontier(met)`) after a lesson the same way it does after a drill.

## 2. Authoring rule

**Decision: lessons bind at two levels — unit and ask-step.**

- At unit level, replace `skills: [<string>...]` with
  `concepts: [<4-char tag>...]` — the set of concepts the whole unit
  touches. Rationale: `skills` was free-text with no witness in the KB;
  tags are checkable and record-stable.
- Each `ask` step MAY carry `focus: <tag>` naming the one concept a
  correct answer to that step evidences. Steps without an `ask`
  (`say`/`pause`/`action`/`done`) never carry `focus`. Rationale: only a
  graded prediction can witness met-ness (§4); narration cannot.

**Lint (curriculum load-time, the existing curriculum linter):**

1. Every tag in a unit's `concepts` exists in `loadKB().concepts`.
2. Every such tag is **non-structural** (`kind !== "structural"`) —
   structural roots are vacuously met and are never a lesson's teaching
   target.
3. Every `ask`-step `focus` tag exists, is non-structural, **and** is
   listed in that unit's `concepts` (the unit set is the superset of its
   focuses). A `focus` outside the unit set is an authoring error.

The lint runs at curriculum load, mirroring the existing data lint, so a
bad tag fails fast rather than silently mis-binding progress.

## 3. u1 concept mapping (the concrete table)

`curriculum/u1-state-io.mjs` today declares
`skills: ["state-model", "read-trace", "predict-output", "input-boundary"]`.
That becomes:

```
concepts: ["0006", "0009", "000A", "000B", "0026"]
```

| Tag | Slug | Why it belongs to u1 |
|---|---|---|
| `0006` | `name-holds-value` | `x = 3`; `print(x)` — the unit's opening trace. |
| `0009` | `evaluate-before-bind` | `b = a * 3` computed before the name stores it. |
| `000A` | `rebind-updates-name` | `x = 10` replaces what `x` held. |
| `000B` | `accumulate-rebind` | `total = total + 5` reads old, computes, rebinds. |

Old `skills` strings that map to **nothing** (recorded, not silently
dropped):

- `state-model` and `read-trace` — interface/narrative skills with no KB
  witness. No minimal program's output discriminates "can read a trace";
  the structural roots (`run-top-to-bottom`, `one-line-per-print`)
  already carry that narrative. Dropped.
- `predict-output` — a *form* (§5.2 predict-exact-output), not a
  concept. It describes how the ask is graded, not what is learned.
  Dropped.
- `input-boundary` — **GAP CLOSED** (expansion ladder §R4a). It was
  deferred while phase-1 KB had no node for the stdin rendezvous; `0026`
  `input-pauses-for-value` is now minted, wired (`kb/concepts/io.mjs`),
  and exercised (`kb/exercises/io.mjs`), and the `predict-io` form can
  supply a scripted stdin line during grading. u1 gained `0026` in its
  `concepts` and carries a graded `predict-io` ask — the `int(input())`
  bridge, hand-authored because a KB exercise for `0026` may not reach
  outside `ancestors(0026)` for `int(...)` (§2.8 closure / K-4). The
  input-boundary steps now grant met like any other graded prediction.

**Ask-step focus assignment** (the two graded predictions in u1):

- The `b = a * 3` prediction (step reading `a = 2\nb = a * 3\na = a + 1\nprint(b)`)
  → `focus: "0009"` (the "computed before `a` changed" catch).
- The `total` accumulation prediction (step reading
  `total = 0\ntotal = total + 5\ntotal = total + 10\nprint("total:", total)`)
  → `focus: "000B"`.
- The `int(input())` transcript prediction (step reading
  `answer = input("Pick a number: ")\nnumber = int(answer)\nprint(number + 1)`,
  `stdinScript: ["7"]`) → `focus: "0026"`.

`0006` and `000A` are in the unit `concepts` set (the unit exercises
them in demos) but have no dedicated graded ask in u1, so they are not
marked met by u1 alone — they get their met credit from drills or a
later unit's ask. This is correct: met-ness requires a graded correct
prediction (§4), and u1's narration of rebinding is a demo, not a probe.

## 4. When a lesson marks a concept met

**Decision: exactly the drill rule of `knowledge-base-design.md` §2.8 —
no lesson-specific relaxation.**

A lesson marks concept C met iff **all** hold:

1. The step is an `ask` of kind `predict-output`, `predict-state`,
   `trace-table`, `predict-the-error` or `predict-io` whose `focus` is C.
2. It is graded **exact-output** (the primary predict-exact-output form)
   — or it is **predict-state** answered exactly (predicting what a name
   really holds after the run is the same §2.8 evidence class as
   predicting what it prints: an unaided, engine-verified prediction of
   the concept's observable effect) — or it is a **trace-table** answered
   with every cell correct: a student who predicts every intermediate
   value unaided has demonstrated strictly more than one who predicts
   only the end state, so the all-correct table is an accepted (stronger)
   witness — or it is a **predict-the-error** answered with BOTH the line
   and the error kind right (expansion ladder §R3): naming where a program
   crashes and with what is an unaided, engine-verified prediction of the
   program's observable effect, the same §2.8 evidence class as predicting
   what it prints — or it is a **predict-io** whose whole console
   transcript is right (expansion ladder §R4a): predicting where a
   program pauses, where the typed line lands, and what it prints around
   both is a prediction of the program's observable effect, the same
   §2.8 evidence class (the echo-stripped transcript is accepted too — a
   learner who predicts only what the PROGRAM emits has understood the
   same thing; the local echo is a presentation choice, not a concept).
3. The student's answer is **correct on the first attempt** and arrives
   **before the final hint is shown**. §2.8 forbids crediting a shown
   answer or a lucky skip; a hint that states the output *is* a shown
   answer. So: credit only when the correct answer lands before the last
   hint in the step's `hints` array has been revealed. A correct answer
   entered after that final hint does not count.

Everything else grants nothing: watching a `Trace` demo, scrubbing the
memory slider, a `say`/`pause`/`action`/`done` step, or an ask answered
only after the last hint. Met-ness is evidence the student can predict
the concept unaided; only a clean first-attempt prediction is that
evidence.

## 5. One shared record store

**Decision: a single per-student mastery map owned by the tutor runtime,
KB stays storage-free.**

```
tag → { met: true, at: <ms>, source: "lesson" | "drill" }
```

- localStorage-backed, the **same** store the drill mode uses. Lessons
  and drills both write through one API:

  ```
  grantMet(tag, source)   // idempotent; first grant wins `at`/`source`
  ```

- The KB itself never persists anything (`knowledge-base-design.md`
  §7.3: `loadKB()` exposes pure functions; "nothing in the KB imports
  from, or refers to, any delivery runtime"). The met **set** is derived
  from the store's keys and passed *into* KB queries; the KB never reads
  the store.
- Frontier queries drive the menu: after a lesson, `kb.frontier(met)`
  (unmet concepts whose parents are all met) lets the tutor menu offer
  - **"Drill what you just learned"** — intros whose `focus` is in
    `kb.frontier(met)` (the newly unlocked frontier), and
  - **"Continue where the lesson left off"** — the next unit.

Because both sources feed one store, a concept met in a drill suppresses
its redundant lesson ask and vice versa; the menu reflects true progress
regardless of which surface earned it.

## 6. Migration sketch for u1 (main-session phase 4)

1. In `curriculum/u1-state-io.mjs`: replace the `skills` array with
   `concepts: ["0006", "0009", "000A", "000B"]`.
2. Add `focus: "0009"` to the `b = a * 3` ask step and `focus: "000B"`
   to the `total` ask step. Leave the input-boundary steps unfocused.
3. Extend the curriculum linter with the §2 cross-check (tags exist,
   non-structural, focus ⊆ unit concepts).
4. In the tutor runtime's answer-grading path, on a first-attempt
   correct `predict-output` ask that carries `focus` and was answered
   before the final hint, call `grantMet(focus, "lesson")`.
5. Wire the tutor menu's post-lesson entries to `kb.frontier(met)` as in
   §5.

No changes to `app/**` engine internals, the KB data, or drill code are
required beyond the shared `grantMet`/store already planned for drills.

## 7. Test plan (T-series, asserted via `window.plp`)

Per repo convention, assert against `window.plp` state, never pixels.

- **(a) Lint rejects a bad `focus`.** A unit fixture whose `ask` carries
  an unknown tag, or a structural tag (`0001`), or a tag absent from the
  unit `concepts` set → curriculum load surfaces a lint error.
- **(b) Correct first ask marks met; wrong does not.** Drive u1 to the
  `b = a * 3` ask; a correct first-attempt answer → the store has `0009`
  with `source: "lesson"`. A wrong answer (or one entered only after the
  final hint) → `0009` absent from the store.
- **(c) Demo-only walkthrough grants nothing.** Step through u1's
  trace/scrub/`say` steps without answering any ask → the met store is
  unchanged (empty of u1's focuses).
- **(d) Met set feeds the frontier and the menu.** After (b)'s grant,
  `kb.frontier(met)` is non-empty and the tutor menu exposes the
  "Continue"/"Drill what you just learned" entries computed from it.

---

## Known gaps

- **Input concept unminted.** `input-boundary` has no phase-1 KB node;
  the u1 input steps grant nothing until an input/stdin concept is added
  to State & I/O (§3.2) and given an ask focus. Tracked here, not a
  blocker for phase-4 migration.
