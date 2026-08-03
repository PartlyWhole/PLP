// Minted-but-not-yet-wired concepts: their tags are permanently allocated
// in kb/tags.ledger.json and their prose is authored here, but this module
// is deliberately NOT imported by kb/index.mjs — loading a concept without
// an intro exercise would (correctly) fail inv 12 (K-7). The ledger running
// ahead of the loaded set is the designed mechanism for this (K-1 is
// directional; CLAUDE.md invariant 10). Wire each concept into loadKB()
// only together with its intro exercise.
//
// - 0026 input-pauses-for-value: needs an ask form that can supply stdin
//   during grading (predict-output with a scripted input line) before an
//   exercise is honest — the drill contract currently forbids input().
//   Until then, u1's input-boundary steps grant nothing (lesson-kb-binding
//   §3 known gap, now half-closed: the tag exists).
// - 0027–002J, the functions sub-graph (~12 nodes, design §2.4 expansion
//   headroom): exercises are explicitly out of scope for phase 5; they need
//   the analyzer to grow def/call/return/scope support first (a §4.1
//   grammar extension of the same shape as the phase-3 one).

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
