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
// - 002D local-scope-inside / 002E locals-shadow-globals: wave 4. They need
//   the predict-state form to grow a canonical "gone" answer token (a name
//   that no longer exists is not a value the current form can express).
// - 002J mutable-arg-shared: wave 5 (objId pass-through through a frame).

export default [
  {
    tag: "002D",
    slug: "local-scope-inside",
    kind: "core",
    parents: ["0029"],
    statement: "Names bound inside a function exist only inside it; outside, they are gone.",
    wrongAnswer: "the inside name still readable after the call",
    card: "Names made inside a function live only INSIDE that run. When "
      + "the function ends, they are gone.\n\n"
      + "```py\ndef f():\n    inside = 5\n    print(inside)\nf()\n```\n\n"
      + "`inside` exists during the call — printing it afterwards would be "
      + "an error, because outside the function there is no such name.",
  },
  {
    tag: "002E",
    slug: "locals-shadow-globals",
    kind: "edge",
    parents: ["002D"],
    statement: "A name bound inside a function hides the outer name of the same spelling; the outer one is untouched.",
    wrongAnswer: "the outer name changed by the inner assignment",
    card: "If a function binds a name that also exists outside, the inside "
      + "one is a SEPARATE name that hides the outer one — the outer value "
      + "is untouched.\n\n"
      + "```py\nx = 1\ndef f():\n    x = 99\nf()\nprint(x)\n```\n\n"
      + "This prints `1`: the function's `x` was its own, and it vanished "
      + "when the call ended.",
  },
  {
    tag: "002J",
    slug: "mutable-arg-shared",
    kind: "edge",
    parents: ["0029", "000H"],
    statement: "Passing a list passes the SAME list — a mutation inside the function shows outside.",
    wrongAnswer: "the outer list unchanged after the call",
    card: "Passing a list does not copy it: the parameter is another name "
      + "for the SAME list. A change inside shows outside.\n\n"
      + "```py\ndef add(xs):\n    xs.append(9)\nnums = [1, 2]\nadd(nums)\nprint(nums)\n```\n\n"
      + "This prints `[1, 2, 9]`: `xs` and `nums` were one list.",
  },
];
