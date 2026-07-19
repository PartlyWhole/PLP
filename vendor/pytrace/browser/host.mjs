import {
  INPUT_CANCELLED,
  INPUT_IDLE,
  INPUT_READY,
  INPUT_WAITING,
  canonicalLine,
  createInputBuffers,
  inputViews,
  lineBytes,
  synthesizeTerminal,
} from "./protocol.mjs";
import {
  fetchCanonicalSchema,
  IncrementalStreamValidator,
} from "./validation.mjs";

const encoder = new TextEncoder();

export const defaultTraceOptions = Object.freeze({
  echo_stdin: true,
  identity_tombstones: 2048,
  max_container_elems: 120,
  max_heap_edges: 2000,
  max_heap_nodes: 500,
  max_input_line_bytes: 64 * 1024,
  max_output_bytes: 256 * 1024,
  max_record_bytes: 2 * 1024 * 1024,
  max_source_bytes: 1024 * 1024,
  max_steps: 1000,
  max_trace_bytes: 32 * 1024 * 1024,
  show_dunder_attributes: false,
  trace_modules: [],
  wall_clock_s: 10,
});

export function createTraceWorker(config = {}) {
  return new TraceWorkerSession(new BrowserTraceHost(config));
}

class TraceWorkerSession {
  constructor(host) {
    this._host = host;
    this._active = null;
    this._startPromise = null;
    this._runPending = false;
    this._interruptRequested = false;
    this._disposed = false;
    this._disposePromise = null;
  }

  async run({
    runId,
    source,
    options = {},
    stdinLines = [],
    onRecord = () => {},
  } = {}) {
    if (this._disposed) {
      throw new Error("trace worker session is disposed");
    }
    if (this._runPending || this._active) {
      throw new Error("trace worker session already has an active run");
    }
    if (typeof onRecord !== "function") {
      throw new TypeError("onRecord must be a function");
    }
    this._runPending = true;
    this._interruptRequested = false;
    let internalSession = null;
    try {
      this._startPromise = this._host.start(source, {
        options,
        runId,
        stdinLines,
      });
      internalSession = await this._startPromise;
      this._active = internalSession;
      if (this._interruptRequested) {
        internalSession.interrupt();
      }
      if (this._disposed) {
        await internalSession.close();
      }
      for await (const record of internalSession.records) {
        await onRecord(record);
      }
      return await internalSession.wait();
    } catch (error) {
      if (internalSession && !internalSession._finished) {
        await internalSession.close();
      }
      throw error;
    } finally {
      this._active = null;
      this._startPromise = null;
      this._runPending = false;
    }
  }

  provideInput(line) {
    if (!this._active) {
      throw new Error("no trace run is active");
    }
    this._active.sendInput(line);
  }

  interrupt() {
    if (this._interruptRequested || (!this._active && !this._runPending)) {
      return;
    }
    this._interruptRequested = true;
    this._active?.interrupt();
  }

  dispose() {
    if (!this._disposePromise) {
      this._disposed = true;
      this._disposePromise = (async () => {
        let internalSession = this._active;
        if (!internalSession && this._startPromise) {
          try {
            internalSession = await this._startPromise;
          } catch {
            // Run startup owns and reports its failure.
          }
        }
        if (internalSession) {
          await internalSession.close();
        }
        await this._host.close();
      })();
    }
    return this._disposePromise;
  }
}

export class BrowserTraceHost {
  constructor({
    forceNoSharedMemory = false,
    graceMs = 500,
    signalDelayMs = 100,
    schemaUrl = new URL("../schema/trace-engine-1.schema.json", import.meta.url),
    wheelUrl = "/dist/pytrace_engine-0.1.0-py3-none-any.whl",
    workerUrl = new URL("./worker.mjs", import.meta.url),
  } = {}) {
    this.forceNoSharedMemory = forceNoSharedMemory;
    this.graceMs = graceMs;
    this.signalDelayMs = signalDelayMs;
    this.schemaUrl = schemaUrl;
    this.wheelUrl = wheelUrl;
    this.workerUrl = workerUrl;
    this.worker = null;
    this.workerGeneration = 0;
    this.pythonVersion = null;
    this.activeSession = null;
    this._startPending = false;
    this.cleanRuns = 0;
    this._readyPromise = null;
    this._readyResolve = null;
    this._readyReject = null;
    this._buffers = null;
    this._bufferCapacity = 0;
    this._schema = null;
    this._schemaPromise = null;
    this.useSharedMemory = false;
  }

  async initialize() {
    await Promise.all([this._ensureSchema(), this._ensureWorker()]);
  }

  async start(
    source,
    { options = {}, runId = crypto.randomUUID(), stdinLines = [] } = {},
  ) {
    if (this.activeSession || this._startPending) {
      throw new Error("browser host already has an active run");
    }
    this._startPending = true;
    try {
      if (typeof source !== "string") {
        throw new TypeError("source must be a string");
      }
      if (typeof runId !== "string" || runId.length === 0) {
        throw new TypeError("runId must be a non-empty string");
      }
      const mergedOptions = normalizeOptions(options);
      if (encoder.encode(source).byteLength > mergedOptions.max_source_bytes) {
        throw new RangeError("source exceeds max_source_bytes");
      }
      if (
        !Array.isArray(stdinLines) ||
        stdinLines.some(
          (line) =>
            typeof line !== "string" ||
            line.includes("\n") ||
            line.includes("\r") ||
            encoder.encode(line).byteLength >
              mergedOptions.max_input_line_bytes,
        )
      ) {
        throw new TypeError("stdinLines contains an invalid input line");
      }
      await Promise.all([
        this._ensureSchema(),
        this._ensureWorker(mergedOptions.max_input_line_bytes),
      ]);
      const session = new BrowserSession(this, {
        options: mergedOptions,
        runId,
        source,
        stdinLines,
      });
      await session._prepare();
      this.activeSession = session;
      this._resetControlBuffers();
      this.worker.postMessage({
        control: {
          options: mergedOptions,
          run_id: runId,
          source,
          stdin_lines: stdinLines,
          use_shared: this.useSharedMemory,
        },
        type: "run",
      });
      session._startWatchdog();
      return session;
    } finally {
      this._startPending = false;
    }
  }

  async close() {
    if (this.activeSession && !this.activeSession._finished) {
      this._hardTerminate(this.activeSession, "killed");
    }
    this._discardWorker();
  }

  async _ensureSchema() {
    if (!this._schemaPromise) {
      this._schemaPromise = fetchCanonicalSchema(this.schemaUrl)
        .then((schema) => {
          this._schema = schema;
          return schema;
        })
        .catch((error) => {
          this._schemaPromise = null;
          throw error;
        });
    }
    return this._schemaPromise;
  }

  _resetControlBuffers() {
    if (!this.useSharedMemory || !this._buffers) {
      return;
    }
    const interrupt = new Int32Array(this._buffers.interruptBuffer);
    Atomics.store(interrupt, 0, 0);
    Atomics.store(interrupt, 1, 0);
    const { header } = inputViews(this._buffers.stdinBuffer);
    Atomics.store(header, 0, INPUT_IDLE);
    Atomics.store(header, 2, 0);
  }

  async _ensureWorker(minimumInputBytes = defaultTraceOptions.max_input_line_bytes) {
    const sharedMemoryAvailable =
      !this.forceNoSharedMemory &&
      globalThis.crossOriginIsolated === true &&
      typeof SharedArrayBuffer === "function";
    if (
      this.worker &&
      this._readyPromise &&
      (!sharedMemoryAvailable || this._bufferCapacity >= minimumInputBytes)
    ) {
      return this._readyPromise;
    }
    if (this.worker) {
      this._discardWorker();
    }
    this.useSharedMemory = sharedMemoryAvailable;
    this._bufferCapacity = this.useSharedMemory ? minimumInputBytes : 0;
    this._buffers = this.useSharedMemory
      ? createInputBuffers(minimumInputBytes)
      : null;
    this.worker = new Worker(this.workerUrl, { type: "module" });
    this.workerGeneration += 1;
    this._readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
    this.worker.onmessage = (event) => this._handleMessage(event.data);
    this.worker.onerror = () => {
      if (this.activeSession) {
        this._hardTerminate(this.activeSession, "engine_error");
      } else {
        this._readyReject?.(new Error("browser worker failed during startup"));
        this._discardWorker();
      }
    };
    this.worker.postMessage({
      interruptBuffer: this._buffers?.interruptBuffer,
      stdinBuffer: this._buffers?.stdinBuffer,
      type: "init",
      wheelUrl: this.wheelUrl,
    });
    return this._readyPromise;
  }

  _handleMessage(message) {
    if (message?.type === "ready") {
      this.pythonVersion = message.pythonVersion;
      this._readyResolve?.();
      return;
    }
    const session = this.activeSession;
    if (!session || message?.runId !== session.runId) {
      if (message?.type === "fatal" && !session) {
        this._readyReject?.(new Error("browser worker initialization failed"));
        this._discardWorker();
      }
      return;
    }
    try {
      if (message.type === "record") {
        session._acceptRecordLine(message.line);
      } else if (message.type === "input_waiting") {
        session._acceptInputWait(message.requestId, message.generation);
      } else if (message.type === "run_done") {
        session._completeFromWorker(message.result);
      } else if (message.type === "fatal") {
        this._hardTerminate(session, "engine_error");
      }
    } catch {
      this._hardTerminate(session, "engine_error");
    }
  }

  _hardTerminate(session, reason) {
    if (session !== this.activeSession || session._finished) {
      return;
    }
    this._discardWorker();
    session._completeSynthetic(reason);
    this.activeSession = null;
    this.cleanRuns = 0;
  }

  _sessionCompleted(session, health) {
    if (session !== this.activeSession) {
      return;
    }
    this.activeSession = null;
    const abnormal = !health || session.summary.terminal_reason !== "completed";
    if (abnormal) {
      this.cleanRuns = 0;
      this._discardWorker();
      return;
    }
    this.cleanRuns += 1;
    if (this.cleanRuns >= 20) {
      this.cleanRuns = 0;
      this._discardWorker();
    }
  }

  _discardWorker() {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    this._readyPromise = null;
    this._readyResolve = null;
    this._readyReject = null;
    this._buffers = null;
    this._bufferCapacity = 0;
    this.pythonVersion = null;
  }
}

class BrowserSession {
  constructor(host, { options, runId, source, stdinLines }) {
    this.host = host;
    this.options = options;
    this.runId = runId;
    this.source = source;
    this.stdinLines = stdinLines;
    this.records = new AsyncRecordQueue();
    this.summary = null;
    this._recordList = [];
    this._recordLines = [];
    this._pendingInputRecord = null;
    this._pendingTerminalRecord = null;
    this._preTerminalValidationState = null;
    this._waitingRequest = null;
    this._inputDwell = false;
    this._finished = false;
    this._watchdog = null;
    this._hardTimer = null;
    this._signalTimer = null;
    this._elapsedMs = 0;
    this._previousTime = 0;
    this._fallbackHeader = null;
    this._validator = null;
    this._waitPromise = new Promise((resolve) => {
      this._resolveWait = resolve;
    });
  }

  async _prepare() {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(this.source));
    const sourceSha256 = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const useShared = this.host.useSharedMemory;
    this._fallbackHeader = {
      backend: "settrace",
      engine_version: "0.1.0",
      format: "trace-engine/1",
      host: {
        capabilities: {
          address_space_limit: false,
          cooperative_interrupt: useShared,
          cpu_limit: false,
          cross_origin_isolated: useShared,
          hard_interrupt: true,
          live_input: useShared,
          process_group: false,
        },
        input_mode: useShared ? "live" : "pre_supplied",
        kind: "browser_worker",
        platform: "browser",
        python_hash_seed: "not_applicable",
        runtime: "pyodide",
      },
      kind: "header",
      options: this.options,
      python_version: this.host.pythonVersion,
      run_id: this.runId,
      seq: 0,
      source: this.source,
      source_sha256: sourceSha256,
    };
    this._validator = new IncrementalStreamValidator(
      this.host._schema,
      this._fallbackHeader,
      this.options,
    );
    const headerBytes = lineBytes(canonicalLine(this._fallbackHeader));
    if (
      headerBytes > this.options.max_record_bytes ||
      headerBytes + 8 * 1024 > this.options.max_trace_bytes
    ) {
      throw new RangeError(
        "header cannot fit the configured record and trace budgets",
      );
    }
  }

  sendInput(line) {
    if (!this.host.useSharedMemory || !this._waitingRequest) {
      throw new Error("no live input request is outstanding");
    }
    if (
      typeof line !== "string" ||
      line.includes("\n") ||
      line.includes("\r")
    ) {
      throw new TypeError("input line must not contain a terminator");
    }
    const payload = encoder.encode(line);
    if (payload.byteLength > this.options.max_input_line_bytes) {
      throw new RangeError("input line exceeds max_input_line_bytes");
    }
    const waiting = this._waitingRequest;
    const { bytes, header } = inputViews(this.host._buffers.stdinBuffer);
    if (
      Atomics.load(header, 0) !== INPUT_WAITING ||
      Atomics.load(header, 1) !== waiting.generation
    ) {
      throw new Error("stdin generation is stale");
    }
    this._waitingRequest = null;
    this._setInputDwell(false);
    bytes.fill(0, 0, payload.byteLength);
    bytes.set(payload, 0);
    Atomics.store(header, 2, payload.byteLength);
    Atomics.store(header, 0, INPUT_READY);
    Atomics.notify(header, 0);
  }

  interrupt() {
    if (this._finished) {
      return;
    }
    if (!this.host.useSharedMemory) {
      this.host._hardTerminate(this, "killed");
      return;
    }
    const interrupt = new Int32Array(this.host._buffers.interruptBuffer);
    Atomics.store(interrupt, 1, 1);
    if (this._waitingRequest) {
      const { header } = inputViews(this.host._buffers.stdinBuffer);
      if (Atomics.load(header, 1) === this._waitingRequest.generation) {
        this._waitingRequest = null;
        this._setInputDwell(false);
        Atomics.store(header, 0, INPUT_CANCELLED);
        Atomics.notify(header, 0);
      }
    } else if (!this._signalTimer) {
      this._signalTimer = setTimeout(() => {
        if (!this._finished) {
          Atomics.store(interrupt, 0, 2);
        }
      }, this.host.signalDelayMs);
    }
    if (!this._hardTimer) {
      this._hardTimer = setTimeout(
        () => this.host._hardTerminate(this, "killed"),
        this.host.graceMs,
      );
    }
  }

  cancelInput() {
    if (!this._waitingRequest) {
      throw new Error("no input request is outstanding");
    }
    this.interrupt();
  }

  async wait() {
    return this._waitPromise;
  }

  async close() {
    if (!this._finished) {
      this.host._hardTerminate(this, "killed");
    }
    await this._waitPromise;
  }

  _acceptRecordLine(line) {
    const validationState = this._validator.snapshot();
    const record = this._validator.acceptLine(line);
    this._recordList.push(record);
    this._recordLines.push(line);
    if (
      record.kind === "step" &&
      record.event === "input" &&
      this.host.useSharedMemory
    ) {
      this._setInputDwell(true);
      this._pendingInputRecord = record;
      return;
    }
    if (record.kind === "terminal") {
      this.summary = terminalSummary(this.runId, record);
      this._pendingTerminalRecord = record;
      this._preTerminalValidationState = validationState;
      return;
    }
    this.records.push(record);
  }

  _acceptInputWait(requestId, generation) {
    const record = this._pendingInputRecord;
    if (
      !record ||
      record.event_data?.request_id !== requestId ||
      !Number.isInteger(generation) ||
      generation < 1
    ) {
      throw new Error("worker input rendezvous is invalid");
    }
    const { header } = inputViews(this.host._buffers.stdinBuffer);
    if (
      Atomics.load(header, 0) !== INPUT_WAITING ||
      Atomics.load(header, 1) !== generation
    ) {
      throw new Error("worker input generation is stale");
    }
    this._waitingRequest = { generation, requestId };
    this._pendingInputRecord = null;
    this.records.push(record);
  }

  _completeFromWorker(result) {
    if (!this.summary || this._recordList.at(-1)?.kind !== "terminal") {
      throw new Error("worker completed without a terminal");
    }
    if (
      canonicalLine(result?.summary) !== canonicalLine(this.summary)
    ) {
      throw new Error("worker summary does not match terminal");
    }
    this._validator.finish();
    this.records.push(this._pendingTerminalRecord);
    this._pendingTerminalRecord = null;
    this._finish();
    this.host._sessionCompleted(this, result.health === true);
  }

  _completeSynthetic(reason) {
    if (this._finished) {
      return;
    }
    if (this._pendingInputRecord) {
      this.records.push(this._pendingInputRecord);
      this._pendingInputRecord = null;
    }
    if (this._pendingTerminalRecord) {
      this._recordList.pop();
      this._recordLines.pop();
      this._pendingTerminalRecord = null;
      this.summary = null;
      this._validator.restore(this._preTerminalValidationState);
      this._preTerminalValidationState = null;
    }
    if (this._recordList.length === 0) {
      const line = canonicalLine(this._fallbackHeader);
      this._validator.acceptLine(line);
      this._recordList.push(this._fallbackHeader);
      this._recordLines.push(line);
      this.records.push(this._fallbackHeader);
    }
    if (this._recordList.at(-1)?.kind !== "terminal") {
      const prefixBytes = this._recordLines.reduce(
        (total, line) => total + lineBytes(line),
        0,
      );
      const { line, record } = synthesizeTerminal(
        this._recordList,
        this.options,
        reason,
        prefixBytes,
      );
      this._validator.acceptLine(line);
      this._recordList.push(record);
      this._recordLines.push(line);
      this.records.push(record);
      this.summary = terminalSummary(this.runId, record);
    }
    this._validator.finish();
    this._finish();
  }

  _startWatchdog() {
    this._previousTime = performance.now();
    this._watchdog = setInterval(() => {
      const current = performance.now();
      if (!this._inputDwell) {
        this._elapsedMs += current - this._previousTime;
      }
      this._previousTime = current;
      if (this._elapsedMs >= this.options.wall_clock_s * 1000) {
        clearInterval(this._watchdog);
        this._watchdog = null;
        void this.interrupt();
      }
    }, 25);
  }

  _finish() {
    if (this._finished) {
      return;
    }
    this._finished = true;
    this._waitingRequest = null;
    this._inputDwell = false;
    if (this._watchdog) {
      clearInterval(this._watchdog);
      this._watchdog = null;
    }
    if (this._hardTimer) {
      clearTimeout(this._hardTimer);
      this._hardTimer = null;
    }
    if (this._signalTimer) {
      clearTimeout(this._signalTimer);
      this._signalTimer = null;
    }
    this.records.end();
    this._resolveWait(this.summary);
  }

  _setInputDwell(paused) {
    if (paused === this._inputDwell) {
      return;
    }
    const current = performance.now();
    if (!this._inputDwell && this._previousTime > 0) {
      this._elapsedMs += current - this._previousTime;
    }
    this._previousTime = current;
    this._inputDwell = paused;
  }
}

class AsyncRecordQueue {
  constructor() {
    this.values = [];
    this.waiters = [];
    this.done = false;
  }

  push(value) {
    if (this.done) {
      throw new Error("record queue is closed");
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value });
    } else {
      this.values.push(value);
    }
  }

  end() {
    this.done = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  next() {
    if (this.values.length > 0) {
      return Promise.resolve({ done: false, value: this.values.shift() });
    }
    if (this.done) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

function normalizeOptions(options) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new TypeError("options must be an object");
  }
  const optionNames = new Set(Object.keys(defaultTraceOptions));
  const unknown = Object.keys(options).filter((name) => !optionNames.has(name));
  if (unknown.length > 0) {
    throw new TypeError(`unknown trace option: ${unknown[0]}`);
  }
  const merged = {
    ...defaultTraceOptions,
    ...options,
    trace_modules: [...(options.trace_modules ?? defaultTraceOptions.trace_modules)],
  };
  for (const name of [
    "identity_tombstones",
    "max_container_elems",
    "max_heap_edges",
    "max_heap_nodes",
    "max_input_line_bytes",
    "max_output_bytes",
    "max_record_bytes",
    "max_source_bytes",
    "max_steps",
    "max_trace_bytes",
  ]) {
    if (!Number.isSafeInteger(merged[name]) || merged[name] <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  if (!Number.isFinite(merged.wall_clock_s) || merged.wall_clock_s <= 0) {
    throw new TypeError("wall_clock_s must be a finite positive number");
  }
  if (
    !Array.isArray(merged.trace_modules) ||
    new Set(merged.trace_modules).size !== merged.trace_modules.length ||
    merged.trace_modules.some((name) => typeof name !== "string" || name.length === 0)
  ) {
    throw new TypeError("trace_modules must contain unique non-empty strings");
  }
  if (
    typeof merged.echo_stdin !== "boolean" ||
    typeof merged.show_dunder_attributes !== "boolean"
  ) {
    throw new TypeError("trace option switches must be boolean");
  }
  return merged;
}

function terminalSummary(runId, terminal) {
  const summary = terminal.summary;
  return {
    diagnostic_count: summary.diagnostic_count,
    run_id: runId,
    stderr_bytes: summary.stderr_bytes,
    stdout_bytes: summary.stdout_bytes,
    step_count: summary.step_count,
    terminal_reason: terminal.reason,
    terminal_seq: terminal.seq,
    trace_bytes: summary.trace_bytes,
    trace_complete: terminal.trace_complete,
  };
}
