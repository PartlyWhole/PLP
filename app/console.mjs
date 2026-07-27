// Terminal-emulator console (xterm.js): interleaved stdout/stderr with full
// control-sequence handling (\r overwrites, ANSI colors, cursor movement),
// inline input typed at the prompt with local echo + history, Ctrl+C
// interrupt, and a truthful Ctrl+D "EOF unsupported" notice.
//
// Architectural invariants (VALIDATION.md X0a/X0b):
//  - The chunk store (raw engine deltas + system lines) is the source of
//    truth; the terminal is a VIEW. text() derives from the store, never
//    from the screen.
//  - Rendering is deterministic replay: reset() + rewriting the same chunks
//    yields the same buffer. Scrubbing replays a prefix of the store.
//
// Echo contract: in live-input mode the runner disables the engine's
// echo_stdin and this module echoes keystrokes locally — exactly one echo.
// In degraded (pre-supplied stdin) mode the engine keeps echoing and no
// local typing exists.

import { Terminal } from "../vendor/xterm/xterm.mjs";
import { FitAddon } from "../vendor/xterm/addon-fit.mjs";

const SGR = {
  stderr: ["\x1b[91m", "\x1b[0m"],
  sys: ["\x1b[2m", "\x1b[0m"],
  stdout: ["", ""],
  echo: ["", ""], // locally echoed input lines (live mode; engine echo off)
};

export function createConsole({ root, onInput, onInterrupt, maxInputLineBytes = 65536 }) {
  const host = root.querySelector("[data-role=console-term]");
  const term = new Terminal({
    convertEol: true, // engine deltas use \n; lone \r (overwrites) passes through
    scrollback: 5000,
    fontSize: 14,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    cursorBlink: true,
    theme: {
      background: "#0d0f12",
      foreground: "#d6dae3",
      cursor: "#4f8ff7",
      selectionBackground: "#24457c",
    },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(host);
  fit();

  // Full transcript stays in memory; the terminal renders it.
  let chunks = []; // { stream: "stdout"|"stderr"|"sys", text }
  let scrubbed = false; // true while showing a reconstructed (≤ step) view
  let atLineStart = true; // last written store chunk ended in a newline

  function writeStyled(stream, text) {
    const [pre, post] = SGR[stream] ?? SGR.stdout;
    term.write(pre + text + post);
  }

  function append(stream, text) {
    if (!text) return;
    chunks.push({ stream, text });
    atLineStart = text.endsWith("\n");
    if (!scrubbed) writeStyled(stream, text);
  }

  function system(text) {
    const line = (atLineStart ? "" : "\n") + text + (text.endsWith("\n") ? "" : "\n");
    append("sys", line);
  }

  function replay(list) {
    term.reset();
    for (const c of list) writeStyled(c.stream, c.text);
  }

  // Reconstructed view for step scrubbing: program output (and system
  // lines) up to and including steps[index]'s deltas.
  function showUpTo(steps, index) {
    scrubbed = index < steps.length - 1;
    if (!scrubbed) { replay(chunks); return; }
    term.reset();
    if (index < 0) { // synthetic "before the program runs" position
      writeStyled("sys", "⟨before the program runs — no output yet⟩\n");
      return;
    }
    writeStyled("sys", `⟨output up to step ${index + 1} — move the slider to the end to return to live view⟩\n`);
    for (let j = 0; j <= index && j < steps.length; j++) {
      const o = steps[j].output;
      if (o?.stdout_delta) writeStyled("stdout", o.stdout_delta);
      if (o?.stderr_delta) writeStyled("stderr", o.stderr_delta);
    }
  }

  // ---- inline input discipline (engine echo disabled in live mode) -------
  const encoder = new TextEncoder();
  let waiting = false;
  let lineBuf = "";
  const history = [];
  let histPos = -1; // -1 = editing a fresh line

  function eraseCurrentLine() {
    term.write("\b \b".repeat(lineBuf.length));
  }

  function setLine(text) {
    eraseCurrentLine();
    lineBuf = text;
    term.write(lineBuf);
  }

  function submit() {
    const line = lineBuf;
    // Typed characters are a PREVIEW only — erase them; the accepted line
    // re-enters through the runner's provideInput, which appends the
    // canonical "echo" chunk to the store (single echo path shared with
    // programmatic input; keeps replay/X0b consistent).
    eraseCurrentLine();
    lineBuf = "";
    waiting = false;
    histPos = -1;
    if (line) history.push(line);
    try {
      onInput(line);
    } catch (err) {
      system(`input rejected: ${err.message ?? err}`);
      waiting = true; // engine is still waiting; let the user retry
      lineBuf = line;
      term.write(line);
    }
  }

  term.onData((data) => {
    if (data === "\x03") { onInterrupt?.(); return; } // Ctrl+C, any time
    if (!waiting) return;
    if (data === "\r") { submit(); return; }
    if (data === "\x7f" || data === "\b") { // Backspace (end-of-line editing)
      if (lineBuf) { lineBuf = lineBuf.slice(0, -1); term.write("\b \b"); }
      return;
    }
    if (data === "\x04") { // Ctrl+D: EOF has no representation in the wire contract
      system("⟨EOF (Ctrl+D) is not supported here — the program is still waiting for a line⟩");
      return;
    }
    if (data === "\x1b[A") { // history up
      if (!history.length) return;
      histPos = histPos === -1 ? history.length - 1 : Math.max(0, histPos - 1);
      setLine(history[histPos]);
      return;
    }
    if (data === "\x1b[B") { // history down
      if (histPos === -1) return;
      histPos += 1;
      if (histPos >= history.length) { histPos = -1; setLine(""); }
      else setLine(history[histPos]);
      return;
    }
    if (data.startsWith("\x1b")) return; // other control sequences: ignore
    // Printable input (typed or pasted). Keep the first line of a paste.
    const text = data.split(/[\r\n]/, 1)[0].replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
    if (!text) return;
    const candidate = lineBuf + text;
    if (encoder.encode(candidate).byteLength > maxInputLineBytes) {
      system(`⟨input line limit reached (${maxInputLineBytes} bytes)⟩`);
      return;
    }
    lineBuf = candidate;
    term.write(text); // local echo
  });

  // Stage gate (console-input capability): when non-interactive, input()
  // waits show the prompt but line mode never engages (the director can
  // still leave Stop/interrupt available as the escape).
  let interactive = true;

  function showInput() {
    if (!interactive) return;
    waiting = true;
    lineBuf = "";
    histPos = -1;
    term.focus();
  }

  function hideInput() {
    if (waiting && lineBuf) eraseCurrentLine();
    waiting = false;
    lineBuf = "";
  }

  function fit() {
    try { fitAddon.fit(); } catch { /* container not laid out yet */ }
  }

  return {
    reset() {
      chunks = [];
      scrubbed = false;
      hideInput();
      term.reset();
    },
    append,
    system,
    showUpTo,
    showInput,
    hideInput,
    fit,
    // Source-of-truth transcript (program output + echoed input, no system
    // lines). engineText() is exactly the engine's streams, for comparison
    // with the stream-check reconstruction.
    text: () => chunks.filter((c) => c.stream !== "sys").map((c) => c.text).join(""),
    engineText: () => chunks.filter((c) => c.stream === "stdout" || c.stream === "stderr").map((c) => c.text).join(""),
    // Screen-buffer text for tests (trailing blank lines trimmed).
    buffer() {
      const buf = term.buffer.active;
      const lines = [];
      for (let y = 0; y < buf.length; y++) lines.push(buf.getLine(y)?.translateToString(true) ?? "");
      return lines.join("\n").replace(/\n+$/, "");
    },
    isWaiting: () => waiting,
    setInteractive(v) { interactive = Boolean(v); if (!interactive) hideInput(); },
    isInteractive: () => interactive,
    term, // debug/test access (cell attributes, cols/rows)
  };
}
