// Generated-documentation pipeline (design §8). PURE: imports only kb/ and
// builds the human-readable curriculum reference as a deterministic string
// from the KB plus a map of REAL sample outputs. It never executes Python
// itself — the outputs are obtained by a real interpreter (the K-doc
// fidelity test in Pyodide, or tools/kb-docgen.mjs via system python3) and
// passed in. Determinism (sorted order, no clock, no RNG beyond the
// recorded seeds) is what makes the byte-identical drift check meaningful.

import { fnv1a32 } from "./rng.mjs";

// The recorded provenance seed for an exercise's reference sample: k = 0.
export const DOC_SEED_K = 0;
const seedFor = (id, k) => (fnv1a32(id) ^ k) >>> 0;

const TOPICS = [
  ["state", "State & I/O"],
  ["numbers", "Numbers & bools"],
  ["strings", "Strings"],
  ["lists", "Lists & aliasing"],
  ["logic", "Conditions & logic"],
  ["loops", "Loops & ranges"],
  ["structures", "Dicts & tuples"],
];

const byTag = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The concrete programs whose real output the reference needs. Each carries a
// stable key `${exerciseId}|${label}`; the caller executes `run` (the code to
// run) and records its printed output under that key. `run` may differ from
// the displayed `code` (predict-state appends a read of the probed name).
export function docSamples(kb) {
  const specs = [];
  for (const ex of [...kb.exercises].sort((a, b) => byTag(a.id, b.id))) {
    const prog = ex.generator.generate(seedFor(ex.id, DOC_SEED_K));
    if (ex.form === "spot-the-difference") {
      specs.push({ key: `${ex.id}|A`, run: prog.code });
      specs.push({ key: `${ex.id}|B`, run: prog.contrastCode });
    } else if (ex.form === "predict-state") {
      specs.push({ key: `${ex.id}|state`, run: `${prog.code}print(${prog.probeName})\n` });
    } else if (ex.form === "trace-table") {
      // The blanks derive from the live trace at runtime; the reference can
      // only show the watched names' END values (docgen is stdout-only).
      specs.push({ key: `${ex.id}|names`, run: `${prog.code}${prog.probeNames.map((n) => `print(${n})`).join("\n")}\n` });
    } else if (ex.form === "predict-the-error") {
      // The program RAISES on purpose (expansion ladder §R3). `expectError`
      // tells the executor to record the crash as "Type (line N)" rather than
      // to fail: CPython's message WORDING drifts between the system python3
      // and Pyodide, so the reference never records message text — only the
      // type and the line, which both writers agree on.
      specs.push({ key: `${ex.id}|raise`, run: prog.code, expectError: true });
    } else if (ex.form === "order-the-lines") {
      // The deal is shuffled at compile time; the reference records the
      // CANONICAL order (the exercise's ground truth) and what it prints.
      specs.push({ key: `${ex.id}|out`, run: `${prog.lines.join("\n")}\n` });
    } else {
      specs.push({ key: `${ex.id}|out`, run: prog.code });
    }
  }
  return specs;
}

function lineage(kb, tag) {
  return [...kb.ancestors(tag)].sort(byTag);
}

function childrenOf(kb, tag) {
  return [...kb.concepts.values()].filter((c) => c.parents.includes(tag)).map((c) => c.tag).sort(byTag);
}

function fence(code) {
  return "```py\n" + code.replace(/\n$/, "") + "\n```";
}

function outBlock(output) {
  return output === "" ? "_(no output)_" : "```\n" + output.replace(/\n$/, "") + "\n```";
}

// Build the full markdown reference. `outputs` maps sample keys → real output;
// `waivers` is the parsed kb/waivers.json (loadKB does not carry it).
export function renderReference(kb, outputs, waivers = []) {
  const get = (key) => {
    if (!(key in outputs)) throw new Error(`docgen: missing sample output for ${key}`);
    return outputs[key];
  };
  const concepts = [...kb.concepts.values()];
  const counts = { structural: 0, core: 0, edge: 0 };
  for (const c of concepts) counts[c.kind]++;
  const exercises = [...kb.exercises].sort((a, b) => byTag(a.id, b.id));
  const topicOf = new Map();
  for (const ex of kb.exercises) if (!topicOf.has(ex.focus)) topicOf.set(ex.focus, ex.topic);

  const L = [];
  L.push("# PLP knowledge base — generated reference");
  L.push("");
  L.push("> Generated from `kb/` — DO NOT EDIT. Regenerate with");
  L.push("> `node tools/kb-docgen.mjs --write` (or the `K-doc` fidelity test with");
  L.push("> `KB_UPDATE_FIXTURES=1`). Every sample output below is obtained by");
  L.push("> real execution; the committed file must be byte-identical to a fresh");
  L.push("> regeneration (design §8, invariant 15).");
  L.push("");
  L.push("## Overview");
  L.push("");
  L.push(`- **${concepts.length} concepts** — ${counts.structural} structural / ${counts.core} core / ${counts.edge} edge.`);
  L.push(`- **${exercises.length} exercises** across ${TOPICS.length} topics.`);
  L.push(`- **Forms:** ${[...new Set(exercises.map((e) => e.form))].sort().join(", ")}.`);
  L.push("");

  // Topic → concepts table.
  L.push("## Topics");
  L.push("");
  const conceptTopic = new Map();
  for (const [tid] of TOPICS) {
    for (const ex of kb.exercises) if (ex.topic === tid && !conceptTopic.has(ex.focus)) conceptTopic.set(ex.focus, tid);
  }
  for (const [tid, title] of TOPICS) {
    const tags = concepts.filter((c) => conceptTopic.get(c.tag) === tid).map((c) => c.tag).sort(byTag);
    L.push(`- **${title}** (\`${tid}\`): ${tags.length ? tags.join(", ") : "—"}`);
  }
  const structuralTags = concepts.filter((c) => c.kind === "structural").map((c) => c.tag).sort(byTag);
  L.push(`- **Structural roots**: ${structuralTags.join(", ")}`);
  L.push("");

  // The full concept DAG (design §8 "the topic DAG rendering"), grouped by
  // topic, edges parent → child, deterministic ordering throughout.
  L.push("## Concept graph");
  L.push("");
  L.push("Edges point parent → child (prerequisite → dependent). Solid boxes");
  L.push("are core, rounded are edge, hexagons are the structural roots.");
  L.push("");
  L.push("```mermaid");
  L.push("graph TD");
  const nodeLine = (c) => {
    const label = `${c.tag} ${c.slug}`;
    if (c.kind === "structural") return `  ${c.tag}{{"${label}"}}`;
    if (c.kind === "edge") return `  ${c.tag}("${label}")`;
    return `  ${c.tag}["${label}"]`;
  };
  L.push("  subgraph roots [Structural roots]");
  for (const t of structuralTags) L.push("  " + nodeLine(kb.concepts.get(t)).trim());
  L.push("  end");
  for (const [tid, title] of TOPICS) {
    const tags = concepts.filter((c) => conceptTopic.get(c.tag) === tid).map((c) => c.tag).sort(byTag);
    if (!tags.length) continue;
    L.push(`  subgraph ${tid} [${title}]`);
    for (const t of tags) L.push("  " + nodeLine(kb.concepts.get(t)).trim());
    L.push("  end");
  }
  for (const c of [...concepts].sort((a, b) => byTag(a.tag, b.tag))) {
    for (const p of [...c.parents].sort(byTag)) L.push(`  ${p} --> ${c.tag}`);
  }
  L.push("```");
  L.push("");

  // Per-concept sections, in tag order.
  L.push("## Concepts");
  L.push("");
  for (const c of [...concepts].sort((a, b) => byTag(a.tag, b.tag))) {
    L.push(`### ${c.tag} · ${c.slug} — ${c.kind}`);
    L.push("");
    L.push(c.statement);
    L.push("");
    L.push(`- Parents: ${c.parents.length ? c.parents.join(", ") : "— (root)"}`);
    const kids = childrenOf(kb, c.tag);
    L.push(`- Children: ${kids.length ? kids.join(", ") : "—"}`);
    if (c.kind !== "structural") {
      L.push(`- Lineage: ${lineage(kb, c.tag).join(" ← ") || "—"}`);
      L.push(`- Characteristic wrong answer: ${c.wrongAnswer}`);
    }
    const exIds = exercises.filter((e) => e.focus === c.tag).map((e) => e.id);
    L.push(`- Exercises: ${exIds.length ? exIds.join(", ") : "— (none yet)"}`);
    L.push("");
  }

  // Per-exercise sections, in id order, with a real sample.
  L.push("## Exercises");
  L.push("");
  for (const ex of exercises) {
    const focus = kb.concepts.get(ex.focus);
    L.push(`### ${ex.id} — focus ${ex.focus} (${focus.slug})`);
    L.push("");
    L.push(`- Form: \`${ex.form}\` · Role: ${ex.role} · Topic: ${ex.topic}`);
    L.push(`- Assumed: ${ex.assumed.length ? ex.assumed.join(", ") : "— (structural only)"}`);
    if (ex.contrast) L.push(`- Contrast: ${ex.contrast}`);
    L.push(`- Shapes: ${ex.generator.shapes.join(", ")} · Variants: ${ex.generator.variants.join(", ")}`);
    L.push(`- Sample (provenance: seed k=${DOC_SEED_K}):`);
    L.push("");
    const prog = ex.generator.generate(seedFor(ex.id, DOC_SEED_K));
    if (ex.form === "spot-the-difference") {
      L.push("Program A (shown with its output):");
      L.push(fence(prog.code));
      L.push("prints:");
      L.push(outBlock(get(`${ex.id}|A`)));
      L.push("");
      L.push("Program B (predicted):");
      L.push(fence(prog.contrastCode));
      L.push("prints:");
      L.push(outBlock(get(`${ex.id}|B`)));
    } else if (ex.form === "predict-state") {
      L.push(fence(prog.code));
      L.push(`After it runs, \`${prog.probeName}\` holds:`);
      L.push(outBlock(get(`${ex.id}|state`)));
    } else if (ex.form === "trace-table") {
      L.push(fence(prog.code));
      L.push(`Step-table walkthrough over \`${prog.probeNames.join("`, `")}\` (blanks derive from the live trace); the watched names end holding:`);
      L.push(outBlock(get(`${ex.id}|names`)));
    } else if (ex.form === "predict-the-error") {
      L.push(fence(prog.code));
      L.push(`stops with: \`${get(`${ex.id}|raise`).trim()}\``);
    } else if (ex.form === "order-the-lines") {
      L.push("Lines (canonical order):");
      L.push(fence(prog.lines.join("\n")));
      L.push("prints:");
      L.push(outBlock(get(`${ex.id}|out`)));
    } else if (ex.form === "fill-one-blank") {
      L.push(`Filled with the intended token \`${prog.blank.target}\`:`);
      L.push(fence(prog.code));
      L.push("prints the target:");
      L.push(outBlock(get(`${ex.id}|out`)));
    } else {
      L.push(fence(prog.code));
      L.push("prints:");
      L.push(outBlock(get(`${ex.id}|out`)));
    }
    L.push("");
  }

  // Waivers.
  L.push("## Waivers");
  L.push("");
  if (!waivers.length) L.push("_(none)_");
  else for (const w of waivers) L.push(`- \`${w.exerciseId}\` — ${w.ruleId} on ${w.tag}: ${w.reason} (issue: ${w.issue})`);
  L.push("");

  return L.join("\n");
}
