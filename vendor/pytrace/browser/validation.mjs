import { canonicalLine, lineBytes } from "./protocol.mjs";

const encoder = new TextEncoder();

const TOP_LEVEL_KEYS = Object.freeze({
  diagnostic: new Set([
    "kind",
    "seq",
    "severity",
    "code",
    "message",
    "at_step",
    "details",
  ]),
  header: new Set([
    "kind",
    "seq",
    "format",
    "run_id",
    "engine_version",
    "python_version",
    "backend",
    "source",
    "source_sha256",
    "options",
    "host",
  ]),
  step: new Set([
    "kind",
    "seq",
    "step",
    "event",
    "location",
    "stack",
    "globals",
    "closure_environments",
    "heap",
    "output",
    "flags",
    "event_data",
  ]),
  terminal: new Set([
    "kind",
    "seq",
    "reason",
    "synthetic",
    "trace_complete",
    "summary",
    "exception",
  ]),
});

const REQUIRED_TOP_LEVEL_KEYS = Object.freeze({
  diagnostic: new Set(["kind", "seq", "severity", "code", "message"]),
  header: TOP_LEVEL_KEYS.header,
  step: new Set(
    [...TOP_LEVEL_KEYS.step].filter((name) => name !== "event_data"),
  ),
  terminal: new Set([
    "kind",
    "seq",
    "reason",
    "synthetic",
    "trace_complete",
    "summary",
  ]),
});

const STEP_EVENTS = new Set([
  "call",
  "resume",
  "line",
  "yield",
  "return",
  "exception",
  "unwind",
  "input",
]);

const TERMINAL_REASONS = new Set([
  "completed",
  "uncaught_exception",
  "step_limit",
  "trace_limit",
  "needs_input",
  "interrupted",
  "killed",
  "engine_error",
]);

const REFERENCE_FREE_SCALARS = new Set([
  "none",
  "bool",
  "int",
  "float",
  "str",
  "bytes",
  "complex",
  "range",
  "slice",
  "ellipsis",
  "not_implemented",
]);

export async function fetchCanonicalSchema(
  schemaUrl = new URL("../schema/trace-engine-1.schema.json", import.meta.url),
) {
  const response = await fetch(schemaUrl);
  if (!response.ok) {
    throw new Error(`canonical schema request failed with ${response.status}`);
  }
  const schema = await response.json();
  if (!isObject(schema)) {
    throw new Error("canonical schema must be an object");
  }
  return schema;
}

export class IncrementalStreamValidator {
  constructor(schema, expectedHeader, options) {
    if (!isObject(schema) || !isObject(expectedHeader)) {
      throw new TypeError("stream validator requires a schema and expected header");
    }
    this.schema = schema;
    this.expectedHeader = expectedHeader;
    this.options = options;
    this.expectedSeq = 0;
    this.stepCount = 0;
    this.diagnosticCount = 0;
    this.stdoutBytes = 0;
    this.stderrBytes = 0;
    this.traceBytes = 0;
    this.traceModules = null;
    this.terminalSeen = false;
  }

  acceptLine(line) {
    if (typeof line !== "string" || !line.endsWith("\n")) {
      throw new Error("worker record is not NDJSON");
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error("worker record is not valid JSON");
    }
    if (!isObject(record) || canonicalLine(record) !== line) {
      throw new Error("worker record is not canonical NDJSON");
    }
    const payloadBytes = lineBytes(line);
    if (payloadBytes > this.options.max_record_bytes) {
      throw new Error("worker record exceeds max_record_bytes");
    }
    if (this.traceBytes + payloadBytes > this.options.max_trace_bytes) {
      throw new Error("worker stream exceeds max_trace_bytes");
    }
    this.accept(record, payloadBytes);
    return record;
  }

  accept(record, payloadBytes = lineBytes(canonicalLine(record))) {
    if (this.terminalSeen) {
      throw new Error("stream contains a record after terminal");
    }
    validateTopLevel(record);
    if (!Number.isSafeInteger(record.seq) || record.seq !== this.expectedSeq) {
      throw new Error("record seq values must be contiguous safe integers");
    }

    let nextStdout = this.stdoutBytes;
    let nextStderr = this.stderrBytes;
    let nextStepCount = this.stepCount;
    let nextDiagnosticCount = this.diagnosticCount;
    let nextTraceModules = this.traceModules;
    let terminalSeen = false;

    if (this.expectedSeq === 0) {
      if (record.kind !== "header") {
        throw new Error("stream must begin with header seq 0");
      }
      if (!jsonEqual(record, this.expectedHeader)) {
        throw new Error("worker header does not match the requested run");
      }
      nextTraceModules = validateHeader(record);
    } else if (record.kind === "header") {
      throw new Error("stream must contain exactly one header");
    } else if (this.traceModules === null) {
      throw new Error("stream header state is missing");
    }

    if (record.kind === "step") {
      if (!Number.isSafeInteger(record.step) || record.step !== this.stepCount) {
        throw new Error("step values must be contiguous safe integers");
      }
      if (this.stepCount >= this.options.max_steps) {
        throw new Error("worker stream exceeds max_steps");
      }
      [nextStdout, nextStderr] = validateStep(
        record,
        this.stdoutBytes,
        this.stderrBytes,
        this.traceModules ?? [],
      );
      if (nextStdout + nextStderr > this.options.max_output_bytes) {
        throw new Error("worker output exceeds max_output_bytes");
      }
      nextStepCount += 1;
    } else if (record.kind === "diagnostic") {
      validateDiagnostic(record, this.stepCount);
      nextDiagnosticCount += 1;
    } else if (record.kind === "terminal") {
      validateTerminalCombination(record);
      validateTerminalSummary(record, {
        diagnostic_count: this.diagnosticCount,
        stderr_bytes: this.stderrBytes,
        stdout_bytes: this.stdoutBytes,
        step_count: this.stepCount,
        trace_bytes: this.traceBytes + payloadBytes,
      });
      terminalSeen = true;
    }

    validateSchema(record, this.schema, this.schema);
    this.expectedSeq += 1;
    this.stepCount = nextStepCount;
    this.diagnosticCount = nextDiagnosticCount;
    this.stdoutBytes = nextStdout;
    this.stderrBytes = nextStderr;
    this.traceBytes += payloadBytes;
    this.traceModules = nextTraceModules;
    this.terminalSeen = terminalSeen;
  }

  finish() {
    if (this.expectedSeq === 0) {
      throw new Error("stream is empty");
    }
    if (!this.terminalSeen) {
      throw new Error("stream must end with one terminal");
    }
  }

  snapshot() {
    return {
      diagnosticCount: this.diagnosticCount,
      expectedSeq: this.expectedSeq,
      stderrBytes: this.stderrBytes,
      stdoutBytes: this.stdoutBytes,
      stepCount: this.stepCount,
      terminalSeen: this.terminalSeen,
      traceBytes: this.traceBytes,
      traceModules:
        this.traceModules === null ? null : structuredClone(this.traceModules),
    };
  }

  restore(snapshot) {
    this.diagnosticCount = snapshot.diagnosticCount;
    this.expectedSeq = snapshot.expectedSeq;
    this.stderrBytes = snapshot.stderrBytes;
    this.stdoutBytes = snapshot.stdoutBytes;
    this.stepCount = snapshot.stepCount;
    this.terminalSeen = snapshot.terminalSeen;
    this.traceBytes = snapshot.traceBytes;
    this.traceModules =
      snapshot.traceModules === null
        ? null
        : structuredClone(snapshot.traceModules);
  }
}

export function validateSchema(instance, schema, root = schema) {
  if (schema === true) {
    return;
  }
  if (schema === false || !isObject(schema)) {
    throw new Error("record violates the canonical JSON Schema");
  }

  if ("$ref" in schema) {
    if (typeof schema.$ref !== "string") {
      throw new Error("record violates the canonical JSON Schema");
    }
    validateSchema(instance, resolveReference(schema.$ref, root), root);
  }
  if ("type" in schema && !hasJsonType(instance, schema.type)) {
    throw new Error("record violates the canonical JSON Schema");
  }
  if ("const" in schema && !jsonEqual(instance, schema.const)) {
    throw new Error("record violates the canonical JSON Schema");
  }
  if (
    "enum" in schema &&
    (!Array.isArray(schema.enum) ||
      !schema.enum.some((choice) => jsonEqual(instance, choice)))
  ) {
    throw new Error("record violates the canonical JSON Schema");
  }
  if (
    "oneOf" in schema &&
    (!Array.isArray(schema.oneOf) ||
      schema.oneOf.filter((branch) => matches(instance, branch, root)).length !==
        1)
  ) {
    throw new Error("record violates the canonical JSON Schema");
  }
  if ("allOf" in schema) {
    if (!Array.isArray(schema.allOf)) {
      throw new Error("record violates the canonical JSON Schema");
    }
    for (const branch of schema.allOf) {
      validateSchema(instance, branch, root);
    }
  }
  if ("not" in schema && matches(instance, schema.not, root)) {
    throw new Error("record violates the canonical JSON Schema");
  }
  if ("if" in schema) {
    const branch = matches(instance, schema.if, root)
      ? schema.then
      : schema.else;
    if (branch !== undefined) {
      validateSchema(instance, branch, root);
    }
  }

  if (isObject(instance)) {
    validateObject(instance, schema, root);
  } else if (Array.isArray(instance)) {
    validateArray(instance, schema, root);
  } else if (typeof instance === "string") {
    validateString(instance, schema);
  } else if (isJsonNumber(instance)) {
    validateNumber(instance, schema);
  }
}

function validateObject(instance, schema, root) {
  const required = schema.required ?? [];
  if (
    !Array.isArray(required) ||
    required.some((name) => !Object.hasOwn(instance, name))
  ) {
    throw new Error("record violates the canonical JSON Schema");
  }
  const properties = schema.properties ?? {};
  if (!isObject(properties)) {
    throw new Error("record violates the canonical JSON Schema");
  }
  for (const [name, subschema] of Object.entries(properties)) {
    if (Object.hasOwn(instance, name)) {
      validateSchema(instance[name], subschema, root);
    }
  }
  if (
    schema.additionalProperties === false &&
    Object.keys(instance).some((name) => !Object.hasOwn(properties, name))
  ) {
    throw new Error("record violates the canonical JSON Schema");
  }
}

function validateArray(instance, schema, root) {
  if (
    "minItems" in schema &&
    (!Number.isInteger(schema.minItems) ||
      instance.length < schema.minItems)
  ) {
    throw new Error("record violates the canonical JSON Schema");
  }
  if (
    schema.uniqueItems === true &&
    instance.some((value, index) =>
      instance.slice(index + 1).some((other) => jsonEqual(value, other)),
    )
  ) {
    throw new Error("record violates the canonical JSON Schema");
  }
  if ("items" in schema) {
    for (const value of instance) {
      validateSchema(value, schema.items, root);
    }
  }
}

function validateString(instance, schema) {
  if (
    "minLength" in schema &&
    (!Number.isInteger(schema.minLength) ||
      [...instance].length < schema.minLength)
  ) {
    throw new Error("record violates the canonical JSON Schema");
  }
  if (
    "pattern" in schema &&
    (typeof schema.pattern !== "string" ||
      !new RegExp(schema.pattern, "u").test(instance))
  ) {
    throw new Error("record violates the canonical JSON Schema");
  }
}

function validateNumber(instance, schema) {
  if ("minimum" in schema && instance < schema.minimum) {
    throw new Error("record violates the canonical JSON Schema");
  }
  if ("exclusiveMinimum" in schema && instance <= schema.exclusiveMinimum) {
    throw new Error("record violates the canonical JSON Schema");
  }
}

function resolveReference(reference, root) {
  if (!reference.startsWith("#/")) {
    throw new Error("record violates the canonical JSON Schema");
  }
  let current = root;
  for (const rawPart of reference.slice(2).split("/")) {
    const part = rawPart.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(current) || !Object.hasOwn(current, part)) {
      throw new Error("record violates the canonical JSON Schema");
    }
    current = current[part];
  }
  return current;
}

function matches(instance, schema, root) {
  try {
    validateSchema(instance, schema, root);
  } catch {
    return false;
  }
  return true;
}

function hasJsonType(instance, expected) {
  if (Array.isArray(expected)) {
    return expected.some((candidate) => hasJsonType(instance, candidate));
  }
  if (typeof expected !== "string") {
    return false;
  }
  return {
    array: Array.isArray(instance),
    boolean: typeof instance === "boolean",
    integer: Number.isInteger(instance),
    null: instance === null,
    number: isJsonNumber(instance),
    object: isObject(instance),
    string: typeof instance === "string",
  }[expected];
}

function validateTopLevel(record) {
  const allowed = TOP_LEVEL_KEYS[record.kind];
  const required = REQUIRED_TOP_LEVEL_KEYS[record.kind];
  if (!allowed || !required) {
    throw new Error("unknown record kind");
  }
  const keys = Object.keys(record);
  if (
    [...required].some((name) => !Object.hasOwn(record, name)) ||
    keys.some((name) => !allowed.has(name))
  ) {
    throw new Error(`${record.kind} record fields are invalid`);
  }
  if (record.kind === "step") {
    validateEventCombination(record);
  }
}

function validateEventCombination(record) {
  if (!STEP_EVENTS.has(record.event)) {
    throw new Error("unknown step event");
  }
  if (["call", "resume", "line"].includes(record.event)) {
    if (Object.hasOwn(record, "event_data")) {
      throw new Error(`${record.event} must not have event_data`);
    }
    return;
  }
  if (!isObject(record.event_data)) {
    throw new Error(`${record.event} requires event_data`);
  }
  const expected = {
    exception: "exception",
    input: "input",
    return: "value",
    unwind: "exception",
    yield: "value",
  }[record.event];
  if (record.event_data.kind !== expected) {
    throw new Error(`${record.event} has incompatible event_data`);
  }
}

function validateHeader(header) {
  if (header.format !== "trace-engine/1" || header.backend !== "settrace") {
    throw new Error("header format or backend is invalid");
  }
  if (
    !isObject(header.options) ||
    !Array.isArray(header.options.trace_modules) ||
    header.options.trace_modules.some((name) => typeof name !== "string") ||
    !isObject(header.host)
  ) {
    throw new Error("header options or host is invalid");
  }
  return structuredClone(header.options.trace_modules);
}

function validateDiagnostic(record, stepCount) {
  if (
    !["warning", "error"].includes(record.severity) ||
    typeof record.code !== "string" ||
    record.code.length === 0 ||
    typeof record.message !== "string"
  ) {
    throw new Error("diagnostic fields are invalid");
  }
  if (
    Object.hasOwn(record, "at_step") &&
    (!Number.isSafeInteger(record.at_step) ||
      record.at_step < 0 ||
      record.at_step > stepCount)
  ) {
    throw new Error("diagnostic at_step is invalid");
  }
  if (Object.hasOwn(record, "details") && !isObject(record.details)) {
    throw new Error("diagnostic details must be an object");
  }
}

function validateTerminalSummary(terminal, expected) {
  if (!isObject(terminal.summary)) {
    throw new Error("terminal summary must be an object");
  }
  for (const [name, value] of Object.entries(expected)) {
    if (
      !Number.isSafeInteger(terminal.summary[name]) ||
      terminal.summary[name] !== value
    ) {
      throw new Error(`terminal summary ${name} mismatch`);
    }
  }
  if (
    Object.hasOwn(terminal, "exception") &&
    (!isObject(terminal.exception) ||
      typeof terminal.exception.type_name !== "string" ||
      terminal.exception.type_name.length === 0)
  ) {
    throw new Error("terminal exception is invalid");
  }
}

function validateStep(record, stdoutBytes, stderrBytes, traceModules) {
  const heap = requireArray(record, "heap");
  const heapNodes = heap.map((value) => requireObject(value, "heap node"));
  const heapUids = heapNodes.map((node) => requirePositiveInteger(node, "uid"));
  if (new Set(heapUids).size !== heapUids.length) {
    throw new Error("heap UIDs must be unique within a step");
  }

  const stack = requireArray(record, "stack");
  if (stack.length === 0) {
    throw new Error("step stack must not be empty");
  }
  const frames = stack.map((value) => requireObject(value, "frame"));
  const frameIds = frames.map((frame) =>
    requirePositiveInteger(frame, "frame_id"),
  );
  if (new Set(frameIds).size !== frameIds.length) {
    throw new Error("frame IDs must be unique within a step");
  }

  const globalRecords = requireArray(record, "globals");
  const modules = globalRecords.map((value) =>
    requireString(requireObject(value, "global scope"), "module"),
  );
  if (!jsonEqual(modules, ["__main__", ...traceModules])) {
    throw new Error("global scopes do not match trace_modules order");
  }
  for (const frame of frames) {
    validateUniqueBindings(requireArray(frame, "locals"));
  }
  for (const value of globalRecords) {
    validateUniqueBindings(
      requireArray(requireObject(value, "global scope"), "bindings"),
    );
  }

  const environments = requireArray(record, "closure_environments").map(
    (value) => requireObject(value, "closure environment"),
  );
  const environmentIds = environments.map((environment) =>
    requirePositiveInteger(environment, "environment_id"),
  );
  if (new Set(environmentIds).size !== environmentIds.length) {
    throw new Error("closure environment IDs must be unique");
  }

  const uidSet = new Set(heapUids);
  for (const uid of referencedUids(record)) {
    if (!uidSet.has(uid)) {
      throw new Error("step contains a dangling REF");
    }
  }
  const nodeByUid = new Map(
    heapUids.map((uid, index) => [uid, heapNodes[index]]),
  );
  for (const environment of environments) {
    for (const value of requireArray(environment, "cells")) {
      const binding = requireObject(value, "closure cell binding");
      const cellValue = requireObject(binding.value, "value");
      const uid = requirePositiveInteger(cellValue, "uid");
      if (
        cellValue.kind !== "ref" ||
        nodeByUid.get(uid)?.kind !== "cell"
      ) {
        throw new Error("closure cell reference must resolve to a cell node");
      }
    }
  }
  validateFunctionLinks(
    heapNodes,
    new Set(frameIds),
    new Set(environmentIds),
  );
  validateBytesValues(record);
  validateSetNodes(heapNodes);

  const output = requireObject(record.output, "output");
  const stdoutDelta = requireString(output, "stdout_delta");
  const stderrDelta = requireString(output, "stderr_delta");
  const nextStdout = stdoutBytes + encoder.encode(stdoutDelta).byteLength;
  const nextStderr = stderrBytes + encoder.encode(stderrDelta).byteLength;
  if (
    output.stdout_bytes !== nextStdout ||
    output.stderr_bytes !== nextStderr
  ) {
    throw new Error("output offset mismatch");
  }
  return [nextStdout, nextStderr];
}

function validateFunctionLinks(heapNodes, frameIds, environmentIds) {
  for (const node of heapNodes) {
    if (node.kind !== "function") {
      continue;
    }
    if (
      (node.provenance === "resolved" &&
        !frameIds.has(node.defining_frame_id)) ||
      (node.provenance === "unknown" &&
        Object.hasOwn(node, "defining_frame_id")) ||
      !["resolved", "unknown"].includes(node.provenance)
    ) {
      throw new Error("function provenance is invalid");
    }
    if (
      node.closure_environment_id !== undefined &&
      !environmentIds.has(node.closure_environment_id)
    ) {
      throw new Error("function has invalid closure environment");
    }
  }
}

function validateBytesValues(record) {
  for (const value of walkObjects(record)) {
    if (value.kind !== "bytes") {
      continue;
    }
    if (
      typeof value.base64 !== "string" ||
      !Number.isSafeInteger(value.length) ||
      value.length < 0
    ) {
      throw new Error("invalid bytes value");
    }
    let decoded;
    try {
      decoded = atob(value.base64);
    } catch {
      throw new Error("bytes value is not canonical base64");
    }
    const reencoded = btoa(decoded);
    if (reencoded !== value.base64 || decoded.length !== value.length) {
      throw new Error("bytes value length or base64 mismatch");
    }
  }
}

function validateSetNodes(heapNodes) {
  for (const node of heapNodes) {
    if (!["set", "frozenset"].includes(node.kind)) {
      continue;
    }
    const items = requireArray(node, "items");
    const canonicalAllowed =
      node.elided_count === 0 && items.every(isReferenceFreeScalar);
    const expected = canonicalAllowed ? "canonical" : "unordered";
    if (node.ordering !== expected) {
      throw new Error("set ordering declaration is invalid");
    }
    if (canonicalAllowed) {
      const payloads = items.map((item) =>
        canonicalLine(requireObject(item, "set item")),
      );
      const sorted = [...payloads].sort();
      if (!jsonEqual(payloads, sorted)) {
        throw new Error("canonical set items are not sorted");
      }
    }
  }
}

function isReferenceFreeScalar(value) {
  if (!isObject(value) || !REFERENCE_FREE_SCALARS.has(value.kind)) {
    return false;
  }
  if (value.kind === "slice") {
    return ["start", "stop", "step"].every((name) =>
      isReferenceFreeScalar(value[name]),
    );
  }
  return !walkObjects(value).some((nested) =>
    ["ref", "elided"].includes(nested.kind),
  );
}

function validateUniqueBindings(values) {
  const names = values.map((value) =>
    requireString(requireObject(value, "binding"), "name"),
  );
  if (new Set(names).size !== names.length) {
    throw new Error("binding names must be unique");
  }
}

function validateTerminalCombination(terminal) {
  if (!TERMINAL_REASONS.has(terminal.reason)) {
    throw new Error("unknown terminal reason");
  }
  let valid;
  if (terminal.reason === "killed") {
    valid = terminal.synthetic === true && terminal.trace_complete === false;
  } else if (terminal.reason === "engine_error") {
    valid =
      (terminal.synthetic === false && terminal.trace_complete === true) ||
      (terminal.synthetic === true && terminal.trace_complete === false);
  } else {
    valid = terminal.synthetic === false && terminal.trace_complete === true;
  }
  if (
    !valid ||
    (terminal.reason === "uncaught_exception") !==
      Object.hasOwn(terminal, "exception")
  ) {
    throw new Error("terminal fields do not match its reason");
  }
}

function referencedUids(value) {
  const result = new Set();
  for (const nested of walkObjects(value)) {
    if (nested.kind === "ref") {
      result.add(requirePositiveInteger(nested, "uid"));
    }
  }
  return result;
}

function walkObjects(value) {
  const result = [];
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (isObject(current)) {
      result.push(current);
      stack.push(...Object.values(current));
    } else if (Array.isArray(current)) {
      stack.push(...current);
    }
  }
  return result;
}

function requireObject(value, description) {
  if (!isObject(value)) {
    throw new Error(`${description} must be an object`);
  }
  return value;
}

function requireArray(record, name) {
  if (!Array.isArray(record[name])) {
    throw new Error(`${name} must be an array`);
  }
  return record[name];
}

function requireString(record, name) {
  if (typeof record[name] !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return record[name];
}

function requirePositiveInteger(record, name) {
  if (!Number.isSafeInteger(record[name]) || record[name] < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return record[name];
}

function isObject(value) {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

function isJsonNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function jsonEqual(left, right) {
  if (isJsonNumber(left) && isJsonNumber(right)) {
    return left === right;
  }
  if (typeof left !== typeof right || left === null || right === null) {
    return left === right;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index]))
    );
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (name) =>
          Object.hasOwn(right, name) && jsonEqual(left[name], right[name]),
      )
    );
  }
  return left === right;
}
