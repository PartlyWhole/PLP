// PILOT-SITE PATCH 1/2 (vendor/PATCHES.md): resolve Pyodide relative to this
// file instead of the origin root, so the site works from a GitHub Pages
// project path (/<repo>/). Upstream specifier: "/node_modules/pyodide/pyodide.mjs"
import { loadPyodide } from "../../pyodide/pyodide.mjs";

import {
  INPUT_CANCELLED,
  INPUT_HEADER_INTS,
  INPUT_IDLE,
  INPUT_READY,
  INPUT_WAITING,
  inputViews,
} from "./protocol.mjs";

let pyodide;
let executeRun;
let interruptView;
let stdinHeader;
let stdinBytes;
let inputGeneration = 0;
let activeRunId = null;

const decoder = new TextDecoder("utf-8", { fatal: true });

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message?.type === "init") {
      await initialize(message);
      return;
    }
    if (message?.type !== "run" || activeRunId !== null || !executeRun) {
      throw new Error("invalid worker control");
    }
    activeRunId = message.control.run_id;
    const resultText = executeRun(JSON.stringify(message.control));
    self.postMessage({
      result: JSON.parse(resultText),
      runId: activeRunId,
      type: "run_done",
    });
    activeRunId = null;
  } catch (error) {
    console.error("PyTrace worker fatal", error?.constructor?.name ?? "Error");
    self.postMessage({
      errorType: error?.constructor?.name ?? "Error",
      runId: activeRunId,
      type: "fatal",
    });
    activeRunId = null;
  }
};

async function initialize(message) {
  if (pyodide) {
    throw new Error("worker is already initialized");
  }
  if (message.interruptBuffer && message.stdinBuffer) {
    interruptView = new Int32Array(message.interruptBuffer);
    ({ bytes: stdinBytes, header: stdinHeader } = inputViews(message.stdinBuffer));
  }
  pyodide = await loadPyodide({
    // PILOT-SITE PATCH 2/2 (vendor/PATCHES.md). Upstream: new URL("/node_modules/pyodide/", self.location.origin).href
    indexURL: new URL("../../pyodide/", import.meta.url).href,
  });
  if (interruptView) {
    pyodide.setInterruptBuffer(interruptView);
  }
  pyodide.registerJsModule("pytrace_bridge", {
    emit: (line) => {
      self.postMessage({ line: String(line), runId: activeRunId, type: "record" });
    },
    interrupt_requested: () =>
      interruptView ? Atomics.load(interruptView, 1) !== 0 : false,
    read_input: (requestId) => readInput(String(requestId)),
  });
  await pyodide.loadPackage(message.wheelUrl);
  pyodide.runPython(PYTHON_BOOTSTRAP);
  executeRun = pyodide.globals.get("_pytrace_execute");
  const pythonVersion = pyodide.runPython(
    "import platform as _pytrace_platform; _pytrace_platform.python_version()",
  );
  self.postMessage({ pythonVersion, type: "ready" });
}

function readInput(requestId) {
  if (!stdinHeader || !stdinBytes) {
    return null;
  }
  inputGeneration += 1;
  const generation = inputGeneration;
  Atomics.store(stdinHeader, 1, generation);
  Atomics.store(stdinHeader, 2, 0);
  Atomics.store(stdinHeader, 0, INPUT_WAITING);
  self.postMessage({
    generation,
    requestId,
    runId: activeRunId,
    type: "input_waiting",
  });

  while (true) {
    const state = Atomics.load(stdinHeader, 0);
    const currentGeneration = Atomics.load(stdinHeader, 1);
    if (currentGeneration !== generation) {
      throw new Error("stdin generation changed while waiting");
    }
    if (state === INPUT_READY) {
      const length = Atomics.load(stdinHeader, 2);
      if (length < 0 || length > stdinBytes.byteLength) {
        throw new Error("stdin byte length is invalid");
      }
      const line = decoder.decode(stdinBytes.slice(0, length));
      Atomics.store(stdinHeader, 0, INPUT_IDLE);
      return line;
    }
    if (state === INPUT_CANCELLED) {
      Atomics.store(stdinHeader, 0, INPUT_IDLE);
      return null;
    }
    Atomics.wait(stdinHeader, 0, INPUT_WAITING, 50);
    if (interruptView && Atomics.load(interruptView, 0) !== 0) {
      pyodide.checkInterrupt();
    }
  }
}

const PYTHON_BOOTSTRAP = String.raw`
import builtins as _pytrace_builtins
import json as _pytrace_json
import os as _pytrace_os
import sys as _pytrace_sys
import warnings as _pytrace_warnings

import pytrace_bridge as _pytrace_bridge
from trace_engine.api import InputCancelled as _PyTraceInputCancelled
from trace_engine.api import InputProvider as _PyTraceInputProvider
from trace_engine.api import QueueInputProvider as _PyTraceQueueInputProvider
from trace_engine.api import TraceSink as _PyTraceSink
from trace_engine.engine import _run_with_host as _pytrace_run_with_host
from trace_engine.options import TraceOptions as _PyTraceOptions
from trace_engine.serialization import canonical_record_bytes as _pytrace_record_bytes


class _PyTraceBrowserSink(_PyTraceSink):
    def emit(self, record):
        _pytrace_bridge.emit(_pytrace_record_bytes(record).decode("ascii"))


class _PyTraceBrowserInput(_PyTraceInputProvider):
    input_mode = "live"

    def provide_input(self, request_id, prompt):
        del prompt
        value = _pytrace_bridge.read_input(request_id)
        if value is None:
            raise _PyTraceInputCancelled
        return str(value)


def _pytrace_options(value):
    fields = dict(value)
    fields["trace_modules"] = tuple(fields["trace_modules"])
    return _PyTraceOptions(**fields)


def _pytrace_execute(control_json):
    control = _pytrace_json.loads(control_json)
    options = _pytrace_options(control["options"])
    use_shared = bool(control["use_shared"])
    provider = (
        _PyTraceBrowserInput()
        if use_shared
        else _PyTraceQueueInputProvider(tuple(control["stdin_lines"]))
    )
    host = {
        "kind": "browser_worker",
        "runtime": "pyodide",
        "platform": "browser",
        "input_mode": provider.input_mode,
        "python_hash_seed": "not_applicable",
        "capabilities": {
            "live_input": use_shared,
            "cooperative_interrupt": use_shared,
            "hard_interrupt": True,
            "process_group": False,
            "cpu_limit": False,
            "address_space_limit": False,
            "cross_origin_isolated": use_shared,
        },
    }
    diagnostics = (
        ("host_limit_unavailable", "the browser host cannot enforce a CPU limit"),
        (
            "host_limit_unavailable",
            "the browser host cannot enforce an address-space limit",
        ),
    )
    before_modules = dict(_pytrace_sys.modules)
    before_stdout = _pytrace_sys.stdout
    before_stderr = _pytrace_sys.stderr
    before_input = _pytrace_builtins.input
    before_cwd = _pytrace_os.getcwd()
    before_argv = list(_pytrace_sys.argv)
    before_path = list(_pytrace_sys.path)
    before_recursion = _pytrace_sys.getrecursionlimit()
    before_filters = list(_pytrace_warnings.filters)
    summary = None
    try:
        summary = _pytrace_run_with_host(
            control["source"],
            run_id=control["run_id"],
            options=options,
            sink=_PyTraceBrowserSink(),
            input_provider=provider,
            host_info=host,
            host_diagnostics=diagnostics,
            interrupt_requested=(
                (lambda: bool(_pytrace_bridge.interrupt_requested()))
                if use_shared
                else None
            ),
        )
    finally:
        for module_name in set(_pytrace_sys.modules) - set(before_modules):
            _pytrace_sys.modules.pop(module_name, None)
        for module_name, module in before_modules.items():
            _pytrace_sys.modules[module_name] = module
    health = (
        _pytrace_sys.gettrace() is None
        and _pytrace_sys.stdout is before_stdout
        and _pytrace_sys.stderr is before_stderr
        and _pytrace_builtins.input is before_input
        and _pytrace_os.getcwd() == before_cwd
        and list(_pytrace_sys.argv) == before_argv
        and list(_pytrace_sys.path) == before_path
        and _pytrace_sys.getrecursionlimit() == before_recursion
        and list(_pytrace_warnings.filters) == before_filters
    )
    return _pytrace_json.dumps(
        {
            "health": health,
            "summary": {
                "diagnostic_count": summary.diagnostic_count,
                "run_id": summary.run_id,
                "stderr_bytes": summary.stderr_bytes,
                "stdout_bytes": summary.stdout_bytes,
                "step_count": summary.step_count,
                "terminal_reason": summary.terminal_reason,
                "terminal_seq": summary.terminal_seq,
                "trace_bytes": summary.trace_bytes,
                "trace_complete": summary.trace_complete,
            },
        },
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )
`;
