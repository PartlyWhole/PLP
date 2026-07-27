// Drill bank: parameterized exercise templates for the tutor's drill mode.
//
// Each template is a tiny PROGRAM GENERATOR targeting one idea (trajectory
// + sources: design/tutor-plan.md §7, python_exercises.md). Variations come
// from a seeded RNG over the template's parameter space; the generated
// program is loaded, run, and graded by the engine — ground truth is what
// Python actually does, so an authored answer key cannot exist, let alone
// be wrong.
//
// TWO LEVELS, ONE QUESTION AT A TIME:
//  - level "core": basic understanding — the bread-and-butter mechanics a
//    student must be fluent in (assign/read, output, indexing, branches,
//    loops). Most of every round (weighted 3:1).
//  - level "edge": the corner-case long tail (negative floor division,
//    aliasing, shallow copies, truthiness traps, …).
//  - Every generated program asks exactly ONE thing: it produces exactly
//    one line of output (a template whose variation space covers several
//    aspects prints ONE of them per question, chosen by the RNG). The sole
//    exception is flagged `multiline: true` (print-returns-None, where the
//    two lines ARE the concept). tests enforce the one-line invariant.
//
// Generator rules (why every template looks the way it does):
//  - deterministic under a seed (mulberry32), so tests and rebuilt drill
//    sessions reproduce exactly;
//  - always prints something (a program whose entire output is empty makes
//    predict-output unbuildable);
//  - deterministic output only: no sets in prints, no id()/is on cached
//    ints (is on LISTS is fine and used), no input(), no exceptions
//    (tracebacks are not typeable answers);
//  - small enough to trace (learner-scale, far under the step budget).
//
// `explain` is the first-principles scaffold shown after a miss, with
// runnable ```py fences.
//
// buildDrillLesson compiles a seeded, stats-weighted question round into an
// ordinary lesson script (app/TUTOR.md step vocabulary), so drills reuse
// the whole lesson machinery: popup beats, retry, persistence, restore.

import { mulberry32 } from "./questions.mjs";

const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export const drillTopics = [
  { id: "state", title: "State & I/O" },
  { id: "numbers", title: "Numbers & bools" },
  { id: "strings", title: "Strings" },
  { id: "lists", title: "Lists & aliasing" },
  { id: "logic", title: "Conditions & logic" },
  { id: "loops", title: "Loops & ranges" },
  { id: "structures", title: "Dicts & tuples" },
];

export const drillTemplates = {
  // ======================= STATE & I/O ====================================
  "assign-read": {
    topic: "state", level: "core",
    title: "Assign, then read",
    explain: "A name holds the value most recently assigned to it. Reading a name "
      + "gives back exactly what the state holds right now — and a second "
      + "assignment simply replaces the first.\n\n```py\nx = 3\nx = 8\nprint(x)\n```",
    generate(rng) {
      const a = int(rng, 2, 9), b = int(rng, 10, 20);
      const kind = pick(rng, ["single", "replace", "copy"]);
      if (kind === "single") return { code: `x = ${a}\nprint(x)\n` };
      if (kind === "replace") return { code: `x = ${a}\nx = ${b}\nprint(x)\n` };
      return { code: `x = ${a}\ny = x\nprint(y)\n` };
    },
  },
  "expr-eval": {
    topic: "state", level: "core",
    title: "Expressions read the current state",
    explain: "An expression is computed from the values the names hold at that "
      + "moment. `print(x + y)` reads both names, computes, and outputs the "
      + "result — the state itself doesn't change.",
    generate(rng) {
      const x = int(rng, 2, 7), y = int(rng, 2, 7);
      const expr = pick(rng, ["x + y", "x * y", "x - y", "x + y + x"]);
      return { code: `x = ${x}\ny = ${y}\nprint(${expr})\n` };
    },
  },
  "quoted-vs-name": {
    topic: "state", level: "core",
    title: "A name vs a string that looks like one",
    explain: "Quotes make TEXT. `print(\"x\")` outputs the one-character string "
      + "`x`; `print(x)` reads the NAME `x` from the state and outputs its "
      + "value. The quotes are the whole difference.",
    generate(rng) {
      const v = int(rng, 3, 9);
      const name = pick(rng, ["x", "n", "total"]);
      const quoted = rng() < 0.5;
      return { code: `${name} = ${v}\nprint(${quoted ? `"${name}"` : name})\n` };
    },
  },
  "state-rebind": {
    topic: "state", level: "core",
    title: "Values are captured at assignment time",
    explain: "A line changes the state only when it runs, and a binding takes the "
      + "values as they are **at that moment**. `b = a * 3` copied the result into "
      + "`b`; changing `a` afterwards does NOT reach back and update `b`.\n\n"
      + "```py\na = 2\nb = a * 3\na = a + 1\nprint(b)\n```",
    generate(rng) {
      const kind = pick(rng, ["capture", "read-then-change", "chain"]);
      if (kind === "capture") {
        const a = int(rng, 2, 5), k = int(rng, 2, 4), inc = int(rng, 1, 3);
        return { code: `a = ${a}\nb = a * ${k}\na = a + ${inc}\nprint(${pick(rng, ["b", "a"])})\n` };
      }
      if (kind === "read-then-change") {
        const x = int(rng, 2, 5), add = int(rng, 2, 6), nx = int(rng, 8, 12);
        return { code: `x = ${x}\ny = x + ${add}\nx = ${nx}\nprint(x + y)\n` };
      }
      const x = int(rng, 1, 4);
      return { code: `x = ${x}\ny = x\nx = ${int(rng, 6, 9)}\nprint(y)\n` };
    },
  },
  "state-accumulate": {
    topic: "state", level: "core",
    title: "Read-then-write updates",
    explain: "`total = total + 5` READS the current value, computes, then WRITES "
      + "the result back — the right side always runs first, using the old state. "
      + "Trace it as a table, one row per line.",
    generate(rng) {
      const start = int(rng, 0, 3);
      const nSteps = int(rng, 1, 4);
      const lines = [`total = ${start}`];
      for (let i = 0; i < nSteps; i++) {
        const op = pick(rng, ["+", "*", "-"]);
        const v = op === "*" ? int(rng, 2, 3) : int(rng, 2, 9);
        lines.push(`total = total ${op} ${v}`);
      }
      lines.push("print(total)");
      return { code: lines.join("\n") + "\n" };
    },
  },
  "print-output": {
    topic: "state", level: "core",
    title: "What print actually emits",
    explain: "`print` with commas puts exactly ONE space between the pieces (any "
      + "types welcome). `+` concatenates strings exactly as written, with no "
      + "space — and numbers need `str(...)` first.\n\n"
      + "```py\nx = 7\nprint(\"x is\", x)\nprint(\"x is \" + str(x))\n```",
    generate(rng) {
      const x = int(rng, 3, 9);
      const kind = pick(rng, ["comma", "concat", "multi"]);
      const label = pick(rng, ["x is", "value:", "got"]);
      if (kind === "comma") return { code: `x = ${x}\nprint("${label}", x)\n` };
      if (kind === "concat") return { code: `x = ${x}\nprint("${label}" + str(x))\n` };
      return { code: `x = ${x}\nprint(x, x + 1, x * 2)\n` };
    },
  },
  "state-swap": {
    topic: "state", level: "edge",
    title: "Sequential assignment vs the tuple swap",
    explain: "`a = b` then `b = a` does NOT swap: the first line already overwrote "
      + "`a`, so the second copies the new value back — both names end up equal. "
      + "A real swap needs a temp, or `a, b = b, a`, where the whole right side is "
      + "evaluated FIRST with the old values and then unpacked.",
    generate(rng) {
      const a = int(rng, 1, 4), b = int(rng, 5, 9);
      const kind = pick(rng, ["sequential", "temp", "tuple"]);
      const body = {
        sequential: "a = b\nb = a",
        temp: "t = a\na = b\nb = t",
        tuple: "a, b = b, a",
      }[kind];
      return { code: `a = ${a}\nb = ${b}\n${body}\nprint(a, b)\n` };
    },
  },
  "print-quirks": {
    topic: "state", level: "edge",
    title: "Adjacent literals; print returns None",
    explain: "Two string literals side by side merge at PARSE time: `\"py\" "
      + "\"thon\"` is one string, no comma, no space. And `print(...)` returns "
      + "`None` — printing is output, not a value you can keep.\n\n"
      + "```py\nresult = print(\"hi\")\nprint(result)\n```",
    generate(rng) {
      if (rng() < 0.5) {
        const [w1, w2] = pick(rng, [["py", "thon"], ["note", "book"], ["net", "work"]]);
        return { code: `print("${w1}" "${w2}")\n` };
      }
      const word = pick(rng, ["hi", "ok", "yes"]);
      return { code: `result = print("${word}")\nprint(result)\n`, multiline: true };
    },
  },

  // ======================= NUMBERS & BOOLS ================================
  "arith-basics": {
    topic: "numbers", level: "core",
    title: "Arithmetic and precedence",
    explain: "`*` and `/` bind tighter than `+` and `-`; parentheses override; "
      + "`**` is power. When unsure, add the parentheses Python is already "
      + "assuming: `7 + 3 * 2` is `7 + (3 * 2)`.",
    generate(rng) {
      const a = int(rng, 2, 7), b = int(rng, 2, 5), c = int(rng, 2, 4);
      const expr = pick(rng, [
        `${a} + ${b} * ${c}`, `(${a} + ${b}) * ${c}`, `${a} * ${b} - ${c}`,
        `${a} ** 2`, `${a} - ${b} - ${c}`, `2 ** ${int(rng, 2, 4)}`,
      ]);
      return { code: `print(${expr})\n` };
    },
  },
  "division-types": {
    topic: "numbers", level: "core",
    title: "/, //, % — and their result types",
    explain: "`/` ALWAYS gives a float — even `10 / 2` is `5.0`. `//` is "
      + "whole-number division (how many fit), `%` is the remainder. Keeping "
      + "track of which type comes out is half of numeric fluency.\n\n"
      + "```py\nprint(10 / 2)\nprint(10 // 3)\nprint(10 % 3)\n```",
    generate(rng) {
      const b = pick(rng, [2, 3, 4, 5]);
      const op = pick(rng, ["/", "//", "%", "/"]);
      // "/" always yields a float — keep it a CLEAN one (x.0) so the core
      // lesson is the type, not decimal expansion (that's float-precision).
      const a = op === "/" ? b * int(rng, 2, 4)
        : b * int(rng, 2, 4) + pick(rng, [0, 1, int(rng, 1, b - 1)]);
      return { code: `print(${a} ${op} ${b})\n` };
    },
  },
  "conversions": {
    topic: "numbers", level: "core",
    title: "int(), str(), float() conversions",
    explain: "`int(\"5\")` parses text into a number; `str(3)` renders a number as "
      + "text — and then `+` means concatenation, not addition. `int(3.9)` "
      + "truncates toward zero (it does not round).\n\n"
      + "```py\nprint(int(\"5\") + 2)\nprint(str(3) + \"4\")\nprint(int(3.9))\n```",
    generate(rng) {
      const n = int(rng, 2, 8);
      const kind = pick(rng, ["parse", "render", "trunc", "tofloat"]);
      if (kind === "parse") return { code: `print(int("${n}") + ${int(rng, 1, 5)})\n` };
      if (kind === "render") return { code: `print(str(${n}) + "${int(rng, 1, 9)}")\n` };
      if (kind === "trunc") return { code: `print(int(${n}.${pick(rng, [9, 5, 2])}))\n` };
      return { code: `print(float(${n}))\n` };
    },
  },
  "int-div-mod": {
    topic: "numbers", level: "edge",
    title: "Floor division and modulo with negatives",
    explain: "The invariant that never breaks: `(a // b) * b + (a % b) == a`. "
      + "Python's `//` rounds toward **negative infinity** (floor), not toward "
      + "zero, and `a % b` always has the **same sign as `b`**.\n\n"
      + "```py\nprint(-7 / 2)   # -3.5\nprint(-7 // 2)  # floor(-3.5) is -4, NOT -3\nprint(-7 % 2)   # -7 - (-4)*2 = 1\n```",
    generate(rng) {
      const b = pick(rng, [2, 3, 4, 5, 7]);
      const mag = int(rng, 1, 4) * b + int(rng, 1, b - 1); // never a multiple
      const [sa, sb] = pick(rng, [[-1, 1], [1, -1], [-1, -1], [-1, 1], [1, -1], [1, 1]]);
      const op = pick(rng, ["//", "%"]);
      return { code: `a = ${sa * mag}\nb = ${sb * b}\nprint(a ${op} b)\n` };
    },
  },
  "float-precision": {
    topic: "numbers", level: "edge",
    title: "Floats are not exact",
    explain: "Many decimals have no finite **binary** expansion — `0.1` is already "
      + "an approximation before any math happens, and errors compound. Some sums "
      + "(halves, quarters, eighths) ARE exact. Never `==` computed floats:\n\n"
      + "```py\nprint(0.1 + 0.2)\nimport math\nprint(math.isclose(0.1 + 0.2, 0.3))\n```",
    generate(rng) {
      const [a, b, c] = pick(rng, [
        ["0.1", "0.2", "0.3"], ["0.1", "0.1", "0.2"], ["0.25", "0.5", "0.75"],
        ["0.1", "0.7", "0.8"], ["0.5", "0.125", "0.625"], ["0.2", "0.4", "0.6"],
      ]);
      const kind = pick(rng, ["eq", "sum"]);
      if (kind === "eq") return { code: `x = ${a} + ${b}\nprint(x == ${c})\n` };
      return { code: `print(${a} + ${b})\n` };
    },
  },
  "bool-is-int": {
    topic: "numbers", level: "edge",
    title: "bool is a kind of int",
    explain: "`bool` is a subclass of `int`: `True` is 1 and `False` is 0, so "
      + "arithmetic and equality just work. This gives the counting idiom "
      + "`sum(condition for x in items)`.\n\n"
      + "```py\nprint(True + True)\nprint(sum([True, False, True, True]))\n```",
    generate(rng) {
      const kind = pick(rng, ["plus", "sum", "eq"]);
      if (kind === "plus") {
        const n = int(rng, 2, 4);
        return { code: `print(${Array.from({ length: n }, () => pick(rng, ["True", "False"])).join(" + ")})\n` };
      }
      if (kind === "sum") {
        const flags = Array.from({ length: int(rng, 3, 6) }, () => pick(rng, ["True", "False"]));
        return { code: `flags = [${flags.join(", ")}]\nprint(sum(flags))\n` };
      }
      return { code: `print(True == ${pick(rng, ["1", "2", "0"])})\n` };
    },
  },

  // ======================= STRINGS ========================================
  "str-basics": {
    topic: "strings", level: "core",
    title: "len, concat, repeat, case, in",
    explain: "`len(s)` counts characters. `+` glues strings exactly as written; "
      + "`*` repeats. `.upper()`/`.lower()` return a NEW string. `\"an\" in s` "
      + "asks whether the substring occurs.",
    generate(rng) {
      const w = pick(rng, ["banana", "python", "stream", "cat", "hello"]);
      const kind = pick(rng, ["len", "concat", "repeat", "case", "in"]);
      if (kind === "len") return { code: `s = "${w}"\nprint(len(s))\n` };
      if (kind === "concat") {
        const t = pick(rng, ["fish", "dog", "net"]);
        return { code: `s = "${w}"\nt = "${t}"\nprint(s + t)\n` };
      }
      if (kind === "repeat") return { code: `print("${w.slice(0, 2)}" * ${int(rng, 2, 4)})\n` };
      if (kind === "case") {
        const method = pick(rng, ["upper", "lower"]);
        const word = method === "lower" ? w.toUpperCase() : w;
        return { code: `print("${word}".${method}())\n` };
      }
      const sub = pick(rng, [w.slice(1, 3), "zz", w.slice(0, 2)]);
      return { code: `print("${sub}" in "${w}")\n` };
    },
  },
  "str-index": {
    topic: "strings", level: "core",
    title: "Indexing characters",
    explain: "Positions count from 0: `s[0]` is the first character, `s[2]` the "
      + "third. Negative indices count from the end: `s[-1]` is defined as "
      + "`s[len(s) - 1]` — the last character.",
    generate(rng) {
      const w = pick(rng, ["python", "banana", "wizard", "carpet"]);
      const idx = pick(rng, ["0", "1", "2", "-1", "-2", String(w.length - 1)]);
      return { code: `s = "${w}"\nprint(s[${idx}])\n` };
    },
  },
  "str-compare": {
    topic: "strings", level: "edge",
    title: "String comparison is by code points",
    explain: "Strings compare character-by-character using each character's numeric "
      + "code (`ord`). ALL uppercase letters sort before all lowercase, and digits "
      + "compare as characters — `\"10\" < \"9\"` is True because `'1' < '9'` at "
      + "position 0; length never gets a say.\n\n"
      + "```py\nprint(ord('Z'), ord('a'))\nprint(ord('1'), ord('9'))\n```",
    generate(rng) {
      const [x, y] = pick(rng, [
        ['"10"', '"9"'], ['"100"', '"2"'], ['"Zebra"', '"apple"'],
        ['"apple"', '"banana"'], ['"app"', '"apple"'], ['"ABC"', '"abc"'],
        ['"img12"', '"img9"'],
      ]);
      return { code: `print(${x} < ${y})\n` };
    },
  },
  "str-slice": {
    topic: "strings", level: "edge",
    title: "Half-open slices and steps",
    explain: "Think of positions BETWEEN characters: `s[a:b]` includes `a`, "
      + "excludes `b`, so its length is `b - a` and `s[:k] + s[k:]` tiles "
      + "perfectly. The third slot is the step; `-1` walks backward.\n\n"
      + "```py\ns = \"python\"\nprint(s[1:4])\nprint(s[::-1])\n```",
    generate(rng) {
      const w = pick(rng, ["python", "banana", "wizard", "stream", "carpet"]);
      const op = pick(rng, ["[1:4]", "[:3]", "[3:]", "[::-1]", "[::2]", "[-3:]", "[1:]"]);
      return { code: `s = "${w}"\nprint(s${op})\n` };
    },
  },
  "str-rebind": {
    topic: "strings", level: "edge",
    title: "Strings are immutable; names rebind",
    explain: "`s[0] = ...` would fail — strings never change. `s = \"b\" + s[1:]` "
      + "builds a **new** string and re-points the name `s`; any other name still "
      + "points at the old, unchanged string.\n\n"
      + "```py\ns = \"cat\"\nt = s\ns = \"b\" + s[1:]\nprint(s, t)\n```",
    generate(rng) {
      const w = pick(rng, ["cat", "map", "sun", "dog", "cup"]);
      const ch = pick(rng, ["b", "r", "t", "h"]);
      return { code: `s = "${w}"\nt = s\ns = "${ch}" + s[1:]\nprint(${pick(rng, ["s", "t"])})\n` };
    },
  },

  // ======================= LISTS ==========================================
  "list-basics": {
    topic: "lists", level: "core",
    title: "Indexing, length, sum, max",
    explain: "`nums[1]` is the SECOND element (positions count from 0); "
      + "`nums[-1]` the last. `len` counts elements; `sum`/`max`/`min` fold the "
      + "whole list into one value.",
    generate(rng) {
      const nums = Array.from({ length: int(rng, 3, 5) }, () => int(rng, 1, 9));
      const kind = pick(rng, ["index", "neg", "len", "sum", "max"]);
      const op = {
        index: `nums[${int(rng, 0, nums.length - 1)}]`,
        neg: "nums[-1]",
        len: "len(nums)",
        sum: "sum(nums)",
        max: pick(rng, ["max(nums)", "min(nums)"]),
      }[kind];
      return { code: `nums = [${nums.join(", ")}]\nprint(${op})\n` };
    },
  },
  "list-mutate": {
    topic: "lists", level: "core",
    title: "Changing a list in place",
    explain: "`append` adds one element at the end; `nums[i] = v` replaces the "
      + "element at position i. Both change the SAME list object — no new list is "
      + "made, no assignment to the name needed.",
    generate(rng) {
      const nums = Array.from({ length: 3 }, () => int(rng, 1, 9));
      const v = int(rng, 10, 99);
      const kind = pick(rng, ["append", "setitem", "pop"]);
      const op = {
        append: `nums.append(${v})`,
        setitem: `nums[${int(rng, 0, 2)}] = ${v}`,
        pop: "nums.pop()",
      }[kind];
      return { code: `nums = [${nums.join(", ")}]\n${op}\nprint(nums)\n` };
    },
  },
  "grid-basics": {
    topic: "lists", level: "core",
    title: "Reading a 2D grid",
    explain: "A grid is a list OF lists: `grid[1]` is the whole second row; "
      + "`grid[1][0]` first picks the row, then indexes into it. `len(grid)` "
      + "counts rows; `len(grid[0])` counts the first row's columns.",
    generate(rng) {
      const g = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => int(rng, 1, 9)));
      const lit = `[[${g[0].join(", ")}], [${g[1].join(", ")}]]`;
      const op = pick(rng, ["grid[1][0]", "grid[0][1]", "grid[1]", "len(grid)", "len(grid[0])"]);
      return { code: `grid = ${lit}\nprint(${op})\n` };
    },
  },
  "alias-mutate": {
    topic: "lists", level: "edge",
    title: "Two names, one list",
    explain: "Assignment copies the **reference**, not the list: after `b = a` "
      + "there is ONE list with two names, so mutating through either name shows "
      + "through both. A full slice `a[:]` builds a genuinely new list. "
      + "`b = b + [x]` REBINDS `b` (a unchanged); `b += [x]` MUTATES the shared "
      + "one.\n\n```py\na = [1, 2]\nb = a\nb.append(3)\nprint(a, b, a is b)\n```",
    generate(rng) {
      const base = `[${int(rng, 1, 5)}, ${int(rng, 6, 9)}]`;
      const x = int(rng, 10, 99);
      const kind = pick(rng, ["alias", "copy", "plus", "aug"]);
      const op = {
        alias: `b = a\nb.append(${x})`,
        copy: `b = a[:]\nb.append(${x})`,
        plus: `b = a\nb = b + [${x}]`,
        aug: `b = a\nb += [${x}]`,
      }[kind];
      const focus = pick(rng, ["a", "b", "a is b"]);
      return { code: `a = ${base}\n${op}\nprint(${focus})\n` };
    },
  },
  "grid-2d": {
    topic: "lists", level: "edge",
    title: "Shallow copies share the rows",
    explain: "`grid[:]` copies only the OUTER list — both lists hold the same row "
      + "objects, so writing through one shows in the other. `[row] * 3` is three "
      + "references to ONE row. Independent rows need the comprehension form.\n\n"
      + "```py\nrow = [0, 0]\ngrid = [row] * 3\nprint(grid[0] is grid[1])\n```",
    generate(rng) {
      const v = int(rng, 5, 9);
      const kind = pick(rng, ["slice-copy", "star", "compr"]);
      if (kind === "slice-copy") {
        return { code: `grid = [[0, 0], [0, 0]]\ncopy = grid[:]\ncopy[0][0] = ${v}\nprint(${pick(rng, ["grid", "copy"])})\n` };
      }
      if (kind === "star") {
        return { code: `row = [0, 0]\ngrid = [row] * ${int(rng, 2, 3)}\ngrid[0][0] = ${v}\nprint(grid)\n` };
      }
      return { code: `grid = [[0, 0] for _ in range(3)]\ngrid[0][0] = ${v}\nprint(grid)\n` };
    },
  },
  "append-extend": {
    topic: "lists", level: "edge",
    title: "append vs extend vs insert",
    explain: "`append` adds ONE element — even when that element is a whole list "
      + "(making a nested list). `extend` adds EACH element. `insert(0, x)` "
      + "pushes in at a position.\n\n"
      + "```py\na = [1, 2]\na.append([3, 4])\nprint(a)      # [1, 2, [3, 4]]\nb = [1, 2]\nb.extend([3, 4])\nprint(b)      # [1, 2, 3, 4]\n```",
    generate(rng) {
      const x = int(rng, 3, 6), y = int(rng, 7, 9);
      const op = pick(rng, [
        `a.append([${x}, ${y}])`, `a.extend([${x}, ${y}])`,
        `a.append(${x})`, `a.insert(0, ${x})`,
      ]);
      const focus = pick(rng, ["a", "len(a)"]);
      return { code: `a = [1, 2]\n${op}\nprint(${focus})\n` };
    },
  },
  "remove-while-iterating": {
    topic: "lists", level: "edge",
    title: "Mutating the list you're iterating",
    explain: "The for-loop is an index counter in disguise. Every `remove` shifts "
      + "the tail LEFT while the index marches RIGHT, so the element after each "
      + "removed one is never examined — adjacent odd numbers survive. Fix: build "
      + "the list you want, or iterate a frozen copy.\n\n"
      + "```py\nnums = [x for x in [1, 3, 2, 5, 7, 4] if x % 2 == 0]\nprint(nums)\n```",
    generate(rng) {
      const nums = Array.from({ length: 6 }, () => int(rng, 1, 9));
      return { code: `nums = [${nums.join(", ")}]\nfor x in nums:\n    if x % 2 == 1:\n        nums.remove(x)\nprint(nums)\n` };
    },
  },

  // ======================= CONDITIONS & LOGIC =============================
  "compare-basics": {
    topic: "logic", level: "core",
    title: "Comparisons produce True/False",
    explain: "A comparison is an expression like any other — it computes a value, "
      + "and that value is `True` or `False` (capitalized, no quotes). `==` asks "
      + "equal; `!=` asks not-equal.",
    generate(rng) {
      const x = int(rng, 1, 9), k = int(rng, 1, 9);
      const op = pick(rng, [">", "<", ">=", "<=", "==", "!="]);
      return { code: `x = ${x}\nprint(x ${op} ${k})\n` };
    },
  },
  "if-else": {
    topic: "logic", level: "core",
    title: "Which branch runs?",
    explain: "`if` tests the condition against the CURRENT state: exactly one of "
      + "the two branches runs. Nothing about the untaken branch executes at all.",
    generate(rng) {
      const x = int(rng, 1, 12), k = int(rng, 3, 9);
      const op = pick(rng, [">", "<", ">="]);
      const [big, small] = pick(rng, [["big", "small"], ["yes", "no"], ["high", "low"]]);
      return {
        code: `x = ${x}\nif x ${op} ${k}:\n    print("${big}")\nelse:\n    print("${small}")\n`,
      };
    },
  },
  "elif-chain": {
    topic: "logic", level: "core",
    title: "elif chains stop at the first hit",
    explain: "An `if/elif/else` chain tests top to bottom and runs ONLY the first "
      + "branch whose condition is true — everything below is skipped, even if it "
      + "would also be true. Order is priority.",
    generate(rng) {
      const score = pick(rng, [95, 85, 75, 65, 90, 70, 55]);
      return {
        code: `score = ${score}\nif score >= 90:\n    print("A")\nelif score >= 70:\n    print("B")\nelif score >= 50:\n    print("C")\nelse:\n    print("F")\n`,
      };
    },
  },
  "bool-ops": {
    topic: "logic", level: "core",
    title: "and, or, not with comparisons",
    explain: "`and` needs BOTH sides true; `or` needs at least one; `not` flips. "
      + "With comparisons on both sides the result is a plain `True`/`False`.",
    generate(rng) {
      const x = int(rng, 1, 12);
      const a = int(rng, 2, 6), b = int(rng, 7, 11);
      const expr = pick(rng, [
        `x > ${a} and x < ${b}`, `x < ${a} or x > ${b}`,
        `not x > ${a}`, `x >= ${a} and x != ${b}`,
      ]);
      return { code: `x = ${x}\nprint(${expr})\n` };
    },
  },
  "truthiness": {
    topic: "logic", level: "edge",
    title: "What counts as False",
    explain: "Falsy = zero of any numeric type, empty container/string, `None`, "
      + "`False`. Everything else is truthy — including `\"0\"` (a non-empty "
      + "string), `[0]` and `[[]]` (non-empty lists), and `\" \"` (a space is a "
      + "character). Truthiness looks at the container, never inside it.",
    generate(rng) {
      const v = pick(rng, ['"0"', "0", "0.0", '""', "[]", "[0]", '" "', "[[]]", '"False"', "None", "[None]"]);
      return { code: `x = ${v}\nif x:\n    print("truthy")\nelse:\n    print("falsy")\n` };
    },
  },
  "and-or-values": {
    topic: "logic", level: "edge",
    title: "and/or return operands",
    explain: "`a or b`: if `a` is truthy the result is **a** (b never runs); else "
      + "**b**. `a and b`: if `a` is falsy the result is **a**; else **b**. "
      + "Neither converts anything to True/False — they hand back an operand. "
      + "That's why `0 or \"default\"` is the default-value idiom.",
    generate(rng) {
      const expr = pick(rng, [
        '0 or "default"', '"hi" and 42', "None or [] or 0", "[] and [1]",
        "0 and 99", "1 or 99", '"a" or "b"', '[0] and "yes"', "None or 7",
      ]);
      return { code: `print(${expr})\n` };
    },
  },
  "chained-compare": {
    topic: "logic", level: "edge",
    title: "Chained comparisons",
    explain: "`a OP1 b OP2 c` means `(a OP1 b) and (b OP2 c)` with `b` evaluated "
      + "once. `==` and `in` are BOTH comparison operators, so they chain too: "
      + "`False == False in [False]` means `(False == False) and (False in "
      + "[False])` — both True.",
    generate(rng) {
      if (rng() < 0.2) return { code: `print(False == False in [False])\n` };
      const x = int(rng, 0, 12);
      const expr = pick(rng, ["1 < x < 10", "10 > x > 1", "1 < x > 3", "0 < x < 5 < 100", "x < 5 > 2"]);
      return { code: `x = ${x}\nprint(${expr})\n` };
    },
  },

  // ======================= LOOPS & RANGES =================================
  "loop-accumulate": {
    topic: "loops", level: "core",
    title: "The accumulator pattern",
    explain: "A running value updated once per element: start at the identity "
      + "(`0` for sums, `1` for products), update each time around, read the "
      + "answer after the loop. This one skeleton is sum, count, max, and "
      + "\"join\" — learn it once.",
    generate(rng) {
      const kind = pick(rng, ["count", "sum-range", "sum-list"]);
      if (kind === "count") {
        return { code: `count = 0\nfor i in range(${int(rng, 3, 6)}):\n    count = count + 1\nprint(count)\n` };
      }
      if (kind === "sum-range") {
        return { code: `total = 0\nfor i in range(${int(rng, 3, 5)}):\n    total = total + i\nprint(total)\n` };
      }
      const nums = Array.from({ length: 3 }, () => int(rng, 1, 8));
      return { code: `total = 0\nfor n in [${nums.join(", ")}]:\n    total = total + n\nprint(total)\n` };
    },
  },
  "loop-build": {
    topic: "loops", level: "core",
    title: "Building a list in a loop",
    explain: "Start with an empty list, `append` one result per element, read the "
      + "finished list after the loop. The transform runs once per element, in "
      + "order.",
    generate(rng) {
      const nums = Array.from({ length: 3 }, () => int(rng, 1, 6));
      const op = pick(rng, ["n * 2", "n + 1", "n * n"]);
      return { code: `out = []\nfor n in [${nums.join(", ")}]:\n    out.append(${op})\nprint(out)\n` };
    },
  },
  "while-basic": {
    topic: "loops", level: "core",
    title: "while runs until the condition fails",
    explain: "Each time around, the condition is re-checked against the CURRENT "
      + "state. The loop body must move the state toward making the condition "
      + "false — then the first check that fails exits, and the state at that "
      + "moment is what remains.",
    generate(rng) {
      const start = int(rng, 5, 9);
      const step = pick(rng, [2, 3]);
      const kind = pick(rng, ["countdown", "grow"]);
      if (kind === "countdown") {
        return { code: `n = ${start}\nwhile n > 0:\n    n = n - ${step}\nprint(n)\n` };
      }
      return { code: `n = 1\nwhile n < ${start}:\n    n = n * 2\nprint(n)\n` };
    },
  },
  "range-basics": {
    topic: "loops", level: "core",
    title: "What range produces",
    explain: "`range(n)` counts `0` up to `n - 1` — n numbers, stop excluded. "
      + "`range(a, b)` starts at `a`, still excludes `b`.",
    generate(rng) {
      if (rng() < 0.5) return { code: `print(list(range(${int(rng, 3, 6)})))\n` };
      const a = int(rng, 1, 4);
      return { code: `print(list(range(${a}, ${a + int(rng, 2, 4)})))\n` };
    },
  },
  "range-edge": {
    topic: "loops", level: "edge",
    title: "Empty and descending ranges",
    explain: "A range whose default `+1` step can never move start toward stop is "
      + "silently EMPTY — `range(5, 1)` runs zero times, no error (a quiet bug "
      + "generator). Counting down needs an explicit negative step, stop still "
      + "excluded.",
    generate(rng) {
      if (rng() < 0.5) {
        const a = int(rng, 4, 8);
        return { code: `print(list(range(${a}, ${a - int(rng, 1, 3)})))\n` };
      }
      return { code: `print(list(range(${pick(rng, [10, 8, 9])}, 0, -${pick(rng, [2, 3])})))\n` };
    },
  },
  "break-continue": {
    topic: "loops", level: "edge",
    title: "break vs continue",
    explain: "`break` leaves the loop entirely — later values are never seen. "
      + "`continue` abandons only THIS iteration and jumps to the next. Trace it "
      + "as a table, one row per iteration.",
    generate(rng) {
      const hi = int(rng, 5, 7);
      const trig = int(rng, 2, hi - 1);
      const kw = pick(rng, ["break", "continue"]);
      return {
        code: `seen = []\nfor i in range(1, ${hi}):\n    if i == ${trig}:\n        ${kw}\n    seen.append(i)\nprint(seen)\n`,
      };
    },
  },
  "for-else": {
    topic: "loops", level: "edge",
    title: "The loop else (nobreak)",
    explain: "The `else` block runs iff the loop finished WITHOUT hitting `break` "
      + "— read it as \"nobreak\". It's the built-in version of the manual "
      + "`found = False` flag.",
    generate(rng) {
      const items = Array.from({ length: 3 }, () => int(rng, 1, 8) * 2);
      const present = rng() < 0.5;
      const target = present ? pick(rng, items) : int(rng, 1, 8) * 2 + 1;
      return {
        code: `for x in [${items.join(", ")}]:\n    if x == ${target}:\n        print("found", x)\n        break\nelse:\n    print("not found")\n`,
      };
    },
  },

  // ======================= DICTS & TUPLES =================================
  "dict-read": {
    topic: "structures", level: "core",
    title: "Reading a dict",
    explain: "`d[key]` looks up the value stored under that key; `len(d)` counts "
      + "the key–value pairs. Keys are how you name your way into the data.",
    generate(rng) {
      const ks = pick(rng, [["a", "b"], ["x", "y"], ["cat", "dog"]]);
      const v1 = int(rng, 1, 9), v2 = int(rng, 10, 20);
      const op = pick(rng, [`d["${ks[0]}"]`, `d["${ks[1]}"]`, "len(d)"]);
      return { code: `d = {"${ks[0]}": ${v1}, "${ks[1]}": ${v2}}\nprint(${op})\n` };
    },
  },
  "tuple-read": {
    topic: "structures", level: "core",
    title: "Reading a tuple",
    explain: "Tuples index exactly like lists — positions from 0, negatives from "
      + "the end — they just can't be changed afterwards.",
    generate(rng) {
      const t = Array.from({ length: 3 }, () => int(rng, 1, 9));
      const op = pick(rng, ["t[0]", "t[1]", "t[2]", "t[-1]", "len(t)"]);
      return { code: `t = (${t.join(", ")})\nprint(${op})\n` };
    },
  },
  "dict-edge": {
    topic: "structures", level: "edge",
    title: "What `in` checks; get with defaults",
    explain: "`in` on a dict checks **keys**, never values. `d[k]` raises on a "
      + "missing key; `d.get(k, default)` doesn't — which is why "
      + "`counts[ch] = counts.get(ch, 0) + 1` is the counting idiom.",
    generate(rng) {
      const k1 = pick(rng, ['"a"', '"x"', '"key"']);
      const v1 = int(rng, 1, 9);
      const v2 = int(rng, 1, 9);
      const d = `d = {${k1}: ${v1}, "b": ${v2}}`;
      const kind = pick(rng, ["in-key", "in-value", "get-missing", "count"]);
      if (kind === "in-key") return { code: `${d}\nprint(${k1} in d)\n` };
      if (kind === "in-value") return { code: `${d}\nprint(${v1} in d)\n` };
      if (kind === "get-missing") return { code: `${d}\nprint(d.get("missing", ${int(rng, 0, 5)}))\n` };
      return { code: `${d}\nd[${k1}] = d.get(${k1}, 0) + 1\nprint(d)\n` };
    },
  },
  "tuple-comma": {
    topic: "structures", level: "edge",
    title: "The comma makes the tuple",
    explain: "Parentheses are just grouping — the COMMA creates the tuple, so "
      + "`x = 5,` makes `(5,)` (a classic hidden bug). And in `x, y = y, x + y` "
      + "the whole right side is evaluated FIRST with the old values, then "
      + "unpacked.",
    generate(rng) {
      const a = int(rng, 1, 9), b = int(rng, 1, 9);
      const kind = pick(rng, ["trailing", "trailing-type", "grouping", "fib"]);
      if (kind === "trailing") return { code: `x = ${a},\nprint(x)\n` };
      if (kind === "trailing-type") return { code: `x = ${a},\nprint(type(x).__name__)\n` };
      if (kind === "grouping") return { code: `x = (${a})\nprint(type(x).__name__)\n` };
      return { code: `x = ${a}\ny = ${b}\nx, y = y, x + y\nprint(x, y)\n` };
    },
  },
};

// ---- session compiler ------------------------------------------------------

function templateIdsFor(topic) {
  const all = Object.keys(drillTemplates);
  return topic === "all" ? all : all.filter((id) => drillTemplates[id].topic === topic);
}

// Weighted pick: core (basic understanding) templates dominate ~3:1; unseen
// templates get a novelty boost; missed ones come back more often.
function weightOf(stats, id) {
  const t = drillTemplates[id];
  const levelWeight = t.level === "core" ? 3 : 1;
  const s = stats?.[id];
  const history = !s?.seen ? 1.5 : 1 + 2 * (s.missed / s.seen);
  return levelWeight * history;
}

// Compile a drill round into an ordinary lesson script. Deterministic under
// (topic, seed, count, stats) — a persisted session rebuilds exactly.
export function buildDrillLesson(topic, { count = 8, seed = 1, stats = {} } = {}) {
  const ids = templateIdsFor(topic);
  if (!ids.length) return null;
  const rng = mulberry32(seed >>> 0);
  const topicTitle = topic === "all" ? "everything" : (drillTopics.find((t) => t.id === topic)?.title ?? topic);
  const steps = [{
    say: `**Drill: ${topicTitle}.** ${count} quick programs, one question each. `
      + "Predict the exact output before running — precision is the point. "
      + "A miss gets you the underlying rule, and comes back more often.",
  }];
  let prev = null;
  for (let i = 0; i < count; i++) {
    // weighted, seeded template choice; avoid immediate repeats
    let id = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const weights = ids.map((t) => weightOf(stats, t));
      const total = weights.reduce((a, w) => a + w, 0);
      let roll = rng() * total;
      id = ids[ids.length - 1];
      for (let j = 0; j < ids.length; j++) {
        roll -= weights[j];
        if (roll <= 0) { id = ids[j]; break; }
      }
      if (id !== prev || ids.length === 1) break;
    }
    prev = id;
    const t = drillTemplates[id];
    const { code, multiline } = t.generate(rng);
    steps.push({ loadCode: code });
    steps.push({
      ask: {
        kind: "predict-output",
        template: id,
        singleLine: !multiline,
        prompt: `(${i + 1}/${count} · ${t.title}) What exactly does this program print?`
          + (multiline ? "" : " One line."),
      },
    });
    steps.push({ if: { lastAnswer: ["wrong", "skipped"] }, say: t.explain, pause: true });
  }
  steps.push({
    done: `Round complete. Start another **${topicTitle}** round for fresh `
      + "variations — templates you missed will come up more often.",
  });
  return { id: `drill-${topic}-${seed >>> 0}`, unit: 0, title: `Drill · ${topicTitle}`, steps };
}
