// Pure construction-question model.
//
// Memory answers are graphs, not flattened name/value rows. A graph preserves
// identity, aliases, cycles, and references held inside other data. Expression
// answers are ordered semantic actions for a deliberately supported subset of
// Python. Neither model depends on the disposable quiz UI.

import { displayFilters } from "./memory.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeText = (value) => String(value ?? "").replace(/\s+/g, "").replace(/'/g, '"');

function scalarType(value) {
  if (!value?.kind) return "value";
  if (value.kind === "none") return "NoneType";
  if (value.kind === "not_implemented") return "NotImplementedType";
  return value.kind;
}

function scalarText(value) {
  if (value == null) return "?";
  switch (value.kind) {
    case "none": return "None";
    case "bool": return value.value ? "True" : "False";
    case "int": return value.decimal;
    case "float": return value.special ?? value.decimal;
    case "str": return JSON.stringify(value.value);
    case "bytes": return `bytes[${value.length}]`;
    case "complex": return `complex(${scalarText(value.real)}, ${scalarText(value.imag)})`;
    case "range": return `range(${scalarText(value.start)}, ${scalarText(value.stop)}, ${scalarText(value.step)})`;
    case "slice": return `slice(${scalarText(value.start)}, ${scalarText(value.stop)}, ${scalarText(value.step)})`;
    case "ellipsis": return "...";
    case "not_implemented": return "NotImplemented";
    case "elided": return `⟨elided: ${value.reason ?? "unknown"}⟩`;
    default: return value.value == null ? value.kind : String(value.value);
  }
}

function hiddenBinding(binding, heap) {
  if (binding.value?.kind !== "ref") return false;
  const node = heap.get(binding.value.uid);
  if (displayFilters.hideModuleBindings && node?.kind === "module") return true;
  return displayFilters.hideFunctionBindings && node?.kind === "function"
    && node.closure_environment_id == null;
}

function inlineReference(node) {
  if (displayFilters.inlinePlainFunctions && node?.kind === "function"
    && node.closure_environment_id == null) {
    return { kind: "scalar", type: "function", value: `function ${node.qualname ?? "?"}` };
  }
  if (displayFilters.inlineModules && node?.kind === "module") {
    return { kind: "scalar", type: "module", value: `module ${node.module ?? "?"}` };
  }
  return null;
}

function dataType(node) {
  if (!node) return "unknown";
  if (node.kind === "instance") return node.class_qualname ?? node.type_name ?? "instance";
  return node.kind ?? node.type_name ?? "object";
}

function dataDescription(node) {
  if (!node) return "unavailable";
  switch (node.kind) {
    case "list": case "tuple": case "set": case "frozenset":
      return `${(node.items ?? []).length + (node.elided_count ?? 0)} items`;
    case "dict": return `${(node.entries ?? []).length + (node.elided_count ?? 0)} entries`;
    case "instance": return `${(node.attributes ?? []).length} attributes`;
    case "class": return node.qualname ?? "class";
    case "function": return node.qualname ?? "function";
    case "generator": return node.state ?? "generator";
    case "cell": return node.state === "value" ? "value" : "empty";
    case "module": return node.module ?? "module";
    case "opaque": return node.reason ?? "opaque";
    case "elided": return node.reason ?? "elided";
    default: return node.type_name ?? node.kind ?? "data";
  }
}

function emptyGraph(scopes = []) {
  return { scopes: scopes.map((scope) => ({ id: scope.id, label: scope.label, bindings: [] })), data: [] };
}

export function emptyDataNode(id, kind = "list") {
  const node = { id, kind, type: kind, description: "", items: [], entries: [], fields: [] };
  if (kind === "instance") node.type = "instance";
  return node;
}

// Convert one trace snapshot into a learner-facing graph. Question-local data
// ids are assigned by deterministic traversal from bindings. Engine uids never
// escape this function and are never compared between steps.
export function memoryGraphAt(steps, stateIndex) {
  const step = steps?.[stateIndex];
  if (!step) return { scopes: [], data: [] };
  const heap = new Map((step.heap ?? []).map((node) => [node.uid, node]));
  const uidToId = new Map();
  const queue = [];
  const nodes = new Map();

  function ensureData(uid) {
    if (!uidToId.has(uid)) {
      uidToId.set(uid, `data${uidToId.size + 1}`);
      queue.push(uid);
    }
    return uidToId.get(uid);
  }

  function graphValue(value) {
    if (value?.kind === "ref") {
      const inline = inlineReference(heap.get(value.uid));
      if (inline) return inline;
      return { kind: "ref", target: ensureData(value.uid) };
    }
    return { kind: "scalar", type: scalarType(value), value: scalarText(value) };
  }

  function bindingsFor(bindings) {
    return (bindings ?? [])
      .filter((binding) => !hiddenBinding(binding, heap))
      .map((binding) => ({ name: binding.name, value: graphValue(binding.value) }));
  }

  const scopes = [];
  for (const globalScope of step.globals ?? []) {
    scopes.push({
      id: `globals:${globalScope.module}`,
      label: globalScope.module === "__main__" ? "Globals" : `Globals · ${globalScope.module}`,
      bindings: bindingsFor(globalScope.bindings),
    });
  }
  (step.stack ?? []).forEach((frame, index) => {
    if (frame.function === "<module>") return;
    scopes.push({
      id: `frame:${index}:${frame.function}`,
      label: `${frame.function}()`,
      bindings: bindingsFor(frame.locals),
    });
  });
  for (const environment of step.closure_environments ?? []) {
    scopes.push({
      id: `closure:${environment.environment_id}`,
      label: `Closure ${environment.environment_id}`,
      bindings: bindingsFor(environment.cells),
    });
  }

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const uid = queue[cursor];
    const source = heap.get(uid);
    const id = uidToId.get(uid);
    const node = {
      id,
      kind: source?.kind ?? "unknown",
      type: dataType(source),
      description: dataDescription(source),
      items: [], entries: [], fields: [],
    };
    nodes.set(id, node);
    if (!source) continue;
    switch (source.kind) {
      case "list": case "tuple": case "set": case "frozenset":
        node.items = (source.items ?? []).map(graphValue);
        break;
      case "dict":
        node.entries = (source.entries ?? []).map((entry) => ({
          key: graphValue(entry.key), value: graphValue(entry.value),
        }));
        break;
      case "instance":
        node.fields = (source.attributes ?? []).map((field) => ({ name: field.name, value: graphValue(field.value) }));
        break;
      case "class":
        node.fields = (source.attributes ?? []).map((field) => ({ name: field.name, value: graphValue(field.value) }));
        if (!displayFilters.inlineClassBases) {
          node.items = (source.bases ?? []).map(graphValue);
        }
        break;
      case "cell":
        if (source.state === "value") node.items = [graphValue(source.content)];
        break;
    }
  }

  return { scopes, data: [...uidToId.values()].map((id) => nodes.get(id)).filter(Boolean) };
}

export function starterGraph(target, mode = "blank") {
  if (mode === "complete") return clone(target);
  if (mode === "partial") {
    const starter = emptyGraph(target.scopes);
    starter.scopes = target.scopes.map((scope) => ({
      id: scope.id,
      label: scope.label,
      bindings: scope.bindings.map((binding, index) => ({
        name: binding.name,
        value: index % 2 === 0 && binding.value?.kind === "scalar" ? clone(binding.value) : null,
      })),
    }));
    return starter;
  }
  return emptyGraph(target.scopes);
}

export function mergeGraphScopes(graph, target) {
  const result = clone(graph);
  const existing = new Set(result.scopes.map((scope) => scope.id));
  for (const scope of target.scopes) {
    if (!existing.has(scope.id)) result.scopes.push({ id: scope.id, label: scope.label, bindings: [] });
  }
  return result;
}

function issueCollector() {
  const issues = [];
  return {
    add(area, message) {
      if (issues.length < 16) issues.push({ area, message });
    },
    issues,
  };
}

// Compare rooted graphs up to renaming of data ids. The two bijection maps are
// what make aliasing and cycles grade correctly.
export function gradeMemoryGraph(answer, target) {
  const report = issueCollector();
  const answerNodes = new Map((answer?.data ?? []).map((node) => [node.id, node]));
  const targetNodes = new Map((target?.data ?? []).map((node) => [node.id, node]));
  const targetToAnswer = new Map();
  const answerToTarget = new Map();
  const compared = new Set();

  function compareValue(expected, actual, path) {
    if (!actual) {
      report.add("bindings", `${path} is not connected to data.`);
      return;
    }
    if (expected?.kind !== actual.kind) {
      report.add("types", `${path} should be ${expected?.kind === "ref" ? "a data reference" : "a scalar value"}.`);
      return;
    }
    if (expected.kind === "scalar") {
      if (expected.type !== actual.type) report.add("types", `${path} should have type ${expected.type}.`);
      if (normalizeText(expected.value) !== normalizeText(actual.value)) {
        report.add("contents", `${path} should be ${expected.value}.`);
      }
      return;
    }
    compareNode(expected.target, actual.target, path);
  }

  function compareArray(expected, actual, path, label) {
    if (expected.length !== actual.length) {
      report.add("contents", `${path} should contain ${expected.length} ${label}.`);
    }
    const length = Math.min(expected.length, actual.length);
    for (let index = 0; index < length; index++) compareValue(expected[index], actual[index], `${path}[${index}]`);
  }

  function compareNode(expectedId, actualId, path) {
    if (!answerNodes.has(actualId)) {
      report.add("bindings", `${path} points to missing ${actualId ?? "data"}.`);
      return;
    }
    if (!targetNodes.has(expectedId)) return;
    if (targetToAnswer.has(expectedId) && targetToAnswer.get(expectedId) !== actualId) {
      report.add("identity", `${path} should reference the same data as an earlier connection.`);
      return;
    }
    if (answerToTarget.has(actualId) && answerToTarget.get(actualId) !== expectedId) {
      report.add("identity", `${path} incorrectly merges two distinct pieces of data.`);
      return;
    }
    targetToAnswer.set(expectedId, actualId);
    answerToTarget.set(actualId, expectedId);
    const pair = `${expectedId}|${actualId}`;
    if (compared.has(pair)) return;
    compared.add(pair);

    const expected = targetNodes.get(expectedId);
    const actual = answerNodes.get(actualId);
    if (expected.kind !== actual.kind) report.add("types", `${path} should reference ${expected.kind} data.`);
    if (expected.type !== actual.type) report.add("types", `${path} should have data type ${expected.type}.`);

    compareArray(expected.items ?? [], actual.items ?? [], path, "items");
    const expectedEntries = expected.entries ?? [];
    const actualEntries = actual.entries ?? [];
    if (expectedEntries.length !== actualEntries.length) {
      report.add("contents", `${path} should contain ${expectedEntries.length} dictionary entries.`);
    }
    for (let index = 0; index < Math.min(expectedEntries.length, actualEntries.length); index++) {
      compareValue(expectedEntries[index].key, actualEntries[index].key, `${path} key ${index}`);
      compareValue(expectedEntries[index].value, actualEntries[index].value, `${path} value ${index}`);
    }
    const expectedFields = expected.fields ?? [];
    const actualFields = actual.fields ?? [];
    if (expectedFields.length !== actualFields.length) {
      report.add("contents", `${path} should contain ${expectedFields.length} attributes.`);
    }
    for (let index = 0; index < Math.min(expectedFields.length, actualFields.length); index++) {
      if (expectedFields[index].name !== actualFields[index].name) {
        report.add("contents", `${path} attribute ${index + 1} should be named ${expectedFields[index].name}.`);
      }
      compareValue(expectedFields[index].value, actualFields[index].value, `${path}.${expectedFields[index].name}`);
    }
    if (!["list", "tuple", "set", "frozenset", "dict", "instance", "class", "cell"].includes(expected.kind)
      && normalizeText(expected.description) !== normalizeText(actual.description)) {
      report.add("contents", `${path} should be described as ${expected.description}.`);
    }
  }

  const answerScopes = new Map((answer?.scopes ?? []).map((scope) => [scope.id, scope]));
  for (const expectedScope of target?.scopes ?? []) {
    const actualScope = answerScopes.get(expectedScope.id);
    if (!actualScope) {
      report.add("bindings", `The ${expectedScope.label} scope is missing.`);
      continue;
    }
    const expectedBindings = new Map(expectedScope.bindings.map((binding) => [binding.name, binding]));
    const actualBindings = new Map(actualScope.bindings.map((binding) => [binding.name, binding]));
    for (const [name, expected] of expectedBindings) {
      const actual = actualBindings.get(name);
      if (!actual) report.add("bindings", `${expectedScope.label} is missing the name ${name}.`);
      else compareValue(expected.value, actual.value, `${expectedScope.label}.${name}`);
    }
    for (const name of actualBindings.keys()) {
      if (!expectedBindings.has(name)) report.add("bindings", `${expectedScope.label} has an extra name ${name}.`);
    }
  }
  for (const scope of answer?.scopes ?? []) {
    if (!(target?.scopes ?? []).some((expected) => expected.id === scope.id) && scope.bindings.length) {
      report.add("bindings", `${scope.label} is an extra scope.`);
    }
  }
  if ((answer?.data ?? []).length !== (target?.data ?? []).length) {
    report.add("identity", `The answer should contain ${(target?.data ?? []).length} identity-bearing data pills.`);
  }

  const perArea = Object.fromEntries(["bindings", "types", "contents", "identity"]
    .map((area) => [area, !report.issues.some((issue) => issue.area === area)]));
  return {
    correct: report.issues.length === 0,
    feedback: report.issues.map((issue) => issue.message),
    perArea,
    expected: clone(target),
  };
}

// ---- expression evaluation ----------------------------------------------

const BINARY_PRECEDENCE = new Map([
  ["or", 1], ["and", 2], ["==", 3], ["!=", 3], ["<", 3], ["<=", 3], [">", 3], [">=", 3],
  ["+", 4], ["-", 4], ["*", 5], ["/", 5], ["//", 5], ["%", 5], ["**", 6],
]);

function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === "#") return line.slice(0, index);
  }
  return line;
}

function tokenize(source) {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|([A-Za-z_]\w*)|(\*\*|\/\/|==|!=|<=|>=|[+\-*\/%()[\]{},.:<>]))/y;
  let index = 0;
  while (index < source.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) return null;
    tokens.push({
      type: match[1] ? "number" : match[2] ? "string" : match[3] ? "name" : "symbol",
      value: match[1] ?? match[2] ?? match[3] ?? match[4],
    });
    index = pattern.lastIndex;
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

function parseExpressionSource(source) {
  const tokens = tokenize(source);
  if (!tokens) return null;
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const accept = (value) => peek().value === value ? take() : null;

  function primary() {
    const token = take();
    let node;
    if (token.type === "number") node = { type: "literal", dataType: token.value.includes(".") ? "float" : "int", value: token.value };
    else if (token.type === "string") node = { type: "literal", dataType: "str", value: token.value };
    else if (token.type === "name" && ["True", "False"].includes(token.value)) node = { type: "literal", dataType: "bool", value: token.value };
    else if (token.type === "name" && token.value === "None") node = { type: "literal", dataType: "NoneType", value: "None" };
    else if (token.type === "name") node = { type: "name", name: token.value };
    else if (token.value === "[") {
      const items = [];
      if (!accept("]")) {
        do { items.push(expression(0)); } while (accept(",") && peek().value !== "]");
        if (!accept("]")) throw new Error("missing ]");
      }
      node = { type: "collection", kind: "list", items };
    } else if (token.value === "{") {
      if (accept("}")) node = { type: "collection", kind: "dict", entries: [] };
      else {
        const first = expression(0);
        if (accept(":")) {
          const entries = [{ key: first, value: expression(0) }];
          while (accept(",") && peek().value !== "}") {
            const key = expression(0);
            if (!accept(":")) throw new Error("missing :");
            entries.push({ key, value: expression(0) });
          }
          if (!accept("}")) throw new Error("missing }");
          node = { type: "collection", kind: "dict", entries };
        } else {
          const items = [first];
          while (accept(",") && peek().value !== "}") items.push(expression(0));
          if (!accept("}")) throw new Error("missing }");
          node = { type: "collection", kind: "set", items };
        }
      }
    } else if (token.value === "(") {
      node = expression(0);
      if (!accept(")")) throw new Error("missing )");
    } else throw new Error("unsupported expression");

    while (true) {
      if (accept(".")) {
        const attribute = take();
        if (attribute.type !== "name") throw new Error("missing attribute");
        node = { type: "attribute", object: node, name: attribute.value };
      } else if (accept("[")) {
        const index = expression(0);
        if (!accept("]")) throw new Error("missing ]");
        node = { type: "subscript", object: node, index };
      } else if (accept("(")) {
        const args = [];
        if (!accept(")")) {
          do { args.push(expression(0)); } while (accept(",") && peek().value !== ")");
          if (!accept(")")) throw new Error("missing )");
        }
        node = { type: "call", callee: node, args };
      } else break;
    }
    return node;
  }

  function unary() {
    if (["+", "-", "not"].includes(peek().value)) {
      const operator = take().value;
      return { type: "unary", operator, operand: unary() };
    }
    return primary();
  }

  function expression(minimum) {
    let left = unary();
    while (BINARY_PRECEDENCE.has(peek().value) && BINARY_PRECEDENCE.get(peek().value) >= minimum) {
      const operator = take().value;
      const precedence = BINARY_PRECEDENCE.get(operator);
      const right = expression(operator === "**" ? precedence : precedence + 1);
      left = { type: "binary", operator, left, right };
    }
    return left;
  }

  try {
    const tree = expression(0);
    return peek().type === "eof" ? tree : null;
  } catch {
    return null;
  }
}

function emitEvaluation(node, cards) {
  const add = (action, label, detail) => cards.push({ id: `eval${cards.length + 1}`, action, label, detail });
  switch (node.type) {
    case "literal":
      add("literal", "Produce literal", `${node.dataType} · ${node.value}`);
      break;
    case "name":
      add("read", "Read name", node.name);
      break;
    case "unary":
      emitEvaluation(node.operand, cards);
      add("operator", `Apply ${node.operator}`, "produce the unary result");
      break;
    case "binary":
      emitEvaluation(node.left, cards);
      emitEvaluation(node.right, cards);
      add("operator", `Apply ${node.operator}`, "combine the left and right results");
      break;
    case "collection":
      if (node.entries) {
        for (const entry of node.entries) { emitEvaluation(entry.key, cards); emitEvaluation(entry.value, cards); }
        add("construct", "Construct dict", `${node.entries.length} ${node.entries.length === 1 ? "entry" : "entries"}`);
      } else {
        for (const item of node.items) emitEvaluation(item, cards);
        add("construct", `Construct ${node.kind}`, `${node.items.length} ${node.items.length === 1 ? "item" : "items"}`);
      }
      break;
    case "attribute":
      emitEvaluation(node.object, cards);
      add("read", "Read attribute", node.name);
      break;
    case "subscript":
      emitEvaluation(node.object, cards);
      emitEvaluation(node.index, cards);
      add("read", "Read item", "use the container and index results");
      break;
    case "call":
      emitEvaluation(node.callee, cards);
      for (const argument of node.args) emitEvaluation(argument, cards);
      add("call", "Call", `${node.args.length} ${node.args.length === 1 ? "argument" : "arguments"}`);
      break;
  }
}

export function buildEvaluationPlan(line) {
  const source = stripComment(String(line ?? "")).trim();
  if (!source || /^(def|class|if|elif|else|for|while|return|import|from|try|except|finally|with)\b/.test(source)) return null;
  const assignment = source.match(/^([A-Za-z_]\w*)\s*(\*\*=|\/\/=|\+=|-=|\*=|\/=|%=|=)\s*(.+)$/);
  const cards = [];
  if (assignment) {
    const [, name, operator, rightSource] = assignment;
    const right = parseExpressionSource(rightSource);
    if (!right) return null;
    if (operator !== "=") cards.push({ id: "eval1", action: "read", label: "Read target", detail: name });
    emitEvaluation(right, cards);
    if (operator !== "=") {
      cards.push({ id: `eval${cards.length + 1}`, action: "operator", label: `Apply ${operator}`, detail: "use in-place behavior when the data type supports it" });
    }
    cards.push({ id: `eval${cards.length + 1}`, action: "bind", label: operator === "=" ? "Bind name" : "Store result", detail: name });
  } else {
    const tree = parseExpressionSource(source);
    if (!tree) return null;
    emitEvaluation(tree, cards);
  }
  return cards.length ? { source, cards } : null;
}

export function gradeEvaluationOrder(order, cards) {
  const expected = cards.map((card) => card.id);
  const perIndex = expected.map((id, index) => order?.[index] === id);
  return {
    correct: order?.length === expected.length && perIndex.every(Boolean),
    perIndex,
    expected,
    feedback: perIndex.every(Boolean) && order?.length === expected.length
      ? [] : ["The evaluation actions are not yet in Python's execution order."],
  };
}

export const cloneConstructionGraph = clone;
