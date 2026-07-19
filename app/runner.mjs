// PyTrace session wiring: one facade session, one run at a time. Fans each
// record out to the console and the memory model, runs the consumer-side
// stream checks when a stream exists, and translates terminal reasons into
// terminal-style closing lines.

import { createTraceWorker, defaultTraceOptions } from "../vendor/pytrace/browser/host.mjs";
import { traceStreamCheck } from "./stream-checks.mjs";

const WHEEL_URL = new URL(
  "../vendor/pytrace/dist/pytrace_engine-0.1.0-py3-none-any.whl",
  import.meta.url,
).href;

// Expected on every browser run (no CPU / address-space limits in wasm) —
// not worth a console line.
const QUIET_DIAGNOSTICS = new Set(["host_limit_unavailable"]);

const END_NOTES = {
  completed: "── program finished ──",
  uncaught_exception: "── program crashed ──",
  interrupted: "── program stopped ──",
  killed: "── program stopped (hard kill — trace incomplete) ──",
  needs_input: "── program asked for input, but live input is unavailable in non-isolated mode ──",
  step_limit: `── stopped: step limit reached (${defaultTraceOptions.max_steps} steps) ──`,
  trace_limit: "── stopped: trace size limit reached ──",
  engine_error: "── the trace engine hit an internal error ──",
};

export function createRunner({ editor, memory, consoleUI, onStatus }) {
  let session = null;
  let records = [];
  let running = false;
  let booted = false;
  let runCounter = 0;
  let lastSummary = null;

  const ensureSession = () => session ??= createTraceWorker({ wheelUrl: WHEEL_URL });

  function onRecord(record) {
    records.push(record);
    memory.appendRecord(record);
    if (record.kind === "header") {
      onStatus?.({ type: "header", host: record.host });
    } else if (record.kind === "step") {
      const o = record.output;
      if (o?.stdout_delta) consoleUI.append("stdout", o.stdout_delta);
      if (o?.stderr_delta) consoleUI.append("stderr", o.stderr_delta);
      if (record.event === "input") consoleUI.showInput(record.event_data?.prompt ?? "");
    } else if (record.kind === "diagnostic" && !QUIET_DIAGNOSTICS.has(record.code)) {
      consoleUI.system(`⚠ ${record.code}: ${record.message}`);
    }
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
    try {
      const summary = await session.run({
        runId: `plp-${Date.now()}-${++runCounter}`,
        source: editor.getValue(),
        options: {},
        stdinLines: [],
        onRecord,
      });
      booted = true;
      lastSummary = summary;
      const terminal = records[records.length - 1];
      if (terminal?.kind === "terminal" && terminal.exception) {
        const ex = terminal.exception;
        consoleUI.append("stderr",
          `${ex.type_name}${ex.safe_message ? `: ${ex.safe_message}` : ""}`
          + (ex.location ? ` (line ${ex.location.line})` : "") + "\n");
      }
      consoleUI.system(END_NOTES[summary.terminal_reason] ?? `── ended: ${summary.terminal_reason} ──`);
      onStatus?.({ type: "done", summary });
      return summary;
    } catch (err) {
      // Pre-stream rejections only (options/state errors) — no records exist.
      consoleUI.system(`run failed: ${err.message ?? err}`);
      onStatus?.({ type: "error", error: err });
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
    interrupt: () => { session?.interrupt(); },
    provideInput: (line) => ensureSession().provideInput(line),
    isRunning: () => running,
    records: () => records,
    summary: () => lastSummary,
    checkErrors: () => traceStreamCheck(records).errors,
  };
}
