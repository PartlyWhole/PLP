// PyTrace session wiring: one facade session, one run at a time. Fans each
// record out to the console and the memory model, runs the consumer-side
// stream checks when a stream exists, and translates terminal reasons into
// terminal-style closing lines.

import { createTraceWorker, defaultTraceOptions } from "../vendor/pytrace/browser/host.mjs";
import { traceStreamCheck } from "./stream-checks.mjs";
import { events } from "./events.mjs";
import { createFastRunner } from "./fastrun.mjs";

const WHEEL_URL = new URL(
  "../vendor/pytrace/dist/pytrace_engine-0.1.0-py3-none-any.whl",
  import.meta.url,
).href;

// Expected on every browser run (no CPU / address-space limits in wasm) —
// not worth a console line.
const QUIET_DIAGNOSTICS = new Set(["host_limit_unavailable"]);

export const END_NOTES = {
  completed: "── program finished ──",
  uncaught_exception: "── program crashed ──",
  interrupted: "── program stopped ──",
  killed: "── program stopped (hard kill — trace incomplete) ──",
  needs_input: "── program asked for input, but live input is unavailable in non-isolated mode ──",
  step_limit: `── stopped: step limit reached (${defaultTraceOptions.max_steps} steps) ──`,
  trace_limit: "── stopped: trace size limit reached ──",
  engine_error: "── the trace engine hit an internal error ──",
};

// Record → UI fan-out shared by the live runner and the collab follower
// path: both the memory model and the console are deterministic projections
// of the record stream, so a follower feeding remote records through this
// function reproduces the driver's panes exactly. `interactive` gates the
// input-line UI (followers see the prompt text but never enter line mode).
export function renderRecordToUI(record, { memory, consoleUI, interactive = true }) {
  memory.appendRecord(record);
  if (record.kind === "step") {
    const o = record.output;
    if (o?.stdout_delta) consoleUI.append("stdout", o.stdout_delta);
    if (o?.stderr_delta) consoleUI.append("stderr", o.stderr_delta);
    if (record.event === "input" && interactive) consoleUI.showInput(record.event_data?.prompt ?? "");
  } else if (record.kind === "diagnostic" && !QUIET_DIAGNOSTICS.has(record.code)) {
    consoleUI.system(`⚠ ${record.code}: ${record.message}`);
  }
}

// End-of-run console rendering (exception summary line + closing note),
// derived from the terminal record + terminal reason — same on both the
// driver and a collab follower.
export function renderRunEnd(records, terminalReason, consoleUI) {
  const terminal = records[records.length - 1];
  if (terminal?.kind === "terminal" && terminal.exception) {
    const ex = terminal.exception;
    consoleUI.append("stderr",
      `${ex.type_name}${ex.safe_message ? `: ${ex.safe_message}` : ""}`
      + (ex.location ? ` (line ${ex.location.line})` : "") + "\n");
  }
  consoleUI.system(END_NOTES[terminalReason] ?? `── ended: ${terminalReason} ──`);
}

// Optional collab hooks: onRunStart(runId), onRecord(record), onInput(line),
// onRunEnd(summary|null). All fire AFTER the local UI has been updated.
// Terminals that mean "this program is too big to trace" rather than
// "this program went wrong" — the engine stopped because a budget ran out,
// so the untraced path is the only way to see it finish.
const TOO_LARGE_TO_TRACE = new Set(["step_limit", "trace_limit"]);

export function createRunner({ editor, memory, consoleUI, onStatus, hooks }) {
  let session = null;
  let records = [];
  let running = false;
  let booted = false;
  let runCounter = 0;
  let lastSummary = null;
  let autoFallback = false;

  const ensureSession = () => session ??= createTraceWorker({ wheelUrl: WHEEL_URL });
  // Untraced path — the DEFAULT Run: plain Pyodide, no step limits, no
  // records (app/fastrun.mjs). Output is forwarded to collab too: an
  // untraced run has no record stream to replicate, so its console output
  // is shared directly (app/COLLAB.md, "untraced runs").
  const fast = createFastRunner({
    consoleUI,
    onOutput: (stream, text) => hooks?.onOutput?.({ stream, text }),
  });

  function onRecord(record) {
    records.push(record);
    renderRecordToUI(record, { memory, consoleUI });
    if (record.kind === "header") onStatus?.({ type: "header", host: record.host });
    // The stdin rendezvous, announced (expansion ladder §R4a): the LOCAL
    // engine has stopped and is waiting for a line. Emitted here rather than
    // in renderRecordToUI so a collab follower replaying the driver's records
    // never claims an input request it cannot answer. Scripted-input consumers
    // (the tutor's predict-io form) answer from this event; the run is live
    // while it fires, so answering must be deferred (queueMicrotask) — see
    // app/tutor.mjs execPredictIO.
    if (record.kind === "step" && record.event === "input") {
      events.emit("input-requested", { prompt: record.event_data?.prompt ?? "" });
    }
    hooks?.onRecord?.(record);
  }

  // Traced run ("Trace"): the memory model, bounded by the engine's budgets.
  // `stdinLines` is the DEGRADED-mode escape only: in live (isolated) mode the
  // engine ignores it entirely and `input()` waits for provideInput (CLAUDE.md
  // engine facts), so a scripted-input caller must ALSO answer live.
  async function trace({ stdinLines = [] } = {}) {
    // Guard BEFORE touching any state: a concurrent call must not clobber
    // the active run's records.
    if (running || fast.isRunning()) throw new Error("a run is already active");
    records = [];
    lastSummary = null;
    memory.reset();
    consoleUI.reset();
    editor.clearHighlight();
    ensureSession();
    running = true;
    consoleUI.system(booted ? "── run ──" : "── run ── (first run downloads the ~12 MB Python runtime; please wait…)");
    onStatus?.({ type: "state", state: booted ? "running" : "booting" });
    const runId = `plp-${Date.now()}-${++runCounter}`;
    hooks?.onRunStart?.(runId);
    events.emit("run-started", { runId });
    let tracedSummary = null;
    try {
      const summary = await session.run({
        runId,
        source: editor.getValue(),
        // Live-input mode (isolated): the console echoes typed lines locally,
        // so disable the engine's echo — exactly one echo either way.
        // Degraded mode keeps engine echo (pre-supplied lines, no typing).
        options: { echo_stdin: !crossOriginIsolated },
        stdinLines,
        onRecord,
      });
      booted = true;
      lastSummary = summary;
      renderRunEnd(records, summary.terminal_reason, consoleUI);
      onStatus?.({ type: "done", summary });
      hooks?.onRunEnd?.(summary);
      events.emit("run-ended", { reason: summary.terminal_reason, trace_complete: summary.trace_complete });
      tracedSummary = summary;
    } catch (err) {
      // Pre-stream rejections only (options/state errors) — no records exist.
      consoleUI.system(`run failed: ${err.message ?? err}`);
      onStatus?.({ type: "error", error: err });
      hooks?.onRunEnd?.(null);
      events.emit("run-rejected", { message: String(err.message ?? err) });
      return null;
    } finally {
      running = false;
      consoleUI.hideInput();
      // A finished trace is something to walk THROUGH, so it opens at the
      // start anchor rather than the last step the stream happened to reach.
      // (The panes still follow live while records arrive — that shows the
      // program working — but the resting position is the beginning.)
      if (memory.stepCount() > 0) memory.goTo(0, { silent: true });
      if (records.length) {
        const { errors } = traceStreamCheck(records);
        if (errors.length) console.error("PLP stream-check violations:", errors);
      }
    }

    // The engine stopped on a budget, not on a program error: this program
    // is too big to trace in full. Say so and point at Run, which always
    // finishes — re-running automatically would defeat the point of having
    // explicitly asked to trace (and would execute side effects twice).
    if (TOO_LARGE_TO_TRACE.has(tracedSummary?.terminal_reason)) {
      if (autoFallback) {
        consoleUI.system("── too large to trace — running it again without the memory model ──");
        return run({ keepPanes: true });
      }
      consoleUI.system("── traced the first part only — press Run to execute the whole program ──");
    }
    return tracedSummary;
  }

  // The DEFAULT Run: untraced, so it always finishes. Same console and
  // input contract as tracing; the memory model stays empty (nothing was
  // traced) and collab receives the output stream instead of records.
  async function run({ keepPanes = false } = {}) {
    if (running || fast.isRunning()) throw new Error("a run is already active");
    running = true;
    if (!keepPanes) {
      records = [];
      memory.reset();
      consoleUI.reset();
      editor.clearHighlight();
      consoleUI.system("── run (no memory model — press Trace for that) ──");
    }
    lastSummary = null;
    onStatus?.({ type: "state", state: "running" });
    const runId = `plp-run-${Date.now()}-${++runCounter}`;
    hooks?.onRunStart?.(runId, { mode: "untraced" });
    events.emit("run-started", { runId, mode: "untraced" });
    try {
      const summary = await fast.run(editor.getValue());
      lastSummary = summary;
      consoleUI.system(END_NOTES[summary.terminal_reason] ?? `── ended: ${summary.terminal_reason} ──`);
      onStatus?.({ type: "done", summary });
      hooks?.onRunEnd?.(summary);
      events.emit("run-ended", { reason: summary.terminal_reason, trace_complete: false, mode: "untraced" });
      return summary;
    } catch (err) {
      // The shared run must reach a terminal state on EVERY path: while it
      // reads "running", canRun() is false for every peer INCLUDING this
      // one, so a swallowed failure wedges the whole room.
      consoleUI.system(`run failed: ${err.message ?? err}`);
      onStatus?.({ type: "error", error: err });
      hooks?.onRunEnd?.(null);
      events.emit("run-rejected", { message: String(err.message ?? err) });
      return null;
    } finally {
      running = false;
      consoleUI.hideInput();
    }
  }

  function interrupt() {
    if (fast.isRunning()) fast.interrupt();
    else session?.interrupt();
    events.emit("interrupt-requested");
  }

  function provideInput(line) {
    // Route to whichever engine is waiting; both throw when nothing is
    // outstanding, so the console's single echo path stays identical.
    if (fast.isRunning()) fast.provideInput(line);
    else ensureSession().provideInput(line); // throws on no outstanding request
    // Accepted: echo the line into the transcript (live mode disables the
    // engine's echo; degraded mode never reaches here — provideInput throws).
    consoleUI.append("echo", line + "\n");
    hooks?.onInput?.(line);
    events.emit("input-answered", { line });
  }

  // Scripted input (expansion ladder §R4a): trace a program, answering each
  // rendezvous from `lines` in order. ONE implementation, shared by the
  // tutor's predict-io form and the debug/test helper — so what the learner
  // is graded against and what K-10/K-doc record are the same execution.
  //
  // Invariant 2 (every run reaches a terminal): if the program asks for more
  // lines than the script holds, the run is INTERRUPTED rather than left
  // waiting forever. `exhausted` reports that so the caller can skip instead
  // of grading a run that never finished.
  //
  // Answers are deferred with queueMicrotask: the event fires from inside the
  // record fan-out of the live run, and provideInput must not re-enter it.
  // Degraded (non-isolated) mode has no live rendezvous at all, so the script
  // is ALSO handed to the engine as pre-supplied stdin.
  async function traceWithScript(lines = []) {
    const script = [...lines];
    let used = 0;
    let exhausted = false;
    const off = events.on((e) => {
      if (e.type !== "input-requested") return;
      if (used >= script.length) {
        exhausted = true;
        queueMicrotask(() => { try { interrupt(); } catch { /* already ending */ } });
        return;
      }
      const line = script[used++];
      queueMicrotask(() => { try { provideInput(line); } catch { /* run already ended */ } });
    });
    try {
      const summary = await trace({ stdinLines: crossOriginIsolated ? [] : script });
      return { summary, used, exhausted, script };
    } finally {
      off();
    }
  }

  return {
    run,     // untraced (the Run button)
    trace,   // traced (the Trace button)
    traceWithScript,
    // Opt-in: when a traced run trips a budget, re-run it untraced instead
    // of just reporting. Off by default — Run already covers that need.
    setAutoFallback: (v) => { autoFallback = Boolean(v); },
    autoFallback: () => autoFallback,
    interrupt,
    provideInput,
    isRunning: () => running || fast.isRunning(),
    fastState: () => fast.debugState(),
    records: () => records,
    summary: () => lastSummary,
    checkErrors: () => traceStreamCheck(records).errors,
  };
}
