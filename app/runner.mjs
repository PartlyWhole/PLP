// PyTrace session wiring: one facade session, one run at a time. Fans each
// record out to the console and the memory model, runs the consumer-side
// stream checks when a stream exists, and translates terminal reasons into
// terminal-style closing lines.

import { createTraceWorker, defaultTraceOptions } from "../vendor/pytrace/browser/host.mjs";
import { traceStreamCheck } from "./stream-checks.mjs";
import { events } from "./events.mjs";

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
export function createRunner({ editor, memory, consoleUI, onStatus, hooks }) {
  let session = null;
  let records = [];
  let running = false;
  let booted = false;
  let runCounter = 0;
  let lastSummary = null;

  const ensureSession = () => session ??= createTraceWorker({ wheelUrl: WHEEL_URL });

  function onRecord(record) {
    records.push(record);
    renderRecordToUI(record, { memory, consoleUI });
    if (record.kind === "header") onStatus?.({ type: "header", host: record.host });
    hooks?.onRecord?.(record);
  }

  async function run() {
    // Guard BEFORE touching any state: a concurrent call must not clobber
    // the active run's records.
    if (running) throw new Error("a run is already active");
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
    try {
      const summary = await session.run({
        runId,
        source: editor.getValue(),
        // Live-input mode (isolated): the console echoes typed lines locally,
        // so disable the engine's echo — exactly one echo either way.
        // Degraded mode keeps engine echo (pre-supplied lines, no typing).
        options: { echo_stdin: !crossOriginIsolated },
        stdinLines: [],
        onRecord,
      });
      booted = true;
      lastSummary = summary;
      renderRunEnd(records, summary.terminal_reason, consoleUI);
      onStatus?.({ type: "done", summary });
      hooks?.onRunEnd?.(summary);
      events.emit("run-ended", { reason: summary.terminal_reason, trace_complete: summary.trace_complete });
      return summary;
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
      if (records.length) {
        const { errors } = traceStreamCheck(records);
        if (errors.length) console.error("PLP stream-check violations:", errors);
      }
    }
  }

  return {
    run,
    interrupt: () => { session?.interrupt(); events.emit("interrupt-requested"); },
    provideInput: (line) => {
      ensureSession().provideInput(line); // throws on no outstanding request
      // Accepted: echo the line into the transcript (live mode disables the
      // engine's echo; degraded mode never reaches here — provideInput throws).
      consoleUI.append("echo", line + "\n");
      hooks?.onInput?.(line);
      events.emit("input-answered", { line });
    },
    isRunning: () => running,
    records: () => records,
    summary: () => lastSummary,
    checkErrors: () => traceStreamCheck(records).errors,
  };
}
