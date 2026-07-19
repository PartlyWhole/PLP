// Consumer-side cross-record checks for trace-engine/1 streams, per the
// PyTrace integration guidance (order, contiguity, output offset
// reconstruction, in-step REF resolution). Records are already schema- and
// limit-validated by the engine's browser facade before delivery; these are
// the additional duties the handoff assigns to consumers.
// Ported from the Engine Pilot reference implementation.

const encoder = new TextEncoder();

// Walk every EncodedValue reachable in a step record and yield ref uids.
function* refUids(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* refUids(item);
    return;
  }
  if (node && typeof node === "object") {
    if (node.kind === "ref" && typeof node.uid === "number") yield node.uid;
    for (const v of Object.values(node)) yield* refUids(v);
  }
}

// Returns { errors, stdout, stderr } — reconstructed output included so the
// UI can display exactly what the checker verified.
export function traceStreamCheck(records) {
  const errors = [];
  const err = (m) => errors.push(m);
  let stdout = "";
  let stderr = "";
  if (!records.length) return { errors: ["empty stream"], stdout, stderr };

  records.forEach((r, i) => { if (r.seq !== i) err(`seq not contiguous at index ${i}`); });

  const headers = records.filter((r) => r.kind === "header");
  const terminals = records.filter((r) => r.kind === "terminal");
  const steps = records.filter((r) => r.kind === "step");
  const diagnostics = records.filter((r) => r.kind === "diagnostic");

  if (headers.length !== 1) err(`expected exactly one header, found ${headers.length}`);
  else if (records[0].kind !== "header") err("header is not the first record");
  if (terminals.length !== 1) err(`expected exactly one terminal, found ${terminals.length}`);
  else if (records[records.length - 1].kind !== "terminal") err("terminal is not the last record");

  steps.forEach((s, i) => { if (s.step !== i) err(`step counter not contiguous at step index ${i} (got ${s.step})`); });

  for (const s of steps) {
    if (!s.output) continue;
    stdout += s.output.stdout_delta;
    stderr += s.output.stderr_delta;
    const outBytes = encoder.encode(stdout).byteLength;
    const errBytes = encoder.encode(stderr).byteLength;
    if (outBytes !== s.output.stdout_bytes) {
      err(`stdout offset mismatch at step ${s.step}: reconstructed ${outBytes} bytes, record says ${s.output.stdout_bytes}`);
    }
    if (errBytes !== s.output.stderr_bytes) {
      err(`stderr offset mismatch at step ${s.step}: reconstructed ${errBytes} bytes, record says ${s.output.stderr_bytes}`);
    }
    // Every REF must resolve inside the same step's heap.
    const heapUids = new Set((s.heap ?? []).map((n) => n.uid));
    for (const uid of refUids([s.stack, s.globals, s.closure_environments, s.heap])) {
      if (!heapUids.has(uid)) {
        err(`unresolved ref uid ${uid} at step ${s.step}`);
        break; // one report per step is enough
      }
    }
  }

  const term = terminals[0];
  if (term && term.summary) {
    if (term.summary.step_count !== steps.length) {
      err(`terminal step_count ${term.summary.step_count} != observed ${steps.length}`);
    }
    if (term.summary.diagnostic_count !== diagnostics.length) {
      err(`terminal diagnostic_count ${term.summary.diagnostic_count} != observed ${diagnostics.length}`);
    }
    const outBytes = encoder.encode(stdout).byteLength;
    const errBytes = encoder.encode(stderr).byteLength;
    // A host-synthetic terminal reports what the runtime last knew; only
    // check byte totals on engine-produced terminals.
    if (!term.synthetic) {
      if (term.summary.stdout_bytes !== outBytes) err(`terminal stdout_bytes ${term.summary.stdout_bytes} != reconstructed ${outBytes}`);
      if (term.summary.stderr_bytes !== errBytes) err(`terminal stderr_bytes ${term.summary.stderr_bytes} != reconstructed ${errBytes}`);
    }
    // trace_bytes counts canonical wire bytes; not recomputable in-page.
  }
  return { errors, stdout, stderr };
}
