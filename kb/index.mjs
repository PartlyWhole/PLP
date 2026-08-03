// The KB's narrow interface (design §7.3). Consumers — a drill runtime,
// a guided-lesson runtime, a placement diagnostic, a workbook printer —
// see loadKB() and nothing else. This module imports nothing from app/
// (it must load in plain Node for the invariant suite and docgen) and
// performs structural validation on load, throwing on any internal
// inconsistency so tests fail with a named reason.
//
// tags.ledger.json is the permanent append-only tag record; it is NOT
// imported here (JSON-module import attributes differ across hosts) —
// the concept modules below carry the same structure, and
// tests/kb.spec.mjs cross-checks the two byte for byte.

import roots from "./concepts/roots.mjs";
import stateConcepts from "./concepts/state.mjs";
import numberConcepts from "./concepts/numbers.mjs";
import listConcepts from "./concepts/lists.mjs";
import stringConcepts from "./concepts/strings.mjs";
import logicConcepts from "./concepts/logic.mjs";
import loopConcepts from "./concepts/loops.mjs";
import structureConcepts from "./concepts/structures.mjs";
import stateExercises from "./exercises/state.mjs";
import numberExercises from "./exercises/numbers.mjs";
import listExercises from "./exercises/lists.mjs";
import stringExercises from "./exercises/strings.mjs";
import logicExercises from "./exercises/logic.mjs";
import loopExercises from "./exercises/loops.mjs";
import structureExercises from "./exercises/structures.mjs";
import formExercises from "./exercises/forms.mjs";
import { footprint } from "./analyzer/footprint.mjs";

const TAG_RE = /^[0-9A-HJKMNP-TV-Z]{4}$/; // Crockford base-32: no I L O U
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function loadKB() {
  const allConcepts = [...roots, ...stateConcepts, ...numberConcepts, ...listConcepts, ...stringConcepts, ...logicConcepts, ...loopConcepts, ...structureConcepts];
  const concepts = new Map();
  const bySlug = new Set();
  for (const c of allConcepts) {
    if (!TAG_RE.test(c.tag)) throw new Error(`kb: bad tag ${c.tag}`);
    if (!SLUG_RE.test(c.slug)) throw new Error(`kb: bad slug ${c.slug}`);
    if (concepts.has(c.tag)) throw new Error(`kb: duplicate tag ${c.tag}`);
    if (bySlug.has(c.slug)) throw new Error(`kb: duplicate slug ${c.slug}`);
    if (!["structural", "core", "edge"].includes(c.kind)) throw new Error(`kb: bad kind on ${c.tag}`);
    if (c.kind === "structural") {
      if (c.parents.length) throw new Error(`kb: structural ${c.tag} has parents`);
    } else {
      if (!c.parents.length) throw new Error(`kb: non-structural ${c.tag} has no parents`);
      if (!c.statement || !c.wrongAnswer || !c.card) throw new Error(`kb: ${c.tag} missing statement/wrongAnswer/card`);
    }
    concepts.set(c.tag, c);
    bySlug.add(c.slug);
  }
  for (const c of concepts.values()) {
    for (const p of c.parents) {
      if (!concepts.has(p)) throw new Error(`kb: ${c.tag} parent ${p} unknown`);
    }
  }

  const structural = new Set([...concepts.values()].filter((c) => c.kind === "structural").map((c) => c.tag));

  const exercises = [...stateExercises, ...numberExercises, ...listExercises, ...stringExercises, ...logicExercises, ...loopExercises, ...structureExercises, ...formExercises];
  const exIds = new Set();
  for (const ex of exercises) {
    if (exIds.has(ex.id)) throw new Error(`kb: duplicate exercise id ${ex.id}`);
    exIds.add(ex.id);
    if (!concepts.has(ex.focus)) throw new Error(`kb: exercise ${ex.id} focus ${ex.focus} unknown`);
    if (structural.has(ex.focus)) throw new Error(`kb: exercise ${ex.id} focuses a structural concept`);
    for (const t of ex.assumed) {
      if (!concepts.has(t)) throw new Error(`kb: exercise ${ex.id} assumes unknown ${t}`);
      if (structural.has(t)) throw new Error(`kb: exercise ${ex.id} lists structural ${t} in assumed (structural tags are always permitted, never listed — design §2.8)`);
    }
  }

  // Transitive ancestors (memoized; the acyclicity test guards recursion).
  const ancestorCache = new Map();
  function ancestors(tag) {
    if (ancestorCache.has(tag)) return ancestorCache.get(tag);
    const out = new Set();
    const visit = (t) => {
      for (const p of concepts.get(t)?.parents ?? []) {
        if (!out.has(p)) { out.add(p); visit(p); }
      }
    };
    visit(tag);
    ancestorCache.set(tag, out);
    return out;
  }

  // met is the set of non-structural tags the student has answered
  // correctly at least once; structural tags are vacuously met (§2.8).
  const isMet = (met, tag) => structural.has(tag) || met.has(tag);

  // Frontier: unmet exercisable concepts all of whose parents are met.
  function frontier(met) {
    const out = new Set();
    for (const c of concepts.values()) {
      if (structural.has(c.tag) || met.has(c.tag)) continue;
      if (c.parents.every((p) => isMet(met, p))) out.add(c.tag);
    }
    return out;
  }

  // Offerable (§2.8 dynamic contract): intros whose focus is on the
  // frontier, plus reviews of met concepts — always with assumed ⊆ met.
  function offerable(met) {
    const front = frontier(met);
    return exercises.filter((ex) => {
      if (!ex.assumed.every((t) => isMet(met, t))) return false;
      if (ex.role === "intro") return front.has(ex.focus);
      return met.has(ex.focus);
    });
  }

  return { concepts, structural, exercises, ancestors, frontier, offerable, footprint };
}
