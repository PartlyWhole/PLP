// Trust boundary for trace records that did NOT come from the local engine.
//
// Locally, every record is schema-validated by PyTrace's browser facade
// before the UI ever sees it, so the renderers may assume well-formed data
// (uids are integers, kinds are from a closed set, …). Records arriving
// over collaboration come from another peer's document instead: any peer
// holding a room link can write arbitrary JSON there. This module is the
// gate that restores the local invariant before such a record reaches
// renderRecordToUI — without it, a crafted `uid` becomes markup in every
// follower's page.
//
// Policy: structural allowlist, not sanitization. A record that does not
// look exactly like engine output is dropped whole, because a partially
// valid trace record has no meaningful rendering anyway.

const RECORD_KINDS = new Set(["header", "step", "diagnostic", "terminal"]);
const VALUE_KINDS = new Set([
  "none", "bool", "int", "float", "str", "bytes", "complex", "range", "slice",
  "ellipsis", "not_implemented", "ref", "elided",
]);

// Depth/breadth caps: a hostile peer should not be able to freeze a
// follower with a pathologically nested or enormous record.
const MAX_DEPTH = 24;
const MAX_NODES = 20000;
const MAX_STRING = 200_000;

const isSafeUid = (v) => Number.isSafeInteger(v) && v >= 0;

// Walks a parsed record, enforcing: known kinds, integer uids, string
// fields that are actually strings, and the size caps above.
function checkValue(value, state, depth) {
  if (depth > MAX_DEPTH) return false;
  if (++state.nodes > MAX_NODES) return false;
  if (value === null || typeof value === "boolean" || typeof value === "number") return true;
  if (typeof value === "string") return value.length <= MAX_STRING;
  if (Array.isArray(value)) return value.every((v) => checkValue(v, state, depth + 1));
  if (typeof value !== "object") return false; // functions/symbols/undefined

  // Any object carrying a `kind` that names an encoded value must obey that
  // vocabulary; `ref` in particular must carry an integer uid.
  if (typeof value.kind === "string" && VALUE_KINDS.has(value.kind)) {
    if (value.kind === "ref" && !isSafeUid(value.uid)) return false;
  }
  // Heap nodes are identified by uid wherever one appears.
  if ("uid" in value && !isSafeUid(value.uid)) return false;

  return Object.values(value).every((v) => checkValue(v, state, depth + 1));
}

// Returns true when `record` is shaped like engine output and safe to
// render. Never throws.
export function isRenderableRecord(record) {
  try {
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;
    if (!RECORD_KINDS.has(record.kind)) return false;
    if (record.seq !== undefined && !Number.isSafeInteger(record.seq)) return false;
    if (record.kind === "step") {
      if (!Number.isSafeInteger(record.step)) return false;
      if (typeof record.event !== "string") return false;
      const loc = record.location;
      if (loc !== undefined && (typeof loc !== "object" || loc === null
        || (loc.line !== undefined && !Number.isSafeInteger(loc.line)))) return false;
      if (record.heap !== undefined && !Array.isArray(record.heap)) return false;
    }
    return checkValue(record, { nodes: 0 }, 0);
  } catch {
    return false;
  }
}
