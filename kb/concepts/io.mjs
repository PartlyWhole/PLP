// The input boundary (expansion ladder §R4a). Lives in its own module rather
// than in state.mjs because the stdin rendezvous is the one concept whose
// exercises need a scripted-input form (`predict-io`) to be honest at all —
// keeping it separate makes that dependency visible.
//
// The tag was minted in phase 5 and parked in concepts/pending.mjs until the
// form existed; it moved here (unchanged — the ledger is append-only and
// K-1 compares the loaded concept with its ledger entry exactly) together
// with kb/exercises/io.mjs.

export default [
  {
    tag: "0026",
    slug: "input-pauses-for-value",
    kind: "core",
    parents: ["0006"],
    statement: "input(…) stops the program until the outside world types a line; the typed text enters the state as an ordinary binding.",
    wrongAnswer: "the program runs on without waiting, or the value appears from nowhere",
    card: "At `input(...)` the program STOPS. It cannot move on until the "
      + "outside world — you — types a line and presses Enter.\n"
      + "The typed text then enters the state as an ordinary binding, and "
      + "the program continues.\n\n```py\nname = input(\"Who? \")\nprint(name)\n```\n\n"
      + "Nothing prints until you answer; then your answer is what prints.",
  },
];
