# PLP — Python Learning Platform

A minimal, build-free static site that runs Python in the browser (Pyodide via
the PyTrace engine) with:

- **Code editor** (left, CodeMirror 5)
- **Memory model** (right): a Names table (globals + call-stack frames) and an
  Objects table (heap: id, type, contents), updating live while the program
  runs, with a step scrubber to replay execution
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

Both modes scrub the same in-memory record array; `window.plp.memory.goTo()`
and `stepCount()` operate in the current mode's position space, while
`steps()` always returns raw engine steps.

Console internals are documented in [app/CONSOLE.md](app/CONSOLE.md);
repo-wide architecture and invariants in [CLAUDE.md](CLAUDE.md).

## Memory model display rules

The engine (PyTrace) reports every reachable object per step, bounded by
budgets; the UI applies a learner-oriented display policy on top. The
policy is implemented as **individually toggleable filters**
(`plp.memory.filters` + `plp.memory.refresh()`; see
[app/MEMORY.md](app/MEMORY.md) for the full as-built documentation):

1. **Immutable scalars render inline** (int, str, bool, None, float, bytes,
   …) in the Names table and inside object contents. Identity is only
   visualized where identity has observable consequences (aliasing and
   mutation), so scalars get no `obj N` rows.
2. **Everything with meaningful identity gets an Objects row**: lists,
   tuples, sets, dicts, instances, classes, functions, generators, cells.
   References render as `obj N` chips that flash/scroll the target row.
3. **The Objects table shows only chip-reachable objects**: nodes reachable
   from the Names table (globals, frame locals, closure cells) by following
   refs through displayed contents. Invariant: every rendered chip resolves
   to a rendered row, and every rendered row is reachable from a name.
4. **Class bases render inline by name, not as chips** (e.g.
   `class Puppy(Dog)`); unnameable builtin bases (the implicit `object`) are
   omitted. This keeps the ubiquitous opaque `object` base from cluttering
   every class example, without breaking rule 3 — real user superclasses
   still appear because names reference them.
5. **Bare `def` and `import` add nothing** (`inlinePlainFunctions`,
   `inlineModules`, `hideFunctionBindings`, `hideModuleBindings`): a
   plain function or module binding produces no Names row and no Objects
   row — plumbing, not state. Called functions still appear as frame
   labels; closures always keep their bindings, chips, and rows. Toggle
   the `hide*Bindings` flags off to teach that `def`/`import` bind names
   like any assignment (values then render inline: *`function add`*,
   *`module math`*).
6. **Truth markers are never hidden.** Objects the engine truthfully
   declines to inspect (`opaque` — builtins, imported objects, file handles)
   still appear when a learner's own data reaches them, as dimmed rows;
   `elided` markers (budget truncation) always render. Hiding them would
   turn "not inspected" into "doesn't exist".

Rules 3–6 are the `displayFilters` flags in [app/memory.mjs](app/memory.mjs);
rules 1–2 follow the engine's value encoding.

## Generative questions (pilot)

The **Quiz** button (memory pane) opens a pilot panel of questions
generated from the current program and its trace: predict the memory after
the next line (or across a span) with changed values blanked; arrange
shuffled code lines; write the structural lines vs the detail lines; fill
in a call's arguments. Memory questions are graded against what the
program actually did. Engine and extension points:
[app/QUESTIONS.md](app/QUESTIONS.md).

## Guided lessons (director)

The **Lesson** button starts a guided, game-tutorial-style walkthrough:
the app gates itself down to one meaningful action per step, spotlights
it, and advances only on your own real actions (running, hovering,
scrubbing, answering) — with quiet behavior-triggered hints, on-demand
"why?" explanations, and struggle-aware branching. Lessons are
human-authored data over an implemented grammar; authoring manual:
[app/DIRECTOR.md](app/DIRECTOR.md). The shipped lesson is a
grammar-validation placeholder.

## Live collaboration

Click **Share session** to get an invite link (`#room=…`). Peers who open
it share:

- the **code editor** (character-level merging — concurrent edits both
  survive),
- every **run**: whoever presses Run becomes the driver; everyone else's
  memory model and console replay the identical run live, including
  `input()` prompts and answers. Late joiners replay finished runs in
  full. While a run streams, other peers' Run is disabled.
- the **step scrubber**: scrubbing steps everyone who's following; a peer
  who scrubs on their own detaches, and scrubbing back to the end
  re-attaches.

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
