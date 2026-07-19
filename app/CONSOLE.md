# Console — as-built documentation

The console pane ([console.mjs](console.mjs)) is a terminal emulator
(vendored xterm.js 6.0.0, `vendor/xterm/`) that renders program I/O for
PyTrace runs and hosts inline `input()` interaction.

## Architecture: store is truth, terminal is a view

The module keeps a **chunk store** — an in-memory array of
`{ stream, text }` in arrival order — and treats the xterm screen as a
deterministic projection of it:

- `append(stream, text)` pushes to the store and (when live) writes to the
  terminal with per-stream styling.
- Scrubbing (`showUpTo(steps, index)`) does `term.reset()` and replays a
  prefix: the engine deltas of steps `0..index` (or the full store when the
  scrub position is the live end). Replaying the same chunks always yields
  the same buffer (VALIDATION X0b).
- `text()` (transcript) and `engineText()` (engine streams only) derive
  from the store, never from the screen (X0a).

### Streams

| stream | source | styling |
|---|---|---|
| `stdout` | engine `stdout_delta` | default |
| `stderr` | engine `stderr_delta` | bright red (SGR 91) |
| `echo` | locally echoed accepted input lines (live mode) | default |
| `sys` | UI system lines (run boundaries, notices) | dim (SGR 2); excluded from `text()` |

Terminal config: `convertEol: true` (engine deltas use `\n`; a lone `\r`
passes through so carriage-return overwrites work), scrollback 5 000,
site-matched theme. ANSI escape sequences in program output are interpreted
by xterm (colors, cursor movement, clearing).

## Input subsystem

The engine emits the prompt to stdout, then blocks until
`session.provideInput(line)` (isolated pages only; see degraded mode
below). On the `input` step the runner calls `showInput()`: the console
enters **line mode** and focuses the terminal.

Line discipline (`term.onData`):

| key | behavior |
|---|---|
| printable / paste | appended to the line buffer and locally echoed; pastes are truncated at the first newline; control chars stripped; UTF-8 byte length capped at `maxInputLineBytes` (default 65 536, the engine's `max_input_line_bytes`) with a dim notice |
| Backspace | end-of-line editing (`\b \b`) |
| Enter | submit (see echo contract) |
| ↑ / ↓ | history recall / forward (session-lifetime, in-memory) |
| Ctrl+C | `onInterrupt()` — any time, not just while waiting |
| Ctrl+D | dim notice "EOF is not supported here" — the trace-engine/1 wire contract has **no EOF representation**; `EOFError` cannot be produced |
| other escape sequences | ignored |

### Echo contract (exactly-once, single path)

- **Live (isolated) mode**: the runner sets `echo_stdin: false` on every
  run. Typed characters are only an erasable *preview*; on Enter the
  preview is erased and the line is submitted via `onInput`. The **only**
  place an accepted line enters the transcript is
  `runner.provideInput(line)`, which appends an `echo` chunk after the
  engine accepts the line. Programmatic input (`plp.provideInput`) and
  keyboard input therefore produce identical transcripts.
- **Degraded (non-isolated) mode**: no live input exists; `echo_stdin`
  stays `true` and the engine echoes consumed pre-supplied lines itself.
- If `provideInput` throws (stale/unsolicited), the console prints a dim
  rejection notice and returns to line mode with the typed line restored.

## Public API (`createConsole({ root, onInput, onInterrupt, maxInputLineBytes })`)

| member | contract |
|---|---|
| `reset()` | clears store + screen + input state (run start) |
| `append(stream, text)` | store + live write |
| `system(text)` | dim line, guaranteed to start at column 0 |
| `showUpTo(steps, index)` | scrub view; `index < 0` = "before the program runs"; live end restores full replay |
| `showInput()` / `hideInput()` | enter/leave line mode |
| `fit()` | refit to container (called on gutter drag, maximize, window resize) |
| `text()` | transcript: stdout + stderr + echo |
| `engineText()` | stdout + stderr only — comparable to stream-check reconstruction |
| `buffer()` | screen text via xterm buffer API (tests; trailing blank lines trimmed) |
| `isWaiting()` | line-mode flag (tests wait on this) |
| `term` | raw xterm instance (cell attributes, cols/rows — test/debug only) |

**Async caveat**: `term.write` is asynchronous; after triggering a replay,
read `buffer()` under a poll (see `tests/emulator.spec.mjs`).

## Deliberate limitations (truthfulness)

- No EOF (protocol), no catchable `KeyboardInterrupt` (engine re-raises
  interrupts past user handlers) — both are engine-level, documented in
  the plan and VALIDATION.
- Python still sees `isatty() == False` and no terminal size; the emulator
  is presentation-only and advertises nothing to the program.
- Scrollback is capped at 5 000 lines on screen; the store keeps the full
  transcript (`text()` is never truncated).

## Validation

VALIDATION.md X-series; automated in [tests/emulator.spec.mjs](../tests/emulator.spec.mjs)
(X0a/X0b determinism, `\r` overwrite, SGR cell attributes, echo-exactly-once,
typing/editing, Ctrl+C interrupt, flood/scrollback, fit, self-containment).
