# PLP — Python Learning Platform

A minimal, build-free static site that runs Python in the browser (Pyodide via
the PyTrace engine) with:

- **Code editor** (left, CodeMirror 5), automatically saved in this browser
- **Memory model** (right): scoped name boxes paired with values or data ids,
  plus a compact expandable Data In Memory list and contextual reference arrows,
  updating live with a step scrubber to replay execution
- **Console** (bottom): a real terminal emulator (vendored xterm.js 6):
  interleaved stdout/stderr, ANSI colors, `\r` progress bars, inline
  `input()` typed at the prompt with history and Backspace editing, Ctrl+C
  to interrupt (Ctrl+D shows a truthful "EOF unsupported" notice — the
  engine's wire contract has no EOF)
- All panes drag-resizable and maximizable

## Run locally

```sh
node tools/dev-server.mjs          # http://127.0.0.1:8619/PLP/  (GitHub Pages simulation, COI via service worker)
node tools/dev-server.mjs --coi    # same, with real COOP/COEP headers
```

The site must be served under the `/PLP/` prefix (the dev server does this) —
it deploys as a GitHub Pages *project* site.

`?nonisolated` on the URL demonstrates degraded mode (no live input; runs that
ask for input end `needs_input`; Stop hard-kills).

## Test

```sh
npm install
npx playwright test        # add PW_ALL_BROWSERS=1 for firefox+webkit
```

Tests drive the app through the `window.plp` debug API.

## Run vs Trace

Two ways to execute, and the difference is whether the memory model is
being filled:

- **Run** — full speed, no tracing. Always finishes, however large the
  program. Real output, working `input()`, working Stop; the memory model
  stays empty because nothing was recorded.
- **Trace** — records every executed line to drive the memory model, so
  you can scrub through execution. Tracing costs a step record per line
  and the engine stops at `max_steps` (1000 by default), so on a large
  program Trace keeps the first 1000 steps, says so, and points you at
  Run for the whole thing. (`plp.runner.setAutoFallback(true)` makes it
  re-run untraced automatically instead.)

In a shared session both are replicated: a traced run replays as records
(memory model included), an untraced run replays as its console output.

## Stepping model

The scrubber has two granularities (toggle in the memory pane; **line steps**
is the default):

- **Line steps** — position 0 is a synthetic **start anchor** ("before the
  program runs": empty tables, no output, no highlight), then one position
  per *executed source line*: consecutive
  engine steps on the same (module, function, line) collapse into one
  position (a 3-iteration comprehension is one position, labeled with its
  collapsed engine-step count). The highlighted line and the displayed
  memory agree causally: position "line N" highlights line N and shows the
  state that line **produced** (technically: the next group's boundary
  snapshot; the final position shows the last snapshot). This avoids the
  raw stream's learner-hostile artifacts — duplicate-looking start steps,
  and the off-by-one where line N is highlighted while the memory still
  shows the state from *before* it ran.
- **Engine steps** — every raw trace event (`call`/`line`/`return`/`yield`/
  `exception`/…), with the engine's own semantics: a snapshot is taken
  *before* the event's line executes. Useful for seeing calls/returns and
  per-iteration evaluation explicitly.

**Trace rests at the beginning.** A finished trace parks on position 0 —
the start anchor — so you step *forward* through the program rather than
landing on its last step and dragging back. The console keeps showing the
run that just happened; it only reconstructs partial output once you
actually scrub.

Both modes scrub the same in-memory record array; `window.plp.memory.goTo()`
and `stepCount()` operate in the current mode's position space, while
`steps()` always returns raw engine steps.

Console internals are documented in [app/CONSOLE.md](app/CONSOLE.md);
repo-wide architecture and invariants in [CLAUDE.md](CLAUDE.md).
New to the codebase? Start with [ONBOARDING.md](ONBOARDING.md).

## Memory model display rules

The engine (PyTrace) reports every reachable object per step, bounded by
budgets; the UI applies a learner-oriented display policy on top. The
policy is implemented as **individually toggleable filters**
(`plp.memory.filters` + `plp.memory.refresh()`; see
[app/MEMORY.md](app/MEMORY.md) for the full as-built documentation):

Hovering a name box highlights every scoped whole-word
text match in the editor, including matches inside strings and comments.

1. **Boxes are variable names; pills are data.** Immutable values stay paired
   directly with their name as typed pills such as `int · 3`. A heap-object
   binding uses a compact data<sub>N</sub> reference pill; its canonical Data In
   Memory entry adds `: type · description`.
2. **Everything with meaningful identity gets one expandable data pill** in
   the Data In Memory list, formatted as `data<sub>N</sub> : type · description`:
   lists, tuples, sets, dicts, instances, generators, and cells, plus advanced
   objects when their teaching filters expose them. Two names bound to the
   same object show the same id. Hovering an id or data pill reveals solid
   arrows from bound names and dashed arrows from
   containing objects. Clicking a binding pill scrolls its canonical data pill
   to the same vertical level without reordering the list. Short lists do not
   scroll. Clicking the canonical pill moves it to the top and toggles its
   details.
3. **Only name-reachable objects appear**: nodes reachable from visible globals,
   frame locals, and closure cells by following refs through displayed
   contents. Every rendered data target resolves to exactly one pill.
4. **Class-valued bindings are hidden by default** (`hideClassBindings`): instances
   already show their class name and attributes, so a bare `class Dog` adds no
   name box or class pill. Python-generated class-body names such as
   `__module__`, `__qualname__`, and `__firstlineno__` are hidden by the same
   filter. Turn the filter off when teaching that `class` binds a first-class
   object. In that advanced view, bases render inline by name (for example,
   `class Puppy(Dog)`) and the implicit builtin `object` is omitted.
5. **Bare `def` and `import` add nothing** (`inlinePlainFunctions`,
   `inlineModules`, `hideFunctionBindings`, `hideModuleBindings`): a
   plain function or module binding produces no name box or data pill.
   Called functions still appear as scope labels; closures keep their
   bindings and identity-bearing pills. Toggle
   the `hide*Bindings` flags off to teach that `def`/`import` bind names
   like any assignment (values then render as pills: *`function add`*,
   *`module math`*).
6. **Truth markers are never hidden.** Objects the engine truthfully
   declines to inspect (`opaque`: builtins, imported objects, file handles)
   still appear when a learner's own data reaches them, as dimmed pills;
   `elided` markers (budget truncation) always render. Hiding them would
   turn "not inspected" into "doesn't exist".

Rules 3–6 are the `displayFilters` flags in [app/memory.mjs](app/memory.mjs);
rules 1–2 follow the engine's value encoding.

## Generative questions (dormant pilot)

The question pilot is currently deprecated while the learner UI is redesigned.
No Quiz control appears in the learner-facing application. The preserved engine
and programmatic panel can build memory from a blank or partial state, update a
complete state after one or more lines, create nested data, bind variable names
to data, and construct a supported expression's evaluation sequence. Graph
grading checks values, bindings, contents, and aliasing without requiring
particular data-id numbers. See
[app/CONSTRUCTION.md](app/CONSTRUCTION.md) and
[app/QUESTIONS.md](app/QUESTIONS.md).

## Director prototype (dormant)

The lesson product surface is currently deprecated while the core learner UI
is redesigned. The tested Director, Stage, tutor, and reference lesson remain
in the repository as experimental infrastructure, but no lesson data loads and
no Lesson control appears in the learner-facing application. See
[app/DIRECTOR.md](app/DIRECTOR.md) for the preserved grammar.

## Live collaboration

Click **Share session** to get an invite link (`#room=…`). Peers who open
it share:

- the **code editor** (character-level merging, plus colored peer selections
  and carets). A peer's anonymous name appears briefly when they move, then
  disappears while their caret or selection remains,
- every **run**: whoever presses Run becomes the driver; everyone else's
  memory model and console replay the identical run live, including
  `input()` prompts and answers. Late joiners replay finished runs in
  full. While a run streams, other peers' Run is disabled.
- the **step scrubber**: scrubbing steps everyone who's following; a peer
  who scrubs on their own detaches, and scrubbing back to the end
  re-attaches.

The current editor buffer is also saved locally after every change, including
changes received from a collaborator. **Leave** removes the room connection
and invite hash, but keeps the code. Closing and later reopening PLP in the
same browser restores the last buffer.

Rooms ride three free transports at once (whichever works carries the
room): the public Automerge sync relay, direct WebRTC between browsers
(signaling via public Nostr relays), and BroadcastChannel for same-browser
tabs. `?transports=ws,p2p,tabs` narrows the set; the choice travels in the
link as `&via=`. **The link is the only access control** — anyone who has
it can read and write the room, permanently. Details:
[app/COLLAB.md](app/COLLAB.md).

## Notes

- Console internals: the raw output chunk store is the source of truth and
  the terminal is a deterministic replay view (scrubbing replays a prefix).
  In live-input mode the engine's `echo_stdin` is disabled and the accepted
  line is echoed locally through a single path (`runner.provideInput`) —
  exactly one echo in both live and degraded modes.
- Vendored runtime (`vendor/`): Pyodide 314.0.2, PyTrace engine 0.1.0,
  CodeMirror 5.65.21, xterm.js 6.0.0 + fit addon (MIT) — see
  `vendor/PROVENANCE.md` and `vendor/PATCHES.md` (one deliberate divergence:
  `pytrace/browser/worker.mjs` resolves Pyodide relative to itself so the
  site works from a project sub-path).
- First run downloads ~12 MB of runtime; subsequent runs are instant.
- `.nojekyll` is required (GitHub Pages/Jekyll would drop files otherwise).
