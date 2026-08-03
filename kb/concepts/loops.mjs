// Loops & ranges concepts (design §3.7). loop-for-visits-each is the one
// design-flagged multi-line concept: several printed lines ARE the idea.

export default [
  {
    tag: "001E",
    slug: "loop-for-visits-each",
    kind: "core",
    parents: ["000D"],
    statement: "for x in xs: runs the body once per item, with x holding each item in turn.",
    wrongAnswer: "one run total, or the wrong number of runs",
    card: "`for x in xs:` runs the indented lines once for each item in "
      + "`xs`. Each time, `x` holds the next item.\n\n"
      + "```py\nfor x in [10, 20, 30]:\n    print(x)\n```\n\n"
      + "This prints three lines — `10`, then `20`, then `30`.",
  },
  {
    tag: "001F",
    slug: "range-stop-excluded",
    kind: "core",
    parents: ["001E"],
    statement: "range(n) counts 0, 1, …, n-1 — n itself is not included.",
    wrongAnswer: "includes n at the end",
    card: "`range(n)` counts up from 0 and STOPS before n. So it gives "
      + "`0, 1, …, n-1` — n itself is left out.\n\n"
      + "```py\nprint(list(range(5)))\n```\n\n"
      + "This prints `[0, 1, 2, 3, 4]` — five numbers, ending at 4, not 5.",
  },
  {
    tag: "001G",
    slug: "range-start-stop",
    kind: "core",
    parents: ["001F"],
    statement: "range(a, b) counts from a up to but not including b.",
    wrongAnswer: "includes b, or counts b−a+1 numbers",
    card: "`range(a, b)` starts at a and stops before b.\n\n"
      + "```py\nprint(list(range(2, 7)))\n```\n\n"
      + "This prints `[2, 3, 4, 5, 6]` — starts at 2, ends at 6, and 7 is "
      + "left out.",
  },
  {
    tag: "001H",
    slug: "range-step",
    kind: "core",
    parents: ["001G"],
    statement: "range(a, b, s) counts from a in steps of s, stopping before b.",
    wrongAnswer: "includes the endpoint, or uses the wrong step",
    card: "`range(a, b, s)` starts at a and adds s each time, stopping "
      + "before b.\n\n```py\nprint(list(range(1, 9, 2)))\n```\n\n"
      + "This prints `[1, 3, 5, 7]` — up in twos, stopping before 9.",
  },
  {
    tag: "001J",
    slug: "loop-accumulate",
    kind: "core",
    parents: ["001E", "000B"],
    statement: "A running total updates once per loop pass; its final value is there after the loop.",
    wrongAnswer: "an off-by-one total, or only the last value",
    card: "A running total starts before the loop and is updated once per "
      + "pass. After the loop, it holds the finished result.\n\n"
      + "```py\ntotal = 0\nfor x in [1, 2, 3]:\n    total = total + x\nprint(total)\n```\n\n"
      + "This prints `6`: 0, then 1, then 3, then 6.",
  },
  {
    tag: "001K",
    slug: "loop-build-list",
    kind: "core",
    parents: ["001E", "000G"],
    statement: "Appending once per pass grows a list one item per pass.",
    wrongAnswer: "the wrong length, or items in the wrong order",
    card: "Start with an empty list and append once per pass; it grows one "
      + "item at a time, in visiting order.\n\n"
      + "```py\nxs = []\nfor x in [1, 2, 3]:\n    xs.append(x)\nprint(xs)\n```\n\n"
      + "This prints `[1, 2, 3]` — one item added each pass.",
  },
  {
    tag: "001M",
    slug: "while-repeats-while-true",
    kind: "core",
    parents: ["0015", "000B"],
    statement: "while re-tests before every pass and stops the moment the test is False.",
    wrongAnswer: "one pass too many or one too few",
    card: "`while` checks its test BEFORE each pass. The moment the test "
      + "is False, it stops — it does not do one more pass.\n\n"
      + "```py\nn = 3\nwhile n > 0:\n    n = n - 1\nprint(n)\n```\n\n"
      + "This prints `0`: it stops as soon as `n` reaches 0.",
  },
  {
    tag: "001N",
    slug: "break-exits",
    kind: "core",
    parents: ["001E", "0017"],
    statement: "break leaves the whole loop immediately.",
    wrongAnswer: "the loop finishes the remaining items anyway",
    card: "`break` stops the whole loop at once. No more passes happen, "
      + "even if items remain.\n\n"
      + "```py\nfor x in [5, 6, 7]:\n    if x > 5:\n        break\n    print(x)\n```\n\n"
      + "This prints just `5`: at 6 the test is true, so `break` ends the "
      + "loop.",
  },
  {
    tag: "001P",
    slug: "continue-skips",
    kind: "core",
    parents: ["001E", "0017"],
    statement: "continue skips the rest of this pass and goes on to the next one.",
    wrongAnswer: "the loop exits instead of continuing",
    card: "`continue` skips the rest of THIS pass and jumps to the next "
      + "item. The loop keeps going.\n\n"
      + "```py\nfor x in [1, 2]:\n    if x == 1:\n        continue\n    print(x)\n```\n\n"
      + "This prints just `2`: the pass for 1 is skipped, but the loop goes "
      + "on.",
  },
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
  },
];
