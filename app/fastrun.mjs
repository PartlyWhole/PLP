// Host side of the untraced ("fast") execution path — see
// app/fastrun-worker.mjs for why this exists.
//
// Mirrors the traced runner's contract where the UI cares: output flows
// into the same console chunk store, input() uses the same single-echo
// path, Stop interrupts, and the run resolves with a terminal reason from
// the same vocabulary (completed / uncaught_exception / interrupted /
// engine_error). It produces NO trace records — nothing for the memory
// model, and nothing for collab to replicate.

import { events } from "./events.mjs";

const WORKER_URL = new URL("./fastrun-worker.mjs", import.meta.url);
const IDLE = 0, WAITING = 1, READY = 2, CANCELLED = 3;
const HEADER_INTS = 2;
const STDIN_BYTES = 64 * 1024;

// onOutput(stream, text): fires for every output chunk after it reaches the
// console — collab uses it to share untraced runs, which have no records.
export function createFastRunner({ consoleUI, onOutput }) {
  let worker = null;
  let ready = null;          // promise resolved once Pyodide has booted
  let running = false;
  let settle = null;         // resolver for the in-flight run
  let interruptView = null;
  let stdinHeader = null;
  let stdinBytes = null;
  let awaitingInput = false;

  const encoder = new TextEncoder();

  function ensureWorker() {
    if (worker) return ready;
    worker = new Worker(WORKER_URL, { type: "module" });

    // SharedArrayBuffer needs cross-origin isolation. Without it the worker
    // cannot block, so input() reports EOF instead of hanging (documented,
    // same posture as the traced path's degraded mode).
    let interruptBuffer = null, stdinBuffer = null;
    if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer === "function") {
      interruptBuffer = new SharedArrayBuffer(4);
      stdinBuffer = new SharedArrayBuffer(HEADER_INTS * 4 + STDIN_BYTES);
      interruptView = new Int32Array(interruptBuffer);
      stdinHeader = new Int32Array(stdinBuffer, 0, HEADER_INTS);
      stdinBytes = new Uint8Array(stdinBuffer, HEADER_INTS * 4);
    }

    ready = new Promise((resolve) => {
      worker.onmessage = (event) => {
        const m = event.data;
        if (m.type === "ready") { resolve(); return; }
        if (m.type === "out") { consoleUI.append(m.stream, m.text); onOutput?.(m.stream, m.text); return; }
        if (m.type === "input-request") {
          awaitingInput = true;
          consoleUI.showInput(m.prompt ?? "");
          return;
        }
        if (m.type === "input-unavailable") {
          consoleUI.system("⚠ input() needs cross-origin isolation — reporting EOF (see ?nonisolated)");
          return;
        }
        if (m.type === "done") {
          awaitingInput = false;
          running = false;
          consoleUI.hideInput();
          if (m.error) consoleUI.append("stderr", m.error + "\n");
          settle?.({ terminal_reason: m.reason, traced: false });
          settle = null;
        }
      };
      worker.onerror = (err) => {
        running = false;
        awaitingInput = false;
        settle?.({ terminal_reason: "engine_error", traced: false, error: String(err.message ?? err) });
        settle = null;
      };
      worker.postMessage({ type: "init", interruptBuffer, stdinBuffer });
    });
    return ready;
  }

  async function run(source) {
    if (running) throw new Error("a run is already active");
    running = true;
    events.emit("run-started", { runId: `fast-${Date.now()}`, traced: false });
    await ensureWorker();
    const done = new Promise((resolve) => { settle = resolve; });
    worker.postMessage({ type: "run", source });
    const summary = await done;
    events.emit("run-ended", { reason: summary.terminal_reason, trace_complete: false, traced: false });
    return summary;
  }

  // Answer a pending input() — writes into the shared buffer and wakes the
  // blocked worker. Throws when nothing is waiting, matching the traced
  // path's behavior so the console's single echo path is identical.
  function provideInput(line) {
    if (!awaitingInput || !stdinHeader) throw new Error("no input is being requested");
    const bytes = encoder.encode(String(line));
    if (bytes.length > stdinBytes.length) throw new Error("input line too long");
    stdinBytes.set(bytes);
    Atomics.store(stdinHeader, 1, bytes.length);
    Atomics.store(stdinHeader, 0, READY);
    Atomics.notify(stdinHeader, 0);
    awaitingInput = false;
  }

  function interrupt() {
    if (!running) return;
    if (awaitingInput && stdinHeader) {
      // Release the rendezvous first, or the worker never reaches a point
      // where the interrupt can be observed.
      Atomics.store(stdinHeader, 0, CANCELLED);
      Atomics.notify(stdinHeader, 0);
      awaitingInput = false;
    }
    if (interruptView) Atomics.store(interruptView, 0, 2); // SIGINT
    else { // degraded: no cooperative path, kill the worker
      worker?.terminate();
      worker = null;
      ready = null;
      running = false;
      consoleUI.hideInput();
      settle?.({ terminal_reason: "killed", traced: false });
      settle = null;
    }
  }

  return {
    run,
    provideInput,
    interrupt,
    isRunning: () => running,
    isWaitingForInput: () => awaitingInput,
    dispose: () => { worker?.terminate(); worker = null; ready = null; running = false; },
  };
}
