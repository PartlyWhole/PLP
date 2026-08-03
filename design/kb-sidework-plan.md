# KB side-work implementation plan (Stage A output)

Executor: read this whole file, then implement ONLY the task section you
were assigned, exactly as written. All work happens in the worktree
`/Users/alan/PLP-sidework` (absolute paths below). Do not touch
`kb/**`, `tests/kb.spec.mjs`, `tests/tutor.spec.mjs`, `app/**`,
`curriculum/**`, `index.html`. Blockers go under `## Execution notes`
at the bottom of this file; small mechanical deviations get logged
there too.

Verification command after any code step (from the worktree root):

```
PLP_PORT=8733 npx playwright test tests/ledger-check.spec.mjs tests/placement.spec.mjs
```

(Playwright runs pure-Node specs fine; they use no `page` fixture. The
webServer still boots — that is expected and harmless.)

---

## Task 1 — ledger permanence check (files: `tools/check-ledger.mjs`, `.github/workflows/kb-ledger.yml`, `tests/ledger-check.spec.mjs`)

### 1.1 `tools/check-ledger.mjs`

Zero-dependency Node (only `node:fs`, `node:child_process`,
`node:process`). Structure: a pure exported function plus a thin CLI
guarded by `import.meta.url` main-module detection.

Exports:

```js
export const TAG_RE = /^[0-9A-HJKMNP-TV-Z]{4}$/;      // Crockford base-32, no I L O U
export function checkLedger(before, after) → string[]  // violations, [] = OK
```

`before`/`after` are parsed JSON arrays (the CLI does the parsing).
Entry shape: `{tag, slug, kind, parents, status, successors?}`.

Rules, applied in this order (each violation is one string, exact
formats below — tests assert on them verbatim):

1. Input shape: if `before` or `after` is not an Array →
   `"ledger: base is not a JSON array"` / `"ledger: working copy is not a JSON array"`,
   and return immediately (no further checks).
2. Strict prefix, length: if `after.length < before.length`, emit for
   each `i` in `[after.length, before.length)`:
   `"entry removed: <tag> (<slug>)"` (tag/slug from `before[i]`).
3. For each index `i < min(before.length, after.length)`, with
   `b = before[i]`, `a = after[i]`:
   - `a.tag !== b.tag` → `"tag changed at index <i>: <b.tag> → <a.tag>"`
     and SKIP the remaining per-entry checks for this index (everything
     downstream would be noise).
   - `a.kind !== b.kind` → `"kind changed on <tag>: <b.kind> → <a.kind>"`
   - `JSON.stringify(a.parents) !== JSON.stringify(b.parents)` →
     `"parents changed on <tag>: <JSON of b.parents> → <JSON of a.parents>"`
     (order-sensitive by design; reordering parents is a change).
   - Slug changes are LEGAL (renamable by design) — no check.
   - Status:
     - unchanged status: if `b.status !== "active"` and
       `JSON.stringify(a.successors ?? null) !== JSON.stringify(b.successors ?? null)`
       → `"successors changed on <tag>"`.
     - changed status: legal only when `b.status === "active"` and
       `a.status` is `"split"` or `"merged-into"`; anything else →
       `"illegal status change on <tag>: <b.status> → <a.status>"`.
       When the transition IS legal, additionally require
       `Array.isArray(a.successors) && a.successors.length > 0`, else
       `"status change on <tag> lacks successors"`; and every successor
       tag must exist among `after` entries' tags, else per missing one
       `"successor <s> of <tag> not in ledger"`.
4. New entries, each index `i >= before.length`, `a = after[i]`:
   - `!TAG_RE.test(a.tag)` → `"new tag <tag> is not 4-char Crockford base-32"`
   - duplicate against ALL other tags in `after` (prefix and new) →
     `"duplicate tag <tag>"` (emit once per duplicated new entry).
   - `a.status !== "active"` → `"new entry <tag> must start active"`
   - every `p` of `a.parents` must be a tag present in `after` →
     `"new entry <tag> parent <p> unknown"`

`<tag>` in messages is the entry's tag string. Use a plain ` → `
(U+2192 with spaces) exactly as shown.

CLI (bottom of the same file):

```js
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
```

(If that comparison proves brittle, `pathToFileURL(process.argv[1]).href`
from `node:url` is the sanctioned variant — log the swap in Execution
notes.) Behavior of `node tools/check-ledger.mjs <base-ref> [path]`:

- `path` defaults to `kb/tags.ledger.json`.
- No `<base-ref>` → print `usage: node tools/check-ledger.mjs <base-ref> [ledger-path]` to stderr, exit 2.
- Read base: `execFileSync("git", ["show", `${ref}:${path}`], {encoding: "utf8"})`.
  If that throws (ref unresolvable, file absent at base — e.g. the
  all-zeros SHA on a branch-creation push): print
  `note: ledger missing at <ref>; treating base as empty` to stderr and
  use `[]` as `before` (append-from-nothing is legal; new-entry checks
  still run).
- Read working copy with `readFileSync(path, "utf8")`; JSON.parse both
  (parse failure → print `error: cannot parse <which>: <message>`,
  exit 2).
- Run `checkLedger`. Violations → one per line to stderr, exit 1.
  Clean → print `ledger OK (<after.length> entries, <after.length - before.length> new)`, exit 0.

### 1.2 `.github/workflows/kb-ledger.yml` (verbatim)

```yaml
name: kb-ledger
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Resolve base ref
        id: base
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            echo "ref=origin/${{ github.base_ref }}" >> "$GITHUB_OUTPUT"
          else
            echo "ref=${{ github.event.before }}" >> "$GITHUB_OUTPUT"
          fi
      - name: Check tag-ledger permanence
        run: node tools/check-ledger.mjs "${{ steps.base.outputs.ref }}"
```

No npm install, no browsers. The all-zeros `event.before` case is
absorbed by the script's missing-base note path.

### 1.3 `tests/ledger-check.spec.mjs`

Pure Node: `import { test, expect } from "@playwright/test";` and
`import { checkLedger } from "../tools/check-ledger.mjs";` — no `page`.
Build fixtures from a shared `base` array (deep-clone with
`structuredClone` before mutating):

```js
const base = [
  { tag: "0001", slug: "root-a", kind: "structural", parents: [], status: "active" },
  { tag: "0005", slug: "leaf-b", kind: "core", parents: ["0001"], status: "active" },
];
```

| Test name | Setup (after = clone of base, then…) | Exact assertion |
|---|---|---|
| LC-1 legal append | push `{tag:"0006", slug:"new-c", kind:"core", parents:["0005"], status:"active"}` | `checkLedger(base, after)` deep-equals `[]` |
| LC-2 illegal deletion | `after = base.slice(0, 1)` | violations deep-equal `["entry removed: 0005 (leaf-b)"]` |
| LC-3 illegal tag edit | `after[1].tag = "0007"` | violations deep-equal `["tag changed at index 1: 0005 → 0007"]` |
| LC-4 illegal parent edit | `after[1].parents = []` | violations deep-equal `["parents changed on 0005: [\"0001\"] → []"]` |
| LC-5 legal slug rename | `after[1].slug = "leaf-renamed"` | violations deep-equal `[]` |
| LC-6 legal split | append successors `{tag:"0006",…}`, `{tag:"0007",…}` (parents `["0001"]`, status active), then `after[1].status = "split"; after[1].successors = ["0006","0007"]` | violations deep-equal `[]` |
| LC-7 status flip without successors | `after[1].status = "split"` (no successors) | violations deep-equal `["status change on 0005 lacks successors"]` |
| LC-8 duplicate new tag | push new entry with `tag: "0005"` (fresh slug, parents `["0001"]`, active) | violations deep-equal `["duplicate tag 0005"]` |
| LC-9 illegal status transition | `after[1].status = "retired"` | violations deep-equal `["illegal status change on 0005: active → retired"]` |
| LC-10 bad new tag charset | push entry `tag: "00IL"` (parents `["0001"]`, active) | violations include `"new tag 00IL is not 4-char Crockford base-32"` |
| LC-11 split successor unknown | as LC-6 but successors `["0006","ZZZZ"]` with only `0006` appended | violations deep-equal `["successor ZZZZ of 0005 not in ledger"]` |
| LC-12 non-array input | `checkLedger({}, base)` | violations deep-equal `["ledger: base is not a JSON array"]` |

Also LC-13 real-ledger smoke: read `kb/tags.ledger.json` from disk
(READ only), `checkLedger(ledger, ledger)` is `[]`, and
`checkLedger([], ledger)` is `[]` (the whole ledger is a legal append
from empty). Derive nothing else from its content.

---

## Task 2 — placement diagnostic (files: `tools/kb-placement.mjs`, `tests/placement.spec.mjs`)

### 2.1 `tools/kb-placement.mjs`

Pure module, no DOM, no engine, no RNG. Imports NOTHING from `kb/`
directly — the caller passes the object returned by `loadKB()`.

Exports and exact algorithm:

```js
export function startPlacement(kb)            // → session
export function nextProbe(session)            // → Exercise | null
export function recordAnswer(session, exerciseId, correct) // → same session, updated
export function result(session)               // → { met: Set<tag>, frontier: Set<tag> }
```

Session object (plain, mutated in place and returned):

```js
{ kb, met: Set<tag>, unmet: Set<tag>, asked: Set<tag>, depth: Map<tag, number>, exercisable: string[] }
```

Construction (`startPlacement`):

1. `exercisable` = every non-structural concept tag that is the `focus`
   of at least one exercise with `role === "intro"`, sorted ascending
   by tag. (Invariant 12 says all non-structural concepts qualify, but
   derive it — never assume.)
2. `depth` = longest-path depth per concept tag:
   `depth(t) = 0` if `parents.length === 0`, else
   `1 + max(depth(p) for p of parents)`. Memoized recursion; the KB is
   a DAG by invariant 1, so this terminates.
3. `met`, `unmet`, `asked` start empty. `met` holds NON-STRUCTURAL tags
   only (structural tags are vacuously met by the KB itself; never add
   them).

`nextProbe(session)` — numbered rules:

1. Candidates = every `t` in `exercisable` such that
   `!met.has(t) && !unmet.has(t) && !asked.has(t)` and no member of
   `kb.ancestors(t)` is in `unmet` (a contradicted ancestor implies `t`
   is unmet; never probe it).
2. If no candidates → return `null` (converged).
3. Choose the candidate with maximal `depth`; ties broken by ascending
   tag order (candidates are already tag-sorted, so a single pass
   keeping the first strictly-deeper element implements this).
4. Return the intro exercise for that focus with the lexicographically
   smallest `id` (sort intros by `id`, take `[0]`).

`recordAnswer(session, exerciseId, correct)`:

1. Look up the exercise by id in `kb.exercises`; unknown id → throw
   `new Error("placement: unknown exercise " + exerciseId)`.
2. `f = exercise.focus`; `asked.add(f)`.
3. If `correct`: add `f` and every NON-structural member of
   `kb.ancestors(f)` to `met` (answering the deep question is evidence
   for the whole lineage). Never touch `unmet`.
4. If `!correct`: `unmet.add(f)`. Never subtract from `met` — an
   earlier correct answer already gave direct evidence for those tags,
   and one deep miss does not un-prove an ancestor.
5. Return `session`.

"Schedules its parents" from the prompt is emergent: once `f` is
contradicted, its descendants are filtered out by rule 1 and the
deepest remaining candidates are `f`'s ancestry and siblings — the
probe walks upward automatically. State this in a comment.

Convergence proof (put in the module comment): every probe adds its
focus to `asked`, candidates exclude `asked`, and `exercisable` is
finite — so `nextProbe` returns `null` after at most
`exercisable.length` probes. Determinism: no RNG anywhere; all
iteration orders are tag- or id-sorted.

`result(session)` → `{ met: new Set(session.met), frontier: session.kb.frontier(session.met) }`.

### 2.2 Worked example (current 20-node graph — for the module comment
and the plan reader; tests must NOT hard-code it)

Depths: 0005:1, 0006:2, 0007:3, 0008:2, 0009:3, 000A:3, 000B:4,
000C:4, 000D:3, 000E:4, 000F:5, 000G:4, 000H:5, 000P:3, 0021:4,
0023:6. Perfect student:

1. Deepest = `0023` → exercise `aug-assign-shared-list`. Correct →
   met += {0023, 000H, 0021, 000C, 000G, 000A, 000D, 0006, 0005}.
2. Remaining deepest = `000F` (d5) → `slot-assign`. Correct →
   met += {000F, 000E, 0007}.
3. Remaining deepest = `000B` (d4) → `accumulate-step`. Correct →
   met += {000B, 0009, 0008}.
4. Remaining = `000P` (d3) → `div-always-float`. Correct → met += {000P}.
5. `nextProbe` → null. 16 exercisable concepts placed in 4 questions.

All-wrong student: every probe fails, nothing is implied, so all 16
get probed once each (deepest-first, tag tie-break), met ends empty.

### 2.3 `tests/placement.spec.mjs`

Pure Node. `import { loadKB } from "../kb/index.mjs";` (READ-only
consumption of the narrow interface — this is sanctioned). Every
expectation derived from `loadKB()` at runtime; no concept counts, no
exercise-id lists, no ≤N constants. Helper used by every test:

```js
function run(kb, answers /* (exercise) => boolean */) {
  const s = startPlacement(kb);
  const sequence = [];
  for (let ex = nextProbe(s); ex; ex = nextProbe(s)) {
    sequence.push(ex.id);
    recordAnswer(s, ex.id, answers(ex));
  }
  return { s, sequence };
}
```

`exercisable(kb)` helper: set of non-structural tags with ≥1 intro.

| Test name | Setup | Assertion |
|---|---|---|
| P-1 perfect student converges fast | `run(kb, () => true)` | every tag in `exercisable(kb)` is in `result(s).met`; `sequence.length < exercisable(kb).size` (strictly fewer questions than concepts; guard `size > 1` holds for any real graph) |
| P-2 all-wrong student | `run(kb, () => false)` | `result(s).met.size === 0`; `sequence.length <= exercisable(kb).size` |
| P-3 knows exactly the names-share-list lineage | find `tag0` by slug `names-share-list`; `knows` = non-structural members of `kb.ancestors(tag0)`; `run(kb, ex => knows.has(ex.focus))` | `result(s).met` deep-equals `knows` (as sorted arrays) |
| P-4 determinism | run twice with the same mixed policy `ex => ex.focus.charCodeAt(3) % 2 === 0` | both `sequence` arrays deep-equal; both sorted `met` arrays deep-equal |
| P-5 no probe repeats / convergence | any run from P-4 | `sequence` ids map to focuses with no duplicate focus; loop terminated (implied by `run` returning) with `sequence.length <= exercisable(kb).size` |
| P-6 result frontier is the KB frontier | perfect-student session | sorted `[...result(s).frontier]` deep-equals sorted `[...kb.frontier(result(s).met)]`; for the perfect student it is empty |
| P-7 unknown exercise id throws | `recordAnswer(startPlacement(kb), "no-such-exercise", true)` | throws `/placement: unknown exercise/` |

If `names-share-list` is ever renamed, P-3 must fail loudly: assert the
slug lookup found a tag before using it
(`expect(tag0, "slug names-share-list missing").toBeTruthy()`).

---

## Task 3 — `design/lesson-kb-binding.md` (design note only, NO code)

Write ~120–150 lines, decision-first (state the decision, one-line
rationale, no option menus). Structure and the decisions to record:

1. **Heading + scope.** Binding guided-tutor lessons
   (`curriculum/u1-state-io.mjs`) to KB concepts. Code changes are
   main-session phase-4 work; this note is the spec.
2. **Authoring rule.** Lessons replace the dead `skills: [...]` string
   array with `concepts: [<4-char tags>]` at unit level, and each `ask`
   step MAY carry `focus: <tag>` naming the one concept that a correct
   answer evidences. The lesson linter (curriculum load-time lint)
   cross-checks: every unit `concepts` tag and every `focus` tag exists
   in `loadKB().concepts`, is non-structural, and every `focus` is
   listed in the unit's `concepts`.
3. **u1 mapping (the concrete table).** `skills` →
   `concepts: ["0006", "0009", "000A", "000B"]`
   (name-holds-value, evaluate-before-bind, rebind-updates-name,
   accumulate-rebind). Old strings: `state-model` and `read-trace` are
   interface/narrative skills with no KB witness — they map to nothing
   and are dropped (the structural roots already carry the narrative);
   `predict-output` is a form, not a concept; `input-boundary` has no
   phase-1 KB node — deferred until an input concept is minted (note it
   as a known gap, not a blocker). Ask-step mapping: the `b = a * 3`
   prediction gets `focus: "0009"`; the `total` accumulation prediction
   gets `focus: "000B"`.
4. **When a lesson marks a concept met.** Exactly the drill rule
   (design/knowledge-base-design.md §2.8): one correct
   `predict-output`-kind ask whose `focus` is the concept, graded
   exact-output, first attempt (answers after a revealed hint that
   states the output do not count — specify: credit only when the
   correct answer arrives before the final hint is shown). Watching a
   demo, scrubbing a trace, or a `say`/`pause` step never grants
   met-ness.
5. **One shared record store.** A single per-student map
   `tag → { met: true, at: <ms>, source: "lesson" | "drill" }` owned by
   the tutor runtime (localStorage-backed, same store the drill mode
   will use). Lessons and drills both write through one
   `grantMet(tag, source)` API; the KB itself stays storage-free
   (§7.3). Frontier queries (`kb.frontier(metSet)`) power the tutor
   menu: after a lesson, the menu can offer "Drill what you just
   learned" (intros whose focus is in `frontier(met)`) and "Continue
   where the lesson left off".
6. **Migration sketch for u1** (sized for main-session phase 4):
   swap `skills` → `concepts`, add the two `focus` tags, add the linter
   cross-check, add `grantMet` calls in the tutor runtime's
   answer-grading path.
7. **Test plan.** T-series additions: (a) lint rejects an unknown or
   structural `focus` tag; (b) completing u1's first ask correctly
   marks `0009` met in the store, and answering it wrong does not;
   (c) a demo-only walkthrough (no asks answered) grants nothing;
   (d) the met set feeds `kb.frontier` and the menu shows the
   continue entry. Assert via `window.plp`, per repo test convention.

---

## Task 4 — doc rows (do this LAST, after tasks 1–3 verify; may be done
by the Stage C session itself)

- `VALIDATION.md`: append (do not reflow) rows in the K-series area:
  - `Ledger permanence (CI)` — best evidence: `tests/ledger-check.spec.mjs` (LC-1…LC-13) + `.github/workflows/kb-ledger.yml` running `tools/check-ledger.mjs` against the PR base.
  - `Placement diagnostic` — best evidence: `tests/placement.spec.mjs` (P-1…P-7), pure-Node over `loadKB()`.
- `CLAUDE.md`: one additive bullet under Load-bearing invariants item 10
  (or immediately after the list — append, never reorganize): ledger
  permanence is CI-enforced by `.github/workflows/kb-ledger.yml` via
  `tools/check-ledger.mjs <base-ref>`; K-2's working-copy diff is the
  local approximation.

---

## Decisions made

- Violation messages use ` → ` and one-line-per-violation; tests pin
  them verbatim (the prompt demands exact formats).
- Slug rename legal; parents compare order-sensitive (JSON string
  equality) — reordering parents is treated as an edit.
- Missing base ledger at `<base-ref>` = empty base (append-from-nothing
  legal); unparseable JSON = exit 2 (infrastructure error, not a
  violation verdict).
- Placement: longest-path depth, deepest-first, tag-ascending
  tie-break, smallest-id intro; correct ⇒ lineage met; wrong ⇒ focus
  unmet only (never subtracts met); parents scheduled emergently.
- recordAnswer mutates and returns the same session (no immutability
  requirement anywhere downstream).
- u1 `state-model`/`read-trace`/`input-boundary` map to no KB tag —
  dropped or deferred, recorded in the note as such.
- Lesson met-credit requires the correct answer before the final hint
  (mirrors "not a lucky skip / shown answer" from §2.8).

## Open questions

(none)

## Execution notes

(agents append blockers/deviations here)
