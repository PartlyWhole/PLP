# Memory model - as-built documentation

The memory pane ([memory.mjs](memory.mjs)) renders PyTrace step records as a
visual binding canvas plus a step scrubber. It is presentation-only: records
arrive already validated by the engine facade, are stored unmodified, and
every display decision below is a view choice that can be turned off.

## Visual grammar

**Boxes are names.** Scope cards appear top to bottom:

1. `globals` (`__main__`, plus any `trace_modules`-allowlisted module),
2. each call-stack frame root to active (the active frame is marked; the
   `<module>` frame is skipped because it duplicates globals),
3. closure environments (`closure env N` with their cells).

**Pills are data.** Immutable values stay paired directly with their name box
as typed pills such as `int · 3`, because the trace does not assign them stable
ids. Identity-bearing heap objects appear in a "Data In Memory" list as single
`data<sub>N</sub> : type · description` pills and expand in place to show items,
entries, or attributes.

**data<sub>N</sub> handles expose identity.** A name bound to a heap object is paired with
a compact `data<sub>N</sub>` reference pill. Its canonical Data In Memory pill
adds `: type · description`. Hovering either reference pill or the canonical data pill reveals incoming
references: solid arrows from names and dashed arrows from containing objects.
This lets an object with no direct name binding still show that it is held by a
list, dictionary, instance, or other object. Clicking a binding reference
scrolls its canonical Data In Memory pill to the same vertical level without
reordering data; short, non-overflowing lists do not scroll. Clicking a
canonical Data In Memory pill moves it to the top and toggles its details.

Every displayed heap object has exactly one pill, so two names bound to the same
mutable object show the same id. Reassignment changes the paired id; mutation
changes the existing data pill contents.

## Value rendering

Immutable scalars render as complete typed value pills: `none`, `bool`, `int`
(arbitrary precision), `float` (including `Infinity`/`NaN`), `str` (quoted),
`bytes` (preview + length), `complex`, `range`, `slice`, `ellipsis`, and
`not_implemented`. Unknown kinds render as raw JSON for forward safety.
`elided` values render as visible `⟨elided: reason⟩` markers and are never
hidden.

`ref` values become data-id targets. References inside an expanded object show
the target data<sub>N</sub> and surface the existing data pill instead of duplicating it. Identity
is only visualized where it has observable consequences such as aliasing and
mutation; scalar pills do not expose identity.

**Core invariant, filters on or off: every rendered data target resolves to
exactly one rendered data pill.**

## Display filters

The values region uses a filter pipeline defined by `displayFilters` in
[memory.mjs](memory.mjs), exposed as `window.plp.memory.filters`. Mutate a flag
and call `plp.memory.refresh()`:

```js
plp.memory.filters.inlinePlainFunctions = false; // show every def as a data pill
plp.memory.refresh();
```

| flag (default) | effect when ON | rationale |
|---|---|---|
| `chipReachableOnly` (true) | Shows only heap nodes reachable from visible name boxes through displayed contents | Unreachable objects are noise; OFF shows the full per-step heap |
| `inlineClassBases` (true) | Class bases render by name in the class pill (`class Puppy(Dog)`); the implicit builtin `object` is omitted | Avoids an opaque builtin pill in every class example |
| `inlinePlainFunctions` (true) | Plain functions render as value pills instead of identity-bearing data pills | A bare `def` is usually not the state story; closures keep data pills because their environment matters |
| `inlineModules` (true) | Modules render as value pills such as *`module math`* | Imports remain available without dominating the object graph |
| `hideModuleBindings` (true) | Module name boxes are omitted | Turn OFF when teaching that imports bind names |
| `hideFunctionBindings` (true) | Plain-function name boxes are omitted; called functions still appear as scope cards | Turn OFF when teaching that `def` binds a name |
| `dimOpaque` (true) | Opaque nodes render as dimmed pills | De-emphasized but never hidden; hiding would turn "not inspected" into "doesn't exist" |

Hidden bindings do not seed reachability. Filtering happens only during
rendering; `plp.memory.steps()` always returns untouched records, and turning
every flag off shows the engine's unfiltered truth.

## Stepping and live rendering

- Line-step mode (default) and raw engine-step mode are documented in README
  "Stepping model": synthetic position 0, one position per executed line
  showing the state it produced, iteration collapsing, and the toggle.
  `goTo()`/`stepCount()` use position space; `steps()` always returns raw steps.
- The editor current-line highlight follows the selected position for
  `__main__` locations. The console reconstructs output through that state.
- Hovering a name box highlights every scoped whole-word text match in the
  editor, including matches inside strings and comments. Hover events include
  active enter/leave phases.
- Live renders are throttled to one per animation frame. User scrubbing renders
  immediately and pauses follow; scrubbing to the end resumes it.
- Reference paths are a derived SVG overlay shown only while an id or data pill is
  hovered. Resizing, reordering, or expanding an object redraws paths without
  changing the underlying memory snapshot.

## Identity caveats

Uids are stable only while an object stays observed across consecutive
snapshots. Never compare uids, frame ids, environment ids, or unordered set
order across runs. Sets containing refs are `unordered`; do not diff their
order even within a run.

## Validation

VALIDATION.md M-series covers the visual grammar and display policy; P-series
covers stepping. Automated coverage in `tests/smoke.spec.mjs` includes binding
identity, expansion, reachability, filter toggles, hover behavior, and line-step
produced-state semantics.
