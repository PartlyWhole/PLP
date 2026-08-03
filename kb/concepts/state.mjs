// State & I/O concepts in the phase-1 slice. Full Concept objects
// (design §7.1): structure (kind, parents — mirrored in the append-only
// tags.ledger.json, consistency test-enforced), the one-sentence
// statement, the characteristic wrong answer (design §2.7 — the output a student
// produces when they lack exactly this node), and the canonical rule
// card (student-facing style contract: short sentences, one idea each,
// second person, technical terms kept and glossed).

export default [
  {
    tag: "0005",
    slug: "print-text",
    kind: "core",
    parents: ["0001", "0004"],
    statement: "print(\"…\") writes the quoted characters, without the quotes, as one line.",
    wrongAnswer: "the text with its quotes kept",
    card: "`print(\"hi\")` writes exactly the characters between the quotes.\n"
      + "The quotes themselves are not printed. They only mark where the "
      + "text starts and ends.\n\n```py\nprint(\"hi\")\n```\n\nThis prints `hi` — no quotes.",
  },
  {
    tag: "0006",
    slug: "name-holds-value",
    kind: "core",
    parents: ["0005", "0003"],
    statement: "x = v makes the name x hold the value v; print(x) shows that value.",
    wrongAnswer: "the letter x itself",
    card: "`x = 4` stores the value 4 under the name `x`.\n"
      + "When you print a name, Python looks up the value it holds and "
      + "prints that value — not the name.\n\n```py\nx = 4\nprint(x)\n```\n\nThis prints `4`.",
  },
  {
    tag: "0007",
    slug: "quoted-vs-name",
    kind: "core",
    parents: ["0005", "0006"],
    statement: "\"x\" is the text x; bare x looks up the name x.",
    wrongAnswer: "the stored value where the text was meant, or the text where the value was meant",
    card: "Quotes make text. No quotes means a name.\n"
      + "`print(\"x\")` prints the letter x. `print(x)` looks up the name "
      + "`x` and prints the value it holds.\n\n```py\nx = 3\nprint(\"x\")\nprint(x)\n```\n\n"
      + "The first prints `x`; the second prints `3`.",
  },
  {
    tag: "0009",
    slug: "evaluate-before-bind",
    kind: "core",
    parents: ["0006", "0008"],
    statement: "The right side is computed down to one value before the name stores it.",
    wrongAnswer: "the expression itself, unevaluated",
    card: "In `x = 2 + 3`, Python first works out the right side — `2 + 3` "
      + "becomes `5` — and only then stores the result.\n"
      + "The name holds the finished value, never the calculation.\n\n"
      + "```py\nx = 2 + 3\nprint(x)\n```\n\nThis prints `5`, not `2 + 3`.",
  },
  {
    tag: "000A",
    slug: "rebind-updates-name",
    kind: "core",
    parents: ["0006"],
    statement: "A second x = … replaces x's value; the old value is gone.",
    wrongAnswer: "the first value",
    card: "A name holds one value: the one most recently assigned.\n"
      + "A second assignment replaces the first. The old value is gone.\n\n"
      + "```py\nx = 4\nx = 9\nprint(x)\n```\n\nThis prints `9`. The 4 is gone.",
  },
  {
    tag: "000B",
    slug: "accumulate-rebind",
    kind: "core",
    parents: ["0009", "000A"],
    statement: "x = x + 1 reads the old value, computes, then rebinds x to the result.",
    wrongAnswer: "the old value, or one step short",
    card: "`x = x + 3` happens in two steps. First the right side is "
      + "computed with the OLD value of `x`. Then the result replaces it.\n\n"
      + "```py\nx = 4\nx = x + 3\nprint(x)\n```\n\n"
      + "The right side is `4 + 3`, so `x` becomes `7`.",
  },
  {
    tag: "000C",
    slug: "name-from-name",
    kind: "core",
    parents: ["000A"],
    statement: "b = a gives b the value a holds now; rebinding a later does not change b.",
    wrongAnswer: "a's new value",
    card: "`b = a` copies the value `a` holds right now into `b`.\n"
      + "After that the two names are separate. Changing `a` later does "
      + "not touch `b`.\n\n```py\na = 4\nb = a\na = 9\nprint(b)\n```\n\n"
      + "This prints `4` — the value `b` got when the copy happened.",
  },
  {
    tag: "000J",
    slug: "print-multi-args",
    kind: "core",
    parents: ["0005", "0006"],
    statement: "print(a, b) writes both values on one line with a single space between them.",
    wrongAnswer: "the values with no space between them, or a printed comma",
    card: "`print(a, b)` prints both values on ONE line.\n"
      + "Python puts a single space between them — not a comma, not "
      + "nothing.\n\n```py\nx = 3\ny = 5\nprint(x, y)\n```\n\n"
      + "This prints `3 5` — one space between, on one line.",
  },
  {
    tag: "000M",
    slug: "swap-right-side-first",
    kind: "edge",
    parents: ["000C", "0009"],
    statement: "In a, b = b, a the whole right side is evaluated before either name rebinds — so the values swap.",
    wrongAnswer: "both names end up with the same value",
    card: "`a, b = b, a` swaps the two values.\n"
      + "Python works out the WHOLE right side first — the old `b` and the "
      + "old `a` — and only then stores them into `a` and `b`. So neither "
      + "name is overwritten before it is read.\n\n"
      + "```py\na = 3\nb = 5\na, b = b, a\nprint(b)\n```\n\n"
      + "This prints `3`: `b` gets the old `a`. Doing it one name at a time "
      + "would wrongly leave both at `5`.",
  },
  {
    tag: "000K",
    slug: "str-literal-vs-number",
    kind: "core",
    parents: ["0007", "0002", "000Y"],
    statement: "\"3\" is text and 3 is a number; they can print alike but are different kinds of value.",
    wrongAnswer: "treats the digit text as a number to add",
    card: "`\"3\"` is TEXT that happens to look like a number; `3` is an "
      + "actual number. They print the same, but they behave differently.\n"
      + "`+` glues text together — it does not add.\n\n"
      + "```py\nprint(\"2\" + \"3\")\n```\n\n"
      + "This prints `23`, not `5`: the two are text, so `+` joins them.",
  },
];
