// The footprint pass: AST walk + micro abstract interpreter
// (design §4.2–§4.4). Pure function:
//   footprint(source) → { tags, evidence, warnings, finalTypes } | { error }
// tags is a sorted array of concept tags the program OBSERVABLY uses;
// evidence entries are { tag, rule, line }. finalTypes maps each still-bound
// name to its abstract end-state type (consumed by the inv-9 type oracle);
// names whose type is ambiguous across branches (⊤) are excluded.
//
// Structural tags are emitted only where they have a syntactic witness
// (int literals → 0003); the no-witness roots (0001, 0002, 0004) are never
// emitted — they are always permitted in the contract check (design §2.8).
//
// The semantic rules (design §4.4) live inline below, keyed by tag. Phase 3
// completes the grammar: strings, comparisons, booleans, branches, loops,
// dicts, tuples, slices, conversions, aggregates, and the method table.

import { parse, AnalyzerError } from "./parse.mjs";

export const TAG = {
  intLiteral: "0003",
  printText: "0005",
  nameHoldsValue: "0006",
  quotedVsName: "0007",
  arithOnInts: "0008",
  evaluateBeforeBind: "0009",
  rebindUpdatesName: "000A",
  accumulateRebind: "000B",
  nameFromName: "000C",
  listLiteral: "000D",
  indexFromZero: "000E",
  indexAssignMutates: "000F",
  appendMutates: "000G",
  namesShareList: "000H",
  printMultiArgs: "000J",
  strLiteralVsNumber: "000K",
  swapRightSideFirst: "000M",
  opPrecedence: "000N",
  divYieldsFloat: "000P",
  floordivQuotient: "000Q",
  modRemainder: "000R",
  modSignOfDivisor: "000S",
  strOfInt: "000T",
  intOfStr: "000V",
  boolIsInt: "000X",
  strConcat: "000Y",
  strRepeat: "000Z",
  indexFromEnd: "0010",
  sliceHalfOpen: "0011",
  sliceOpenEnded: "0012",
  strImmutableRebind: "0013",
  strCompareCodePoints: "0014",
  compareOps: "0015",
  boolValues: "0016",
  ifRunsOrSkips: "0017",
  elseOtherwise: "0018",
  elifFirstTrueWins: "0019",
  boolOps: "001A",
  truthinessEmptyFalsy: "001B",
  andOrReturnOperand: "001C",
  chainedCompare: "001D",
  loopForVisitsEach: "001E",
  rangeStopExcluded: "001F",
  rangeStartStop: "001G",
  rangeStep: "001H",
  loopAccumulate: "001J",
  loopBuildList: "001K",
  whileRepeats: "001M",
  breakExits: "001N",
  continueSkips: "001P",
  forElseNoBreak: "001Q",
  dictLookup: "001R",
  dictKeyAssign: "001S",
  dictGetDefault: "001T",
  inDictChecksKeys: "001V",
  tuplePackPrint: "001W",
  tupleUnpack: "001X",
  tupleByComma: "001Y",
  aggregateBuiltins: "001Z",
  extendVsAppend: "0020",
  listConcatNew: "0021",
  nestedLists: "0022",
  plusEqMutatesList: "0023",
  sliceCopies: "0024",
  copyIsShallow: "0025",
};

const ADD_OPS = new Set(["+", "-"]);
const opClass = (op) => (ADD_OPS.has(op) ? "add" : op === "**" ? "pow" : "mul");

function operandSign(node) {
  if (node.kind === "int") return "pos";
  if (node.kind === "unaryop" && node.op === "-" && node.operand.kind === "int") return "neg";
  return "unknown";
}

const isNumeric = (t) => t === "int" || t === "float" || t === "bool";
const numResult = (l, r) => (l === "float" || r === "float" ? "float" : "int");

export function footprint(source) {
  try {
    return analyze(parse(source));
  } catch (e) {
    if (e instanceof AnalyzerError) {
      return { error: { code: e.code, message: e.message, line: e.line } };
    }
    throw e;
  }
}

function analyze(statements) {
  const tags = new Set();
  const evidence = [];
  const warnings = [];
  let env = new Map();          // name → { type, objId?, elem?, keyType?, valType? }
  const objects = new Map();    // objId → { names:Set, mutations:[{via, shared, line}], sharedEver }
  let nextObj = 1;
  let forDepth = 0; // only FOR loops: loop-accumulate/loop-build-list are children of loop-for-visits-each
  const strCopy = new Map();    // name → source name (b = a where a is str)
  const rebound = new Set();    // names that have been reassigned

  const emit = (tag, rule, line) => { tags.add(tag); evidence.push({ tag, rule, line }); };

  // Program-global bound-name set for the string-literal rule (design §4.3
  // row 2): a quoted literal teaches quoted-vs-name only when its text IS a
  // bound name (the genuine `"x"` vs `x` confusion) — a plain print label
  // like "big" is not confusable and folds into print-text.
  const boundNames = new Set();
  const scanBound = (stmts) => {
    for (const s of stmts) {
      if (s.kind === "assign" && s.target.kind === "name") boundNames.add(s.target.id);
      if (s.kind === "assign" && s.target.kind === "tuple") for (const n of s.target.names) boundNames.add(n);
      if (s.kind === "augassign") boundNames.add(s.target);
      if (s.kind === "for") for (const v of s.vars) boundNames.add(v);
      if (s.kind === "for") { scanBound(s.body); if (s.orelse) scanBound(s.orelse); }
      if (s.kind === "while") { scanBound(s.body); if (s.orelse) scanBound(s.orelse); }
      if (s.kind === "if") { for (const c of s.clauses) scanBound(c.body); if (s.orelse) scanBound(s.orelse); }
    }
  };
  scanBound(statements);

  // elems (optional) carries the abstract element VALUES in order, when
  // statically known — that is what makes shallowness observable: a shallow
  // copy is a fresh outer objId whose elems array is SHARED with the
  // original (design vocab-gap mint `copy-is-shallow`, tag 0025).
  function newList(elem, elems) {
    const objId = nextObj++;
    objects.set(objId, { names: new Set(), mutations: [], sharedEver: false });
    return { type: "list", objId, elem: elem ?? "int", elems };
  }

  // Mutations of an object reached THROUGH a container (b[0].append(…)):
  // {elemId, viaOuter, line}. Reading another outer list that shares that
  // element is the moment shallowness becomes observable.
  const elemMutations = [];
  function checkShallowObservation(val, line) {
    if (val.type !== "list" || !val.elems) return;
    for (const e of val.elems) {
      if (e?.objId == null) continue;
      if (elemMutations.some((m) => m.elemId === e.objId && m.viaOuter !== val.objId)) {
        emit(TAG.copyIsShallow, "rule-shallow", line);
        return;
      }
    }
  }

  function requireBound(id, line) {
    if (!env.has(id)) throw new AnalyzerError("would-raise", `name ${id} read before assignment`, line);
    return env.get(id);
  }

  function recordMutation(objId, via, line) {
    if (objId == null) return;
    const obj = objects.get(objId);
    obj.mutations.push({ via, shared: obj.names.size >= 2, line });
  }

  function checkAliasObservation(id, val, line) {
    if (val.type !== "list" || val.objId == null) return;
    const obj = objects.get(val.objId);
    if (obj.mutations.some((m) => m.shared && m.via !== id)) {
      emit(TAG.namesShareList, "rule1-observability", line);
    }
  }

  function bind(id, val) {
    const old = env.get(id);
    if (old?.type === "list" && old.objId != null && old.objId !== val.objId) objects.get(old.objId)?.names.delete(id);
    env.set(id, val);
    if (val.type === "list" && val.objId != null) {
      const obj = objects.get(val.objId);
      obj.names.add(id);
      if (obj.names.size >= 2) obj.sharedEver = true;
    }
  }

  // Element type produced by iterating a value (design call table).
  function elementType(v) {
    if (v.type === "list") return { type: v.elem ?? "int" };
    if (v.type === "range") return { type: "int" };
    if (v.type === "str") return { type: "str" };
    if (v.type === "dict") return { type: v.keyType ?? "str" };
    throw new AnalyzerError("unmapped-syntax", `iterating a ${v.type} is outside the subset`, 0);
  }

  function evalExpr(node, ctx = {}) {
    switch (node.kind) {
      case "int":
        if (node.value < 0) throw new AnalyzerError("unmapped-syntax", "negative literals are outside the subset", node.line);
        emit(TAG.intLiteral, "row1", node.line);
        return { type: "int" };
      case "float":
        return { type: "float" };
      case "bool":
        emit(TAG.boolValues, "row3", node.line);
        return { type: "bool" };
      case "none":
        return { type: "none" };
      case "str":
        if (/^[0-9]+$/.test(node.value)) emit(TAG.strLiteralVsNumber, "row17-digitstr", node.line);
        if (boundNames.has(node.value)) emit(TAG.quotedVsName, "row2", node.line);
        return { type: "str" };
      case "name": {
        const val = requireBound(node.id, node.line);
        emit(TAG.nameHoldsValue, "row4", node.line);
        checkAliasObservation(node.id, val, node.line);
        checkShallowObservation(val, node.line);
        if (strCopy.has(node.id) && rebound.has(strCopy.get(node.id))) {
          emit(TAG.strImmutableRebind, "rule6", node.line);
        }
        return val;
      }
      case "group":
        return evalExpr(node.expr, ctx);
      case "list": {
        let elem = null;
        let nested = false;
        const elems = [];
        for (const item of node.items) {
          const v = evalExpr(item);
          if (v.type === "list") nested = true;
          elem = v.type;
          elems.push(v);
        }
        if (nested) emit(TAG.nestedLists, "row33", node.line);
        emit(TAG.listLiteral, "row28", node.line);
        return newList(elem ?? "int", elems);
      }
      case "dict": {
        let keyType = null, valType = null;
        for (const { key, value } of node.entries) {
          keyType = evalExpr(key).type;
          valType = evalExpr(value).type;
        }
        emit(TAG.dictLookup, "row49", node.line);
        return { type: "dict", keyType: keyType ?? "str", valType: valType ?? "int" };
      }
      case "tuple": {
        node.items.forEach((it) => evalExpr(it));
        if (node.items.length === 1) emit(TAG.tupleByComma, "row56", node.line);
        else emit(TAG.tuplePackPrint, "row53", node.line);
        return { type: "tuple" };
      }
      case "unaryop": {
        if (node.op === "not") {
          const v = evalExpr(node.operand, ctx);
          emit(TAG.boolOps, "row38", node.line);
          if (v.type !== "bool") emit(TAG.truthinessEmptyFalsy, "rule10", node.line);
          return { type: "bool" };
        }
        const v = evalExpr(node.operand);
        if (!isNumeric(v.type)) throw new AnalyzerError("unmapped-syntax", `unary minus on ${v.type} is outside the subset`, node.line);
        return { type: v.type === "bool" ? "int" : v.type };
      }
      case "boolop": {
        const vals = node.values.map((v) => evalExpr(v, ctx));
        emit(TAG.boolOps, "row38", node.line);
        const anyNonBool = vals.some((v) => v.type !== "bool");
        if (anyNonBool) emit(TAG.truthinessEmptyFalsy, "rule10", node.line);
        const types = new Set(vals.map((v) => v.type));
        const resultType = types.size === 1 ? [...types][0] : "top";
        // and/or that can return a non-bool operand, used in a value position.
        if (resultType !== "bool" && !ctx.inTest) emit(TAG.andOrReturnOperand, "rule11", node.line);
        return { type: resultType };
      }
      case "compare": {
        const left = evalExpr(node.left);
        const parts = [left];
        node.ops.forEach((op, k) => {
          const right = evalExpr(node.comparators[k]);
          parts.push(right);
          if (op === "in" || op === "not in") {
            if (right.type !== "dict") throw new AnalyzerError("unmapped-syntax", `${op} on a ${right.type} is outside the subset`, node.line);
            emit(TAG.inDictChecksKeys, "row52", node.line);
          } else {
            emit(TAG.compareOps, "row36", node.line);
            const l = parts[parts.length - 2];
            if (l.type === "str" && right.type === "str" && op !== "==" && op !== "!=") {
              emit(TAG.strCompareCodePoints, "row27", node.line);
            }
          }
        });
        if (node.ops.length >= 2) emit(TAG.chainedCompare, "row41", node.line);
        return { type: "bool" };
      }
      case "binop": {
        const l = evalExpr(node.left);
        const r = evalExpr(node.right);
        if (mixesPrecedence(node)) emit(TAG.opPrecedence, "row13", node.line);
        if (node.op === "/") {
          if (!isNumeric(l.type) || !isNumeric(r.type)) throw new AnalyzerError("unmapped-syntax", "/ on non-numbers is outside the subset", node.line);
          if (l.type === "bool" || r.type === "bool") emit(TAG.boolIsInt, "row19", node.line);
          emit(TAG.divYieldsFloat, "row14", node.line);
          return { type: "float" };
        }
        if (node.op === "//") {
          if (!isNumeric(l.type) || !isNumeric(r.type)) throw new AnalyzerError("unmapped-syntax", "// on non-numbers is outside the subset", node.line);
          emit(TAG.floordivQuotient, "row15", node.line);
          return { type: numResult(l.type, r.type) };
        }
        if (node.op === "%") {
          if (!isNumeric(l.type) || !isNumeric(r.type)) throw new AnalyzerError("unmapped-syntax", "% on non-numbers is outside the subset", node.line);
          emit(TAG.modRemainder, "row16", node.line);
          if (!(operandSign(node.left) === "pos" && operandSign(node.right) === "pos")) emit(TAG.modSignOfDivisor, "rule15", node.line);
          return { type: numResult(l.type, r.type) };
        }
        if (node.op === "+" && l.type === "list" && r.type === "list") {
          emit(TAG.listConcatNew, "row32", node.line);
          return newList(l.elem ?? "int");
        }
        if (node.op === "+" && l.type === "str" && r.type === "str") {
          emit(TAG.strConcat, "row20", node.line);
          return { type: "str" };
        }
        if (node.op === "*" && ((l.type === "str" && r.type === "int") || (l.type === "int" && r.type === "str"))) {
          emit(TAG.strRepeat, "row21", node.line);
          return { type: "str" };
        }
        if ((node.op === "+" || node.op === "-" || node.op === "*" || node.op === "**") && isNumeric(l.type) && isNumeric(r.type)) {
          if (l.type === "bool" || r.type === "bool") emit(TAG.boolIsInt, "row19", node.line);
          emit(TAG.arithOnInts, "row12", node.line);
          return { type: numResult(l.type, r.type) };
        }
        throw new AnalyzerError("unmapped-syntax", `${node.op} on ${l.type}/${r.type} is outside the subset`, node.line);
      }
      case "subscript": {
        const container = evalExpr(node.value);
        const nestedContainer = node.value.kind === "subscript";
        if (node.index.kind === "slice") {
          return evalSlice(container, node.index, node.line);
        }
        const idx = evalExpr(node.index);
        if (container.type === "dict") {
          emit(TAG.dictLookup, "row49", node.line);
          return { type: container.valType ?? "int" };
        }
        if (idx.type !== "int") throw new AnalyzerError("unmapped-syntax", "non-integer index", node.line);
        if (node.index.kind === "unaryop" && node.index.op === "-") emit(TAG.indexFromEnd, "row23", node.line);
        if (nestedContainer) emit(TAG.nestedLists, "row33", node.line);
        emit(TAG.indexFromZero, "row22", node.line);
        if (container.type === "str") return { type: "str" };
        if (container.type === "list") {
          // A literal non-negative index into a statically-known list yields
          // the tracked element VALUE (identity included) — what lets a
          // mutation through b[0] be charged to the shared element.
          if (node.index.kind === "int" && container.elems && node.index.value < container.elems.length) {
            return container.elems[node.index.value];
          }
          return { type: container.elem ?? "int" };
        }
        throw new AnalyzerError("unmapped-syntax", `subscript on ${container.type} is outside the subset`, node.line);
      }
      case "call":
        return evalCall(node, ctx);
      case "method":
        return evalMethod(node);
      default:
        throw new AnalyzerError("unmapped-syntax", `expression kind ${node.kind}`, node.line);
    }
  }

  function evalSlice(container, slice, line) {
    const lo = slice.lower, hi = slice.upper;
    if (container.type !== "str" && container.type !== "list") {
      throw new AnalyzerError("unmapped-syntax", `slice on ${container.type} is outside the subset`, line);
    }
    if (lo) evalExpr(lo);
    if (hi) evalExpr(hi);
    if (!lo && !hi) {
      // Full slice a[:] — a SHALLOW copy: fresh outer objId, same element
      // values (shared identity — that sharing is exactly copy-is-shallow).
      if (container.type === "list") { emit(TAG.sliceCopies, "row35", line); return newList(container.elem ?? "int", container.elems); }
      return { type: "str" };
    }
    if (!lo || !hi) emit(TAG.sliceOpenEnded, "row25", line);
    emit(TAG.sliceHalfOpen, "row24", line);
    if (container.type === "list") return newList(container.elem ?? "int");
    return { type: "str" };
  }

  function evalCall(node, ctx) {
    const f = node.func;
    if (f === "print") {
      for (const a of node.args) {
        const v = evalExpr(a, {});
        if (v.type === "bool") emit(TAG.boolValues, "rule13", node.line);
      }
      if (node.args.length >= 2) emit(TAG.printMultiArgs, "row11", node.line);
      emit(TAG.printText, "row10", node.line);
      return { type: "none" };
    }
    if (f === "len" || f === "sum" || f === "max" || f === "min") {
      const v = evalExpr(node.args[0]);
      if (v.type !== "list" && v.type !== "range") throw new AnalyzerError("unmapped-syntax", `${f}() of a ${v.type} is outside the subset`, node.line);
      emit(TAG.aggregateBuiltins, "row29", node.line);
      if (f === "len") return { type: "int" };
      if (f === "sum") return { type: v.type === "list" ? (v.elem ?? "int") : "int" };
      return { type: v.type === "list" ? (v.elem ?? "int") : "int" }; // max/min
    }
    if (f === "range") {
      node.args.forEach((a) => {
        const v = evalExpr(a);
        if (!isNumeric(v.type)) throw new AnalyzerError("unmapped-syntax", "range() takes whole numbers", node.line);
      });
      emit(TAG.rangeStopExcluded, "row43", node.line);
      if (node.args.length >= 2) emit(TAG.rangeStartStop, "row43", node.line);
      if (node.args.length === 3) emit(TAG.rangeStep, "row43", node.line);
      if (node.args.length < 1 || node.args.length > 3) throw new AnalyzerError("unmapped-syntax", "range() arity", node.line);
      return { type: "range", elem: "int" };
    }
    if (f === "list") {
      const v = evalExpr(node.args[0]);
      if (v.type === "range") return newList("int");
      // list(a) is the same SHALLOW copy as a[:] — element identity shared.
      if (v.type === "list") { emit(TAG.sliceCopies, "row35", node.line); return newList(v.elem ?? "int", v.elems); }
      throw new AnalyzerError("unmapped-syntax", `list() of a ${v.type} is outside the subset`, node.line);
    }
    if (f === "str") {
      const v = evalExpr(node.args[0]);
      if (isNumeric(v.type)) emit(TAG.strOfInt, "row17", node.line);
      else if (v.type === "str") warnings.push({ code: "pointless-conversion" });
      return { type: "str" };
    }
    if (f === "int") {
      const v = evalExpr(node.args[0]);
      if (v.type === "str") emit(TAG.intOfStr, "row17", node.line);
      else if (v.type === "int") warnings.push({ code: "pointless-conversion" });
      return { type: "int" };
    }
    throw new AnalyzerError("unmapped-syntax", `call ${f}() is outside the subset`, node.line);
    void ctx;
  }

  function evalMethod(node) {
    const val = evalExpr(node.obj);
    const objName = node.obj.kind === "name" ? node.obj.id : null;
    // A mutation reached THROUGH a container (b[0].append(…)) is charged to
    // the element, remembering WHICH outer list it came through — the other
    // outer sharing that element observes shallowness on its next read.
    const viaSubscriptOfName = node.obj.kind === "subscript" && node.obj.value.kind === "name";
    const recordElemMutation = () => {
      if (!viaSubscriptOfName || val.objId == null) return;
      const outer = env.get(node.obj.value.id);
      if (outer?.type === "list" && outer.objId != null) {
        elemMutations.push({ elemId: val.objId, viaOuter: outer.objId, line: node.line });
      }
    };
    if (node.name === "append") {
      if (val.type !== "list") throw new AnalyzerError("would-raise", `.append on ${val.type}`, node.line);
      const arg = evalExpr(node.args[0]);
      if (arg.type === "list") emit(TAG.extendVsAppend, "row31", node.line);
      emit(TAG.appendMutates, "row31", node.line);
      if (forDepth > 0) emit(TAG.loopBuildList, "row45", node.line);
      recordMutation(val.objId, objName, node.line);
      recordElemMutation();
      return { type: "none" };
    }
    if (node.name === "extend") {
      if (val.type !== "list") throw new AnalyzerError("would-raise", `.extend on ${val.type}`, node.line);
      const arg = evalExpr(node.args[0]);
      if (arg.type !== "list") throw new AnalyzerError("would-raise", ".extend needs a list", node.line);
      emit(TAG.extendVsAppend, "row31", node.line);
      recordMutation(val.objId, objName, node.line);
      recordElemMutation();
      return { type: "none" };
    }
    if (node.name === "get") {
      if (val.type !== "dict") throw new AnalyzerError("would-raise", `.get on ${val.type}`, node.line);
      node.args.forEach((a) => evalExpr(a));
      emit(TAG.dictGetDefault, "row51", node.line);
      return { type: val.valType ?? "int" };
    }
    throw new AnalyzerError("unmapped-syntax", `method .${node.name} is outside the subset`, node.line);
  }

  // --- statement execution --------------------------------------------

  function execSuite(stmts) {
    for (const stmt of stmts) execStatement(stmt);
  }

  function execStatement(stmt) {
    switch (stmt.kind) {
      case "expr":
        evalExpr(stmt.value, {});
        return;
      case "break":
        emit(TAG.breakExits, "row47", stmt.line);
        return;
      case "continue":
        emit(TAG.continueSkips, "row47", stmt.line);
        return;
      case "augassign": {
        const cur = requireBound(stmt.target, stmt.line);
        const rhs = evalExpr(stmt.value);
        if (isNumeric(cur.type)) {
          if (!isNumeric(rhs.type)) throw new AnalyzerError("unmapped-syntax", "+= mixing numbers and non-numbers", stmt.line);
          emit(TAG.arithOnInts, "rule3-aug", stmt.line);
          emit(TAG.accumulateRebind, "rule3-aug", stmt.line);
          emit(TAG.rebindUpdatesName, "rule2", stmt.line);
          if (forDepth > 0) emit(TAG.loopAccumulate, "row44", stmt.line);
          rebound.add(stmt.target);
          env.set(stmt.target, { type: numResult(cur.type, rhs.type) });
        } else if (cur.type === "list") {
          if (rhs.type !== "list") throw new AnalyzerError("would-raise", "list += non-list", stmt.line);
          const obj = objects.get(cur.objId);
          if (!obj || obj.names.size < 2) throw new AnalyzerError("unmapped-syntax", "+= on an unshared list has no concept node in the subset", stmt.line);
          emit(TAG.plusEqMutatesList, "rule8", stmt.line);
          recordMutation(cur.objId, stmt.target, stmt.line);
        } else {
          throw new AnalyzerError("unmapped-syntax", `+= on ${cur.type} is outside the subset`, stmt.line);
        }
        return;
      }
      case "assign":
        execAssign(stmt);
        return;
      case "if":
        execIf(stmt);
        return;
      case "for":
        execFor(stmt);
        return;
      case "while":
        execWhile(stmt);
        return;
      default:
        throw new AnalyzerError("unmapped-syntax", `statement kind ${stmt.kind}`, stmt.line);
    }
  }

  function execAssign(stmt) {
    if (stmt.target.kind === "subscript") {
      const containerName = stmt.target.value.id;
      const container = requireBound(containerName, stmt.line);
      emit(TAG.nameHoldsValue, "row4", stmt.line);
      checkAliasObservation(containerName, container, stmt.line);
      if (stmt.target.index.kind === "slice") throw new AnalyzerError("unmapped-syntax", "slice assignment is outside the subset", stmt.line);
      if (container.type === "dict") {
        evalExpr(stmt.target.index);
        evalExpr(stmt.value);
        emit(TAG.dictKeyAssign, "row50", stmt.line);
        return;
      }
      if (container.type !== "list") throw new AnalyzerError("would-raise", `subscript store on ${container.type}`, stmt.line);
      const idx = evalExpr(stmt.target.index);
      if (idx.type !== "int") throw new AnalyzerError("unmapped-syntax", "non-integer index", stmt.line);
      evalExpr(stmt.value);
      emit(TAG.indexAssignMutates, "row30", stmt.line);
      recordMutation(container.objId, containerName, stmt.line);
      return;
    }
    if (stmt.target.kind === "tuple") {
      const names = stmt.target.names;
      if (stmt.value.kind !== "tuple") throw new AnalyzerError("unmapped-syntax", "tuple-target assignment needs a tuple right side in the subset", stmt.line);
      const readsTarget = names.some((n) => exprReadsName(stmt.value, n));
      const values = stmt.value.items.map((it) => evalExpr(it));
      if (values.length !== names.length) throw new AnalyzerError("would-raise", "tuple-unpack length mismatch", stmt.line);
      if (readsTarget) emit(TAG.swapRightSideFirst, "rule12", stmt.line);
      else emit(TAG.tupleUnpack, "row54", stmt.line);
      names.forEach((n, i) => bind(n, values[i]));
      return;
    }
    const id = stmt.target.id;
    const wasBound = env.has(id);
    const val = evalExpr(stmt.value);
    if (stmt.value.kind === "name") {
      if (val.type !== "list" && val.type !== "dict") emit(TAG.nameFromName, "rule1", stmt.line);
      if (val.type === "str") strCopy.set(id, stmt.value.id);
    } else if (stmt.value.kind === "binop" || stmt.value.kind === "subscript" || stmt.value.kind === "unaryop" || stmt.value.kind === "call" || stmt.value.kind === "group") {
      const readsTarget = exprReadsName(stmt.value, id);
      const numeric = isNumeric(val.type);
      if (readsTarget && numeric) {
        emit(TAG.accumulateRebind, "rule3", stmt.line);
        if (forDepth > 0) emit(TAG.loopAccumulate, "row44", stmt.line);
      } else if (numeric) emit(TAG.evaluateBeforeBind, "row7", stmt.line);
    }
    if (wasBound) { emit(TAG.rebindUpdatesName, "rule2", stmt.line); rebound.add(id); }
    bind(id, val);
  }

  function execIf(stmt) {
    emit(TAG.ifRunsOrSkips, "row37", stmt.line);
    if (stmt.orelse) emit(TAG.elseOtherwise, "row37", stmt.line);
    if (stmt.clauses.length > 1) emit(TAG.elifFirstTrueWins, "row37", stmt.line);
    const endEnvs = [];
    for (const clause of stmt.clauses) {
      const testVal = evalExpr(clause.test, { inTest: true });
      if (testVal.type !== "bool") emit(TAG.truthinessEmptyFalsy, "rule10", clause.test.line);
      const saved = env; env = new Map(saved);
      execSuite(clause.body);
      endEnvs.push(env); env = saved;
    }
    if (stmt.orelse) {
      const saved = env; env = new Map(saved);
      execSuite(stmt.orelse);
      endEnvs.push(env); env = saved;
    } else {
      endEnvs.push(new Map(env));
    }
    env = mergeEnvs(endEnvs);
  }

  function execFor(stmt) {
    const iterVal = evalExpr(stmt.iter);
    emit(TAG.loopForVisitsEach, "row42", stmt.line);
    if (stmt.vars.length !== 1) throw new AnalyzerError("unmapped-syntax", "multiple for-targets are outside the subset", stmt.line);
    bind(stmt.vars[0], elementType(iterVal));
    forDepth++;
    execSuite(stmt.body);
    forDepth--;
    if (stmt.orelse) {
      emit(TAG.forElseNoBreak, "row48", stmt.line);
      execSuite(stmt.orelse);
    }
  }

  function execWhile(stmt) {
    const testVal = evalExpr(stmt.test, { inTest: true });
    if (testVal.type !== "bool") emit(TAG.truthinessEmptyFalsy, "rule10", stmt.line);
    emit(TAG.whileRepeats, "row46", stmt.line);
    // NOTE: no forDepth bump — loop-accumulate/loop-build-list are children
    // of loop-for-visits-each, so a while-loop counter (n = n - 1) charges
    // only accumulate-rebind, never loop-accumulate.
    execSuite(stmt.body);
    if (stmt.orelse) execSuite(stmt.orelse);
  }

  // Merge branch end-stores: a name agreed by all paths keeps its type;
  // otherwise it becomes ⊤ (excluded from finalTypes so inv 9 never probes
  // a conditionally-bound name).
  function mergeEnvs(endEnvs) {
    const merged = new Map();
    const names = new Set();
    for (const e of endEnvs) for (const k of e.keys()) names.add(k);
    for (const name of names) {
      const present = endEnvs.every((e) => e.has(name));
      if (!present) { merged.set(name, { type: "top" }); continue; }
      const types = new Set(endEnvs.map((e) => e.get(name).type));
      if (types.size === 1) merged.set(name, endEnvs.find((e) => e.get(name)).get(name));
      else merged.set(name, { type: "top" });
    }
    return merged;
  }

  execSuite(statements);

  for (const obj of objects.values()) {
    if (obj.sharedEver && !tags.has(TAG.namesShareList)) { warnings.push({ code: "latent-alias" }); break; }
  }

  const CONCRETE = new Set(["int", "float", "str", "bool", "list", "dict", "tuple", "range"]);
  const finalTypes = {};
  for (const [id, val] of env) if (CONCRETE.has(val.type)) finalTypes[id] = val.type;

  return { tags: [...tags].sort(), evidence, warnings, finalTypes };
}

function mixesPrecedence(node) {
  const cls = opClass(node.op);
  for (const child of [node.left, node.right]) {
    if (child.kind === "binop" && opClass(child.op) !== cls) return true;
  }
  return false;
}

function exprReadsName(node, id) {
  let found = false;
  walkExpr(node, (n, ctx) => { if (n.kind === "name" && n.id === id && ctx === "load") found = true; });
  return found;
}

// Walk every expression node in a statement or expression; cb(node, ctx)
// with ctx "load" for name reads. Compound-statement bodies are walked so
// the pre-pass can spot name loads anywhere in the program.
function walkExpr(node, cb) {
  if (!node || typeof node !== "object") return;
  switch (node.kind) {
    case "assign":
      if (node.target.kind === "subscript") { cb(node.target.value, "load"); walkExpr(node.target.index, cb); }
      walkExpr(node.value, cb);
      return;
    case "augassign":
      cb({ kind: "name", id: node.target, line: node.line }, "load");
      walkExpr(node.value, cb);
      return;
    case "expr":
      walkExpr(node.value, cb);
      return;
    case "if":
      for (const c of node.clauses) { walkExpr(c.test, cb); c.body.forEach((s) => walkExpr(s, cb)); }
      if (node.orelse) node.orelse.forEach((s) => walkExpr(s, cb));
      return;
    case "for":
      walkExpr(node.iter, cb);
      node.body.forEach((s) => walkExpr(s, cb));
      if (node.orelse) node.orelse.forEach((s) => walkExpr(s, cb));
      return;
    case "while":
      walkExpr(node.test, cb);
      node.body.forEach((s) => walkExpr(s, cb));
      if (node.orelse) node.orelse.forEach((s) => walkExpr(s, cb));
      return;
    case "call":
      node.args.forEach((a) => walkExpr(a, cb));
      return;
    case "method":
      walkExpr(node.obj, cb);
      node.args.forEach((a) => walkExpr(a, cb));
      return;
    case "name":
      cb(node, "load");
      return;
    case "group":
      walkExpr(node.expr, cb);
      return;
    case "unaryop":
      walkExpr(node.operand, cb);
      return;
    case "binop":
      walkExpr(node.left, cb);
      walkExpr(node.right, cb);
      return;
    case "boolop":
      node.values.forEach((v) => walkExpr(v, cb));
      return;
    case "compare":
      walkExpr(node.left, cb);
      node.comparators.forEach((c) => walkExpr(c, cb));
      return;
    case "subscript":
      walkExpr(node.value, cb);
      if (node.index) walkExpr(node.index, cb);
      return;
    case "slice":
      if (node.lower) walkExpr(node.lower, cb);
      if (node.upper) walkExpr(node.upper, cb);
      return;
    case "list":
    case "tuple":
      node.items.forEach((i) => walkExpr(i, cb));
      return;
    case "dict":
      node.entries.forEach((e) => { walkExpr(e.key, cb); walkExpr(e.value, cb); });
      return;
    default:
      return;
  }
}
