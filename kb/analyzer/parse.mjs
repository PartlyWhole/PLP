// Recursive-descent parser for the Python subset (design §4.1). Produces a
// small AST consumed by footprint.mjs. The grammar is closed: anything
// outside it is a hard `unmapped-syntax` error (totality). Compound
// statements are indentation-structured; expressions carry full Python
// precedence so the inv-8 oracle can diff the tree against Python's own ast.

import { tokenize, AnalyzerError } from "./tokenize.mjs";

export { AnalyzerError };

const BUILTINS = new Set(["print", "len", "sum", "max", "min", "range", "str", "int", "list"]);
const METHODS = new Set(["append", "extend", "pop", "insert", "remove", "get", "upper", "lower"]);
const KEYWORDS = new Set(["True", "False", "None", "and", "or", "not", "in", "is", "if", "elif", "else", "for", "while", "break", "continue"]);
const ADD_OPS = new Set(["+", "-"]);
const MUL_OPS = new Set(["*", "/", "//", "%"]);
const COMPARE_OPS = new Set(["<", ">", "<=", ">=", "==", "!="]);

export function parse(source) {
  const lines = tokenize(source);
  const { body, next } = parseBlock(lines, 0, 0);
  if (next !== lines.length) {
    throw new AnalyzerError("unmapped-syntax", "inconsistent indentation", lines[next]?.toks[0]?.line);
  }
  return body;
}

// Parse consecutive statements at exactly `indent`. Stops at end of input or
// at the first line whose indent is less than `indent`.
function parseBlock(lines, idx, indent) {
  const body = [];
  while (idx < lines.length && lines[idx].indent === indent) {
    const { stmt, next } = parseStatement(lines, idx, indent);
    body.push(stmt);
    idx = next;
  }
  return { body, next: idx };
}

function parseStatement(lines, idx, indent) {
  const { toks } = lines[idx];
  const first = toks[0];
  if (first.type === "NAME" && first.value === "if") return parseIf(lines, idx, indent);
  if (first.type === "NAME" && first.value === "for") return parseFor(lines, idx, indent);
  if (first.type === "NAME" && first.value === "while") return parseWhile(lines, idx, indent);
  if (first.type === "NAME" && (first.value === "break" || first.value === "continue")) {
    if (toks.length !== 1) throw new AnalyzerError("unmapped-syntax", `trailing tokens after ${first.value}`, first.line);
    return { stmt: { kind: first.value, line: first.line }, next: idx + 1 };
  }
  if (first.type === "NAME" && (first.value === "elif" || first.value === "else")) {
    throw new AnalyzerError("unmapped-syntax", `${first.value} without a matching if/for/while`, first.line);
  }
  return { stmt: parseSimpleStatement(toks), next: idx + 1 };
}

function requireBodyIndent(lines, idx, headerIndent, line) {
  if (idx >= lines.length || lines[idx].indent <= headerIndent) {
    throw new AnalyzerError("unmapped-syntax", "expected an indented block", line);
  }
  return lines[idx].indent;
}

function parseColonHeader(toks) {
  // toks: KEYWORD … ':'  → returns the TokenStream positioned after the keyword,
  // with the trailing ':' verified. Caller reads the header expression.
  if (toks[toks.length - 1]?.value !== ":") {
    throw new AnalyzerError("unmapped-syntax", "compound statement header must end with ':'", toks[0].line);
  }
}

function parseIf(lines, idx, indent) {
  const clauses = [];
  let orelse = null;
  let header = lines[idx];
  // if / elif clauses
  for (;;) {
    const kw = header.toks[0].value; // "if" or "elif"
    parseColonHeader(header.toks);
    const p = new TokenStream(header.toks.slice(1, header.toks.length - 1));
    const test = parseExpr(p);
    p.expectEnd();
    const bodyIndent = requireBodyIndent(lines, idx + 1, indent, header.toks[0].line);
    const { body, next } = parseBlock(lines, idx + 1, bodyIndent);
    clauses.push({ test, body });
    idx = next;
    if (idx < lines.length && lines[idx].indent === indent && lines[idx].toks[0].value === "elif") {
      header = lines[idx];
      continue;
    }
    break;
  }
  if (idx < lines.length && lines[idx].indent === indent && lines[idx].toks[0].value === "else") {
    const elseHeader = lines[idx];
    if (elseHeader.toks.length !== 2 || elseHeader.toks[1].value !== ":") {
      throw new AnalyzerError("unmapped-syntax", "else header must be 'else:'", elseHeader.toks[0].line);
    }
    const bodyIndent = requireBodyIndent(lines, idx + 1, indent, elseHeader.toks[0].line);
    const blk = parseBlock(lines, idx + 1, bodyIndent);
    orelse = blk.body;
    idx = blk.next;
  }
  return { stmt: { kind: "if", clauses, orelse, line: clauses[0].test.line }, next: idx };
}

function parseFor(lines, idx, indent) {
  const header = lines[idx];
  parseColonHeader(header.toks);
  const p = new TokenStream(header.toks.slice(1, header.toks.length - 1));
  // NAME (',' NAME)* 'in' expr
  const vars = [p.expectName()];
  while (p.peekOp(",")) { p.next(); vars.push(p.expectName()); }
  if (!p.peekName("in")) throw new AnalyzerError("unmapped-syntax", "for header needs 'in'", header.toks[0].line);
  p.next();
  const iter = parseExpr(p);
  p.expectEnd();
  const bodyIndent = requireBodyIndent(lines, idx + 1, indent, header.toks[0].line);
  const blk = parseBlock(lines, idx + 1, bodyIndent);
  idx = blk.next;
  let orelse = null;
  if (idx < lines.length && lines[idx].indent === indent && lines[idx].toks[0].value === "else") {
    const eh = lines[idx];
    if (eh.toks.length !== 2 || eh.toks[1].value !== ":") throw new AnalyzerError("unmapped-syntax", "else header must be 'else:'", eh.toks[0].line);
    const bi = requireBodyIndent(lines, idx + 1, indent, eh.toks[0].line);
    const eb = parseBlock(lines, idx + 1, bi);
    orelse = eb.body;
    idx = eb.next;
  }
  return { stmt: { kind: "for", vars, iter, body: blk.body, orelse, line: header.toks[0].line }, next: idx };
}

function parseWhile(lines, idx, indent) {
  const header = lines[idx];
  parseColonHeader(header.toks);
  const p = new TokenStream(header.toks.slice(1, header.toks.length - 1));
  const test = parseExpr(p);
  p.expectEnd();
  const bodyIndent = requireBodyIndent(lines, idx + 1, indent, header.toks[0].line);
  const blk = parseBlock(lines, idx + 1, bodyIndent);
  idx = blk.next;
  let orelse = null;
  if (idx < lines.length && lines[idx].indent === indent && lines[idx].toks[0].value === "else") {
    const eh = lines[idx];
    if (eh.toks.length !== 2 || eh.toks[1].value !== ":") throw new AnalyzerError("unmapped-syntax", "else header must be 'else:'", eh.toks[0].line);
    const bi = requireBodyIndent(lines, idx + 1, indent, eh.toks[0].line);
    const eb = parseBlock(lines, idx + 1, bi);
    orelse = eb.body;
    idx = eb.next;
  }
  return { stmt: { kind: "while", test, body: blk.body, orelse, line: header.toks[0].line }, next: idx };
}

// --- simple (single-line) statements -----------------------------------

function findAssignOp(toks) {
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === "OP" && "([{".includes(t.value)) depth++;
    else if (t.type === "OP" && ")]}".includes(t.value)) depth--;
    else if (depth === 0 && t.type === "OP" && (t.value === "=" || t.value === "+=")) return i;
  }
  return -1;
}

function splitTopCommas(toks) {
  const parts = [];
  let depth = 0, cur = [];
  for (const t of toks) {
    if (t.type === "OP" && "([{".includes(t.value)) depth++;
    if (t.type === "OP" && ")]}".includes(t.value)) depth--;
    if (depth === 0 && t.type === "OP" && t.value === ",") { parts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  parts.push(cur);
  return parts; // a trailing comma yields a final empty part
}

function parseSimpleStatement(toks) {
  const line = toks[0].line;
  const opIdx = findAssignOp(toks);
  if (opIdx === -1) {
    const p = new TokenStream(toks);
    const value = parseExpr(p);
    p.expectEnd();
    return { kind: "expr", value, line };
  }
  const op = toks[opIdx].value;
  const leftToks = toks.slice(0, opIdx);
  const rightToks = toks.slice(opIdx + 1);
  if (op === "+=") {
    if (leftToks.length !== 1 || leftToks[0].type !== "NAME") {
      throw new AnalyzerError("unmapped-syntax", "+= target must be a bare name in the subset", line);
    }
    const rp = new TokenStream(rightToks);
    const value = parseExpr(rp);
    rp.expectEnd();
    return { kind: "augassign", target: leftToks[0].value, op: "+=", value, line };
  }
  // '=' assignment
  const targetParts = splitTopCommas(leftToks);
  let target;
  if (targetParts.length > 1) {
    const names = targetParts.map((seg) => {
      if (seg.length !== 1 || seg[0].type !== "NAME") throw new AnalyzerError("unmapped-syntax", "tuple-assignment targets must be bare names", line);
      return seg[0].value;
    });
    target = { kind: "tuple", names, line };
  } else {
    const tp = new TokenStream(leftToks);
    const t = parseExpr(tp);
    tp.expectEnd();
    if (t.kind !== "name" && t.kind !== "subscript") throw new AnalyzerError("unmapped-syntax", "assignment target must be a name or subscript", line);
    target = t;
  }
  // right side: exprlist → single expr, or tuple (any top-level comma, incl trailing)
  const valueParts = splitTopCommas(rightToks);
  let value;
  if (valueParts.length > 1) {
    const items = valueParts.filter((seg) => seg.length > 0).map((seg) => {
      const vp = new TokenStream(seg);
      const e = parseExpr(vp);
      vp.expectEnd();
      return e;
    });
    value = { kind: "tuple", items, line };
  } else {
    const vp = new TokenStream(rightToks);
    value = parseExpr(vp);
    vp.expectEnd();
  }
  return { kind: "assign", target, value, line };
}

// --- expressions (Python precedence) -----------------------------------

function parseExpr(p) { return parseOr(p); }

function parseOr(p) {
  let left = parseAnd(p);
  if (p.peekName("or")) {
    const values = [left];
    while (p.peekName("or")) { p.next(); values.push(parseAnd(p)); }
    return { kind: "boolop", op: "or", values, line: left.line };
  }
  return left;
}

function parseAnd(p) {
  let left = parseNot(p);
  if (p.peekName("and")) {
    const values = [left];
    while (p.peekName("and")) { p.next(); values.push(parseNot(p)); }
    return { kind: "boolop", op: "and", values, line: left.line };
  }
  return left;
}

function parseNot(p) {
  if (p.peekName("not")) {
    const line = p.next().line;
    return { kind: "unaryop", op: "not", operand: parseNot(p), line };
  }
  return parseComparison(p);
}

function parseComparison(p) {
  const left = parseArith(p);
  const ops = [], comparators = [];
  for (;;) {
    let op = null;
    const t = p.peek();
    if (t?.type === "OP" && COMPARE_OPS.has(t.value)) { op = t.value; p.next(); }
    else if (p.peekName("in")) { op = "in"; p.next(); }
    else if (p.peekName("not") && p.peekName("in", 1)) { op = "not in"; p.next(); p.next(); }
    else break;
    ops.push(op);
    comparators.push(parseArith(p));
  }
  if (ops.length === 0) return left;
  return { kind: "compare", left, ops, comparators, line: left.line };
}

function parseArith(p) {
  let left = parseTerm(p);
  while (p.peek()?.type === "OP" && ADD_OPS.has(p.peek().value)) {
    const op = p.next().value;
    left = { kind: "binop", op, left, right: parseTerm(p), line: left.line };
  }
  return left;
}

function parseTerm(p) {
  let left = parseFactor(p);
  while (p.peek()?.type === "OP" && MUL_OPS.has(p.peek().value)) {
    const op = p.next().value;
    left = { kind: "binop", op, left, right: parseFactor(p), line: left.line };
  }
  return left;
}

function parseFactor(p) {
  if (p.peekOp("-")) {
    const line = p.next().line;
    return { kind: "unaryop", op: "-", operand: parseFactor(p), line };
  }
  return parsePower(p);
}

function parsePower(p) {
  const base = parsePostfix(p);
  if (p.peekOp("**")) {
    p.next();
    return { kind: "binop", op: "**", left: base, right: parseFactor(p), line: base.line };
  }
  return base;
}

function parsePostfix(p) {
  let node = parseAtom(p);
  for (;;) {
    if (p.peekOp("[")) {
      p.next();
      const index = parseSubscript(p);
      p.expectOp("]");
      node = { kind: "subscript", value: node, index, line: node.line };
    } else if (p.peekOp(".")) {
      p.next();
      const m = p.next();
      if (m?.type !== "NAME" || !METHODS.has(m.value)) throw new AnalyzerError("unmapped-syntax", `method .${m?.value} is outside the subset`, node.line);
      p.expectOp("(");
      const args = parseArgs(p);
      p.expectOp(")");
      node = { kind: "method", obj: node, name: m.value, args, line: node.line };
    } else break;
  }
  return node;
}

// index := expr | [expr] ':' [expr]   (two-part slice; step is out of subset)
function parseSubscript(p) {
  let lower = null;
  if (!p.peekOp(":") && !p.peekOp("]")) lower = parseExpr(p);
  if (p.peekOp(":")) {
    p.next();
    let upper = null;
    if (!p.peekOp("]")) upper = parseExpr(p);
    if (p.peekOp(":")) throw new AnalyzerError("unmapped-syntax", "slice step is outside the subset", p.line);
    return { kind: "slice", lower, upper, line: p.line };
  }
  return lower;
}

function parseArgs(p) {
  const args = [];
  if (!p.peekOp(")")) {
    args.push(parseExpr(p));
    while (p.peekOp(",")) { p.next(); if (p.peekOp(")")) break; args.push(parseExpr(p)); }
  }
  return args;
}

function parseAtom(p) {
  const t = p.peek();
  if (!t) throw new AnalyzerError("unmapped-syntax", "unexpected end of expression", p.line);
  if (t.type === "INT") { p.next(); return { kind: "int", value: t.value, line: t.line }; }
  if (t.type === "FLOAT") { p.next(); return { kind: "float", value: t.value, line: t.line }; }
  if (t.type === "STRING") { p.next(); return { kind: "str", value: t.value, line: t.line }; }
  if (t.type === "NAME") {
    if (t.value === "True" || t.value === "False") { p.next(); return { kind: "bool", value: t.value === "True", line: t.line }; }
    if (t.value === "None") { p.next(); return { kind: "none", line: t.line }; }
    if (KEYWORDS.has(t.value)) throw new AnalyzerError("unmapped-syntax", `keyword ${t.value} is not valid here`, t.line);
    p.next();
    if (p.peekOp("(")) {
      if (!BUILTINS.has(t.value)) throw new AnalyzerError("unmapped-syntax", `call of non-builtin ${t.value} is outside the subset`, t.line);
      p.next();
      const args = parseArgs(p);
      p.expectOp(")");
      return { kind: "call", func: t.value, args, line: t.line };
    }
    return { kind: "name", id: t.value, line: t.line };
  }
  if (t.type === "OP" && t.value === "[") {
    p.next();
    const items = [];
    if (!p.peekOp("]")) {
      items.push(parseExpr(p));
      while (p.peekOp(",")) { p.next(); if (p.peekOp("]")) break; items.push(parseExpr(p)); }
    }
    p.expectOp("]");
    return { kind: "list", items, line: t.line };
  }
  if (t.type === "OP" && t.value === "{") {
    p.next();
    const entries = [];
    if (!p.peekOp("}")) {
      do {
        const key = parseExpr(p);
        p.expectOp(":");
        const value = parseExpr(p);
        entries.push({ key, value });
      } while (p.peekOp(",") && (p.next(), !p.peekOp("}")));
    }
    p.expectOp("}");
    return { kind: "dict", entries, line: t.line };
  }
  if (t.type === "OP" && t.value === "(") {
    p.next();
    const items = [parseExpr(p)];
    let trailingComma = false;
    while (p.peekOp(",")) { p.next(); trailingComma = true; if (p.peekOp(")")) break; trailingComma = false; items.push(parseExpr(p)); }
    p.expectOp(")");
    if (items.length === 1 && !trailingComma) return { kind: "group", expr: items[0], line: t.line };
    return { kind: "tuple", items, line: t.line };
  }
  throw new AnalyzerError("unmapped-syntax", `token ${JSON.stringify(t.value)} is outside the subset here`, t.line);
}

class TokenStream {
  constructor(toks) { this.toks = toks; this.i = 0; this.line = toks[0]?.line; }
  peek(ahead = 0) { return this.toks[this.i + ahead]; }
  next() { return this.toks[this.i++]; }
  peekOp(value, ahead = 0) { const t = this.peek(ahead); return t?.type === "OP" && t.value === value; }
  peekName(value, ahead = 0) { const t = this.peek(ahead); return t?.type === "NAME" && t.value === value; }
  expectOp(value) {
    const t = this.next();
    if (!(t?.type === "OP" && t.value === value)) throw new AnalyzerError("unmapped-syntax", `expected ${JSON.stringify(value)}`, this.line);
  }
  expectName() {
    const t = this.next();
    if (t?.type !== "NAME") throw new AnalyzerError("unmapped-syntax", "expected a name", this.line);
    return t.value;
  }
  expectEnd() { if (this.i < this.toks.length) throw new AnalyzerError("unmapped-syntax", "trailing tokens outside the subset", this.line); }
}
