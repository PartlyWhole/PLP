// The functions sub-graph, def/call/return half (expansion ladder §R4b,
// waves 1–3). Each concept here is wired together with its intro exercise in
// kb/exercises/functions.mjs and the analyzer rules that emit its tag
// (kb/analyzer/footprint.mjs: rule-def, rule-call, rule-param-bind,
// rule-args-first, rule-return-value, rule-return-vs-print,
// rule-return-exits, rule-call-in-expr, rule-none-fallthrough).
//
// Parent edges are FROZEN by the append-only ledger (CLAUDE.md invariant 10;
// check-ledger CI). One is redundant and deliberately kept: 002G's second
// parent 0008 (arith-on-ints) is already reachable through 002A → 0009 → 0008,
// so it adds no gating — ACCEPTED per the ladder's §R4b decision rather than
// edited, because any parents edit trips check-ledger.
//
// NOT wired here: 002D/002E (wave 4) and 002J (wave 5) — still in
// kb/concepts/pending.mjs with the reason each is waiting.

export default [
  {
    tag: "0027",
    slug: "def-defines-not-runs",
    kind: "core",
    parents: ["0005"],
    statement: "def stores the recipe under a name; its body does not run yet.",
    wrongAnswer: "the body's output appearing at def time",
    card: "`def` only STORES the steps under a name — like writing a recipe "
      + "down. Nothing in the body runs yet.\n\n"
      + "```py\ndef greet():\n    print(\"hi\")\nprint(\"done\")\n```\n\n"
      + "This prints just `done`: the body waits until someone calls "
      + "`greet()`.",
  },
  {
    tag: "0028",
    slug: "call-runs-body",
    kind: "core",
    parents: ["0027"],
    statement: "name() runs the stored body now, once per call.",
    wrongAnswer: "nothing, or the body running only once despite two calls",
    card: "Writing `greet()` — the name with parentheses — runs the stored "
      + "body right now. Each call runs it again.\n\n"
      + "```py\ndef greet():\n    print(\"hi\")\ngreet()\ngreet()\n```\n\n"
      + "This prints `hi` twice — one run per call.",
  },
  {
    tag: "0029",
    slug: "def-params-bind-args",
    kind: "core",
    parents: ["0028", "0006"],
    statement: "Calling f(v) binds the argument v to the parameter name for that run of the body.",
    wrongAnswer: "the parameter keeping an old or unrelated value",
    card: "A parameter is a name that gets its value at CALL time: `f(5)` "
      + "binds 5 to the parameter for that run.\n\n"
      + "```py\ndef double(n):\n    print(n * 2)\ndouble(5)\n```\n\n"
      + "This prints `10`: for this call, `n` holds 5.",
  },
  {
    tag: "002A",
    slug: "return-hands-back-value",
    kind: "core",
    parents: ["0028", "0009"],
    statement: "return hands one value back to the caller; the call expression becomes that value.",
    wrongAnswer: "the value printing by itself, or nothing coming back",
    card: "`return` hands a value BACK to whoever called. The call itself "
      + "becomes that value — nothing prints unless someone prints it.\n\n"
      + "```py\ndef double(n):\n    return n * 2\nx = double(5)\nprint(x)\n```\n\n"
      + "This prints `10`: the call became 10, and `x` stored it.",
  },
  {
    tag: "002B",
    slug: "return-vs-print",
    kind: "core",
    parents: ["002A"],
    statement: "print shows a value on the screen; return hands it back — a function that only prints hands back None.",
    wrongAnswer: "treating the printed text as the returned value",
    card: "`print` SHOWS a value; `return` HANDS IT BACK. They are "
      + "different jobs.\nA function that only prints hands back `None`.\n\n"
      + "```py\ndef shout():\n    print(\"hi\")\nx = shout()\nprint(x)\n```\n\n"
      + "This prints `hi` (from the call), then `None` — nothing was "
      + "returned, so that is what `x` got.",
  },
  {
    tag: "002C",
    slug: "return-exits-function",
    kind: "core",
    parents: ["002A"],
    statement: "return leaves the function immediately; lines after it do not run.",
    wrongAnswer: "the lines after return also running",
    card: "`return` ENDS the function run right there. Lines after it are "
      + "never reached.\n\n"
      + "```py\ndef f():\n    return 1\n    print(\"never\")\nprint(f())\n```\n\n"
      + "This prints just `1` — the `print(\"never\")` line never runs.",
  },
  {
    tag: "002F",
    slug: "args-evaluated-first",
    kind: "core",
    parents: ["0029", "0009"],
    statement: "Arguments are computed down to values before the call starts.",
    wrongAnswer: "the expression arriving unevaluated",
    card: "Before a call starts, Python computes each argument down to one "
      + "value — the function receives finished values, never the "
      + "calculation.\n\n"
      + "```py\ndef double(n):\n    return n * 2\nprint(double(2 + 3))\n```\n\n"
      + "This prints `10`: `2 + 3` became 5 first, then the call ran.",
  },
  {
    tag: "002G",
    slug: "call-in-expression",
    kind: "core",
    parents: ["002A", "0008"],
    statement: "A call is an expression: its returned value takes part in the surrounding calculation.",
    wrongAnswer: "the call's value ignored by the surrounding math",
    card: "A call slots into a bigger expression: the returned value takes "
      + "the call's place and the calculation continues.\n\n"
      + "```py\ndef double(n):\n    return n * 2\nprint(double(3) + 1)\n```\n\n"
      + "This prints `7`: `double(3)` became 6, then `6 + 1`.",
  },
  {
    tag: "002H",
    slug: "none-when-no-return",
    kind: "edge",
    parents: ["002B"],
    statement: "Falling off the end of a function (or a bare return) hands back None.",
    wrongAnswer: "the last computed value coming back by itself",
    card: "If a function ends without `return`ing a value, the caller gets "
      + "`None` — the last thing computed does NOT come back by itself.\n\n"
      + "```py\ndef f(n):\n    n * 2\nprint(f(3))\n```\n\n"
      + "This prints `None`: `n * 2` was computed and thrown away; nothing "
      + "was returned.",
  },
];
