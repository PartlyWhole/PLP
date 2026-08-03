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
// lines) ignored; everything else — case, internal spacing, order — is exact.
// Precision is curriculum content; sloppier matching would undermine it.
export function normalizeOutput(s) {
  return String(s ?? "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
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
      const correct = got === normalizeOutput(expected);
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
function predictStateQuestion(ctx, opts = {}) {
  const name = opts.name;
  if (!name || !ctx.steps?.length) return null;
  const snap = snapshotAt(ctx.steps, ctx.steps.length - 1);
  const entry = snap.entries.find((e) => e.scope === "globals" && e.name === name);
  if (!entry) return null; // the name is not bound at the end — cannot ask
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
  "fill-one-blank": {
    // Graded by the tutor's async substitute-and-run path (design §5.2); this
    // entry exists so lessons can declare the kind and lint accepts it.
    label: "Fill in the missing token",
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

// ctx = { source, steps, positions } (positions = memory.linePositions()).
export function generateQuestion(kind, ctx, opts = {}) {
  const gen = questionGenerators[kind];
  if (!gen) throw new Error(`unknown question kind: ${kind}`);
  if (gen.needsTrace && !(ctx.steps?.length && ctx.positions?.length)) return null;
  return gen.generate(ctx, opts);
}

export { buildEvaluationPlan, gradeMemoryGraph, memoryGraphAt };
