// Conditions & logic concepts (design §3.6). Two edges from §3 are
// corrected at mint time (recorded in the phase-2 ledger, decision A2):
// bool-values (0016) has parent print-text and compare-ops (0015) has
// parents arith-on-ints + bool-values — so bool-values (intro print(True))
// precedes compare-ops (intro print(3 < 5)), which is the only order in
// which either can be exercised.

export default [
  {
    tag: "0016",
    slug: "bool-values",
    kind: "core",
    parents: ["0005"],
    statement: "The yes-or-no values are True and False, and they print exactly like that.",
    wrongAnswer: "true, yes, or 1",
    card: "A yes-or-no value is written `True` or `False` — capital first "
      + "letter, no quotes. That is exactly how they print.\n\n"
      + "```py\nprint(True)\n```\n\nThis prints `True` — not `true`, not `1`.",
  },
  {
    tag: "0015",
    slug: "compare-ops",
    kind: "core",
    parents: ["0008", "0016"],
    statement: "< > <= >= == != compare two values and give back a yes-or-no result.",
    wrongAnswer: "the comparison read backwards",
    card: "`<`, `>`, `<=`, `>=`, `==`, `!=` compare two values and give "
      + "back `True` or `False`.\n`==` asks 'are they equal?'; `<` asks "
      + "'is the left smaller?'.\n\n```py\nprint(3 < 5)\n```\n\n"
      + "This prints `True`: 3 really is less than 5.",
  },
  {
    tag: "0017",
    slug: "if-runs-or-skips",
    kind: "core",
    parents: ["0015"],
    statement: "if runs its indented lines when the test is True and skips them when it is False.",
    wrongAnswer: "the skipped branch's output",
    card: "`if` looks at its test. If the test is `True`, the indented "
      + "lines run. If it is `False`, they are skipped completely.\n\n"
      + "```py\nx = 2\nif x > 3:\n    print(\"big\")\nprint(\"done\")\n```\n\n"
      + "`2 > 3` is False, so `big` is skipped. This prints just `done`.",
  },
  {
    tag: "0018",
    slug: "else-otherwise",
    kind: "core",
    parents: ["0017"],
    statement: "else runs exactly when the if test was False — one branch runs, never both.",
    wrongAnswer: "both branches' output",
    card: "`else` is the other path. If the `if` test is True, the `if` "
      + "block runs; otherwise the `else` block runs. Exactly one of them "
      + "runs — never both.\n\n"
      + "```py\nx = 2\nif x > 3:\n    print(\"big\")\nelse:\n    print(\"small\")\n```\n\n"
      + "`2 > 3` is False, so this prints `small` only.",
  },
  {
    tag: "0019",
    slug: "elif-first-true-wins",
    kind: "core",
    parents: ["0018"],
    statement: "In an if/elif/… chain, tests run top to bottom and only the first true branch runs.",
    wrongAnswer: "a later true branch also runs",
    card: "In an `if`/`elif` chain, Python checks tests from the top. The "
      + "FIRST one that is True runs — and the rest are skipped, even if "
      + "they are also true.\n\n"
      + "```py\nx = 5\nif x > 10:\n    print(\"big\")\nelif x > 3:\n    print(\"medium\")\nelse:\n    print(\"small\")\n```\n\n"
      + "`x > 10` is False, `x > 3` is True, so this prints `medium`.",
  },
  {
    tag: "001A",
    slug: "bool-ops",
    kind: "core",
    parents: ["0016"],
    statement: "and needs both sides true; or needs at least one; not flips.",
    wrongAnswer: "or treated as exclusive, or and/or swapped",
    card: "`and` is True only when BOTH sides are True. `or` is True when "
      + "AT LEAST ONE side is True. `not` flips True and False.\n\n"
      + "```py\nprint(True and False)\n```\n\n"
      + "This prints `False`: `and` needs both, and one side is False.",
  },
  {
    tag: "001B",
    slug: "truthiness-empty-falsy",
    kind: "edge",
    parents: ["0017", "000D"],
    statement: "A test can be any value: 0, \"\", and [] count as false; everything else counts as true.",
    wrongAnswer: "expects an error, or treats a non-empty value as false",
    card: "A test does not have to be True or False. Empty things count as "
      + "false: `0`, `\"\"`, and `[]`. Everything else counts as true.\n\n"
      + "```py\nx = []\nif x:\n    print(\"has items\")\nprint(\"done\")\n```\n\n"
      + "`[]` is empty, so it counts as false and the block is skipped. "
      + "This prints just `done`.",
  },
  {
    tag: "001C",
    slug: "and-or-return-operand",
    kind: "edge",
    parents: ["001A", "001B"],
    statement: "and/or hand back one of their operands, not necessarily True or False.",
    wrongAnswer: "True instead of the operand value",
    card: "`and` and `or` do not always give `True`/`False` — they hand "
      + "back one of the actual values.\n`a or b` gives `a` if `a` counts "
      + "as true, otherwise `b`.\n\n```py\nprint(2 or 0)\n```\n\n"
      + "This prints `2`: `2` counts as true, so `or` hands back `2` "
      + "itself — not `True`.",
  },
  {
    tag: "001D",
    slug: "chained-compare",
    kind: "edge",
    parents: ["0015", "001A"],
    statement: "a < b < c means a < b and b < c — not a comparison of a result with c.",
    wrongAnswer: "grouped left-to-right, comparing a True/False with c",
    card: "`a < b < c` is a shorthand for `a < b and b < c`. Python checks "
      + "both links, not `(a < b) < c`.\n\n```py\nprint(1 < 2 < 3)\n```\n\n"
      + "This prints `True`: 1 < 2 and 2 < 3 are both true.",
  },
  {
    tag: "002K",
    slug: "branch-picks-binding",
    kind: "core",
    parents: ["0018", "000B"],
    statement: "A branch can rebind a name — what the name ends up holding depends on which branch ran.",
    wrongAnswer: "the value the OTHER branch would have produced",
    card: "The test decides which branch runs, and only the branch that "
      + "runs gets to rebind the name.\n\n"
      + "```py\nn = 8\nif n > 5:\n    n = n - 5\nelse:\n    n = n + 10\nprint(n)\n```\n\n"
      + "`8 > 5` is True, so only `n = n - 5` runs: this prints `3`. "
      + "Change the start to `n = 2` and the else branch runs instead — "
      + "`12`. Same program, one line executed, two different endings.",
  },
];
