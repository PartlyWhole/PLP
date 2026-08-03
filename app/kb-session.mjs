// Drill/practice sessions sourced from the concept-DAG knowledge base
// (kb/). PURE module: it imports only kb/ (never DOM, never other app/
// state) and takes the learner's mastery records as an argument, so it
// stays a testable policy over loadKB()'s narrow interface.
//
// It emits the tutor's existing lesson-step vocabulary (app/TUTOR.md) — the
// same compiled-round shape app/drills.mjs produced — so the runtime is
// unchanged; only the exercise SOURCE moves to the KB. Stats are keyed by
// concept TAG (not drill-template id): a tag is permanent, so mastery
// records survive slug renames and exercise rewrites.
//
// Selection (design §6): a session draws from the topic's exercise pool
// (or all exercises for "everything") weighted by
//   level (core 3 : edge 1)  ×  novelty (×1.5 if the concept is unseen)
//   ×  miss-rate (×(1 + 2·missed/seen), up to ~3×),
// avoiding consecutive repeats of the same (exercise, shape). The topic
// picker is a practice affordance, so it is not hard-gated on the frontier;
// the mastery-gated frontier/offerable machinery stays available on
// loadKB() for a future adaptive mode. (The persisted record shape is
// {seen, missed}; the full review staircase — a per-concept consecutive-
// correct streak — is approximated here by novelty + miss-rate, because the
// streak field would change that record shape.)

import { loadKB } from "../kb/index.mjs";
import { mulberry32 } from "../kb/rng.mjs";

const kb = loadKB();

// The learner-facing topics — same ids and titles as the drill menu, so the
// tutor's 8-button menu ("Everything" + 7 topics) is unchanged.
export const kbTopics = [
  { id: "state", title: "State & I/O" },
  { id: "numbers", title: "Numbers & bools" },
  { id: "strings", title: "Strings" },
  { id: "lists", title: "Lists & aliasing" },
  { id: "logic", title: "Conditions & logic" },
  { id: "loops", title: "Loops & ranges" },
  { id: "structures", title: "Dicts & tuples" },
];

const TITLE_BY_TOPIC = new Map(kbTopics.map((t) => [t.id, t.title]));

function poolFor(topic) {
  return topic === "all" ? kb.exercises : kb.exercises.filter((ex) => ex.topic === topic);
}

// Replace a fill-one-blank hole (blank = {line, col, len}) with `replacement`
// — used to render the displayed `___` and to build the filled program the
// grader executes.
export function spliceBlank(code, blank, replacement) {
  const lines = code.split("\n");
  const li = blank.line - 1;
  const line = lines[li] ?? "";
  lines[li] = line.slice(0, blank.col) + replacement + line.slice(blank.col + blank.len);
  return lines.join("\n");
}

// Weight of an exercise given the learner's tag-keyed stats (design §6.3).
function weightOf(stats, ex) {
  const level = kb.concepts.get(ex.focus)?.kind === "core" ? 3 : 1;
  const s = stats?.[ex.focus];
  const novelty = !s || !s.seen ? 1.5 : 1;
  const missRate = s?.seen ? 1 + 2 * (s.missed / s.seen) : 1;
  return level * novelty * missRate;
}

// Compile a practice round into an ordinary lesson script. Deterministic
// under (topic, seed, count, stats) — a persisted session rebuilds exactly.
export function buildKBSession(topic, { count = 8, seed = 1, stats = {} } = {}) {
  const pool = poolFor(topic);
  if (!pool.length) return null;
  const rng = mulberry32(seed >>> 0);
  const topicTitle = topic === "all" ? "everything" : (TITLE_BY_TOPIC.get(topic) ?? topic);

  const steps = [{
    say: `**${topicTitle} — let's go!** ${count} tiny programs, one question `
      + "each. Read the code, type exactly what it prints, and press Enter "
      + "to see the real answer. Every character counts — spaces too. "
      + "If one tricks you, you'll see why, and it will come back later "
      + "so you can beat it.",
  }];

  let prevKey = null;
  for (let i = 0; i < count; i++) {
    // Weighted, seeded exercise choice; no consecutive (form, shape) repeat
    // (design §5.3 / inv 14), so consecutive questions feel different.
    let chosen = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      const ex = weightedPick(rng, pool, stats);
      const prog = ex.generator.generate(Math.floor(rng() * 0x100000000));
      const key = `${ex.form}|${prog.shape}`;
      chosen = { ex, prog, key };
      if (key !== prevKey || pool.length === 1) break;
    }
    prevKey = chosen.key;
    const { ex, prog } = chosen;
    const concept = kb.concepts.get(ex.focus);
    const n = `(${i + 1}/${count})`;

    // No concept title before the attempt: naming the rule spoils the
    // question and leads with jargon. The rule arrives in the explain.
    let ask;
    if (ex.form === "spot-the-difference") {
      // Show program A WITH its real output, then predict program B — which
      // differs by exactly one line (design §5.2).
      steps.push({ say: `**Spot the difference.** This program:\n\n\`\`\`py\n${prog.code}\`\`\`\n\nprints \`${prog.aOutput}\`. The next one changes just one line — predict what IT prints.` });
      steps.push({ loadCode: prog.contrastCode });
      ask = {
        kind: "predict-output",
        form: ex.form, shape: prog.shape,
        concept: ex.focus, template: ex.id, singleLine: true,
        prompt: `${n} Predict what this program prints. Type the one line.`,
      };
    } else if (ex.form === "fill-one-blank") {
      // The learner sees the program with a hole; grading substitutes the
      // typed token and runs it (design §5.2). loadCode shows the hole.
      steps.push({ loadCode: spliceBlank(prog.code, prog.blank, "___") });
      ask = {
        kind: "fill-one-blank",
        form: ex.form, shape: prog.shape,
        concept: ex.focus, template: ex.id, singleLine: true,
        code: prog.code, blank: prog.blank, targetOutput: prog.targetOutput,
        prompt: `${n} Fill in the blank (___) so this program prints \`${prog.targetOutput}\`.`,
      };
    } else if (ex.form === "predict-state") {
      steps.push({ loadCode: prog.code });
      ask = {
        kind: "predict-state",
        form: ex.form, shape: prog.shape,
        concept: ex.focus, template: ex.id, singleLine: true,
        opts: { name: prog.probeName },
        prompt: `${n} After this program runs, what does \`${prog.probeName}\` hold? Type the value.`,
      };
    } else {
      steps.push({ loadCode: prog.code });
      ask = {
        kind: "predict-output",
        form: ex.form, shape: prog.shape,
        concept: ex.focus,       // tag — weights future selection, keyed in plp.kb.v1
        template: ex.id,         // exercise id — kept for events/review context
        singleLine: !ex.multiline,
        prompt: `${n} What will this program print?` + (ex.multiline ? "" : " Type the one line."),
      };
    }
    steps.push({ ask });
    // After a miss: the program's variant card if it has one (the specific
    // values just asked), else the concept's canonical rule card.
    const explain = prog.variantCard ?? concept.card;
    steps.push({ if: { lastAnswer: ["wrong", "skipped"] }, say: explain, pause: true });
  }

  steps.push({
    done: `Round complete — nice work! Start another **${topicTitle}** round `
      + "for brand-new questions. The ones that tricked you will show up "
      + "again, so you can beat them.",
  });
  return { id: `drill-${topic}-${seed >>> 0}`, unit: 0, title: `Practice · ${topicTitle}`, steps };
}

// ---- lesson↔KB binding helpers (design/lesson-kb-binding.md) --------------

// Load-time lint for a lesson's concept binding (§2 of the binding spec):
// unit-level `concepts` tags must exist and be non-structural; every
// ask-step `focus` must exist, be non-structural, and be listed in the
// unit's `concepts` set (the unit set is the superset of its focuses).
export function lintLessonConcepts(lesson) {
  const errors = [];
  const declared = new Set(lesson.concepts ?? []);
  for (const t of lesson.concepts ?? []) {
    if (!kb.concepts.has(t)) errors.push(`concepts: unknown tag ${t}`);
    else if (kb.structural.has(t)) errors.push(`concepts: structural tag ${t} is never a teaching target`);
  }
  (lesson.steps ?? []).forEach((step, i) => {
    const f = step.ask?.focus;
    if (f === undefined) return;
    if (!kb.concepts.has(f)) errors.push(`step ${i}: ask.focus ${f} is not a KB tag`);
    else if (kb.structural.has(f)) errors.push(`step ${i}: ask.focus ${f} is structural (vacuously met, never a focus)`);
    else if (!declared.has(f)) errors.push(`step ${i}: ask.focus ${f} missing from the unit's concepts list`);
  });
  return errors;
}

// The frontier for a met set (unmet concepts whose parents are all met) —
// the KB stays storage-free; callers pass the met tags in (§5).
export function frontierTags(met) {
  return [...kb.frontier(new Set(met))].sort();
}

// The practice topic with the most intro exercises focused on the given
// frontier tags — where "drill what you just learned" should point.
export function drillTopicFor(tags) {
  const counts = new Map();
  for (const ex of kb.exercises) {
    if (ex.role !== "intro" || !tags.includes(ex.focus)) continue;
    counts.set(ex.topic, (counts.get(ex.topic) ?? 0) + 1);
  }
  let best = null, n = 0;
  for (const [t, c] of counts) if (c > n) { best = t; n = c; }
  return best ?? "all";
}

function weightedPick(rng, pool, stats) {
  const weights = pool.map((ex) => weightOf(stats, ex));
  const total = weights.reduce((a, w) => a + w, 0);
  let roll = rng() * total;
  for (let j = 0; j < pool.length; j++) {
    roll -= weights[j];
    if (roll <= 0) return pool[j];
  }
  return pool[pool.length - 1];
}

// One-time migration from the drill-template stats store (plp.drills.v1,
// keyed by template id) to the tag-keyed store (plp.kb.v1). Each old template
// maps to its closest concept; seen/missed accumulate onto that tag.
export const TEMPLATE_TO_CONCEPT = {
  // state
  "assign-read": "0006", "expr-eval": "0009", "quoted-vs-name": "0007",
  "state-rebind": "000C", "state-accumulate": "000B", "print-output": "000J",
  "state-swap": "000M", "print-quirks": "0005",
  // numbers
  "arith-basics": "000N", "division-types": "000P", "conversions": "000V",
  "int-div-mod": "000S", "float-precision": "000W", "bool-is-int": "000X",
  // strings
  "str-basics": "000Y", "str-index": "000E", "str-compare": "0014",
  "str-slice": "0011", "str-rebind": "0013",
  // lists
  "list-basics": "001Z", "list-mutate": "000G", "grid-basics": "0022",
  "alias-mutate": "000H", "grid-2d": "0024", "append-extend": "0020",
  "remove-while-iterating": "001E",
  // logic
  "compare-basics": "0015", "if-else": "0018", "elif-chain": "0019",
  "bool-ops": "001A", "truthiness": "001B", "and-or-values": "001C",
  "chained-compare": "001D",
  // loops
  "loop-accumulate": "001J", "loop-build": "001K", "while-basic": "001M",
  "range-basics": "001F", "range-edge": "001H", "break-continue": "001N",
  "for-else": "001Q",
  // structures
  "dict-read": "001R", "tuple-read": "001W", "dict-edge": "001V",
  "tuple-comma": "001Y",
};

export function migrateStats(drillStats) {
  const out = {};
  for (const [template, s] of Object.entries(drillStats ?? {})) {
    const tag = TEMPLATE_TO_CONCEPT[template];
    if (!tag || !s) continue;
    const cur = out[tag] ??= { seen: 0, missed: 0 };
    cur.seen += s.seen ?? 0;
    cur.missed += s.missed ?? 0;
  }
  return out;
}
