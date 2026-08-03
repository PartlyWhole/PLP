// Structural roots (design §2.6): never a focus, no exercises, no
// characteristic wrong answer (no discriminating witness exists), and
// auto-granted as met from the first session. tags.ledger.json is the
// permanent append-only record; tests assert these modules never drift
// from it.

export default [
  {
    tag: "0001",
    slug: "run-top-to-bottom",
    kind: "structural",
    parents: [],
    statement: "Statements execute once, in order, each finishing before the next.",
  },
  {
    tag: "0002",
    slug: "values-have-types",
    kind: "structural",
    parents: [],
    statement: "Every value is one specific kind of thing — a number, some text, a list…",
  },
  {
    tag: "0003",
    slug: "int-literal",
    kind: "structural",
    parents: [],
    statement: "Bare digits in code mean a whole-number value.",
  },
  {
    tag: "0004",
    slug: "one-line-per-print",
    kind: "structural",
    parents: [],
    statement: "Each print produces exactly one line of output.",
  },
];
