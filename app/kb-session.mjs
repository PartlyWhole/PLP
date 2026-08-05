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
//   ×  miss-rate (×(1 + 2·missed/seen), up to ~3×)
//   ×  cold-start frontier bias (unreachable focuses down-weighted while
//      few answers exist — basics first, fading out with experience),
// avoiding consecutive repeats of the same (form, shape) — the hard floor —
// and, preferentially, of the same focus concept; one slot per round is
// reserved for the learner's worst concept. The topic
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

// Weight of an exercise given the learner's tag-keyed stats (design §6.3),
// plus the cold-start frontier bias: while the learner has answered little,
// exercises whose focus is not yet REACHABLE — the focus is unmet and some
// strict non-structural ancestor has never been seen (in stats, the met set,
// or earlier in this same round) — are strongly down-weighted, so cold
// "all"/endless rounds deal basics first. It is a bias, never a hard gate
// (the topic picker is a practice affordance, not the mastery-gated
// frontier), and it fades out as answers accumulate.
const COLD_ANSWERS = 24;      // bias is gone once this many answers exist
const COLD_STEP_PENALTY = 0.2; // per unseen ancestor, at zero answers
function weightOf(stats, ex, cold) {
  const level = kb.concepts.get(ex.focus)?.kind === "core" ? 3 : 1;
  const s = stats?.[ex.focus];
  const novelty = !s || !s.seen ? 1.5 : 1;
  const missRate = s?.seen ? 1 + 2 * (s.missed / s.seen) : 1;
  let frontierBias = 1;
  if (cold && cold.coldness > 0 && !cold.met.has(ex.focus)) {
    const seenTag = (t) => Boolean(stats?.[t]?.seen) || cold.met.has(t) || cold.dealt.has(t);
    // The penalty compounds per never-seen strict ancestor, so a concept
    // two ideas away is merely unlikely while one eight ideas away is
    // effectively (but never absolutely) off the table.
    const unseen = [...kb.ancestors(ex.focus)]
      .filter((a) => !kb.structural.has(a) && !seenTag(a)).length;
    if (unseen > 0) {
      const pen = COLD_STEP_PENALTY ** unseen;
      frontierBias = 1 - (1 - pen) * cold.coldness;
    }
  }
  return level * novelty * missRate * frontierBias;
}

// The learner's worst concept: highest missed/seen among tags with a miss.
// Ties break by tag so the choice is deterministic.
function worstConceptOf(stats) {
  let worst = null, rate = 0;
  for (const tag of Object.keys(stats ?? {}).sort()) {
    const s = stats[tag];
    if (!s?.seen || !s.missed) continue;
    const r = s.missed / s.seen;
    if (r > rate) { worst = tag; rate = r; }
  }
  return worst;
}

// Compile a practice round into an ordinary lesson script. Deterministic
// under (topic, seed, count, stats, focus, met, prevKey) — a persisted
// session rebuilds exactly. `focus` (a concept tag) narrows the pool to
// that concept's own exercises — the concept map's "Practice this ▶" /
// "Try it anyway ▶" — with a shorter default round and a guaranteed
// teach-first opener (the learner explicitly asked to learn it). `met` is
// the learner's met tag set (lesson-kb-binding §5) feeding the cold-start
// frontier bias; `prevKey` carries the previous chunk's last-dealt key so
// endless chunks keep the no-repeat guarantee across the boundary.
export function buildKBSession(topic, { count, seed = 1, stats = {}, focus, met = [], prevKey = null } = {}) {
  let pool = poolFor(topic);
  if (focus) {
    const focused = pool.filter((ex) => ex.focus === focus);
    if (focused.length) pool = focused;
  }
  count ??= focus ? 4 : 8;
  // A single-exercise focus pool can only vary by seed: four near-identical
  // questions read as broken, so targeted rounds cap at 2 there.
  if (focus && pool.length === 1) count = Math.min(count, 2);
  if (!pool.length) return null;
  const rng = mulberry32(seed >>> 0);
  const topicTitle = topic === "all" ? "everything" : (TITLE_BY_TOPIC.get(topic) ?? topic);
  const focusLabel = focus ? (kb.concepts.get(focus)?.slug.replaceAll("-", " ") ?? focus) : null;

  // No round banner: the surface header shows topic + progress dots, and
  // every instruction the banner used to front-load now appears at the
  // moment it applies (first-time mechanics lines, just-in-time feedback,
  // the summary's come-back promise). The question is the interface.
  const steps = [];

  // Cold-start bias context: coldness fades linearly with total answers;
  // `dealt` accumulates this round's own focuses so a cold round walks
  // outward (0005 first, then what it unlocks) instead of re-dealing one
  // reachable exercise.
  const answered = Object.values(stats).reduce((a, s) => a + (s?.seen ?? 0), 0);
  const cold = focus ? null : {
    coldness: Math.max(0, 1 - answered / COLD_ANSWERS),
    met: new Set(met),
    dealt: new Set(),
  };

  // Guaranteed miss-return (the welcome's "will come back until it's easy"):
  // one slot per round is reserved for the learner's worst concept, when the
  // pool carries one. The slot index is seeded (deterministic) and the rng
  // draw happens only when a worst concept exists, so stat-less compiles
  // keep their rng stream unchanged.
  const worstTag = focus ? null : worstConceptOf(stats);
  const worstPool = worstTag ? pool.filter((ex) => ex.focus === worstTag) : [];
  let missSlot = -1;
  if (worstPool.length) missSlot = Math.floor(rng() * count);

  // prevKey format: `form|shape|concept` — the (form, shape) half is the
  // hard no-repeat floor (design §5.3 / inv 14); the concept half is a soft
  // preference so the same concept never deals twice in a row when
  // alternatives exist.
  let [prevForm, prevShape, prevConcept] = (prevKey ?? "||").split("|");
  let prevFS = prevKey ? `${prevForm}|${prevShape}` : null;
  let forcedReturn = false;
  const taught = new Set();
  for (let i = 0; i < count; i++) {
    // Weighted, seeded exercise choice; no consecutive (form, shape) repeat
    // (design §5.3 / inv 14) and, preferentially, no consecutive focus
    // concept, so consecutive questions feel different. The reserved
    // miss-return slot narrows the pick to the worst concept's exercises —
    // skipped (deferred one slot) if that concept was just dealt.
    const forceHere = !forcedReturn && missSlot >= 0 && i >= missSlot && prevConcept !== worstTag;
    const basePool = forceHere ? worstPool : pool;
    let chosen = null, fallback = null, last = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      const ex = weightedPick(rng, basePool, stats, cold);
      const prog = ex.generator.generate(Math.floor(rng() * 0x100000000));
      const fs = `${ex.form}|${prog.shape}`;
      const cand = { ex, prog, fs };
      last = cand;
      if (basePool.length === 1) { chosen = cand; break; }
      if (fs === prevFS) continue;                        // hard floor
      if (ex.focus !== prevConcept) { chosen = cand; break; } // ideal
      fallback ??= cand;                                  // fs-clean, concept repeat
    }
    chosen ??= fallback ?? last;
    if (forceHere) forcedReturn = true;
    prevFS = chosen.fs;
    prevConcept = chosen.ex.focus;
    cold?.dealt.add(chosen.ex.focus);
    const { ex, prog } = chosen;
    const concept = kb.concepts.get(ex.focus);
    const n = `(${i + 1}/${count})`;

    // FIRST ENCOUNTER of a CORE concept teaches first: the one-sentence
    // rule statement rides ON the ask (rendered in-card, right above the
    // question; the full worked-example card sits behind a tap). EDGE
    // concepts stay discovery-first: they are the corner-case traps whose
    // pedagogy IS the surprise — the miss creates the felt need the rule
    // card then answers (design §10.3). A concept may override with
    // introStyle: "teach-first"/"discover-first". Once seen, every concept
    // stays unspoiled either way. Living on the ask (not a transient say
    // step) also makes mid-round reloads rebuild the teach line correctly.
    // Focus rounds ALWAYS teach the focused concept first, regardless of
    // introStyle or prior sightings: the learner explicitly asked to learn
    // it (the map's "Practice this ▶" / "Try it anyway ▶" promise teaching).
    const introStyle = concept.introStyle ?? (concept.kind === "core" ? "teach-first" : "discover-first");
    let teach;
    const wantTeach = (focus && ex.focus === focus)
      || (introStyle === "teach-first" && !stats[ex.focus]?.seen);
    if (wantTeach && !taught.has(ex.focus)) {
      taught.add(ex.focus);
      teach = { statement: concept.statement, card: concept.card };
    }
    // Prompts are ONE short line: no numbering (the surface shows progress
    // dots), no repeated form instructions (first-time mechanics are the
    // surface's one-quiet-line job).
    let ask;
    if (ex.form === "spot-the-difference") {
      // Program A + its real output ride on the ask (ask.context) so the
      // card — and any reload of it — can show the pair; program B is what
      // the editor holds (design §5.2: the pair differ by one line).
      steps.push({ loadCode: prog.contrastCode });
      ask = {
        kind: "predict-output",
        form: ex.form, shape: prog.shape,
        concept: ex.focus, template: ex.id, singleLine: true,
        context: { code: prog.code, output: prog.aOutput },
        prompt: "One line changed. What does it print now?",
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
        prompt: `Fill the blank so it prints \`${prog.targetOutput}\`.`,
      };
    } else if (ex.form === "trace-table") {
      // Walk the trace: the student fills what each watched name holds at
      // every step where it changes; the real trace is the answer key (the
      // row/blank structure derives at runtime — kb stays trace-agnostic).
      steps.push({ loadCode: prog.code });
      ask = {
        kind: "trace-table",
        form: ex.form, shape: prog.shape,
        concept: ex.focus, template: ex.id,
        probeNames: prog.probeNames, maxBlanks: prog.maxBlanks,
        prompt: "Walk it line by line — what does each name hold after each step?",
      };
    } else if (ex.form === "predict-state") {
      steps.push({ loadCode: prog.code });
      ask = {
        kind: "predict-state",
        form: ex.form, shape: prog.shape,
        concept: ex.focus, template: ex.id, singleLine: true,
        opts: { name: prog.probeName },
        prompt: `After it runs, what does \`${prog.probeName}\` hold?`,
      };
    } else {
      steps.push({ loadCode: prog.code });
      ask = {
        kind: "predict-output",
        form: ex.form, shape: prog.shape,
        concept: ex.focus,       // tag — weights future selection, keyed in plp.kb.v1
        template: ex.id,         // exercise id — kept for events/review context
        singleLine: !ex.multiline,
        prompt: "What does this print?",
      };
    }
    if (teach) ask.teach = teach;
    steps.push({ ask });
    // After a miss: the program's variant card if it has one (the specific
    // values just asked), else the concept's canonical rule card.
    const explain = prog.variantCard ?? concept.card;
    steps.push({ if: { lastAnswer: ["wrong", "skipped"] }, say: explain, pause: true });
    // A correct answer holds too: on the one-card practice surface the next
    // ask replaces the card, so without this beat the "✓" verdict and the
    // reveal would vanish before the learner reads them.
    steps.push({ if: { lastAnswer: "correct" }, pause: true });
  }

  steps.push({
    done: `Round complete — nice work! Start another **${topicTitle}** round `
      + "for brand-new questions. The ones that tricked you will show up "
      + "again, so you can beat them.",
  });
  return {
    id: focus ? `drill-${topic}-${focus}-${seed >>> 0}` : `drill-${topic}-${seed >>> 0}`,
    unit: 0,
    title: focus ? `Practice · ${focusLabel}` : `Practice · ${topicTitle}`,
    steps,
  };
}

// ---- progress helpers ------------------------------------------------------

// tag → topicId, derived exactly like docgen's conceptTopic: a concept's
// topic is the topic of its first exercise (every non-structural loaded
// concept has ≥1 exercise; structural roots are excluded — they have no
// learner meaning).
let topicByTag = null;
export function conceptTopics() {
  if (topicByTag) return topicByTag;
  topicByTag = new Map();
  for (const ex of kb.exercises) {
    if (!topicByTag.has(ex.focus)) topicByTag.set(ex.focus, ex.topic);
  }
  return topicByTag;
}

// Per-topic mastery: met = tags the student has met (iterable). Returns
// kbTopics order: [{ id, title, met, total, ready }] where ready counts
// frontier concepts (unlocked, unmet) in that topic.
export function topicProgress(met) {
  const metSet = new Set(met);
  const topics = conceptTopics();
  const frontier = kb.frontier(metSet);
  const rows = kbTopics.map((t) => ({ id: t.id, title: t.title, met: 0, total: 0, ready: 0 }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [tag, topicId] of topics) {
    const row = byId.get(topicId);
    if (!row) continue;
    row.total += 1;
    if (metSet.has(tag)) row.met += 1;
    if (frontier.has(tag)) row.ready += 1;
  }
  return rows;
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

function weightedPick(rng, pool, stats, cold) {
  const weights = pool.map((ex) => weightOf(stats, ex, cold));
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
