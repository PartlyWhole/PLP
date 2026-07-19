export const INPUT_IDLE = 0;
export const INPUT_WAITING = 1;
export const INPUT_READY = 2;
export const INPUT_CANCELLED = 3;
export const INPUT_HEADER_INTS = 4;
export const DEFAULT_MAX_INPUT_BYTES = 64 * 1024;

const encoder = new TextEncoder();

export function canonicalLine(record) {
  const ordered = orderKeys(record);
  return `${asciiJson(JSON.stringify(ordered))}\n`;
}

export function lineBytes(line) {
  return encoder.encode(line).byteLength;
}

export function synthesizeTerminal(records, options, reason, prefixBytesOverride) {
  const steps = records.filter((record) => record.kind === "step");
  const diagnostics = records.filter((record) => record.kind === "diagnostic");
  const output = steps.at(-1)?.output ?? {};
  const terminal = {
    kind: "terminal",
    reason,
    seq: records.length,
    summary: {
      diagnostic_count: diagnostics.length,
      stderr_bytes: output.stderr_bytes ?? 0,
      stdout_bytes: output.stdout_bytes ?? 0,
      step_count: steps.length,
      trace_bytes: 1,
    },
    synthetic: true,
    trace_complete: false,
  };
  const prefixBytes =
    prefixBytesOverride ??
    records.reduce((total, record) => total + lineBytes(canonicalLine(record)), 0);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const line = canonicalLine(terminal);
    const stable = prefixBytes + lineBytes(line);
    if (stable === terminal.summary.trace_bytes) {
      if (lineBytes(line) > options.max_record_bytes) {
        throw new Error("synthetic terminal exceeds max_record_bytes");
      }
      if (stable > options.max_trace_bytes) {
        throw new Error("synthetic terminal exceeds max_trace_bytes");
      }
      return { line, record: terminal };
    }
    terminal.summary.trace_bytes = stable;
  }
  throw new Error("synthetic terminal byte count did not stabilize");
}

export function createInputBuffers(maxInputBytes = DEFAULT_MAX_INPUT_BYTES) {
  const interruptBuffer = new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT);
  const stdinBuffer = new SharedArrayBuffer(
    INPUT_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT + maxInputBytes,
  );
  return { interruptBuffer, stdinBuffer };
}

export function inputViews(stdinBuffer) {
  return {
    bytes: new Uint8Array(
      stdinBuffer,
      INPUT_HEADER_INTS * Int32Array.BYTES_PER_ELEMENT,
    ),
    header: new Int32Array(stdinBuffer, 0, INPUT_HEADER_INTS),
  };
}

function orderKeys(value) {
  if (Array.isArray(value)) {
    return value.map(orderKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, orderKeys(value[key])]),
    );
  }
  return value;
}

function asciiJson(text) {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) {
      result += text[index];
    } else {
      result += `\\u${code.toString(16).padStart(4, "0")}`;
    }
  }
  return result;
}
