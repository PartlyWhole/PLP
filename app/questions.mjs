// Generative question engine over a trace + source (pilot).
//
// Pure module: no DOM. Given a question context — the program source, the
// raw step records, and the executed-line positions
// (`memory.linePositions()`) — each generator in `questionGenerators`
// produces a serializable Question object with a `grade()` closure:
//
//   {
//     kind, prompt,
//     // kind-specific payload for a UI to render (given/target snapshots,
//     // code lines, shuffled items, …)
//     ...,
//     blanks: [{ id, label, expected }],   // fill-in questions
//     items:  [{ id, text }],              // ordering questions
//     grade(answers) -> { correct, perBlank|perIndex, expected }
//   }
//
// Extensibility: add a generator under a new kind key; the pilot quiz UI
// (quiz.mjs) renders by payload shape, and unknown kinds can ship their own
// renderer. Generators are deterministic under an explicit `seed`/position
// options; without options they self-pick (seeded) sensible targets.
//
// The engine respects the memory model's display filters (hidden bindings
// don't appear in snapshots) so questions match what students see.

import { displayFilters } from "./memory.mjs";
import {
  buildEvaluationPlan,
  gradeEvaluationOrder,
  gradeMemoryGraph,
  memoryGraphAt,
  mergeGraphScopes,
  starterGraph,
} from "./construction.mjs";

// ---- deterministic RNG ----------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- plain-text value rendering (student-typable canonical forms) ---------
export function textValue(v, heap, seen = new Set()) {
  if (v === null || v === undefined) return "?";
  switch (v.kind) {
    case "none": return "None";
    case "bool": return v.value ? "True" : "False";
    case "int": return v.decimal;
    case "float": return v.special ?? v.decimal;
    case "str": return JSON.stringify(v.value);
    case "ellipsis": return "...";
    case "not_implemented": return "NotImplemented";
    case "range": return `range(${textValue(v.start, heap, seen)}, ${textValue(v.stop, heap, seen)}, ${textValue(v.step, heap, seen)})`;
    case "bytes": return `bytes[${v.length}]`;
    case "elided": return "⟨elided⟩";
    case "ref": {
      const n = heap.get(v.uid);
      if (!n) return `obj ${v.uid}`;
      if (seen.has(v.uid)) return "…"; // cycle guard
      seen.add(v.uid);
      const out = textNode(n, heap, seen);
      seen.delete(v.uid);
      return out;
    }
    default: return v.kind;
  }
}

function textNode(n, heap, seen) {
  switch (n.kind) {
    case "list": return `[${(n.items ?? []).map((i) => textValue(i, heap, seen)).join(", ")}]`;
    case "tuple": return `(${(n.items ?? []).map((i) => textValue(i, heap, seen)).join(", ")})`;
    case "set": case "frozenset": return `{${(n.items ?? []).map((i) => textValue(i, heap, seen)).join(", ")}}`;
    case "dict": return `{${(n.entries ?? []).map((e) => `${textValue(e.key, heap, seen)}: ${textValue(e.value, heap, seen)}`).join(", ")}}`;
    case "instance": return `${n.class_qualname ?? "?"}(${(n.attributes ?? []).map((a) => `${a.name}=${textValue(a.value, heap, seen)}`).join(", ")})`;
    case "function": return `function ${n.qualname ?? "?"}`;
    case "class": return `class ${n.qualname ?? "?"}`;
    case "module": return `module ${n.module ?? "?"}`;
    case "generator": return `generator (${n.state ?? "?"})`;
    default: return n.type_name ?? n.kind;
  }
}

// Mirror of the memory model's hidden-binding filters.
function isHiddenBinding(b, heap) {
  if (b.value?.kind !== "ref") return false;
  const node = heap.get(b.value.uid);
  if (displayFilters.hideModuleBindings && node?.kind === "module") return true;
  if (displayFilters.hideFunctionBindings && node?.kind === "function"
    && node.closure_environment_id == null) return true;
  return false;
}

// ---- memory snapshots -----------------------------------------------------
// Flat entry list mirroring the Names table: [{ scope, name, value }].
export function snapshotAt(steps, stateIndex) {
  const s = steps[stateIndex];
  if (!s) return { entries: [] };
  const heap = new Map((s.heap ?? []).map((n) => [n.uid, n]));
  const entries = [];
  for (const g of s.globals ?? []) {
    if (g.module !== "__main__") continue;
    for (const b of g.bindings ?? []) {
      if (isHiddenBinding(b, heap)) continue;
      entries.push({ scope: "globals", name: b.name, value: textValue(b.value, heap) });
    }
  }
  for (const f of s.stack ?? []) {
    if (f.function === "<module>") continue;
    for (const b of f.locals ?? []) {
      if (isHiddenBinding(b, heap)) continue;
      entries.push({ scope: `${f.function}()`, name: b.name, value: textValue(b.value, heap) });
    }
  }
  return { entries };
}

// Program output up to and including steps[stateIndex]'s deltas — the pure
// twin of the console's showUpTo replay (stdout/stderr only; echoed input
// lives in the console chunk store, not in trace records).
export function outputUpTo(steps, stateIndex) {
  let out = "";
  for (let j = 0; j <= stateIndex && j < steps.length; j++) {
    const o = steps[j].output;
    if (o?.stdout_delta) out += o.stdout_delta;
    if (o?.stderr_delta) out += o.stderr_delta;
  }
  return out;
}

const entryKey = (e) => `${e.scope}|${e.name}`;

export function diffSnapshots(before, after) {
  const beforeMap = new Map(before.entries.map((e) => [entryKey(e), e.value]));
  const added = new Set();
  const changed = new Set();
  for (const e of after.entries) {
    const k = entryKey(e);
    if (!beforeMap.has(k)) added.add(k);
    else if (beforeMap.get(k) !== e.value) changed.add(k);
  }
  const afterKeys = new Set(after.entries.map(entryKey));
  const removed = before.entries.map(entryKey).filter((k) => !afterKeys.has(k));
  return { added, changed, removed };
}

// ---- grading --------------------------------------------------------------
// Whitespace-insensitive, quote-style-insensitive comparison so students can
// type '3', ' 3 ', "'hi'" or '"hi"'.
export function normalizeAnswer(s) {
  return String(s ?? "").replace(/\s+/g, "").replace(/'/g, '"');
}

function gradeBlanks(blanks) {
  return (answers = {}) => {
    const perBlank = {};
    for (const b of blanks) {
      perBlank[b.id] = normalizeAnswer(answers[b.id]) === normalizeAnswer(b.expected);
    }
    return {
      correct: blanks.length > 0 && blanks.every((b) => perBlank[b.id]),
      perBlank,
      expected: Object.fromEntries(blanks.map((b) => [b.id, b.expected])),
    };
  };
}

// ---- memory-prediction questions ------------------------------------------
function memoryQuestion(ctx, fromPos, toPos, kind) {
  const P = ctx.positions;
  if (!P[fromPos] || !P[toPos] || fromPos >= toPos) return null;
  const given = snapshotAt(ctx.steps, P[fromPos].stateIndex);
  const target = snapshotAt(ctx.steps, P[toPos].stateIndex);
  const d = diffSnapshots(given, target);
  const blanks = [];
  const entries = target.entries.map((e) => {
    const k = entryKey(e);
    if (d.added.has(k) || d.changed.has(k)) {
      const id = `b${blanks.length}`;
      blanks.push({ id, label: `${e.scope} · ${e.name}`, expected: e.value });
      return { ...e, blankId: id };
    }
    return { ...e, blankId: null };
  });
  if (!blanks.length) return null; // nothing observable changes
  const span = toPos - fromPos === 1
    ? `after the next line (line ${P[toPos].line}) runs`
    : `after execution reaches the state produced by line ${P[toPos].line}`;
  const givenGraph = memoryGraphAt(ctx.steps, P[fromPos].stateIndex);
  const targetGraph = memoryGraphAt(ctx.steps, P[toPos].stateIndex);
  const legacyGrade = gradeBlanks(blanks);
  return {
    kind,
    prompt: `Start from the memory produced by line ${P[fromPos].line}. `
      + `Construct the memory ${span}.`,
    fromLine: P[fromPos].line,
    toLine: P[toPos].line,
    given,
    target: { entries },
    construction: {
      type: "memory-graph",
      mode: "transform",
      starter: mergeGraphScopes(givenGraph, targetGraph),
      target: targetGraph,
    },
    removed: d.removed, // UI may mention frames/names that disappear
    blanks,
    grade(answer) {
      if (answer?.type === "memory-graph-answer") return gradeMemoryGraph(answer.graph, targetGraph);
      return legacyGrade(answer);
    },
  };
}

// Find a (from,to) pair with an observable diff, honoring explicit options.
function pickMemoryPositions(ctx, opts, gap) {
  const P = ctx.positions;
  if (opts.from != null && opts.to != null) return [opts.from, opts.to];
  const rng = mulberry32(opts.seed ?? 42);
  const candidates = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const j = gap === 1 ? i + 1 : Math.min(P.length - 1, i + 2 + Math.floor(rng() * 3));
    if (j > i) candidates.push([i, j]);
  }
  // Rotate the candidate list by a seeded offset, return the first with a diff.
  const off = Math.floor(rng() * candidates.length);
  return { candidates, off };
}

function generateMemoryKind(ctx, opts, gap, kind) {
  const picked = pickMemoryPositions(ctx, opts, gap);
  if (Array.isArray(picked)) {
    const question = memoryQuestion(ctx, picked[0], picked[1], kind);
    return question;
  }
  const { candidates, off } = picked;
  for (let n = 0; n < candidates.length; n++) {
    const [i, j] = candidates[(n + off) % candidates.length];
    const q = memoryQuestion(ctx, i, j, kind);
    if (q) return q;
  }
  return null;
}

function memoryConstructQuestion(ctx, opts = {}) {
  const positions = ctx.positions ?? [];
  const position = opts.position ?? positions.length - 1;
  if (!positions[position]) return null;
  const target = memoryGraphAt(ctx.steps, positions[position].stateIndex);
  if (!target.scopes.some((scope) => scope.bindings.length)) return null;
  const mode = ["blank", "partial", "complete"].includes(opts.mode) ? opts.mode : "blank";
  return {
    kind: "memory-construct",
    prompt: `${mode === "partial" ? "Complete" : "Construct"} the memory state produced by line ${positions[position].line}.`,
    line: positions[position].line,
    construction: { type: "memory-graph", mode, starter: starterGraph(target, mode), target },
    blanks: [],
    grade(answer) {
      if (answer?.type !== "memory-graph-answer") {
        return { correct: false, feedback: ["Construct the memory graph before checking."], expected: target };
      }
      return gradeMemoryGraph(answer.graph, target);
    },
  };
}

// ---- output prediction ------------------------------------------------------
// Text answers compare per-line with trailing whitespace (and trailing blank
// lines) ignored; case, order, and the CONTENT of text are exact.
export function normalizeOutput(s) {
  return String(s ?? "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

// Content-equivalence fallback for container displays: `[1,2, 3]` and
// `[1, 2, 3]` are the same answer in understanding — the spacing is
// Python's printing choice, not a concept under test (same §13 Q4 argument
// as quote style). Inside brackets/parens/braces — and NEVER inside quoted
// text, where spacing IS content — spaces around commas/colons are dropped
// and quote style is unified. The exact form still appears in the reveal.
export function canonicalizeContainers(s) {
  return normalizeOutput(s).split("\n").map((line) => {
    let out = "";
    let quote = null;
    let depth = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        out += c === quote ? '"' : c;
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; out += '"'; continue; }
      if ("[({".includes(c)) depth++;
      if ("])}".includes(c)) depth = Math.max(0, depth - 1);
      if (c === " " && depth > 0) {
        const prev = out[out.length - 1];
        let j = i;
        while (line[j] === " ") j++;
        const next = line[j] ?? "";
        if (",:[({".includes(prev) || ",:])}".includes(next)) continue;
      }
      out += c;
    }
    return out;
  }).join("\n");
}

// State containers are values rather than printed transcripts. For simple
// top-level dict and set displays only, entry order is irrelevant. Lists,
// tuples, nested structure, and quoted-string contents retain their order.
function canonicalizeStateContainer(s) {
  const normalized = canonicalizeContainers(s).trim();
  if (!normalized.startsWith("{") || !normalized.endsWith("}")) return normalized;
  const inner = normalized.slice(1, -1);
  if (!inner) return normalized;

  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let escaped = false;
  const topLevelColons = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\" && quote) { escaped = true; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if ("[({".includes(c)) { depth += 1; continue; }
    if ("])}".includes(c)) { depth -= 1; if (depth < 0) return normalized; continue; }
    if (depth === 0 && c === ":") topLevelColons.push(i);
    if (depth === 0 && c === ",") {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || depth !== 0) return normalized;
  parts.push(inner.slice(start).trim());
  if (parts.some((part) => !part)) return normalized;

  // A simple dict has exactly one top-level colon per entry; a simple set has
  // none. Mixed/ambiguous brace displays fall back to the ordinary canonical
  // spelling instead of accepting more than we understand.
  if (topLevelColons.length !== 0 && topLevelColons.length !== parts.length) return normalized;
  return `{${parts.sort().join(",")}}`;
}

function equivalentStateValue(got, want) {
  return normalizeAnswer(got) === normalizeAnswer(want)
    || canonicalizeContainers(got) === canonicalizeContainers(want)
    || canonicalizeStateContainer(got) === canonicalizeStateContainer(want);
}

function predictOutputQuestion(ctx, opts = {}) {
  const P = ctx.positions;
  if (!P?.length) return null;
  const position = opts.position ?? P.length - 1;
  if (!P[position]) return null;
  const wholeProgram = position === P.length - 1;
  const expected = outputUpTo(ctx.steps, P[position].stateIndex);
  if (normalizeOutput(expected) === "") return null; // nothing printed yet
  return {
    kind: "predict-output",
    prompt: wholeProgram
      ? "What does this program print? Type the exact output."
      : `What has been printed once line ${P[position].line} has run? Type the exact output so far.`,
    line: P[position].line,
    wholeProgram,
    blanks: [],
    grade(answer) {
      const got = normalizeOutput(answer?.text);
      const want = normalizeOutput(expected);
      // Exact first; else the container-canonical forms must match (same
      // content and understanding, different display spacing/quote style).
      const correct = got === want
        || canonicalizeContainers(got) === canonicalizeContainers(want);
      return { correct, expected: { text: expected } };
    },
  };
}

// predict-state (design §5.2): "after this program runs, what does `a`
// hold?" — the way LATENT state (a value the program never prints) becomes
// examinable. Graded synchronously against the name's final value in the
// trace (the interpreter is still the only answer key); grading is quote-
// style- and whitespace-insensitive (normalizeAnswer), which is exactly the
// §13 Q4 default for this form.
//
// THE "GONE" ANSWER TOKEN (expansion ladder §R4b W4): a probe whose name is
// NOT bound at program end — a function local that vanished when the frame
// did — is still a legitimate question, and its answer is "there is no such
// name". Contract: `expected.text === "gone"` and `expected.gone === true`;
// grading accepts exactly the aliases in GONE_ANSWERS (case-insensitive,
// whitespace-trimmed) and NOTHING else, so a learner who types a value is
// wrong. Bound-name questions are untouched by this path.
export const GONE_ANSWERS = ["gone", "nothing", "not defined", "undefined", "no such name"];
export function isGoneAnswer(s) {
  return GONE_ANSWERS.includes(String(s ?? "").trim().toLowerCase().replace(/\s+/g, " "));
}

function predictStateQuestion(ctx, opts = {}) {
  const name = opts.name;
  if (!name || !ctx.steps?.length) return null;
  const snap = snapshotAt(ctx.steps, ctx.steps.length - 1);
  const entry = snap.entries.find((e) => e.scope === "globals" && e.name === name);
  if (!entry) {
    return {
      kind: "predict-state",
      prompt: `After this program runs, what does \`${name}\` hold?`,
      gone: true,
      blanks: [],
      grade(answer) {
        return { correct: isGoneAnswer(answer?.text), expected: { text: "gone", gone: true } };
      },
    };
  }
  const expected = entry.value;
  return {
    kind: "predict-state",
    prompt: `After this program runs, what does \`${name}\` hold?`,
    blanks: [],
    grade(answer) {
      const correct = normalizeAnswer(answer?.text) === normalizeAnswer(expected);
      return { correct, expected: { text: expected } };
    },
  };
}

// ---- progressive trace simulation ----------------------------------------
// `linePositions()` is the memory model's produced-state projection, but it
// is intentionally coarser than a Python execution trace: consecutive events
// on the same physical line collapse into one position, and a function `call`
// event contributes a header-shaped position even though the `def` statement
// is not executed again. A trace simulation needs the learner to predict every
// actual source-line occurrence, so control flow comes from raw `line` records
// while each occurrence's produced state still lands on the aligned memory
// position boundary. Repeated raw lines inside one group use the next raw line
// snapshot, preserving one-line loop iterations that line mode collapses.
function traceSimulationQuestion(ctx, opts = {}) {
  const names = [...new Set(opts.names ?? [])];
  const steps = ctx.steps ?? [];
  const positions = ctx.positions ?? [];
  const maxEvents = opts.maxEvents ?? 24;
  if (!names.length || !steps.length || opts.frames === true) return null;

  // V1 covers completed programs and ordinary, non-nested user calls. A
  // nested/suspended expression needs evaluation-event pedagogy, not a false
  // claim that all of its effects belong to one simple source-line step.
  const last = steps[steps.length - 1];
  if (last?.event !== "return" || last.location?.function !== "<module>") return null;
  if (steps.some((s) => (s.stack ?? []).filter((f) => f.function !== "<module>").length > 1)) return null;

  const groups = [];
  const groupAt = [];
  for (let i = 0; i < steps.length; i++) {
    const loc = steps[i].location;
    if (!loc) return null;
    const prev = groups[groups.length - 1];
    if (!prev || prev.line !== loc.line || prev.function !== loc.function || prev.module !== loc.module) {
      groups.push({ start: i, line: loc.line, function: loc.function, module: loc.module, indices: [] });
    }
    const gi = groups.length - 1;
    groups[gi].indices.push(i);
    groupAt[i] = gi;
  }
  if (groups.length !== positions.length) return null;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i], p = positions[i];
    if (!p || g.line !== p.line || g.function !== p.function || g.module !== p.module) return null;
    // A non-module return in a return-only group means a source line was
    // suspended across nested calls. It is outside the V1 attribution model.
    if (g.function !== "<module>"
      && g.indices.some((j) => steps[j].event === "return")
      && !g.indices.some((j) => steps[j].event === "line")) return null;
  }

  const rawLines = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.event === "line");
  if (rawLines.length < 2 || rawLines.length > maxEvents) return null;
  const sourceLines = String(ctx.source ?? "").replace(/\n$/, "").split("\n")
    .map((text, i) => ({ line: i + 1, text, selectable: text.trim() !== "" }));
  const onlyWatchedGlobals = (snap) => Object.fromEntries(names.map((name) => {
    const found = snap.entries.find((e) => e.scope === "globals" && e.name === name);
    return [name, found?.value ?? null];
  }));
  const outputBetween = (from, to) => {
    let out = "";
    for (let i = from + 1; i <= to && i < steps.length; i++) {
      out += steps[i].output?.stdout_delta ?? "";
      out += steps[i].output?.stderr_delta ?? "";
    }
    return out;
  };
  const valueFromEvent = (step) => {
    const encoded = step.event_data?.kind === "value" ? step.event_data.value : null;
    if (!encoded) return null;
    return textValue(encoded, new Map((step.heap ?? []).map((n) => [n.uid, n])));
  };

  // Match each callee return to the source-line occurrence that initiated it.
  // This is used only for the explanatory caller-resume attribution; grading
  // still rests on the trace snapshots.
  const calls = [];
  const callInfo = new Map();
  const returnInfo = new Map();
  let lastLine = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.event === "line") lastLine = { rawIndex: i, line: s.location.line, function: s.location.function };
    if (s.event === "call" && s.location.function !== "<module>") {
      const info = {
        kind: "call", rawIndex: i, function: s.location.function,
        callerRawIndex: lastLine?.rawIndex ?? null,
        callerLine: lastLine?.line ?? null,
        callerFunction: lastLine?.function ?? null,
      };
      calls.push(info);
      callInfo.set(i, info);
    }
    if (s.event === "return" && s.location.function !== "<module>") {
      const at = calls.findLastIndex((c) => c.function === s.location.function);
      const call = at >= 0 ? calls.splice(at, 1)[0] : null;
      returnInfo.set(i, {
        kind: "return", rawIndex: i, function: s.location.function,
        value: valueFromEvent(s), call,
      });
    }
  }

  const events = rawLines.map(({ s, i: rawIndex }, ordinal) => {
    const gi = groupAt[rawIndex];
    const nextRawLine = rawLines[ordinal + 1]?.i;
    const afterStateIndex = nextRawLine != null && groupAt[nextRawLine] === gi
      ? nextRawLine
      : positions[gi].stateIndex;
    const before = onlyWatchedGlobals(snapshotAt(steps, rawIndex));
    const after = onlyWatchedGlobals(snapshotAt(steps, afterStateIndex));
    const changed = {};
    const gone = [];
    for (const name of names) {
      if (before[name] !== after[name]) {
        if (after[name] == null) gone.push(name);
        else changed[name] = after[name];
      }
    }
    const crossed = [];
    for (let j = rawIndex + 1; j <= afterStateIndex; j++) {
      if (callInfo.has(j)) crossed.push(callInfo.get(j));
      if (returnInfo.has(j)) crossed.push(returnInfo.get(j));
    }
    const returned = crossed.find((t) => t.kind === "return") ?? null;
    const attribution = {};
    if (returned?.call) for (const name of Object.keys(changed)) {
      attribution[name] = {
        kind: "caller-resume",
        line: returned.call.callerLine,
        function: returned.call.callerFunction,
        sourceRawIndex: returned.call.callerRawIndex,
      };
    }
    const output = outputBetween(rawIndex, afterStateIndex);
    return {
      id: `e${ordinal}`,
      ordinal,
      line: s.location.line,
      function: s.location.function,
      module: s.location.module,
      codeText: sourceLines[s.location.line - 1]?.text ?? "",
      rawIndex,
      positionIndex: gi,
      afterStateIndex,
      before,
      after,
      effects: {
        bindings: { changed, gone, attribution },
        output: { writes: output !== "", text: output },
        ...(returned && /^\s*return(?:\s|$)/.test(sourceLines[s.location.line - 1]?.text ?? "")
          ? { returnValue: returned.value ?? "None" }
          : {}),
        transitions: crossed.map((t) => t.kind === "call"
          ? { kind: "call", function: t.function, callerLine: t.callerLine }
          : {
            kind: "return", function: t.function, value: t.value,
            callerLine: t.call?.callerLine ?? null,
            callerFunction: t.call?.callerFunction ?? null,
          }),
      },
    };
  });
  // The V1 effects editor can express changed values but deliberately has no
  // magic-token UI for a watched global becoming unbound. Fail closed instead
  // of generating an answer the learner cannot enter; a later version can add
  // an explicit "name is gone" affordance alongside predict-state's chip.
  if (events.some((event) => event.effects.bindings.gone.length)) return null;

  const expectedEffects = (event) => ({
    bindings: {
      changed: { ...event.effects.bindings.changed },
      gone: [...event.effects.bindings.gone],
    },
    output: event.effects.output.writes
      ? { writes: true, text: event.effects.output.text }
      : { writes: false },
    ...(Object.hasOwn(event.effects, "returnValue") ? { returnValue: event.effects.returnValue } : {}),
  });
  const effectsGrade = (event, answer = {}) => {
    const want = expectedEffects(event);
    const gotChanged = answer.bindings?.changed ?? {};
    const wantNames = Object.keys(want.bindings.changed).sort();
    const gotNames = Object.keys(gotChanged).sort();
    const changedSet = JSON.stringify(gotNames) === JSON.stringify(wantNames);
    const changedValues = changedSet && wantNames.every((name) =>
      equivalentStateValue(gotChanged[name], want.bindings.changed[name]));
    const gotGone = [...(answer.bindings?.gone ?? [])].sort();
    const wantGone = [...want.bindings.gone].sort();
    const gone = JSON.stringify(gotGone) === JSON.stringify(wantGone);
    const outputKind = Boolean(answer.output?.writes) === want.output.writes;
    const outputText = !want.output.writes
      || normalizeOutput(answer.output?.text) === normalizeOutput(want.output.text);
    const returnValue = !Object.hasOwn(want, "returnValue")
      || equivalentStateValue(answer.returnValue, want.returnValue);
    const perField = { changedSet, changedValues, gone, outputKind, outputText, returnValue };
    return { correct: Object.values(perField).every(Boolean), perField, expected: want };
  };
  const terminalBefore = events[events.length - 1].after;
  return {
    kind: "trace-simulation",
    version: 1,
    prompt: "Build the trace yourself: choose the next line, then record what that line changes.",
    names,
    sourceLines,
    stepCount: events.length + 1,
    step(cursor) {
      const event = events[cursor];
      return {
        cursor, total: events.length + 1,
        id: event?.id ?? "end",
        before: event?.before ?? terminalBefore,
        terminal: !event,
      };
    },
    effectPrompt(cursor) {
      const event = events[cursor];
      if (!event) return null;
      return {
        id: event.id, line: event.line, function: event.function,
        codeText: event.codeText, before: event.before,
        hasReturn: Object.hasOwn(event.effects, "returnValue"),
      };
    },
    gradeNext(cursor, answer = {}) {
      const event = events[cursor];
      const correct = event
        ? answer.kind === "line" && Number(answer.line) === event.line
        : answer.kind === "end";
      return {
        correct,
        expected: event
          ? { kind: "line", line: event.line, function: event.function, codeText: event.codeText }
          : { kind: "end" },
      };
    },
    gradeEffects(cursor, answer) {
      const event = events[cursor];
      return event ? effectsGrade(event, answer) : { correct: false, expected: null };
    },
    revealNext(cursor) {
      return this.gradeNext(cursor, {}).expected;
    },
    revealEffects(cursor) {
      const event = events[cursor];
      if (!event) return null;
      return {
        ...expectedEffects(event),
        attribution: { ...event.effects.bindings.attribution },
        transitions: event.effects.transitions.map((t) => ({ ...t })),
      };
    },
  };
}

// ---- trace-table ------------------------------------------------------------
// Walk the program's executed lines, filling in what each watched name holds
// after each step. Rows are kept only where a watched name was ADDED or
// CHANGED (globals scope, same display filtering as predict-state); within a
// kept row only the changed cells are blanks — unchanged watched names show
// their carried value as givens, unbound names render "—". Graded per blank
// against the real trace with the same container forgiveness as
// predict-state (normalizeAnswer, else canonicalizeContainers).
//
// ROW ATTRIBUTION (expansion ladder §R4b): a module binding produced by a
// call — `x = double(v)` — is first OBSERVED at the position whose steps sit
// inside the callee (the group for the callee's `return` line, whose
// displayed snapshot is the state after the frame popped). Attributing the
// row to that line labels a globals change with a line the name is not
// assigned on. The records carry the fix: `memory.linePositions()` reports
// each position's `function`, so the module-level statement that owns any
// in-frame position is the nearest PRECEDING position with
// `function === "<module>"` — the call site. Globals rows use that line;
// frame rows (opt-in, below) keep their own in-function line.
//
// FRAME ROWS: `{ frames: true }` also keeps rows for watched names bound
// INSIDE a call frame, tagged `row.frame` (e.g. "double()") so a table can
// walk into the call. OFF by default — every existing exercise is untouched.
function traceTableQuestion(ctx, opts = {}) {
  const names = opts.names ?? [];
  const maxBlanks = opts.maxBlanks ?? 8;
  const frames = opts.frames === true;
  if (!names.length) return null;
  const P = ctx.positions ?? [];
  const sourceLines = (ctx.source ?? "").split("\n");
  // Module-level call site owning each position (see ROW ATTRIBUTION above).
  const callSiteLine = [];
  let site = null;
  for (let i = 0; i < P.length; i++) {
    if (P[i].function === "<module>") site = P[i].line;
    callSiteLine[i] = site ?? P[i].line;
  }
  const filterSnap = (snap) => ({
    entries: snap.entries.filter((e) => names.includes(e.name)
      && (frames || e.scope === "globals")),
  });
  let prev = { entries: [] };
  const kept = [];
  for (let i = 0; i < P.length; i++) {
    const snap = filterSnap(snapshotAt(ctx.steps, P[i].stateIndex));
    const diff = diffSnapshots(prev, snap);
    const touched = new Set([...diff.added, ...diff.changed]);
    if (touched.size) {
      // One row per (position, scope): outer (globals) before inner frames.
      const scopes = [...new Set([...touched].map((k) => k.slice(0, k.indexOf("|"))))]
        .sort((a, b) => (a === "globals" ? -1 : b === "globals" ? 1 : 0));
      for (const scope of scopes) kept.push({ position: i, scope, snap, touched });
    }
    prev = snap;
  }
  if (!kept.length) return null; // no watched name ever binds/changes
  const allRows = kept.map((k, idx) => {
    const byName = new Map(k.snap.entries
      .filter((e) => e.scope === k.scope).map((e) => [e.name, e.value]));
    const cells = names.map((name) => ({
      name,
      value: byName.has(name) ? byName.get(name) : "—",
      blank: k.touched.has(`${k.scope}|${name}`),
    }));
    const line = k.scope === "globals" ? callSiteLine[k.position] : P[k.position].line;
    return {
      step: idx + 1,
      line,
      codeText: sourceLines[line - 1] ?? "",
      cells,
      ...(k.scope === "globals" ? {} : { frame: k.scope }),
    };
  });
  // A cell whose value can be read verbatim off its own line is a GIVEN,
  // never a blank: `x = 1` asks for transcription, not prediction. Plain
  // literal assignments (name = number/text/bool/plain-literal list or
  // dict) show their value as scaffolding; computed rebinds, loop
  // variables, and aliasing reads stay blanked — those are the thinking.
  const LIT = String.raw`(?:-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'|True|False)`;
  const LITERAL_ASSIGN_RE = new RegExp(
    String.raw`^\s*[A-Za-z_]\w*\s*=\s*(?:${LIT}|\[(?:\s|,|${LIT})*\]|\{(?:\s|,|:|${LIT})*\})\s*$`,
  );
  for (const r of allRows) {
    if (LITERAL_ASSIGN_RE.test(r.codeText)) for (const c of r.cells) c.blank = false;
  }

  // maxBlanks elision: keep the leading rows whose blanks fit in
  // maxBlanks − 2, mark the gap, and keep the final row's blanks.
  const blankCount = (r) => r.cells.filter((c) => c.blank).length;
  let rows = allRows;
  if (allRows.reduce((a, r) => a + blankCount(r), 0) > maxBlanks) {
    const head = [];
    let used = 0;
    for (const r of allRows.slice(0, -1)) {
      if (used + blankCount(r) > Math.max(0, maxBlanks - 2)) break;
      head.push(r);
      used += blankCount(r);
    }
    rows = [...head, { elided: true }, allRows[allRows.length - 1]];
  }
  const blanks = [];
  for (const r of rows) {
    if (r.elided) continue;
    for (const c of r.cells) {
      if (!c.blank) continue;
      const id = `b${blanks.length}`;
      c.blankId = id;
      blanks.push({
        id,
        label: `step ${r.step} · ${r.frame ? `${r.frame} · ` : ""}${c.name}`,
        expected: c.value,
      });
    }
  }
  // Fewer than two REAL blanks isn't a walkthrough — the caller skips
  // (and the K-10 contract holds every trace-table exercise to ≥2 on
  // every seed, so this is a runtime safety net, not a routine path).
  if (blanks.length < 2) return null;
  const eq = equivalentStateValue;
  return {
    kind: "trace-table",
    prompt: "Walk the program step by step: fill in what each name holds after each line runs.",
    rows,
    names,
    blanks,
    grade(answers = {}) {
      const perBlank = {};
      for (const b of blanks) perBlank[b.id] = eq(answers[b.id], b.expected);
      return {
        correct: blanks.length > 0 && blanks.every((b) => perBlank[b.id]),
        perBlank,
        expected: Object.fromEntries(blanks.map((b) => [b.id, b.expected])),
      };
    },
  };
}

// ---- code-prediction questions --------------------------------------------
const STRUCTURAL_RE = /^\s*(def |class |for |while |if |elif |else\b|return\b|import |from )/;

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function codeOrderQuestion(ctx, opts = {}) {
  const lines = ctx.source.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 3) return null;
  const rng = mulberry32(opts.seed ?? 42);
  const items = lines.map((text, i) => ({ id: `i${i}`, text }));
  let shuffled = shuffle(items, rng);
  if (shuffled.every((it, i) => it.text === lines[i])) shuffled = [...shuffled].reverse();
  return {
    kind: "code-order",
    prompt: "These are the lines of the program, shuffled. Put them in working order (indentation is preserved — use it).",
    items: shuffled,
    grade(orderIds = []) {
      const byId = new Map(items.map((it) => [it.id, it.text]));
      const got = orderIds.map((id) => byId.get(id));
      const perIndex = lines.map((text, i) => got[i] === text);
      return { correct: perIndex.every(Boolean) && got.length === lines.length, perIndex, expected: lines };
    },
  };
}

// mode "structure": structural lines are blanked (write the skeleton);
// mode "details": non-structural lines are blanked (write the work).
function codeStructureQuestion(ctx, opts = {}) {
  const mode = opts.mode ?? "structure";
  const lines = ctx.source.split("\n");
  const blanks = [];
  const display = lines.map((text, i) => {
    if (text.trim() === "") return { text, blankId: null };
    const structural = STRUCTURAL_RE.test(text);
    const hide = mode === "structure" ? structural : !structural;
    if (!hide) return { text, blankId: null };
    const id = `b${blanks.length}`;
    blanks.push({ id, label: `line ${i + 1}`, expected: text.trim() });
    return { text: null, indent: text.match(/^\s*/)[0], blankId: id };
  });
  if (!blanks.length || blanks.length === display.filter((l) => l.text?.trim() !== "").length) return null;
  return {
    kind: "code-structure",
    mode,
    prompt: mode === "structure"
      ? "The detail lines are given. Write the missing structural lines (def/for/if/return/…)."
      : "The structure is given. Write the missing detail lines.",
    lines: display,
    blanks,
    grade: gradeBlanks(blanks),
  };
}

// Blank the arguments of one call expression.
function codeArgsQuestion(ctx, opts = {}) {
  const lines = ctx.source.split("\n");
  const candidates = [];
  lines.forEach((text, i) => {
    if (/^\s*def /.test(text)) return; // def headers are parameters, not args
    for (const m of text.matchAll(/([A-Za-z_]\w*)\(([^()]+)\)/g)) {
      candidates.push({ lineIndex: i, fn: m[1], args: m[2], start: m.index + m[1].length + 1 });
    }
  });
  if (!candidates.length) return null;
  const rng = mulberry32(opts.seed ?? 42);
  const c = opts.line != null
    ? candidates.find((x) => x.lineIndex === opts.line - 1)
    : candidates[Math.floor(rng() * candidates.length)];
  if (!c) return null;
  const argList = c.args.split(",").map((a) => a.trim());
  const blanks = argList.map((a, i) => ({ id: `b${i}`, label: `argument ${i + 1} of ${c.fn}(…)`, expected: a }));
  const line = lines[c.lineIndex];
  return {
    kind: "code-args",
    prompt: `Line ${c.lineIndex + 1} calls ${c.fn}(…). Fill in the argument${argList.length > 1 ? "s" : ""}.`,
    lineIndex: c.lineIndex,
    before: line.slice(0, c.start),
    after: line.slice(c.start + c.args.length),
    argCount: argList.length,
    blanks,
    grade: gradeBlanks(blanks),
  };
}

function expressionSequenceQuestion(ctx, opts = {}) {
  const lines = ctx.source.split("\n");
  const candidates = [];
  lines.forEach((line, index) => {
    const plan = buildEvaluationPlan(line);
    if (plan?.cards.length > 1) candidates.push({ line: index + 1, plan });
  });
  let selected;
  if (opts.line != null) selected = candidates.find((candidate) => candidate.line === opts.line);
  else if (candidates.length) {
    const rng = mulberry32(opts.seed ?? 42);
    selected = candidates[Math.floor(rng() * candidates.length)];
  }
  if (!selected) return null;
  const rng = mulberry32((opts.seed ?? 42) + selected.line);
  let palette = shuffle(selected.plan.cards, rng);
  if (palette.every((card, index) => card.id === selected.plan.cards[index].id)) palette = [...palette].reverse();
  return {
    kind: "expression-sequence",
    prompt: `Construct Python's evaluation sequence for line ${selected.line}.`,
    line: selected.line,
    evaluation: {
      source: selected.plan.source,
      cards: selected.plan.cards,
      palette,
    },
    grade(order = []) { return gradeEvaluationOrder(order, selected.plan.cards); },
  };
}

// ---- registry -------------------------------------------------------------
export const questionGenerators = {
  "memory-construct": {
    label: "Construct memory",
    needsTrace: true,
    generate: memoryConstructQuestion,
  },
  "memory-next-line": {
    label: "Predict memory: next line",
    needsTrace: true,
    generate: (ctx, opts = {}) => generateMemoryKind(ctx, opts, 1, "memory-next-line"),
  },
  "memory-line-to-line": {
    label: "Predict memory: line X → line Y",
    needsTrace: true,
    generate: (ctx, opts = {}) => generateMemoryKind(ctx, opts, 3, "memory-line-to-line"),
  },
  "predict-output": {
    label: "Predict the output",
    needsTrace: true,
    generate: predictOutputQuestion,
  },
  "predict-state": {
    label: "Predict the final value of a name",
    needsTrace: true,
    generate: predictStateQuestion,
  },
  "trace-table": {
    label: "Trace the table",
    needsTrace: true,
    generate: traceTableQuestion,
  },
  "trace-simulation": {
    label: "Build the trace step by step",
    needsTrace: true,
    generate: traceSimulationQuestion,
  },
  "fill-one-blank": {
    // Graded by the tutor's async substitute-and-run path (design §5.2); this
    // entry exists so lessons can declare the kind and lint accepts it.
    // write-the-line (expansion ladder §R5) RIDES this kind: it is the same
    // {code, blank, targetOutput} contract with a line-wide blank and the
    // identical splice-run-compare grading, so it needs no exec, lint, review
    // or retry code of its own — it differs only by `form` (prompt wording,
    // MECHANICS line, placeholder).
    label: "Fill in the missing token",
    needsTrace: false,
    generate: () => null,
  },
  "order-the-lines": {
    // Parsons (expansion ladder §R2). Graded by the tutor's async
    // arrange-and-run path — the learner's arrangement is executed and its
    // real output compared with the target — so, like fill-one-blank, this
    // entry exists only so lessons can declare the kind and lint accepts it.
    // (Unrelated to `code-order` below, which grades by position.)
    label: "Put the lines in order",
    needsTrace: false,
    generate: () => null,
  },
  "predict-the-error": {
    // Error literacy (expansion ladder §R3). Graded by the tutor's async
    // predict-then-verify path against the REAL terminal exception (line +
    // type_name), so — like fill-one-blank and order-the-lines — this entry
    // exists only so lessons can declare the kind and lint accepts it.
    label: "Predict the error",
    needsTrace: false,
    generate: () => null,
  },
  "predict-io": {
    // The input boundary (expansion ladder §R4a). Graded by the tutor's async
    // scripted-input path — the program is really traced with its stdin
    // script answered line by line, and the learner's answer is compared with
    // the real console transcript (ctx.consoleText / ctx.consoleTextNoEcho) —
    // so, like fill-one-blank and order-the-lines, this entry exists only so
    // lessons can declare the kind and lint accepts it.
    label: "Predict the console transcript",
    needsTrace: false,
    generate: () => null,
  },
  "expression-sequence": {
    label: "Build expression evaluation",
    needsTrace: false,
    generate: expressionSequenceQuestion,
  },
  "code-order": {
    label: "Arrange the code lines",
    needsTrace: false,
    generate: codeOrderQuestion,
  },
  "code-structure": {
    label: "Write structure vs details",
    needsTrace: false,
    generate: codeStructureQuestion,
  },
  "code-args": {
    label: "Fill in the arguments",
    needsTrace: false,
    generate: codeArgsQuestion,
  },
};

// ctx = { source, steps, positions, consoleText?, consoleTextNoEcho? }
// (positions = memory.linePositions(); the console fields are plain strings —
// this module never touches the DOM).
export function generateQuestion(kind, ctx, opts = {}) {
  const gen = questionGenerators[kind];
  if (!gen) throw new Error(`unknown question kind: ${kind}`);
  if (gen.needsTrace && !(ctx.steps?.length && ctx.positions?.length)) return null;
  return gen.generate(ctx, opts);
}

export { buildEvaluationPlan, gradeMemoryGraph, memoryGraphAt };
