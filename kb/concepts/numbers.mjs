// Numbers & bools concepts in the phase-1 slice.

export default [
  {
    tag: "0008",
    slug: "arith-on-ints",
    kind: "core",
    parents: ["0003", "0005"],
    statement: "+ - * on whole numbers compute the usual math result.",
    wrongAnswer: "an arithmetic slip (no reasoned misconception — the intro checks fluency)",
    card: "`+`, `-` and `*` on whole numbers work like the math you know.\n"
      + "`*` means multiply.\n\n```py\nprint(3 * 5)\n```\n\nThis prints `15`.",
  },
  {
    tag: "000P",
    slug: "div-yields-float",
    kind: "core",
    parents: ["0008"],
    statement: "/ always gives a float — even when it divides evenly.",
    wrongAnswer: "the whole number, without the .0",
    card: "`/` is true division, and it ALWAYS gives a float — a number "
      + "with a decimal point — even when it divides evenly.\n\n"
      + "```py\nprint(10 / 2)\n```\n\nThis prints `5.0`, not `5`. The `.0` "
      + "tells you the result is a float.",
  },
  {
    tag: "000N",
    slug: "op-precedence",
    kind: "core",
    parents: ["0008"],
    statement: "* and / bind tighter than + and -; parentheses override.",
    wrongAnswer: "the left-to-right answer, e.g. 20 for 2 + 3 * 4",
    card: "`*` and `/` happen BEFORE `+` and `-`, no matter the order they "
      + "are written.\nSo Python does the multiply or divide first, then "
      + "the add or subtract.\n\n```py\nprint(2 + 3 * 4)\n```\n\n"
      + "This prints `14`: `3 * 4` is `12` first, then `2 + 12`. Going "
      + "left to right would wrongly give `20`.",
  },
  {
    tag: "000Q",
    slug: "floordiv-quotient",
    kind: "core",
    parents: ["0008"],
    statement: "// is whole-number division: how many whole times the divisor fits.",
    wrongAnswer: "a decimal answer, as if it were /",
    card: "`//` divides and throws away any remainder.\n"
      + "It answers: how many WHOLE times does the second number fit into "
      + "the first?\n\n```py\nprint(13 // 4)\n```\n\n"
      + "This prints `3`: four fits into thirteen three whole times. The "
      + "leftover `1` is dropped, and there is no `.0`.",
  },
  {
    tag: "000R",
    slug: "mod-remainder",
    kind: "core",
    parents: ["000Q"],
    statement: "% gives the remainder left over after whole-number division.",
    wrongAnswer: "the quotient instead of the remainder",
    card: "`%` gives what is LEFT OVER after whole-number division.\n"
      + "`13 % 4`: four fits into thirteen three times, using up `12`, so "
      + "`1` is left.\n\n```py\nprint(13 % 4)\n```\n\n"
      + "This prints `1` — the remainder, not the `3` whole times it fit.",
  },
  {
    tag: "000S",
    slug: "mod-sign-of-divisor",
    kind: "edge",
    parents: ["000R"],
    statement: "% takes the sign of the divisor, so -7 % 3 is 2.",
    wrongAnswer: "-1, taking the sign of the left operand",
    card: "In Python the result of `%` matches the sign of the RIGHT "
      + "number (the divisor), not the left one.\n"
      + "`-7 % 3`: to reach `-7` from a multiple of `3` going up, the "
      + "nearest multiple below is `-9`, and `-9 + 2` is `-7`.\n\n"
      + "```py\nprint(-7 % 3)\n```\n\n"
      + "This prints `2`, not `-1`. The answer is positive because `3` is "
      + "positive.",
  },
  {
    tag: "000T",
    slug: "str-of-int",
    kind: "core",
    parents: ["000K"],
    statement: "str(3) makes the text \"3\" out of the number 3.",
    wrongAnswer: "adds the numbers instead of joining text",
    card: "`str(3)` turns the number 3 into the text `\"3\"`. Once it is "
      + "text, `+` joins it to other text.\n\n"
      + "```py\nprint(str(3) + \"4\")\n```\n\n"
      + "This prints `34`: `str(3)` is `\"3\"`, joined to `\"4\"` — not `7`.",
  },
  {
    tag: "000V",
    slug: "int-of-str",
    kind: "core",
    parents: ["000K", "0008"],
    statement: "int(\"25\") makes the number 25 out of digit text.",
    wrongAnswer: "joins the text instead of adding numbers",
    card: "`int(\"25\")` turns the digit text `\"25\"` into the number 25. "
      + "Once it is a number, `+` adds.\n\n"
      + "```py\nprint(int(\"25\") + 1)\n```\n\n"
      + "This prints `26`: `int(\"25\")` is the number 25, and 25 + 1 is 26 "
      + "— not `\"251\"`.",
  },
  {
    tag: "000W",
    slug: "float-inexact",
    kind: "edge",
    parents: ["000P"],
    statement: "Floats are approximations; some results print with a long tail of digits.",
    wrongAnswer: "the short, exact-looking decimal",
    card: "Floats cannot store every decimal exactly. Some sums come out a "
      + "tiny bit off, and that shows as a long tail of digits.\n\n"
      + "```py\nprint(0.1 + 0.2)\n```\n\n"
      + "This prints `0.30000000000000004`, not `0.3` — the tail is the "
      + "rounding error.",
  },
  {
    tag: "000X",
    slug: "bool-is-int",
    kind: "edge",
    parents: ["0016", "0008"],
    statement: "True counts as 1 and False counts as 0 in arithmetic.",
    wrongAnswer: "an error, or the words joined like TrueTrue",
    card: "In arithmetic, `True` counts as 1 and `False` as 0. So you can "
      + "add them like numbers.\n\n```py\nprint(True + True)\n```\n\n"
      + "This prints `2`: each `True` counts as 1, and 1 + 1 is 2.",
  },
];
