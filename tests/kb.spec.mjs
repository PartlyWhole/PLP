// K-series: the concept-DAG knowledge base (kb/). Structural invariants
// run as pure Node checks (the spec imports kb/ modules directly — kb/
// deliberately imports nothing from app/, so it loads without a browser);
// execution checks drive real Pyodide through window.plp, per repo
// invariant 9. Invariant numbers in test titles refer to
// design/knowledge-base-design.md §9.

import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadKB } from "../kb/index.mjs";
import { RAISE_TAG } from "../kb/analyzer/footprint.mjs";
import { parse } from "../kb/analyzer/parse.mjs";
import { docSamples, renderReference } from "../kb/docgen.mjs";
import { mulberry32, fnv1a32 } from "../kb/rng.mjs";

const SITE = "/PLP/";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const kb = loadKB();

// The heavy K tests execute EVERY exercise's stratified programs in real
// Pyodide, so their cost grows with the bank (176 exercises and counting).
// A run against the deployed site additionally fetches the whole vendored
// engine over the network, which roughly doubles the wall clock — hence the
// env-aware budget rather than one fixed number that silently rots as the
// bank grows. If this ever needs raising again, prefer splitting the K-10
// loop per topic so Playwright can parallelize it.
const HEAVY_TIMEOUT = process.env.PLP_BASE_URL ? 900_000 : 420_000;

// The declared exception TYPE of a predict-the-error exercise ↔ the concept
// its raise teaches. Both halves are asserted in K-5: the analyzer's raiseKind
// must map (through RAISE_TAG) to the tag this table names for the declared
// type, so provenance and analyzer can never drift apart silently.
const EXPECTED_TYPE_TAG = {
  NameError: "002N",
  TypeError: "002P",
  IndexError: "002Q",
  KeyError: "002R",
};

// The invariant-suite seed family for an exercise (design §4.5).
const seedFor = (id, k) => (fnv1a32(id) ^ k) >>> 0;

// A stratified subsample for the interpreter oracles (design §4.5): the
// first seed that first surfaces each declared shape/variant. Small — most
// exercises resolve to 1–3 programs — which keeps the Pyodide oracles bounded.
function stratifiedSeeds(ex) {
  const chosen = [];
  const shapes = new Set(), variants = new Set();
  for (let k = 0; k < 400 && (shapes.size < ex.generator.shapes.length || variants.size < ex.generator.variants.length); k++) {
    const prog = ex.generator.generate(seedFor(ex.id, k));
    if (!shapes.has(prog.shape) || !variants.has(prog.variant)) chosen.push(k);
    shapes.add(prog.shape); variants.add(prog.variant);
  }
  if (chosen.length === 0) chosen.push(0);
  return chosen;
}

// Canonical s-expression of the micro-parser's AST — structure and operators
// only (names and literal values are erased). The inv-8 oracle asserts this
// equals the same normalisation of Python's own `ast` (built in Pyodide by
// buildOracleProbe), so a precedence or associativity bug in the hand-written
// parser cannot hide.
function jsNorm(node) {
  switch (node.kind) {
    case "int": return "(ci)";
    case "float": return "(cf)";
    case "str": return "(cs)";
    case "bool": return "(cb)";
    case "none": return "(cnone)";
    case "name": return "(nm)";
    case "group": return jsNorm(node.expr); // Python's ast has no paren node
    case "unaryop": return `(u ${node.op} ${jsNorm(node.operand)})`;
    case "binop": return `(bin ${node.op} ${jsNorm(node.left)} ${jsNorm(node.right)})`;
    case "boolop": return `(bool ${node.op} ${node.values.map(jsNorm).join(" ")})`;
    case "compare": return `(cmp ${jsNorm(node.left)} ${node.ops.join(",")} ${node.comparators.map(jsNorm).join(" ")})`;
    case "subscript": return `(sub ${jsNorm(node.value)} ${jsNorm(node.index)})`;
    case "slice": return `(slice ${node.lower ? jsNorm(node.lower) : "_"} ${node.upper ? jsNorm(node.upper) : "_"})`;
    case "list": return `(list ${node.items.map(jsNorm).join(" ")})`;
    case "tuple": return `(tup ${node.items.map(jsNorm).join(" ")})`;
    case "dict": return `(dict ${node.entries.map((e) => `(kv ${jsNorm(e.key)} ${jsNorm(e.value)})`).join(" ")})`;
    case "call": return `(${node.func} ${node.args.map(jsNorm).join(" ")})`;
    case "method": return `(method ${node.name} ${jsNorm(node.obj)} ${node.args.map(jsNorm).join(" ")})`;
    case "expr": return jsNorm(node.value);
    case "augassign": return `(aug ${node.op === "+=" ? "+" : node.op} (nm) ${jsNorm(node.value)})`;
    case "assign": return `(assign ${jsNormTarget(node.target)} ${jsNorm(node.value)})`;
    default: return `(${node.kind})`;
  }
}
function jsNormTarget(t) {
  if (t.kind === "name") return "(nm)";
  if (t.kind === "subscript") return `(sub (nm) ${jsNorm(t.index)})`;
  if (t.kind === "tuple") return `(tup ${t.names.map(() => "(nm)").join(" ")})`;
  return `(${t.kind})`;
}
const jsAst = (source) => `(mod ${parse(source).map(jsNorm).join(" ")})`;
// inv 8 (parser fidelity) targets EXPRESSION precedence/associativity — the
// hand-written parser's real risk. Compound statements (if/for/while) carry
// no precedence subtlety and are covered by inv 9 + inv 10 instead, so their
// programs skip the ast diff.
// "def" joins them (ladder §R4b): a def carries no expression precedence of
// its own, and Python's ast normal form for a FunctionDef has no counterpart
// in jsNorm — same precedent, same inv-9/inv-10 backstop.
const hasCompound = (source) => parse(source).some((s) => ["if", "for", "while", "def"].includes(s.kind));

// The subset program(s) whose footprints a generated sample must keep inside
// the closure. Most forms have one; spot-the-difference has two (both A and
// B differ by one line and must each stay in the closure — design §5.2/§2.8);
// predict-state's displayed program does not print the probed name, so its
// concept becomes observable only through a read of that name, added here (a
// plain print the analyzer understands).
// The analyzer call for an exercise's program. Raising exercises
// (predict-the-error, expansion ladder §R3) are analyzed with
// { expectRaise: true }: their programs STOP on purpose, so the footprint
// that matters is the one accumulated up to and including the raise.
function fp(ex, src) {
  return kb.footprint(src, ex.form === "predict-the-error" ? { expectRaise: true } : {});
}

function footprintSources(ex, prog) {
  // A GONE probe (ladder §R4b wave 4) names a local that no longer exists at
  // program end: appending `print(<probe>)` would RAISE instead of revealing,
  // so the program stands alone. Salience does not suffer — the body's local
  // bind is what emits 002D in the first place.
  if (ex.form === "predict-state" && prog.probeGone) return [prog.code];
  if (ex.form === "predict-state" && prog.probeName) return [`${prog.code}print(${prog.probeName})\n`];
  if (ex.form === "spot-the-difference") return [prog.code, prog.contrastCode];
  // trace-table probes every watched name (they survive to program end —
  // Python loop variables outlive the loop), so the probed reads are visible
  // to the analyzer exactly like predict-state's.
  if (ex.form === "trace-table") return [`${prog.code}${prog.probeNames.map((n) => `print(${n})`).join("\n")}\n`];
  // order-the-lines carries no `code`: the exercise IS the canonical line
  // list (the shuffle is drawn at compile time), so the canonical join is the
  // program whose footprint must stay inside the closure.
  if (ex.form === "order-the-lines") return [canonicalOrderCode(prog)];
  // fix-the-bug: BOTH sides must satisfy the closure — the buggy program the
  // learner reads AND the fixed one the intended repair produces (the repair
  // is where the focus concept usually fires: `b = a[:]` is 0024 itself).
  if (ex.form === "fix-the-bug") {
    return [prog.code, spliceBlankAt(prog.code, prog.blank, prog.blank.target)];
  }
  // predict-io: the program IS the whole story — the typed lines are data
  // arriving from outside, never source the analyzer could see.
  if (ex.form === "predict-io") return [prog.code];
  // predict-the-error: the program IS the whole story (it raises); there is
  // no probe to append — a read of a name after the crash never happens.
  return [prog.code];
}

// Splice a blank (fill-one-blank / write-the-line) with a replacement — the
// same operation app/kb-session.mjs's spliceBlank performs, restated here
// because kb/ and the K-series never import from app/.
function spliceBlankAt(code, blank, replacement) {
  const lines = code.split("\n");
  const li = blank.line - 1;
  const line = lines[li] ?? "";
  lines[li] = line.slice(0, blank.col) + replacement + line.slice(blank.col + blank.len);
  return lines.join("\n");
}

// The canonical (solved) program of an order-the-lines sample.
const canonicalOrderCode = (prog) => prog.lines.join("\n") + "\n";

// The parser-fidelity HALF of the oracle probe, for programs that RAISE on
// purpose (predict-the-error, expansion ladder §R3): the source is parsed with
// ast but never executed, so the probe still runs clean and inv-8 keeps its
// teeth. Type fidelity does not apply — a program that stops has no end state
// (the analyzer returns finalTypes: {}) — and inv 11's real-output floor is
// replaced by the crash-rendering floor below.
function buildParseOnlyProbe(source) {
  return buildOracleProbe(source, [], { execute: false });
}

// A single Pyodide program per sample that emits, in order: the Python-`ast`
// normal form (inv 8), the program's real output (inv 11), and the runtime
// type of each still-bound name in the analyzer's declared order (inv 9).
function buildOracleProbe(source, names, { execute = true } = {}) {
  const typePrints = names.map((n) => `print(type(${n}).__name__)`).join("\n");
  return `import ast
def _op(o):
    return {'Add':'+','Sub':'-','Mult':'*','Div':'/','FloorDiv':'//','Mod':'%','Pow':'**','USub':'-','Not':'not'}[type(o).__name__]
def _cmp(o):
    return {'Lt':'<','Gt':'>','LtE':'<=','GtE':'>=','Eq':'==','NotEq':'!=','In':'in','NotIn':'not in'}[type(o).__name__]
def _n(x):
    t=type(x).__name__
    if t=='Module': return '(mod '+' '.join(_n(s) for s in x.body)+')'
    if t=='Expr': return _n(x.value)
    if t=='Assign': return '(assign '+_n(x.targets[0])+' '+_n(x.value)+')'
    if t=='AugAssign': return '(aug '+_op(x.op)+' '+_n(x.target)+' '+_n(x.value)+')'
    if t=='BinOp': return '(bin '+_op(x.op)+' '+_n(x.left)+' '+_n(x.right)+')'
    if t=='BoolOp': return '(bool '+('and' if type(x.op).__name__=='And' else 'or')+' '+' '.join(_n(v) for v in x.values)+')'
    if t=='Compare': return '(cmp '+_n(x.left)+' '+','.join(_cmp(o) for o in x.ops)+' '+' '.join(_n(c) for c in x.comparators)+')'
    if t=='UnaryOp': return '(u '+_op(x.op)+' '+_n(x.operand)+')'
    if t=='Subscript': return '(sub '+_n(x.value)+' '+_n(x.slice)+')'
    if t=='Slice': return '(slice '+(_n(x.lower) if x.lower else '_')+' '+(_n(x.upper) if x.upper else '_')+')'
    if t=='List': return '(list '+' '.join(_n(e) for e in x.elts)+')'
    if t=='Tuple': return '(tup '+' '.join(_n(e) for e in x.elts)+')'
    if t=='Dict': return '(dict '+' '.join('(kv '+_n(k)+' '+_n(v)+')' for k,v in zip(x.keys,x.values))+')'
    if t=='Name': return '(nm)'
    if t=='Constant':
        v=x.value
        if v is None: return '(cnone)'
        if isinstance(v,bool): return '(cb)'
        if isinstance(v,int): return '(ci)'
        if isinstance(v,float): return '(cf)'
        return '(cs)'
    if t=='Call':
        f=x.func
        if type(f).__name__=='Name': return '('+f.id+' '+' '.join(_n(a) for a in x.args)+')'
        return '(method '+f.attr+' '+_n(f.value)+' '+' '.join(_n(a) for a in x.args)+')'
    return '('+t+')'
_SRC = '''${source}'''
print('@AST@'+_n(ast.parse(_SRC)))
print('@OUT@')
${execute ? source : ""}print('@TYP@')
${typePrints}
`;
}

// First 5 outputs of mulberry32(42) — asserted against BOTH the kb copy
// (here) and the app's copy (in the browser test below) so the two
// implementations cannot drift apart silently.
const RNG_PARITY = [
  0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
  0.6697340414393693, 0.17481389874592423,
];

test.describe("PLP knowledge base (K-series)", () => {

  test("K-1: tag ledger well-formed; every loaded concept matches its active ledger entry (inv 3; design §2.5)", () => {
    const ledger = JSON.parse(readFileSync(new URL("../kb/tags.ledger.json", import.meta.url), "utf8"));
    const tagRe = /^[0-9A-HJKMNP-TV-Z]{4}$/; // Crockford base-32: no I L O U
    const tags = new Set();
    const slugs = new Set();
    const byTag = new Map();
    for (const e of ledger) {
      expect(e.tag, "tag charset").toMatch(tagRe);
      expect(tags.has(e.tag), `tag ${e.tag} unique`).toBe(false);
      expect(slugs.has(e.slug), `slug ${e.slug} unique`).toBe(false);
      tags.add(e.tag);
      slugs.add(e.slug);
      byTag.set(e.tag, e);
      expect(["active", "split", "merged-into"]).toContain(e.status);
    }
    // Every parent named anywhere in the ledger must exist in the ledger.
    for (const e of ledger) for (const p of e.parents) expect(tags.has(p), `parent ${p} of ${e.tag} exists in ledger`).toBe(true);
    // The ledger is the permanent allocation registry; during breadth
    // build-out it runs AHEAD of the loaded concept set (analyzer + exercises
    // land topic-by-topic — design §2.5, phase plan A1). So the agreement is
    // directional: every LOADED concept must appear as an ACTIVE ledger entry
    // with byte-identical slug/kind/parents. Ledger tags with no loaded
    // concept yet are expected, not a failure.
    for (const [tag, c] of kb.concepts) {
      const e = byTag.get(tag);
      expect(e, `loaded concept ${tag} present in ledger`).toBeTruthy();
      expect(e.status, `loaded concept ${tag} is an active ledger entry`).toBe("active");
      expect(c.slug, `slug of ${tag}`).toBe(e.slug);
      expect(c.kind, `kind of ${tag}`).toBe(e.kind);
      expect(c.parents, `parents of ${tag}`).toEqual(e.parents);
    }
  });

  test("K-2: tag ledger is append-only against HEAD (inv 4, local approximation)", () => {
    let committed;
    try {
      committed = execSync("git show HEAD:kb/tags.ledger.json", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString();
    } catch {
      return; // ledger not committed yet — nothing to compare against
    }
    const before = JSON.parse(committed);
    const now = JSON.parse(readFileSync(new URL("../kb/tags.ledger.json", import.meta.url), "utf8"));
    expect(now.length, "entries are never deleted").toBeGreaterThanOrEqual(before.length);
    for (let i = 0; i < before.length; i++) {
      const { tag, slug, kind, parents } = now[i];
      // A committed entry's tag may never change; its structure may only
      // change through the explicit split/merge protocol (status flip +
      // successors), never by silent edits to tag/kind/parents. Slugs are
      // renamable by design.
      expect(tag, `ledger[${i}] tag is permanent`).toBe(before[i].tag);
      expect(kind, `ledger[${i}] kind unchanged`).toBe(before[i].kind);
      expect(parents, `ledger[${i}] parents unchanged`).toEqual(before[i].parents);
      void slug;
    }
  });

  test("K-3: concept graph is a DAG and fully reachable from the roots (inv 1, 2)", () => {
    // Acyclicity via Kahn's algorithm over parent edges.
    const indeg = new Map([...kb.concepts.keys()].map((t) => [t, kb.concepts.get(t).parents.length]));
    const queue = [...indeg].filter(([, d]) => d === 0).map(([t]) => t);
    const children = new Map([...kb.concepts.keys()].map((t) => [t, []]));
    for (const c of kb.concepts.values()) for (const p of c.parents) children.get(p).push(c.tag);
    const order = [];
    while (queue.length) {
      const t = queue.shift();
      order.push(t);
      for (const ch of children.get(t)) {
        indeg.set(ch, indeg.get(ch) - 1);
        if (indeg.get(ch) === 0) queue.push(ch);
      }
    }
    const cycle = [...indeg].filter(([, d]) => d > 0).map(([t]) => t);
    expect(cycle, `cycle among ${cycle.join(", ")}`).toEqual([]);

    // Every node reachable from the structural roots.
    const seen = new Set(kb.structural);
    const bfs = [...kb.structural];
    while (bfs.length) {
      const t = bfs.shift();
      for (const ch of children.get(t)) if (!seen.has(ch)) { seen.add(ch); bfs.push(ch); }
    }
    const orphans = [...kb.concepts.keys()].filter((t) => !seen.has(t));
    expect(orphans, "concepts unreachable from the roots").toEqual([]);
  });

  test("K-4: static exercise contract — assumed ⊆ ancestors(focus), focus ∉ assumed, contrast ∈ assumed; challenge relaxation scoped to its role (inv 5, R1)", () => {
    for (const ex of kb.exercises) {
      const anc = kb.ancestors(ex.focus);
      expect(["intro", "review", "challenge"]).toContain(ex.role);
      if (ex.role === "challenge") {
        // R1.2 DECIDED CONTRACT: braids non-empty, known, non-structural,
        // ⊆ assumed, disjoint from the focus lineage; assumed ⊆
        // ancestors(focus) ∪ braids ∪ ⋃ancestors(braid) — the relaxation
        // exists ONLY for this role, compensated by the dynamic met gate.
        expect(Array.isArray(ex.braids) && ex.braids.length > 0, `${ex.id}: challenge needs braids`).toBe(true);
        const closure = new Set(anc);
        for (const b of ex.braids) {
          expect(kb.concepts.has(b), `${ex.id}: braid ${b} known`).toBe(true);
          expect(kb.structural.has(b), `${ex.id}: braid ${b} non-structural`).toBe(false);
          expect(ex.assumed.includes(b), `${ex.id}: braid ${b} in assumed`).toBe(true);
          expect(b === ex.focus || anc.has(b), `${ex.id}: braid ${b} must sit OUTSIDE the focus lineage`).toBe(false);
          closure.add(b);
          for (const a of kb.ancestors(b)) closure.add(a);
        }
        const outside = ex.assumed.filter((t) => !closure.has(t));
        expect(outside, `${ex.id}: assumed tags outside the challenge closure`).toEqual([]);
      } else {
        expect(ex.braids, `${ex.id}: braids are challenge-only`).toBeUndefined();
        const outside = ex.assumed.filter((t) => !anc.has(t));
        expect(outside, `${ex.id}: assumed tags outside ancestors(${ex.focus})`).toEqual([]);
      }
      expect(ex.assumed.includes(ex.focus), `${ex.id}: focus in assumed`).toBe(false);
      // difficulty: "hard" (R1.3) is a review/challenge-only marker.
      if (ex.difficulty !== undefined) {
        expect(ex.difficulty).toBe("hard");
        expect(["review", "challenge"], `${ex.id}: hard is review/challenge only`).toContain(ex.role);
      }
      // A contrast exercise still meets exactly one new thing: the contrasted
      // concept must be an ancestor of the focus AND already assumed (§2.8).
      if (ex.contrast) {
        expect(anc.has(ex.contrast), `${ex.id}: contrast ${ex.contrast} not an ancestor of focus`).toBe(true);
        expect(ex.assumed.includes(ex.contrast), `${ex.id}: contrast ${ex.contrast} not in assumed`).toBe(true);
      }
    }
  });

  test("K-5: footprint ⊆ assumed ∪ {focus} ∪ Structural on every generated program; analyzer total; declared shapes/variants reachable (inv 6, 7)", () => {
    for (const ex of kb.exercises) {
      const closure = new Set([...ex.assumed, ex.focus, ...kb.structural]);
      const shapesSeen = new Set();
      const variantsSeen = new Set();
      for (let k = 0; k < 40; k++) {
        const prog = ex.generator.generate(seedFor(ex.id, k));
        shapesSeen.add(prog.shape);
        variantsSeen.add(prog.variant);
        for (const src of footprintSources(ex, prog)) {
          const r = fp(ex, src);
          expect(r.error, `${ex.id} seed ${k}: analyzer error ${JSON.stringify(r.error)} on:\n${src}`).toBeUndefined();
          if (ex.form === "predict-the-error") {
            // The raise is the exercise: the analyzer must find one, on the
            // declared line, of the declared TYPE (via RAISE_TAG). The
            // authored `expectedError` is provenance — it is checked here and
            // against real execution in K-10, and used nowhere else.
            expect(r.raises, `${ex.id} seed ${k}: no raise found in:\n${src}`).toBeTruthy();
            expect(r.raises.line, `${ex.id} seed ${k}: raise line`).toBe(prog.expectedError.line);
            expect(RAISE_TAG[r.raises.kind], `${ex.id} seed ${k}: raiseKind ${r.raises.kind} maps to a concept`)
              .toBe(EXPECTED_TYPE_TAG[prog.expectedError.type]);
          }
          const excess = r.tags.filter((t) => !closure.has(t));
          const why = excess.map((t) => JSON.stringify(r.evidence.filter((e) => e.tag === t))).join(" ");
          expect(excess, `${ex.id} seed ${k}: tags outside closure (${why}) in:\n${src}`).toEqual([]);
        }
      }
      // Every declared shape/variant must actually be generatable —
      // extend the scan window before declaring one dead.
      for (let k = 40; k < 400 && (shapesSeen.size < ex.generator.shapes.length || variantsSeen.size < ex.generator.variants.length); k++) {
        const prog = ex.generator.generate(seedFor(ex.id, k));
        shapesSeen.add(prog.shape);
        variantsSeen.add(prog.variant);
      }
      expect([...shapesSeen].sort(), `${ex.id}: declared shapes all reachable`).toEqual([...ex.generator.shapes].sort());
      expect([...variantsSeen].sort(), `${ex.id}: declared variants all reachable`).toEqual([...ex.generator.variants].sort());
    }
  });

  test("K-5a: analyzer reproduces the design's hand-computed footprints (inv 6 anchor)", () => {
    const fp = (src) => {
      const r = kb.footprint(src);
      expect(r.error, `analyzer error on:\n${src}`).toBeUndefined();
      return r.tags;
    };
    // Design §10.2 exercises A, B, C:
    expect(fp('print("hi")\n')).toEqual(["0005"]);
    expect(fp("print(12 / 4)\n")).toEqual(["0003", "0005", "000P"]);
    expect(fp("a = [1, 2]\nb = a\nb += [7]\nprint(a)\n"))
      .toEqual(["0003", "0005", "0006", "000D", "000H", "0023"]);
    // The §10.2 contrast program: b = b + [x] rebinds — no aliasing
    // observation, no plus-eq tag.
    expect(fp("a = [1, 2]\nb = a\nb = b + [7]\nprint(a)\n"))
      .toEqual(["0003", "0005", "0006", "000A", "000D", "0021"]);
    // A latent alias (mutation never observed through the other name)
    // warns instead of charging names-share-list (§4.4 rule 1).
    const latent = kb.footprint("a = [1, 2]\nb = a\nb.append(7)\nprint(b)\n");
    expect(latent.tags).not.toContain("000H");
    expect(latent.warnings.map((w) => w.code)).toContain("latent-alias");
    // Totality: constructs outside the subset are hard errors, never
    // silently unmapped.
    expect(kb.footprint("import os\n").error?.code).toBe("unmapped-syntax");
    expect(kb.footprint("print(x)\n").error?.code).toBe("would-raise");

    // R3 detections. WITHOUT expectRaise every one of them stays an ordinary
    // would-raise error return (the default path is byte-identical to before);
    // WITH it, the partial footprint plus { line, kind } comes back.
    const anchors = [
      ['s = "cat"\nn = 3\nprint(s + n)\n', { line: 3, kind: "type-str-int" }, ["0003", "0006", "002P"]],
      ['n = 3\ns = "cat"\nprint(n + s)\n', { line: 3, kind: "type-str-int" }, ["0003", "0006", "002P"]],
      ["xs = [1, 2, 3]\nprint(xs[5])\n", { line: 2, kind: "index-out-of-range" }, ["0003", "0006", "000D", "000E", "002Q"]],
      ["xs = [1, 2, 3]\nprint(xs[3])\n", { line: 2, kind: "index-out-of-range" }, ["0003", "0006", "000D", "000E", "002Q"]],
      ['d = {"a": 1}\nprint(d["b"])\n', { line: 2, kind: "key-missing" }, ["0003", "0006", "001R", "002R"]],
      ["print(x)\n", { line: 1, kind: "name-unbound" }, ["002N"]],
    ];
    for (const [src, raises, tags] of anchors) {
      expect(kb.footprint(src).error?.code, `default path on:\n${src}`).toBe("would-raise");
      expect(kb.footprint(src).tags, `default path returns no tags on:\n${src}`).toBeUndefined();
      const r = kb.footprint(src, { expectRaise: true });
      expect(r.error, `expectRaise analyzer error on:\n${src}`).toBeUndefined();
      expect(r.raises, `expectRaise raise on:\n${src}`).toEqual(raises);
      expect(r.tags, `expectRaise footprint on:\n${src}`).toEqual([...tags].sort());
      expect(r.finalTypes, `a raising program has no end state:\n${src}`).toEqual({});
    }
    // A statically-known index that IS in range, and a key that IS present,
    // stay ordinary completing programs (the detections never over-fire).
    expect(kb.footprint("xs = [1, 2, 3]\nprint(xs[2])\n").error).toBeUndefined();
    expect(kb.footprint('d = {"a": 1}\nprint(d["a"])\n').error).toBeUndefined();
    // str * int is the legal repeat, not a mix.
    expect(kb.footprint('print("ab" * 3)\n').error).toBeUndefined();
    // A key stored after the literal is a known key from then on.
    expect(kb.footprint('d = {"a": 1}\nd["b"] = 2\nprint(d["b"])\n').error).toBeUndefined();
  });

  test("K-5b: def/call/return frames — the ladder §R4b anchor cases (inv 6 anchor)", () => {
    const tags = (src) => {
      const r = kb.footprint(src);
      expect(r.error, `analyzer error on:\n${src}`).toBeUndefined();
      return r.tags;
    };
    // --- the 11 positive cases (rule → tag, ladder §R4b) ----------------
    // 1. A def BINDS; an un-called body emits NOTHING (0027 rule-def). This
    //    is what makes 0027's intro footprint-clean.
    expect(tags('def greet():\n    print("hi")\nprint("done")\n')).toEqual(["0005", "0027"]);
    // 2. A call runs the body — once per call (0028 rule-call).
    expect(tags('def greet():\n    print("hi")\ngreet()\ngreet()\n')).toEqual(["0005", "0027", "0028"]);
    // 3. A call of a function WITH a parameter binds the argument (0029).
    expect(tags("def double(n):\n    print(n * 2)\ndouble(5)\n"))
      .toEqual(["0003", "0005", "0006", "0008", "0027", "0028", "0029"]);
    // 4. Parameters bind LEFT TO RIGHT; two of them is still one 0029.
    expect(tags("def pair(a, b):\n    print(a)\npair(1, 2)\n"))
      .toEqual(["0003", "0005", "0006", "0027", "0028", "0029"]);
    // 5. A consumed `return <expr>` is 002A (rule-return-value).
    expect(tags("def size():\n    return 3 + 4\nx = size()\nprint(x)\n"))
      .toEqual(["0003", "0005", "0006", "0008", "0009", "0027", "0028", "002A"]);
    // 6. A non-atomic ARGUMENT is computed first (002F rule-args-first).
    expect(tags("def double(n):\n    return n * 2\nprint(double(2 + 3))\n"))
      .toEqual(["0003", "0005", "0006", "0008", "0027", "0028", "0029", "002A", "002F"]);
    // 7. A call inside a larger expression is 002G (rule-call-in-expr) —
    //    and NOT 002F: `3` is an atomic argument.
    expect(tags("def double(n):\n    return n * 2\nprint(double(3) + 1)\n"))
      .toEqual(["0003", "0005", "0006", "0008", "0027", "0028", "0029", "002A", "002G"]);
    // 8. A body that only PRINTS hands back None (002B rule-return-vs-print).
    expect(tags('def shout():\n    print("hi")\nx = shout()\nprint(x)\n'))
      .toEqual(["0005", "0006", "0027", "0028", "002B"]);
    // 9. Statements after an executed return never run (002C).
    expect(tags('def f():\n    return 1\n    print("never")\nprint(f())\n'))
      .toEqual(["0003", "0005", "0027", "0028", "002A", "002C"]);
    // 10. A computed-and-discarded value + a consumed None is 002H, and NOT
    //     002B (nothing was printed).
    expect(tags("def f(n):\n    n * 2\nprint(f(3))\n"))
      .toEqual(["0003", "0005", "0006", "0008", "0027", "0028", "0029", "002H"]);
    // 11. A bare return is the same fall-through (002H), still not 002B.
    expect(tags("def f():\n    return\nprint(f())\n")).toEqual(["0005", "0027", "0028", "002H"]);

    // --- scope: the frame VANISHES, and a function is not a value --------
    // 12. A body statement that binds a NEW name makes a local (002D
    //     rule-local); when the module env already binds that spelling, the
    //     local HIDES it (002E rule-shadow) and the outer one is untouched —
    //     a fresh local binding, never a rebind of the module name (no 000A).
    expect(tags("x = 1\ndef f():\n    x = 99\nf()\nprint(x)\n"))
      .toEqual(["0003", "0005", "0006", "0027", "0028", "002D", "002E"]);
    // 13. A local with no module twin is 002D alone.
    expect(tags('def f():\n    w = "hi"\n    print(w)\nf()\n'))
      .toEqual(["0005", "0006", "0027", "0028", "002D"]);
    // 14. DEVIATION from the ladder's sketch, and load-bearing: a PARAMETER
    //     binding is NOT 002D. 002D is a CHILD of 0029, so charging it to a
    //     plain parameter would push every 0029/002F/002J exercise out of its
    //     own closure (E1). Rebinding a parameter is likewise not a new local.
    expect(tags("def f(n):\n    print(n)\nf(5)\n"))
      .toEqual(["0003", "0005", "0006", "0027", "0028", "0029"]);
    expect(tags("def f(xs):\n    xs = [7]\nnums = [1, 2]\nf(nums)\nprint(nums)\n"))
      .toEqual(["0003", "0005", "0006", "000A", "000D", "0027", "0028", "0029"]);
    // 15. A mutation through a PARAMETER's objId, observed afterwards through
    //     the caller's own name, is 002J (rule-mutable-arg) — alongside the
    //     plain two-names alias observation it also is (000H, its parent).
    expect(tags("def add(xs):\n    xs.append(9)\nnums = [1, 2]\nadd(nums)\nprint(nums)\n"))
      .toEqual(["0003", "0005", "0006", "000D", "000G", "000H", "0027", "0028", "0029", "002J"]);
    // …and a call that only READS the list emits neither.
    expect(tags("def show(xs):\n    print(xs)\nnums = [1, 2]\nshow(nums)\nprint(nums)\n"))
      .toEqual(["0003", "0005", "0006", "000D", "0027", "0028", "0029"]);
    // A body that only reads a MODULE name emits neither 002D nor 002E.
    expect(tags("y = 1\ndef f():\n    print(y)\nf()\n"))
      .toEqual(["0003", "0005", "0006", "0027", "0028"]);
    // Locals never survive the call, and a function value is not concrete —
    // neither appears in the end-state store the inv-9 oracle probes.
    const scoped = kb.footprint("v = 2\ndef f():\n    inside = 5\n    print(inside)\nf()\n");
    expect(scoped.finalTypes).toEqual({ v: "int" });
    // FRAME TEARDOWN, the known hazard (ladder §R4b A4): binding a parameter
    // to a list adds the parameter's NAME to that object's name set, and the
    // objects table is program-global. If teardown did not withdraw it, the
    // stale name would make the list look SHARED forever — and `+=` on a list
    // is gated on exactly that (it is only in the subset when the list really
    // has two names). After a non-mutating call, `nums += [3]` must therefore
    // still be judged unshared, not silently promoted to 0023.
    expect(kb.footprint("def show(xs):\n    print(xs)\nnums = [1, 2]\nshow(nums)\nnums += [3]\nprint(nums)\n").error?.code)
      .toBe("unmapped-syntax");
    // The same withdrawal keeps a LATER genuine alias honest rather than
    // pre-poisoned: two module names really sharing still reads as 000H.
    expect(tags("def show(xs):\n    print(xs)\nnums = [1, 2]\nshow(nums)\nb = nums\nb.append(3)\nprint(nums)\n"))
      .toContain("000H");

    // --- the negatives ---------------------------------------------------
    const err = (src) => kb.footprint(src).error;
    // return at the top level is not a statement of the subset.
    expect(err("return 1\n")?.code).toBe("unmapped-syntax");
    // A def is top-level only: inside a compound (or nested) it is unmapped.
    expect(err("if True:\n    def f():\n        print(1)\n")?.code).toBe("unmapped-syntax");
    expect(err("def f():\n    def g():\n        print(1)\n")?.code).toBe("unmapped-syntax");
    // Calling before the def RUNS is a NameError, not a syntax gap.
    expect(err("f()\ndef f():\n    print(1)\n")).toEqual({ code: "would-raise", message: expect.any(String), line: 1 });
    // Reading a name the body assigns LATER is UnboundLocalError — the
    // pre-scan makes it a would-raise so the module value can never be read
    // through the frame by accident.
    expect(err("y = 1\ndef f():\n    print(y)\n    y = 2\nf()\n")?.code).toBe("would-raise");
    // A bound non-function is not callable; an unsupported builtin is still a
    // closed-grammar gap (the parser now parses a call of ANY name).
    expect(err("x = 3\nx()\n")?.code).toBe("would-raise");
    expect(err("print(abs(3))\n")?.code).toBe("unmapped-syntax");
    // Out of subset by design: control flow in a body, a call from inside a
    // body (recursion), redefining a def, and using a function as a value.
    expect(err("def f():\n    if True:\n        print(1)\nf()\n")?.code).toBe("unmapped-syntax");
    expect(err("def g():\n    print(1)\ndef h():\n    g()\nh()\n")?.code).toBe("unmapped-syntax");
    expect(err("def g():\n    print(1)\ndef g():\n    print(2)\n")?.code).toBe("unmapped-syntax");
    expect(err("def g():\n    print(1)\nh = g\n")?.code).toBe("unmapped-syntax");
  });

  test("K-fnattr: a trace-table row over a CALL is attributed to the CALL SITE, not the callee's line", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));
    // The wave-3 `two-calls-chain` table (ladder §R4b) watches MODULE names
    // across two calls. A module binding produced by a call is first OBSERVED
    // at a position inside the callee (the `return` line group), which used to
    // label the row with a line the watched name is never assigned on. The
    // builder now attributes a globals-scope change to the module-level
    // statement that owns the frame — the CALL SITE. This test is the
    // regression guard for that attribution.
    const code = "def double(n):\n    return n * 2\nv = 4\nx = double(v)\ny = double(x)\nprint(y)\n";
    const got = await page.evaluate(async (src) => {
      window.plp.editor.setValue(src);
      const summary = await window.plp.trace();
      const q = window.plp.questions.generateQuestion("trace-table", {
        source: src,
        steps: window.plp.memory.steps(),
        positions: window.plp.memory.linePositions(),
      }, { names: ["x", "y"], maxBlanks: 8 });
      return {
        reason: summary?.terminal_reason,
        rows: (q?.rows ?? []).map((r) => ({ line: r.line, cells: r.cells.map((c) => `${c.name}=${c.value}`) })),
        code: (q?.rows ?? []).map((r) => r.codeText),
        errors: window.plp.checkErrors(),
      };
    }, code);
    expect(got.reason).toBe("completed");
    expect(got.errors).toEqual([]);
    // Values AND lines: each row sits on the call that produced the binding.
    expect(got.rows).toEqual([
      { line: 4, cells: ["x=8", "y=—"] },
      { line: 5, cells: ["x=8", "y=16"] },
    ]);
    expect(got.code).toEqual(["x = double(v)", "y = double(x)"]);
  });

  test("K-6: generators and selection are deterministic (inv 16)", () => {
    const kb2 = loadKB();
    for (const ex of kb.exercises) {
      const ex2 = kb2.exercises.find((e) => e.id === ex.id);
      for (let k = 0; k < 5; k++) {
        const seed = seedFor(ex.id, k);
        expect(ex.generator.generate(seed)).toEqual(ex.generator.generate(seed));
        expect(ex.generator.generate(seed)).toEqual(ex2.generator.generate(seed));
      }
    }
    const met = new Set(["0005", "0006"]);
    expect([...kb.frontier(met)].sort()).toEqual([...kb2.frontier(met)].sort());
    expect(kb.offerable(met).map((e) => e.id)).toEqual(kb2.offerable(met).map((e) => e.id));
  });

  test("K-7: every non-structural concept has ≥1 intro exercise (inv 12)", () => {
    const covered = new Set(kb.exercises.filter((e) => e.role === "intro").map((e) => e.focus));
    const missing = [...kb.concepts.values()]
      .filter((c) => c.kind !== "structural" && !covered.has(c.tag))
      .map((c) => `${c.tag} ${c.slug}`);
    expect(missing).toEqual([]);
  });

  test("K-8: cold start walks the E1–E7 chain to names-share-list; the diamond gates aliasing (dynamic contract, §10.3)", () => {
    const met = new Set();
    // A brand-new student's frontier is exactly print-text.
    expect([...kb.frontier(met)]).toEqual(["0005"]);

    const chain = [
      ["hello-print", "0005"],
      ["name-then-print", "0006"],
      ["rebind-replaces", "000A"],
      ["copy-then-rebind", "000C"],
      ["list-shows-brackets", "000D"],
      ["append-grows", "000G"],
      ["alias-trap", "000H"],
    ];
    for (const [id, focus] of chain) {
      const offer = kb.offerable(met);
      // The dynamic contract holds at every step: nothing offerable
      // assumes an unmet concept.
      for (const ex of offer) {
        const unmetAssumed = ex.assumed.filter((t) => !met.has(t) && !kb.structural.has(t));
        expect(unmetAssumed, `${ex.id} offered with unmet assumed`).toEqual([]);
      }
      // Aliasing stays locked until BOTH flanks of the diamond are met.
      const bothFlanksMet = met.has("000C") && met.has("000G");
      expect(kb.frontier(met).has("000H"), `000H frontier state with met = {${[...met]}}`).toBe(bothFlanksMet);
      expect(offer.map((e) => e.id), `${id} must be offerable`).toContain(id);
      met.add(focus); // a correct prediction on the focus = met (§2.8)
    }
    expect(met.has("000H")).toBe(true);
    // With aliasing met, the deep exercise (plus-eq) needs list-concat too.
    expect(kb.frontier(met).has("0023")).toBe(false);
    met.add("0021");
    expect(kb.frontier(met).has("0023")).toBe(true);

    // Challenge gate (R1.2): chal-alias-in-loop needs focus 000H met AND
    // every assumed tag met — 001E and 001K are still missing here.
    expect(kb.offerable(met).map((e) => e.id)).not.toContain("chal-alias-in-loop");
    met.add("001E");
    expect(kb.offerable(met).map((e) => e.id)).not.toContain("chal-alias-in-loop");
    met.add("001K");
    expect(kb.offerable(met).map((e) => e.id)).toContain("chal-alias-in-loop");
  });

  test("K-rng: kb mulberry32 matches the pinned stream (drift guard, Node side)", () => {
    const r = mulberry32(42);
    for (const want of RNG_PARITY) expect(r()).toBeCloseTo(want, 15);
  });

  // K-10 executes EVERY exercise's stratified programs in real Pyodide, so
  // its cost is O(bank). Split per TOPIC so each slice carries its own budget:
  // the bank can keep growing without one monolithic test tipping over, and a
  // failure names the topic it came from. (workers:1 keeps Pyodide serialized,
  // so this buys budget, not parallelism.)
  for (const topic of [...new Set(kb.exercises.map((e) => e.topic))].sort()) {
  test(`K-10 [${topic}]: every exercise generates clean, gradable, one-line programs under real execution (inv 10)`, async ({ page }) => {
    test.setTimeout(HEAVY_TIMEOUT);
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));

    // The app's mulberry32 must produce the same stream as kb/rng.mjs.
    const browserStream = await page.evaluate(() => {
      const r = window.plp.questions.mulberry32(42);
      return [r(), r(), r(), r(), r()];
    });
    browserStream.forEach((v, i) => expect(v).toBeCloseTo(RNG_PARITY[i], 15));

    for (const ex of kb.exercises.filter((e) => e.topic === topic)) {
      // Stratified seeds: first occurrence of each declared shape and
      // variant, padded with the earliest remaining seeds to 5.
      const chosen = [];
      const shapes = new Set();
      const variants = new Set();
      for (let k = 0; k < 400 && (shapes.size < ex.generator.shapes.length || variants.size < ex.generator.variants.length); k++) {
        const prog = ex.generator.generate(seedFor(ex.id, k));
        if (!shapes.has(prog.shape) || !variants.has(prog.variant)) chosen.push(k);
        shapes.add(prog.shape);
        variants.add(prog.variant);
      }
      for (let k = 0; chosen.length < 5; k++) if (!chosen.includes(k)) chosen.push(k);
      const programs = chosen.slice(0, 5).flatMap((k) => {
        const prog = ex.generator.generate(seedFor(ex.id, k));
        // spot-the-difference runs TWO programs: A (its real output must equal
        // the shown aOutput) and B (the predicted one, a normal predict-output).
        if (ex.form === "spot-the-difference") {
          // B is the graded program; its real output must differ from the
          // designed misconception (aOutput unless the generator overrides —
          // R1.1's "the moved line changed nothing" check IS the A≠B oracle).
          return [
            { code: prog.code, form: "predict-output", name: null, target: prog.aOutput },
            { code: prog.contrastCode, form: "predict-output", name: null, target: null, mis: prog.misconception ?? prog.aOutput },
          ];
        }
        // order-the-lines: the CANONICAL join must run clean and print
        // exactly the target (one line), and wrong arrangements must not.
        // Machine-enforced discrimination (§R2): rather than re-deriving the
        // compiler's rng-drawn deal from this context (the round rng is not
        // in hand here), two EXPLICIT dependency-breaking permutations are
        // asserted — the reverse, and the first two lines swapped. Both are
        // draws the shuffle can produce, and neither may print the target.
        if (ex.form === "order-the-lines") {
          const L = prog.lines;
          const join = (arr) => arr.join("\n") + "\n";
          const swapped = [L[1], L[0], ...L.slice(2)];
          return [
            { code: join(L), form: "predict-output", name: null, target: prog.targetOutput },
            { code: join([...L].reverse()), form: "predict-output", name: null, target: null, mustMissTarget: prog.targetOutput },
            { code: join(swapped), form: "predict-output", name: null, target: null, mustMissTarget: prog.targetOutput },
          ];
        }
        // predict-io (expansion ladder §R4a): the program is traced with its
        // stdin script answered line by line. Three things must hold: the run
        // completes clean, the script length EXACTLY matches the number of
        // rendezvous (no leftover line, no starvation), and the transcript is
        // gradable.
        if (ex.form === "predict-io") {
          return [{
            code: prog.code, form: "predict-io", name: null, target: null,
            stdin: [...prog.stdinScript], mis: prog.misconception ?? null,
          }];
        }
        // predict-the-error: the program must REALLY raise — with the declared
        // exception type on the declared line (expansion ladder §R3). The
        // "one printed line" law becomes "at most one line before the crash":
        // the crash is the answer, so anything more is noise.
        if (ex.form === "predict-the-error") {
          return [{ code: prog.code, form: "predict-the-error", name: null, target: null, raise: prog.expectedError }];
        }
        // write-the-line (expansion ladder §R5): fill-one-blank with a
        // line-wide blank. Two programs: the intended line spliced in must
        // print the target, and the SCOPE RULE is machine-enforced — the
        // generator's plausible CONSTANT line must not reproduce the target
        // (otherwise the exercise can be gamed without the concept).
        if (ex.form === "write-the-line") {
          return [
            { code: prog.code, form: "predict-output", name: null, target: prog.targetOutput },
            {
              code: spliceBlankAt(prog.code, prog.blank, prog.constantLine),
              form: "predict-output", name: null, target: null,
              mustMissTarget: prog.targetOutput,
            },
          ];
        }
        // fix-the-bug (expansion ladder §R5's composition): three programs.
        // The BUGGY one must run clean and really print the recorded wrong
        // output (the card quotes it as "but it prints"); the intended fix
        // must print the intended output; and the plausible conceptless line
        // must NOT — the same anti-gaming floor write-the-line carries.
        if (ex.form === "fix-the-bug") {
          expect(prog.wrongOutput, `${ex.id}: the bug must be observable (E6)`).not.toBe(prog.targetOutput);
          return [
            { code: prog.code, form: "predict-output", name: null, target: prog.wrongOutput },
            {
              code: spliceBlankAt(prog.code, prog.blank, prog.blank.target),
              form: "predict-output", name: null, target: prog.targetOutput,
            },
            {
              code: spliceBlankAt(prog.code, prog.blank, prog.constantLine),
              form: "predict-output", name: null, target: null,
              mustMissTarget: prog.targetOutput,
            },
          ];
        }
        // fill-one-blank's `code` is the FULL correct program; grade it as
        // predict-output and verify its real output equals the target.
        return [{
          code: prog.code,
          form: ex.form ?? "predict-exact-output",
          name: prog.probeName ?? null,
          names: prog.probeNames ?? null,
          maxBlanks: prog.maxBlanks ?? 8,
          target: prog.targetOutput ?? null,
          mis: ex.form === "trace-table" ? null : prog.misconception ?? null,
        }];
      });

      const results = await page.evaluate(async (progs) => {
        const out = [];
        for (const { code, form, name, names, maxBlanks, target, stdin } of progs) {
          window.plp.editor.setValue(code);
          if (form === "predict-io") {
            const res = await window.plp.traceWithStdin(stdin);
            const transcript = window.plp.console.text();
            out.push({
              reason: res?.summary?.terminal_reason,
              gradable: transcript.trim() !== "",
              expected: transcript.replace(/\n+$/, ""),
              // Exactly consumed: every scripted line was asked for, and the
              // program never asked for one the script did not hold.
              used: res?.used, exhausted: res?.exhausted,
              matchesTarget: true,
              errors: window.plp.checkErrors(),
            });
            continue;
          }
          const summary = await window.plp.trace();
          if (form === "predict-the-error") {
            // The exception comes off the trace stream's terminal record —
            // exactly the surface the tutor grades against (actions.lastException).
            const recs = window.plp.records();
            const terminal = recs.at(-1);
            const exc = terminal?.kind === "terminal" ? terminal.exception ?? null : null;
            // The engine splits the exception across records: type_name on the
            // terminal, the LOCATION on the last "exception" step. This is the
            // same derivation main.mjs's actions.lastException performs.
            const excStep = [...recs].reverse().find((r) => r.kind === "step" && r.event === "exception" && r.location);
            const printed = recs
              .filter((r) => r.kind === "step" && r.output?.stdout_delta)
              .map((r) => r.output.stdout_delta).join("");
            out.push({
              reason: summary?.terminal_reason,
              excType: exc?.type_name ?? null,
              excLine: exc?.location?.line ?? excStep?.location?.line ?? null,
              printedLines: printed.replace(/\n$/, "") === "" ? 0 : printed.replace(/\n$/, "").split("\n").length,
              errors: window.plp.checkErrors(),
            });
            continue;
          }
          const ctx = {
            source: code,
            steps: window.plp.memory.steps(),
            positions: window.plp.memory.linePositions(),
          };
          if (form === "trace-table") {
            // The trace-table contract: gradable, tight (2..maxBlanks
            // blanks), every expected value single-line, every watched name
            // actually blanked at least once.
            const q = window.plp.questions.generateQuestion("trace-table", ctx, { names, maxBlanks });
            const simulation = window.plp.questions.generateQuestion("trace-simulation", ctx, { names });
            const blanked = new Set((q?.blanks ?? []).map((b) => b.label.split(" · ").pop()));
            out.push({
              reason: summary?.terminal_reason,
              gradable: Boolean(q),
              progressive: Boolean(simulation),
              simulationSteps: simulation?.stepCount ?? 0,
              oneLine: (q?.blanks ?? []).every((b) => !String(b.expected).includes("\n")),
              tight: Boolean(q) && q.blanks.length >= 2 && q.blanks.length <= maxBlanks,
              allNamesBlanked: Boolean(q) && names.every((n) => blanked.has(n)),
              matchesTarget: true,
              errors: window.plp.checkErrors(),
            });
            continue;
          }
          const kind = form === "predict-state" ? "predict-state" : "predict-output";
          const q = window.plp.questions.generateQuestion(kind, {
            source: code,
            steps: window.plp.memory.steps(),
            positions: window.plp.memory.linePositions(),
          }, name ? { name } : {});
          // predict-state grades a latent value (the program may print
          // nothing), so the one-line check applies only to printed output.
          const expected = q ? q.grade({ text: "" }).expected.text.replace(/\n+$/, "") : null;
          out.push({
            reason: summary?.terminal_reason,
            gradable: Boolean(q),
            expected,
            oneLine: form === "predict-state" ? !(expected ?? "").includes("\n") : (expected !== null && !expected.includes("\n")),
            matchesTarget: target != null ? (expected === String(target).replace(/\n+$/, "")) : true,
            errors: window.plp.checkErrors(),
          });
        }
        return out;
      }, programs);

      results.forEach((r, i) => {
        // A deliberately-broken arrangement is allowed (expected!) to fail:
        // it must merely not produce the target — by different output OR by
        // never completing at all (the classic read-before-bind raise).
        if (programs[i].mustMissTarget != null) {
          const solved = r.reason === "completed"
            && (r.expected ?? "").trim() === String(programs[i].mustMissTarget).trim();
          expect(solved, `${ex.id} program ${i}: a shuffled arrangement must not already print the target`).toBe(false);
          expect(r.errors).toEqual([]);
          return;
        }
        if (programs[i].raise) {
          const want = programs[i].raise;
          expect(r.reason, `${ex.id} program ${i} must really raise`).toBe("uncaught_exception");
          expect(r.excType, `${ex.id} program ${i}: real exception type`).toBe(want.type);
          expect(r.excLine, `${ex.id} program ${i}: real exception line`).toBe(want.line);
          // ≤1 line printed before the crash (the E4 law, restated for a
          // program whose ending is the answer).
          expect(r.printedLines, `${ex.id} program ${i}: at most one line before the crash`).toBeLessThanOrEqual(1);
          expect(r.errors).toEqual([]);
          return;
        }
        if (programs[i].stdin) {
          expect(r.exhausted, `${ex.id} program ${i}: the stdin script must not be starved`).toBe(false);
          expect(r.used, `${ex.id} program ${i}: every scripted line must be consumed (no leftover)`)
            .toBe(programs[i].stdin.length);
        }
        expect(r.reason, `${ex.id} program ${i} must run clean`).toBe("completed");
        expect(r.gradable, `${ex.id} program ${i} must print something gradable`).toBe(true);
        // One printed line, unless the exercise is the flagged multi-line
        // exception (design §5.2 — loop-for-visits-each, where several lines
        // ARE the concept).
        if (!ex.multiline) expect(r.oneLine, `${ex.id} program ${i} must ask one thing (one output line)`).toBe(true);
        if (r.tight !== undefined) {
          expect(r.tight, `${ex.id} program ${i}: trace-table must yield 2..maxBlanks blanks`).toBe(true);
          expect(r.allNamesBlanked, `${ex.id} program ${i}: every watched name must be blanked at least once`).toBe(true);
          expect(r.progressive, `${ex.id} program ${i}: progressive trace must be buildable`).toBe(true);
          expect(r.simulationSteps, `${ex.id} program ${i}: progressive trace includes lines plus Program ends`).toBeGreaterThan(1);
        }
        // The interpreter is the fill target's ground truth.
        expect(r.matchesTarget, `${ex.id} program ${i}: real output must equal the fill target`).toBe(true);
        // R1.1: the designed misconception is never what really happens —
        // checked here for the forms whose graded truth K-oracles lacks
        // (spot-the-difference's program B; predict-state's probed value).
        if (programs[i].mis != null && r.expected != null) {
          expect(r.expected.trim(), `${ex.id} program ${i}: misconception must differ from the graded answer`)
            .not.toBe(String(programs[i].mis).trim());
        }
        expect(r.errors).toEqual([]);
      });
    }
  });
  }

  test("K-oracles: parser fidelity (inv 8), type fidelity (inv 9), discrimination (inv 11)", async ({ page }) => {
    test.setTimeout(HEAVY_TIMEOUT);
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));

    // Build one probe per stratified sample in Node, alongside the expected
    // JS-side normal form, the analyzer's end-state types, and the focus
    // concept's authored wrong answer.
    const items = [];
    for (const ex of kb.exercises) {
      for (const k of stratifiedSeeds(ex)) {
        const source = ex.form === "order-the-lines"
          ? canonicalOrderCode(ex.generator.generate(seedFor(ex.id, k)))
          : ex.generator.generate(seedFor(ex.id, k)).code;
        const raising = ex.form === "predict-the-error";
        const footprintResult = raising ? kb.footprint(source, { expectRaise: true }) : kb.footprint(source);
        expect(footprintResult.error, `${ex.id} seed ${k}: analyzer error ${JSON.stringify(footprintResult.error)}`).toBeUndefined();
        const fp = footprintResult;
        const names = Object.keys(fp.finalTypes);
        const prog = ex.generator.generate(seedFor(ex.id, k));
        // The designed misconception must differ from the graded truth. Here
        // realOut is program `code`'s printed output, so the check applies to
        // the printed-answer forms; spot-the-difference (graded against B)
        // and predict-state (graded against the probed value) are checked in
        // K-10 instead, where their real expected answer is in hand.
        // predict-io joins the parse-only tier: its program CANNOT run here
        // (it stops at input(), and this probe supplies no stdin), so real
        // output is unavailable — K-10 carries its discrimination floor
        // instead, where the real transcript is in hand.
        const scripted = ex.form === "predict-io";
        const misCheckable = !["spot-the-difference", "predict-state", "trace-table", "fill-one-blank", "write-the-line", "fix-the-bug", "predict-io"].includes(ex.form);
        items.push({
          id: ex.id, seed: k, source,
          jsAst: jsAst(source),
          compound: hasCompound(source),
          names,
          types: names.map((n) => fp.finalTypes[n]),
          wrongAnswer: kb.concepts.get(ex.focus).wrongAnswer,
          misconception: misCheckable ? prog.misconception ?? null : null,
          raising,
          // The crash rendering the reference and the reveal both use: a
          // wrongAnswer equal to THIS would be no wrong answer at all.
          crashRendering: raising ? `${prog.expectedError.type} (line ${prog.expectedError.line})` : null,
          scripted,
          probe: (raising || scripted) ? buildParseOnlyProbe(source) : buildOracleProbe(source, names),
        });
      }
    }

    const outputs = await page.evaluate(async (probes) => {
      const out = [];
      for (const probe of probes) {
        window.plp.editor.setValue(probe);
        const summary = await window.plp.run(); // untraced: no step limit, output flushes on completion
        out.push({ text: window.plp.console.text(), reason: summary?.terminal_reason });
      }
      return out;
    }, items.map((it) => it.probe));

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      // Untraced runs produce no trace records, so the health check is the
      // run summary's terminal reason (checkErrors validates the trace stream,
      // which is empty by design here — invariant 3).
      expect(outputs[i].reason, `${it.id} seed ${it.seed}: oracle probe must run clean\n${it.source}`).toBe("completed");
      const lines = outputs[i].text.split("\n");
      const astLine = lines.find((l) => l.startsWith("@AST@"));
      expect(astLine, `${it.id} seed ${it.seed}: probe produced no @AST@ line\n${it.source}`).toBeTruthy();

      // inv 8 — the hand-written parser's tree matches Python's own ast
      // (expression programs only; compound statements skip — see hasCompound).
      if (!it.compound) {
        expect(astLine.slice("@AST@".length), `${it.id} seed ${it.seed}: parser fidelity vs Python ast\n${it.source}`)
          .toBe(it.jsAst);
      }

      const outIdx = lines.indexOf("@OUT@");
      const typIdx = lines.indexOf("@TYP@");
      const realOut = lines.slice(outIdx + 1, typIdx).join("\n").replace(/\n+$/, "");
      const typeLines = lines.slice(typIdx + 1).filter((l) => l.length > 0);

      // inv 11 — the focus concept's authored wrong answer is not the real
      // output (a discrimination floor: a "wrong" answer equal to the truth
      // teaches nothing). A raising exercise never runs here, so its floor is
      // the CRASH rendering instead of printed output.
      if (it.raising) {
        expect(it.wrongAnswer.trim(), `${it.id} seed ${it.seed}: wrongAnswer must differ from the crash rendering`)
          .not.toBe(it.crashRendering);
        continue;
      }
      // predict-io: parser fidelity only (asserted above). The output and
      // type floors need a run this probe deliberately cannot perform.
      if (it.scripted) continue;
      expect(it.wrongAnswer.trim(), `${it.id} seed ${it.seed}: wrongAnswer must differ from real output`)
        .not.toBe(realOut.trim());

      // R1.1 discrimination floor: the instance's DESIGNED misconception is
      // never the truth — a "designed wrong" equal to the real output would
      // record a confusion for a correct mental model.
      if (it.misconception != null) {
        expect(it.misconception.trim(), `${it.id} seed ${it.seed}: misconception must differ from real output`)
          .not.toBe(realOut.trim());
      }

      // inv 9 — each surviving name's runtime type matches the abstract store.
      for (let j = 0; j < it.types.length; j++) {
        expect(typeLines[j], `${it.id} seed ${it.seed}: type fidelity for ${it.names[j]}\n${it.source}`)
          .toBe(it.types[j]);
      }
    }
  });

  test("K-inv13: every exercise exercises its focus (salience), else a focus-salience waiver covers it (inv 13)", () => {
    const waivers = JSON.parse(readFileSync(new URL("../kb/waivers.json", import.meta.url), "utf8"));
    const salienceWaived = new Set(waivers.filter((w) => w.ruleId === "focus-salience").map((w) => `${w.exerciseId}|${w.tag}`));
    for (const ex of kb.exercises) {
      let salient = false;
      for (let k = 0; k < 40 && !salient; k++) {
        const prog = ex.generator.generate(seedFor(ex.id, k));
        const tags = footprintSources(ex, prog).flatMap((src) => fp(ex, src).tags ?? []);
        if (tags.includes(ex.focus)) salient = true;
      }
      if (!salient) {
        expect(salienceWaived.has(`${ex.id}|${ex.focus}`), `${ex.id}: focus ${ex.focus} is never salient and carries no focus-salience waiver`).toBe(true);
      }
    }
  });

  test("K-inv17: waiver hygiene — every waiver fires; within budget; ruleId known; issue non-empty (inv 17)", () => {
    const waivers = JSON.parse(readFileSync(new URL("../kb/waivers.json", import.meta.url), "utf8"));
    const budget = Math.max(3, Math.ceil(0.05 * kb.exercises.length));
    expect(waivers.length, `waiver count within budget max(3, 5%) = ${budget}`).toBeLessThanOrEqual(budget);
    const KNOWN_RULES = new Set(["focus-salience"]);
    const exById = new Map(kb.exercises.map((e) => [e.id, e]));
    for (const w of waivers) {
      expect(KNOWN_RULES.has(w.ruleId), `waiver ruleId ${w.ruleId} is a known rule`).toBe(true);
      expect(typeof w.issue === "string" && w.issue.length > 0, `waiver ${w.exerciseId} has a non-empty issue`).toBe(true);
      const ex = exById.get(w.exerciseId);
      expect(ex, `waiver exercise ${w.exerciseId} exists`).toBeTruthy();
      if (w.ruleId === "focus-salience") {
        // Must FIRE: the waived tag is genuinely never emitted across samples
        // (a live waiver, never a dead one that rots).
        let everEmitted = false;
        for (let k = 0; k < 40 && !everEmitted; k++) {
          const prog = ex.generator.generate(seedFor(ex.id, k));
          const tags = footprintSources(ex, prog).flatMap((src) => fp(ex, src).tags ?? []);
          if (tags.includes(w.tag)) everEmitted = true;
        }
        expect(everEmitted, `focus-salience waiver ${w.exerciseId}/${w.tag} is DEAD — the tag is actually emitted`).toBe(false);
      }
    }
  });

  test("K-inv14: variety floors — ≥3 program-shapes per core concept; no consecutive (form, shape) in compiled sessions (inv 14)", async () => {
    // (a) Shape floor: every CORE concept accumulates ≥3 distinct shapes
    // across the exercises that focus it (edge concepts have no floor).
    const shapesByFocus = new Map();
    for (const ex of kb.exercises) {
      const s = shapesByFocus.get(ex.focus) ?? new Set();
      for (const sh of ex.generator.shapes) s.add(sh);
      shapesByFocus.set(ex.focus, s);
    }
    const thin = [...kb.concepts.values()]
      .filter((c) => c.kind === "core" && (shapesByFocus.get(c.tag)?.size ?? 0) < 3)
      .map((c) => `${c.tag} ${c.slug} (${shapesByFocus.get(c.tag)?.size ?? 0})`);
    expect(thin, "core concepts below the 3-shape floor").toEqual([]);

    // (b) Session adjacency: compiled practice rounds never put the same
    // (form, shape) twice in a row. Each compiled ask carries its form+shape
    // metadata; kb-session imports only kb/, so it loads in plain Node.
    const { buildKBSession } = await import("../app/kb-session.mjs");
    for (const topic of ["all", "state", "numbers", "lists", "loops"]) {
      for (const seed of [1, 7, 23, 42, 99]) {
        const lesson = buildKBSession(topic, { seed, count: 10 });
        const keys = lesson.steps.filter((s) => s.ask).map((s) => `${s.ask.form}|${s.ask.shape}`);
        expect(keys.length).toBe(10);
        for (const k of keys) expect(k, "every compiled ask carries form|shape metadata").not.toContain("undefined");
        for (let i = 1; i < keys.length; i++) {
          expect(keys[i] !== keys[i - 1], `${topic} seed ${seed}: consecutive (form, shape) repeat at question ${i + 1}: ${keys[i]}`).toBe(true);
        }
      }
    }
  });

  test("K-inv18: compiled sessions are mostly basics — core-focus fraction ≥ 0.6 (inv 18)", async () => {
    // The retired drill bank carried this check (T14); the KB inherits it:
    // across seeded "all" rounds, questions focused on CORE concepts must
    // dominate edge ones ≈3:1 by weight, so ≥60% core in practice.
    const { buildKBSession } = await import("../app/kb-session.mjs");
    let core = 0, total = 0;
    for (const seed of [3, 11, 27]) {
      const lesson = buildKBSession("all", { seed, count: 10 });
      for (const step of lesson.steps) {
        if (!step.ask) continue;
        total += 1;
        if (kb.concepts.get(step.ask.concept).kind === "core") core += 1;
      }
    }
    expect(total).toBe(30);
    expect(core / total, `core fraction ${core}/${total}`).toBeGreaterThanOrEqual(0.6);
  });

  test("K-runtime: trace-table authoring forms compile to progressive trace-simulation asks", async () => {
    const { buildKBSession } = await import("../app/kb-session.mjs");
    const allMet = [...kb.concepts.keys()].filter((t) => !kb.structural.has(t));
    const stats = Object.fromEntries(allMet.map((t) => [t, { seen: 3, missed: 1 }]));
    const seen = [];
    for (const topic of ["state", "logic", "loops", "lists", "strings", "structures", "functions"]) {
      for (let seed = 1; seed <= 60; seed++) {
        const lesson = buildKBSession(topic, { seed, count: 10, met: allMet, stats });
        seen.push(...lesson.steps.filter((s) => s.ask?.form === "trace-table").map((s) => s.ask));
        if (seen.some((ask) => ask.form === "trace-table")) break;
      }
    }
    expect(seen.length, "at least one authored trace-table form should be dealt").toBeGreaterThan(0);
    for (const ask of seen) {
      expect(ask.kind, `${ask.template} should use the progressive runtime`).toBe("trace-simulation");
      expect(ask.probeNames?.length, `${ask.template} keeps its authored watched names`).toBeGreaterThan(0);
    }
  });

  test("K-chal: challenges and hard siblings are availability-FILTERED, never dealt cold, dealt when earned (R1)", async () => {
    const { buildKBSession } = await import("../app/kb-session.mjs");
    const challengeIds = new Set(kb.exercises.filter((e) => e.role === "challenge").map((e) => e.id));
    const hardIds = new Set(kb.exercises.filter((e) => e.difficulty === "hard").map((e) => e.id));
    expect(challengeIds.size).toBe(8);
    expect(hardIds.size).toBe(5);

    // (a) Empty-met compiles NEVER deal challenges or hard siblings — the
    // fixture-stability proof: the filtered pool is the pre-R1 pool.
    for (const topic of ["all", "lists", "loops", "numbers", "strings", "structures"]) {
      for (const seed of [1, 2, 7, 23, 41, 42]) {
        const l = buildKBSession(topic, { seed, count: 8 });
        for (const s of l.steps) {
          if (!s.ask) continue;
          expect(challengeIds.has(s.ask.template), `${topic}/${seed}: challenge ${s.ask.template} dealt with empty met`).toBe(false);
          expect(hardIds.has(s.ask.template), `${topic}/${seed}: hard sibling ${s.ask.template} dealt with empty met`).toBe(false);
        }
      }
    }

    // (b) Met-saturated compiles deal challenges, with the selection floors
    // intact (no consecutive form|shape, no consecutive concept repeat).
    const allMet = [...kb.concepts.keys()].filter((t) => !kb.structural.has(t));
    const stats = Object.fromEntries(allMet.map((t) => [t, { seen: 5, missed: 1 }]));
    let challengesDealt = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const l = buildKBSession("all", { seed, count: 10, met: allMet, stats });
      const asks = l.steps.filter((s) => s.ask).map((s) => s.ask);
      for (let i = 1; i < asks.length; i++) {
        expect(`${asks[i].form}|${asks[i].shape}` !== `${asks[i - 1].form}|${asks[i - 1].shape}`, `seed ${seed}: fs repeat at ${i}`).toBe(true);
      }
      challengesDealt += asks.filter((a) => challengeIds.has(a.template)).length;
    }
    expect(challengesDealt, "met-saturated rounds must actually deal challenges").toBeGreaterThan(0);

    // Challenges never grant met: a challenge is only ever offerable/dealt
    // when its focus is ALREADY met (the filter above), so the tutor's
    // idempotent grantMet("first grant wins") is structurally a no-op on
    // every challenge resolution — assert the gate that guarantees it.
    for (const ex of kb.exercises.filter((e) => e.role === "challenge")) {
      const missingFocus = new Set(allMet.filter((t) => t !== ex.focus));
      expect(kb.offerable(missingFocus).some((e) => e.id === ex.id),
        `${ex.id} offerable without its focus met`).toBe(false);
    }

    // (c) offerable: removing ONE braid tag from met removes exactly that
    // braid's challenges — nothing else changes.
    const metSet = new Set(allMet);
    const before = kb.offerable(metSet).map((e) => e.id);
    metSet.delete("001K"); // braid of chal-alias-in-loop + chal-sum-of-built-list
    const after = new Set(kb.offerable(metSet).map((e) => e.id));
    const removed = before.filter((id) => !after.has(id));
    // Every removed exercise either focuses 001K, assumes it, or (challenge)
    // braids it; the two 001K-braided challenges are among them.
    expect(removed).toContain("chal-alias-in-loop");
    expect(removed).toContain("chal-sum-of-built-list");
    for (const id of removed) {
      const ex = kb.exercises.find((e) => e.id === id);
      expect(ex.focus === "001K" || ex.assumed.includes("001K"), `${id} removed without referencing 001K`).toBe(true);
    }
  });

  test("K-mc: designed misconceptions are rng-free-derived, single-line (per the multiline law), and typed as strings (R1.1)", () => {
    let carrying = 0;
    for (const ex of kb.exercises) {
      for (let k = 0; k < 40; k++) {
        const prog = ex.generator.generate(seedFor(ex.id, k));
        if (prog.misconception === undefined) continue;
        carrying += 1;
        expect(typeof prog.misconception, `${ex.id} seed ${k}: misconception is a string`).toBe("string");
        expect(prog.misconception.length > 0, `${ex.id} seed ${k}: misconception non-empty`).toBe(true);
        if (!ex.multiline) {
          expect(prog.misconception.includes("\n"), `${ex.id} seed ${k}: misconception single-line`).toBe(false);
        }
        // spot-the-difference's designed wrong is A's shown output when a
        // generator emits one explicitly (the compiler stamps aOutput
        // otherwise) — either way it must never equal program B's target
        // (enforced against real execution in K-10).
        if (ex.form === "spot-the-difference" && prog.misconception !== undefined) {
          expect(prog.misconception, `${ex.id} seed ${k}: spot-diff misconception is aOutput`).toBe(prog.aOutput);
        }
      }
    }
    expect(carrying, "a meaningful share of generated programs carry a designed misconception").toBeGreaterThan(100);
  });

  test("K-doc: curriculum/KB-REFERENCE.md is byte-identical to a fresh regeneration with real outputs (inv 15)", async ({ page }) => {
    test.setTimeout(HEAVY_TIMEOUT);
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));

    // Every recorded sample's output is obtained by REAL execution (Pyodide);
    // KB_UPDATE_FIXTURES=1 is the ONLY writer of the committed reference.
    const specs = docSamples(kb);
    const stdinByKey = Object.fromEntries(specs.filter((sp) => sp.stdin).map((sp) => [sp.key, sp.stdin]));
    const results = await page.evaluate(async ({ samples, samplesStdin }) => {
      const out = {};
      for (const { key, run, expectError } of samples) {
        window.plp.editor.setValue(run);
        if (expectError) {
          // A raising sample (expansion ladder §R3) is recorded as
          // "Type (line N)" — derived from the TRACED run's records, since an
          // untraced run produces none. Message text is deliberately never
          // recorded: its wording drifts between CPython builds, which would
          // break byte-identity with the system-python3 writer.
          const summary = await window.plp.trace();
          const recs = window.plp.records();
          const terminal = recs.at(-1);
          const step = [...recs].reverse().find((r) => r.kind === "step" && r.event === "exception" && r.location);
          out[key] = {
            output: `${terminal?.exception?.type_name} (line ${step?.location?.line})`,
            reason: summary?.terminal_reason === "uncaught_exception" ? "completed" : summary?.terminal_reason,
          };
          continue;
        }
        if (samplesStdin[key]) {
          // predict-io (§R4a): scripted stdin, and the ECHO-EXCLUDING
          // transcript — engineText() is exactly what the engine wrote, which
          // is byte-for-byte what CPython with piped stdin prints (the
          // system-python3 writer in tools/kb-docgen.mjs).
          const res = await window.plp.traceWithStdin(samplesStdin[key]);
          out[key] = { output: window.plp.console.engineText(), reason: res?.summary?.terminal_reason };
          continue;
        }
        const summary = await window.plp.run(); // untraced: output flushes on completion
        out[key] = { output: window.plp.console.text(), reason: summary?.terminal_reason };
      }
      return out;
    }, { samples: specs, samplesStdin: stdinByKey });

    const outputs = {};
    for (const { key, run } of specs) {
      expect(results[key]?.reason, `sample ${key} must run clean (or raise, for the §R3 forms):\n${run}`).toBe("completed");
      outputs[key] = results[key].output;
    }

    const waivers = JSON.parse(readFileSync(new URL("../kb/waivers.json", import.meta.url), "utf8"));
    const md = renderReference(kb, outputs, waivers);
    const refUrl = new URL("../curriculum/KB-REFERENCE.md", import.meta.url);

    if (process.env.KB_UPDATE_FIXTURES) {
      writeFileSync(refUrl, md);
      return;
    }
    let committed = "";
    try { committed = readFileSync(refUrl, "utf8"); } catch { /* missing → fail below */ }
    // Byte-identical: a KB change without a doc rebuild fails, a hand edit
    // fails, and a stale output fails because outputs are re-executed here.
    expect(md, "KB-REFERENCE.md drifted — regenerate with KB_UPDATE_FIXTURES=1").toBe(committed);
  });
});
