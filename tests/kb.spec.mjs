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
import { parse } from "../kb/analyzer/parse.mjs";
import { docSamples, renderReference } from "../kb/docgen.mjs";
import { mulberry32, fnv1a32 } from "../kb/rng.mjs";

const SITE = "/PLP/";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const kb = loadKB();

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
const hasCompound = (source) => parse(source).some((s) => ["if", "for", "while"].includes(s.kind));

// The subset program(s) whose footprints a generated sample must keep inside
// the closure. Most forms have one; spot-the-difference has two (both A and
// B differ by one line and must each stay in the closure — design §5.2/§2.8);
// predict-state's displayed program does not print the probed name, so its
// concept becomes observable only through a read of that name, added here (a
// plain print the analyzer understands).
function footprintSources(ex, prog) {
  if (ex.form === "predict-state" && prog.probeName) return [`${prog.code}print(${prog.probeName})\n`];
  if (ex.form === "spot-the-difference") return [prog.code, prog.contrastCode];
  // trace-table probes every watched name (they survive to program end —
  // Python loop variables outlive the loop), so the probed reads are visible
  // to the analyzer exactly like predict-state's.
  if (ex.form === "trace-table") return [`${prog.code}${prog.probeNames.map((n) => `print(${n})`).join("\n")}\n`];
  return [prog.code];
}

// A single Pyodide program per sample that emits, in order: the Python-`ast`
// normal form (inv 8), the program's real output (inv 11), and the runtime
// type of each still-bound name in the analyzer's declared order (inv 9).
function buildOracleProbe(source, names) {
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
${source}print('@TYP@')
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

  test("K-4: static exercise contract — assumed ⊆ ancestors(focus), focus ∉ assumed, contrast ∈ assumed (inv 5)", () => {
    for (const ex of kb.exercises) {
      const anc = kb.ancestors(ex.focus);
      const outside = ex.assumed.filter((t) => !anc.has(t));
      expect(outside, `${ex.id}: assumed tags outside ancestors(${ex.focus})`).toEqual([]);
      expect(ex.assumed.includes(ex.focus), `${ex.id}: focus in assumed`).toBe(false);
      expect(["intro", "review"]).toContain(ex.role);
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
          const r = kb.footprint(src);
          expect(r.error, `${ex.id} seed ${k}: analyzer error ${JSON.stringify(r.error)} on:\n${src}`).toBeUndefined();
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
  });

  test("K-rng: kb mulberry32 matches the pinned stream (drift guard, Node side)", () => {
    const r = mulberry32(42);
    for (const want of RNG_PARITY) expect(r()).toBeCloseTo(want, 15);
  });

  test("K-10: every exercise generates clean, gradable, one-line programs under real execution (inv 10)", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));

    // The app's mulberry32 must produce the same stream as kb/rng.mjs.
    const browserStream = await page.evaluate(() => {
      const r = window.plp.questions.mulberry32(42);
      return [r(), r(), r(), r(), r()];
    });
    browserStream.forEach((v, i) => expect(v).toBeCloseTo(RNG_PARITY[i], 15));

    for (const ex of kb.exercises) {
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
          return [
            { code: prog.code, form: "predict-output", name: null, target: prog.aOutput },
            { code: prog.contrastCode, form: "predict-output", name: null, target: null },
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
        }];
      });

      const results = await page.evaluate(async (progs) => {
        const out = [];
        for (const { code, form, name, names, maxBlanks, target } of progs) {
          window.plp.editor.setValue(code);
          const summary = await window.plp.trace();
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
            const blanked = new Set((q?.blanks ?? []).map((b) => b.label.split(" · ").pop()));
            out.push({
              reason: summary?.terminal_reason,
              gradable: Boolean(q),
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
            oneLine: form === "predict-state" ? !(expected ?? "").includes("\n") : (expected !== null && !expected.includes("\n")),
            matchesTarget: target != null ? (expected === String(target).replace(/\n+$/, "")) : true,
            errors: window.plp.checkErrors(),
          });
        }
        return out;
      }, programs);

      results.forEach((r, i) => {
        expect(r.reason, `${ex.id} program ${i} must run clean`).toBe("completed");
        expect(r.gradable, `${ex.id} program ${i} must print something gradable`).toBe(true);
        // One printed line, unless the exercise is the flagged multi-line
        // exception (design §5.2 — loop-for-visits-each, where several lines
        // ARE the concept).
        if (!ex.multiline) expect(r.oneLine, `${ex.id} program ${i} must ask one thing (one output line)`).toBe(true);
        if (r.tight !== undefined) {
          expect(r.tight, `${ex.id} program ${i}: trace-table must yield 2..maxBlanks blanks`).toBe(true);
          expect(r.allNamesBlanked, `${ex.id} program ${i}: every watched name must be blanked at least once`).toBe(true);
        }
        // The interpreter is the fill target's ground truth.
        expect(r.matchesTarget, `${ex.id} program ${i}: real output must equal the fill target`).toBe(true);
        expect(r.errors).toEqual([]);
      });
    }
  });

  test("K-oracles: parser fidelity (inv 8), type fidelity (inv 9), discrimination (inv 11)", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));

    // Build one probe per stratified sample in Node, alongside the expected
    // JS-side normal form, the analyzer's end-state types, and the focus
    // concept's authored wrong answer.
    const items = [];
    for (const ex of kb.exercises) {
      for (const k of stratifiedSeeds(ex)) {
        const source = ex.generator.generate(seedFor(ex.id, k)).code;
        const fp = kb.footprint(source);
        expect(fp.error, `${ex.id} seed ${k}: analyzer error ${JSON.stringify(fp.error)}`).toBeUndefined();
        const names = Object.keys(fp.finalTypes);
        items.push({
          id: ex.id, seed: k, source,
          jsAst: jsAst(source),
          compound: hasCompound(source),
          names,
          types: names.map((n) => fp.finalTypes[n]),
          wrongAnswer: kb.concepts.get(ex.focus).wrongAnswer,
          probe: buildOracleProbe(source, names),
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
      // teaches nothing).
      expect(it.wrongAnswer.trim(), `${it.id} seed ${it.seed}: wrongAnswer must differ from real output`)
        .not.toBe(realOut.trim());

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
        const tags = footprintSources(ex, prog).flatMap((src) => kb.footprint(src).tags);
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
          const tags = footprintSources(ex, prog).flatMap((src) => kb.footprint(src).tags);
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

  test("K-doc: curriculum/KB-REFERENCE.md is byte-identical to a fresh regeneration with real outputs (inv 15)", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(SITE);
    await page.waitForFunction(() => crossOriginIsolated === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.plp?.tutor));

    // Every recorded sample's output is obtained by REAL execution (Pyodide);
    // KB_UPDATE_FIXTURES=1 is the ONLY writer of the committed reference.
    const specs = docSamples(kb);
    const results = await page.evaluate(async (samples) => {
      const out = {};
      for (const { key, run } of samples) {
        window.plp.editor.setValue(run);
        const summary = await window.plp.run(); // untraced: output flushes on completion
        out[key] = { output: window.plp.console.text(), reason: summary?.terminal_reason };
      }
      return out;
    }, specs);

    const outputs = {};
    for (const { key, run } of specs) {
      expect(results[key]?.reason, `sample ${key} must run clean:\n${run}`).toBe("completed");
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
