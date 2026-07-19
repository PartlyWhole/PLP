# Memory model — as-built documentation

The memory pane ([memory.mjs](memory.mjs)) renders PyTrace step records as
two tables plus a step scrubber. It is presentation-only: records arrive
already validated by the engine's facade, are stored unmodified, and every
display decision below is a *view* choice that can be turned off.

## The two tables

**Names (frames)** — one section per scope, top to bottom:

1. `globals` (`__main__`, plus any `trace_modules`-allowlisted module),
2. each call-stack frame **root → active** (the innermost frame is marked
   `← active`; the `<module>` frame is skipped — it duplicates globals),
3. closure environments (`closure env N` with their cells).

Rows are `Name | Value`.

**Objects** — one row per displayed heap node: `Id | Type | Value`, where
Id is the engine's per-step uid (`obj N`), Type is `type_name`, and Value
renders the node's contents (items, entries, attributes, …).

## Value rendering (engine's closed vocabulary)

Immutable scalars render **inline**: `none`, `bool`, `int` (arbitrary
precision), `float` (incl. `Infinity`/`NaN`), `str` (quoted), `bytes`
(preview + length), `complex`, `range`, `slice`, `ellipsis`,
`not_implemented`. Unknown kinds render as raw JSON (forward safety).
`elided` values render as a visible `⟨elided: reason⟩` marker — never
hidden.

`ref` values render as **chips** (`obj N`) linking to the Objects row;
clicking a chip scrolls to and flashes the row. Identity is only
visualized where it has observable consequences (aliasing, mutation) —
scalars get no rows, so sharing of `3` is unobservable, exactly as in
Python.

**Core invariant (filters on or off): every rendered chip resolves to a
rendered row.**

## Display filters — the policy as toggleable constituents

What the Objects table shows is a *filter pipeline*, defined as flags in
`displayFilters` (exported from memory.mjs, exposed as
`window.plp.memory.filters`). Each constituent can be toggled in code;
after mutating flags call `plp.memory.refresh()`:

```js
plp.memory.filters.inlinePlainFunctions = false; // show every def as a row
plp.memory.refresh();
```

| flag (default) | effect when ON | rationale |
|---|---|---|
| `chipReachableOnly` (true) | Objects table shows only heap nodes reachable from a chip: Names-table roots (globals, frame locals, closure cells) closed over displayed contents (container items, dict keys/values, instance/class attributes, cell contents) | rows the learner cannot navigate to are noise; OFF shows the engine's full per-step heap |
| `inlineClassBases` (true) | class `bases` render by name in the class row (`class Puppy(Dog)`); unnameable builtin bases (the implicit `object`) are omitted | stops an opaque builtin row appearing in every class example; OFF renders bases as ordinary chips |
| `inlinePlainFunctions` (true) | function nodes with **no closure environment** render inline as *`function name`* wherever referenced (no chip, no row) | a bare `def` is not an interesting object for a learner tracing `z = add(x, y)`; closures keep chips + rows because their environment is the point |
| `inlineModules` (true) | module nodes render inline as *`module math`* wherever referenced (no chip, no row) | `import math` binds a name to a module object; true, but not the story the Objects table is telling |
| `dimOpaque` (true) | `opaque` nodes (builtins/imported objects the engine truthfully declines to inspect) render as dimmed rows | de-emphasized but **never hidden** — hiding would turn "truthfully not inspected" into "silently doesn't exist" |

Filtering happens at render time only; `plp.memory.steps()` always returns
the untouched records, and turning every flag off shows the engine's
unfiltered truth.

## Stepping and live rendering

- **Line-step mode** (default) and raw **engine-step mode** are documented
  in README "Stepping model": synthetic position 0, one position per
  executed line showing the state it *produced*, iteration collapsing,
  and the toggle. `goTo()`/`stepCount()` are position-space; `steps()` is
  raw.
- The editor's current-line highlight follows the selected position (for
  `__main__` locations); the console shows output reconstructed up to the
  position's state step.
- Live renders are throttled to **one per animation frame** showing the
  latest position — records arrive at thousands per second and per-record
  rendering freezes the tab. User scrubbing renders immediately and
  pauses follow; scrubbing to the end resumes it.

## Identity caveats (engine semantics)

Uids are stable only while an object stays observed across consecutive
snapshots; never compare uids, frame ids, environment ids, or unordered
set order across runs. Sets containing refs are `unordered` — don't diff
their order even within a run.

## Validation

VALIDATION.md M-series (tables/policy) and P-series (stepping); automated
coverage in `tests/smoke.spec.mjs` (display policy, inline functions with
filter toggle, line-step grouping/produced-state, dangling-chip sweeps).
