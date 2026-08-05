// Minted-but-not-yet-wired concepts: their tags are permanently allocated
// in kb/tags.ledger.json and their prose is authored here, but this module
// is deliberately NOT imported by kb/index.mjs — loading a concept without
// an intro exercise would (correctly) fail inv 12 (K-7). The ledger running
// ahead of the loaded set is the designed mechanism for this (K-1 is
// directional; CLAUDE.md invariant 10). Wire each concept into loadKB()
// only together with its intro exercise.
//
// - 0026 input-pauses-for-value: WIRED (expansion ladder §R4a) — its prose
//   moved to kb/concepts/io.mjs once the `predict-io` form could supply a
//   scripted stdin line during grading.
// - 0027–002H, the def/call/return half of the functions sub-graph: WIRED
//   (expansion ladder §R4b waves 1–3) — prose moved to
//   kb/concepts/functions.mjs alongside the analyzer's def/call/return
//   grammar and abstract call frames.
// - 002D local-scope-inside / 002E locals-shadow-globals: WIRED (expansion
//   ladder §R4b wave 4) — prose moved to kb/concepts/functions.mjs once
//   predict-state grew its canonical "gone" answer token.
// - 002J mutable-arg-shared: WIRED (expansion ladder §R4b wave 5) — prose
//   moved to kb/concepts/functions.mjs alongside the analyzer's objId
//   pass-through through a call frame (rule-mutable-arg) and the matching
//   frame-teardown withdrawal of local names from the objects table.
// - 001Q for-else-no-break: UNWIRED BY DECISION (owner call, after the
//   concept's own trap sprang on an experienced reader). `for ... else` is
//   rare in real Python and several style guides discourage writing it; more
//   to the point, its SYNTAX reads as an error before it reads as a rule, so
//   a discover-first encounter teaches nothing — a learner who concludes
//   "this program is broken" has not met the concept, only doubted the app.
//   The tag stays active and permanent (the ledger never forgets an
//   allocation); the prose waits here, and the analyzer KEEPS its
//   forElseNoBreak rule so any future generated for-else program fails the
//   closure check loudly instead of teaching an untaught concept.
//
// The module is also the designated home for the NEXT minted-but-unwired
// concept, and the documentation of why that state is legal at all: the
// ledger may run ahead of the loaded set (invariant 10, K-1 is directional).

export default [
  {
    tag: "001Q",
    slug: "for-else-no-break",
    kind: "edge",
    parents: ["001N"],
    statement: "A loop's else runs only when the loop finished without a break.",
    wrongAnswer: "else tied to the if, or else runs every time",
    card: "A loop can have an `else`. It runs only if the loop finished "
      + "normally — that is, WITHOUT hitting a `break`.\n\n"
      + "```py\nfor x in [1, 2, 3]:\n    if False:\n        break\nelse:\n    print(\"done\")\n```\n\n"
      + "No break happens, so the loop's `else` runs and this prints "
      + "`done`.",
  }
];
