// Untraced execution worker: plain Pyodide, no trace hooks, no step limits.
//
// This is the "large program" path. PyTrace always traces (its 14 options
// have no off switch) and stops at max_steps, so a program that executes
// more than a few thousand lines can never finish there. Here the same
// vendored Pyodide runs the program directly: full speed, no records, no
// memory model.
//
// Parity with the traced path where it matters:
//   - stdout/stderr stream out incrementally (batched to avoid a
//     postMessage storm on flood-output programs)
//   - input() blocks on a SharedArrayBuffer rendezvous, exactly like
//     PyTrace's worker (needs crossOriginIsolated; degraded mode gets EOF)
//   - Stop works via Pyodide's interrupt buffer (SIGINT -> KeyboardInterrupt)

import { loadPyodide } from "../vendor/pyodide/pyodide.mjs";

// stdin rendezvous protocol (header ints): [0] state, [1] byte length.
const IDLE = 0, WAITING = 1, READY = 2, CANCELLED = 3;
const HEADER_INTS = 2;

let pyodide = null;
let stdinHeader = null;   // Int32Array view over the shared header
let stdinBytes = null;    // Uint8Array view over the shared data area
let interruptView = null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---- output batching -------------------------------------------------------
// A flood program can write thousands of times per second, so one
// postMessage per write would swamp the main thread — but the flush CANNOT
// be driven by a timer: running Python blocks this worker's event loop, so
// during `while True: print(...)` no setTimeout callback ever fires and the
// console would stay blank until the program ended. Flushes are therefore
// driven by the writes themselves (size or elapsed time, both checked
// inline), with a timer only as a backstop for a trailing partial write
// before a long silent computation.
const FLUSH_BYTES = 8 * 1024;
const FLUSH_MS = 30;
let pending = { stdout: "", stderr: "" };
let flushTimer = null;
let lastFlush = 0;

function flushOutput() {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  lastFlush = performance.now();
  for (const stream of ["stdout", "stderr"]) {
    if (pending[stream]) {
      self.postMessage({ type: "out", stream, text: pending[stream] });
      pending[stream] = "";
    }
  }
}

function write(stream, text) {
  if (!text) return;
  pending[stream] += text;
  const now = performance.now();
  if (pending.stdout.length + pending.stderr.length >= FLUSH_BYTES || now - lastFlush >= FLUSH_MS) {
    flushOutput();
    return;
  }
  if (flushTimer === null) flushTimer = setTimeout(flushOutput, FLUSH_MS);
}

// ---- blocking stdin --------------------------------------------------------
function readLine(prompt) {
  if (!stdinHeader || !stdinBytes) {
    // Degraded (non-isolated) mode: no SharedArrayBuffer, so a worker
    // cannot block for input. Report EOF, which surfaces to Python as
    // EOFError — truthful rather than hanging forever.
    self.postMessage({ type: "input-unavailable", prompt });
    return null;
  }
  flushOutput(); // the prompt must be on screen before we block
  Atomics.store(stdinHeader, 1, 0);
  Atomics.store(stdinHeader, 0, WAITING);
  self.postMessage({ type: "input-request", prompt });
  // Block this worker until the host answers (the UI thread stays live).
  while (Atomics.load(stdinHeader, 0) === WAITING) {
    Atomics.wait(stdinHeader, 0, WAITING);
  }
  const state = Atomics.load(stdinHeader, 0);
  if (state === CANCELLED) { Atomics.store(stdinHeader, 0, IDLE); return null; }
  const length = Atomics.load(stdinHeader, 1);
  const line = decoder.decode(stdinBytes.slice(0, length));
  Atomics.store(stdinHeader, 0, IDLE);
  return line;
}

// ---- lifecycle -------------------------------------------------------------
async function initialize(message) {
  if (message.interruptBuffer && message.stdinBuffer) {
    interruptView = new Int32Array(message.interruptBuffer);
    stdinHeader = new Int32Array(message.stdinBuffer, 0, HEADER_INTS);
    stdinBytes = new Uint8Array(message.stdinBuffer, HEADER_INTS * 4);
  }
  pyodide = await loadPyodide({
    indexURL: new URL("../vendor/pyodide/", import.meta.url).href,
  });
  if (interruptView) pyodide.setInterruptBuffer(interruptView);

  pyodide.setStdout({ write: (buf) => { write("stdout", decoder.decode(buf)); return buf.length; } });
  pyodide.setStderr({ write: (buf) => { write("stderr", decoder.decode(buf)); return buf.length; } });
  // Pyodide's stdin contract: return the next line (with newline), or null
  // for EOF. The engine-side echo of accepted input is the host's job, so
  // the transcript matches the traced path exactly.
  pyodide.setStdin({
    stdin: () => {
      const line = readLine("");
      return line === null ? null : line + "\n";
    },
  });
  self.postMessage({ type: "ready" });
}

// Pyodide's traceback includes its own eval machinery
// (/lib/python*.zip/_pyodide/_base.py, eval_code_async, run_async…). The
// traced path never shows engine frames, so neither does this one: keep
// only frames from the learner's program, which Pyodide reports as
// File "<exec>".
const FRAME_RE = /^\s+File "([^"]*)", line (\d+)(?:, in (.*))?$/;

function cleanTraceback(text) {
  const out = [];
  let keeping = true;
  for (const line of text.split("\n")) {
    const frame = FRAME_RE.exec(line);
    if (frame) {
      const [, file, lineNo, fn] = frame;
      keeping = file === "<exec>" || file === "<string>";
      if (keeping) out.push(`  line ${lineNo}${fn && fn !== "<module>" ? `, in ${fn}` : ""}`);
      continue;
    }
    // Continuation (source echo / caret markers) belongs to the last frame.
    if (/^\s/.test(line)) { if (keeping) out.push(line); continue; }
    keeping = true; // header and the final ExceptionType: message line
    if (line.trim()) out.push(line);
  }
  return out.join("\n").trim();
}

async function run(source) {
  let reason = "completed";
  let error = null;
  try {
    await pyodide.runPythonAsync(source);
  } catch (err) {
    const text = String(err?.message ?? err).replace(/^PythonError:\s*/, "");
    if (/KeyboardInterrupt/.test(text)) {
      reason = "interrupted";
    } else {
      reason = "uncaught_exception";
      error = cleanTraceback(text);
    }
  } finally {
    flushOutput();
  }
  self.postMessage({ type: "done", reason, error });
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message?.type === "init") { await initialize(message); return; }
    if (message?.type === "run") { await run(message.source); return; }
  } catch (err) {
    flushOutput();
    self.postMessage({ type: "done", reason: "engine_error", error: String(err?.message ?? err) });
  }
};
