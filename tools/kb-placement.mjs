// Placement diagnostic (design/kb-sidework-plan.md §2.1). Pure module: no
// DOM, no engine, no RNG. Imports NOTHING from kb/ directly — the caller
// passes the object returned by loadKB(). Deterministic: all iteration
// orders are tag- or id-sorted, so a given answer policy always produces
// the same probe sequence.
//
// The diagnostic walks concepts deepest-first. A correct answer to a deep
// question is evidence for the whole ancestral lineage (add focus + every
// non-structural ancestor to `met`), so one good answer places many
// concepts at once. A wrong answer marks only the focus unmet — never
// subtracts from met, because an earlier correct answer already gave
// direct evidence for those tags and one deep miss does not un-prove an
// ancestor.
//
// "Schedules its parents" is emergent, not explicit: once a focus f is
// contradicted (in `unmet`), rule 1 of nextProbe filters out every
// descendant of a contradicted ancestor, so the deepest remaining
// candidates are f's ancestry and siblings — the probe walks upward
// automatically toward the parents.
//
// Convergence: every probe adds its focus to `asked`; candidates exclude
// `asked`; `exercisable` is finite — so nextProbe returns null after at
// most exercisable.length probes. There is no RNG anywhere.
//
// Worked example (current 20-node graph — illustrative; tests must NOT
// hard-code any of this):
//   Depths: 0005:1, 0006:2, 0007:3, 0008:2, 0009:3, 000A:3, 000B:4,
//   000C:4, 000D:3, 000E:4, 000F:5, 000G:4, 000H:5, 000P:3, 0021:4,
//   0023:6.
//   Perfect student:
//     1. Deepest = 0023 → exercise aug-assign-shared-list. Correct →
//        met += {0023, 000H, 0021, 000C, 000G, 000A, 000D, 0006, 0005}.
//     2. Remaining deepest = 000F (d5) → slot-assign. Correct →
//        met += {000F, 000E, 0007}.
//     3. Remaining deepest = 000B (d4) → accumulate-step. Correct →
//        met += {000B, 0009, 0008}.
//     4. Remaining = 000P (d3) → div-always-float. Correct → met += {000P}.
//     5. nextProbe → null. 16 exercisable concepts placed in 4 questions.
//   All-wrong student: every probe fails, nothing is implied, so all 16
//   get probed once each (deepest-first, tag tie-break), met ends empty.

export function startPlacement(kb) {
  // exercisable = every non-structural concept tag that is the focus of at
  // least one intro exercise, sorted ascending by tag. Invariant 12 says
  // all non-structural concepts qualify, but derive it — never assume.
  const introFocuses = new Set();
  for (const ex of kb.exercises) {
    if (ex.role === "intro") introFocuses.add(ex.focus);
  }
  const exercisable = [...introFocuses]
    .filter((t) => !kb.structural.has(t))
    .sort();

  // depth(t) = longest-path depth. 0 for roots (no parents), else
  // 1 + max(depth(parent)). Memoized; the KB is a DAG so this terminates.
  const depth = new Map();
  const depthOf = (t) => {
    if (depth.has(t)) return depth.get(t);
    const parents = kb.concepts.get(t)?.parents ?? [];
    const d = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(depthOf));
    depth.set(t, d);
    return d;
  };
  for (const t of kb.concepts.keys()) depthOf(t);

  // met holds NON-STRUCTURAL tags only (structural tags are vacuously met
  // by the KB itself; never add them).
  return {
    kb,
    met: new Set(),
    unmet: new Set(),
    asked: new Set(),
    depth,
    exercisable,
  };
}

export function nextProbe(session) {
  const { kb, met, unmet, asked, depth, exercisable } = session;

  // Rule 1: candidates = unplaced, unasked exercisable tags with no
  // contradicted ancestor (a contradicted ancestor implies t is unmet).
  // Rule 3: deepest wins; ties break by ascending tag. exercisable is
  // already tag-sorted, so a single pass keeping the first strictly-deeper
  // element yields deepest-then-smallest-tag.
  let best = null;
  for (const t of exercisable) {
    if (met.has(t) || unmet.has(t) || asked.has(t)) continue;
    let contradicted = false;
    for (const anc of kb.ancestors(t)) {
      if (unmet.has(anc)) { contradicted = true; break; }
    }
    if (contradicted) continue;
    if (best === null || depth.get(t) > depth.get(best)) best = t;
  }

  // Rule 2: no candidates → converged.
  if (best === null) return null;

  // Rule 4: intro exercise for that focus with the lexicographically
  // smallest id.
  const intros = kb.exercises
    .filter((ex) => ex.role === "intro" && ex.focus === best)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return intros[0];
}

export function recordAnswer(session, exerciseId, correct) {
  const { kb, met, unmet, asked } = session;

  const exercise = kb.exercises.find((ex) => ex.id === exerciseId);
  if (!exercise) throw new Error("placement: unknown exercise " + exerciseId);

  const f = exercise.focus;
  asked.add(f);

  if (correct) {
    // Answering the deep question is evidence for the whole lineage.
    met.add(f);
    for (const anc of kb.ancestors(f)) {
      if (!kb.structural.has(anc)) met.add(anc);
    }
  } else {
    // Never subtract from met — one deep miss does not un-prove an ancestor.
    unmet.add(f);
  }
  return session;
}

export function result(session) {
  return {
    met: new Set(session.met),
    frontier: session.kb.frontier(session.met),
  };
}
