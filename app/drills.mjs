// Drill bank: parameterized exercise templates for the tutor's drill mode.
//
// Each template is a tiny PROGRAM GENERATOR targeting one corner-case
// misconception (trajectory + sources: design/tutor-plan.md §7,
// python_exercises.md). Variations come from a seeded RNG over the
// template's parameter space; the generated program is loaded, run, and
// graded by the engine — ground truth is what Python actually does, so an
// authored answer key cannot exist, let alone be wrong.
//
// Generator rules (why every template looks the way it does):
//  - deterministic under a seed (mulberry32), so tests and rebuilt drill
//    sessions reproduce exactly;
//  - always prints something (a program whose entire output is empty makes
//    predict-output unbuildable);
//  - deterministic output only: no sets in prints, no id()/is on cached
//    ints, no input(), no exceptions (tracebacks are not typeable answers);
//  - small enough to trace (learner-scale, far under the step budget).
//
// `explain` is the first-principles scaffold shown after a miss — the
// exercise bank's derivation, compressed, with runnable ```py fences.
//
// buildDrillLesson compiles a seeded, stats-weighted question round into an
// ordinary lesson script (app/TUTOR.md step vocabulary), so drills reuse
// the whole lesson machinery: popup beats, retry, persistence, restore.

import { mulberry32 } from "./questions.mjs";

const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const pick2 = (rng, arr) => { // two distinct entries
  const a = pick(rng, arr);
  let b = pick(rng, arr);
  if (arr.length > 1) while (b === a) b = pick(rng, arr);
  return [a, b];
};

export const drillTopics = [
  { id: "numbers", title: "Numbers & bools" },
  { id: "strings", title: "Strings" },
  { id: "lists", title: "Lists & aliasing" },
  { id: "logic", title: "Truthiness & logic" },
  { id: "loops", title: "Loops & ranges" },
  { id: "structures", title: "Dicts & tuples" },
];

export const drillTemplates = {
  // ---- numbers -----------------------------------------------------------
  "int-div-mod": {
    topic: "numbers",
    title: "Floor division and modulo",
    explain: "The invariant that never breaks: `(a // b) * b + (a % b) == a`. "
      + "Python's `//` rounds toward **negative infinity** (floor), not toward zero, "
      + "and `a % b` always has the **same sign as `b`**.\n\n"
      + "```py\nprint(-7 / 2)   # -3.5\nprint(-7 // 2)  # floor(-3.5) is -4, NOT -3\nprint(-7 % 2)   # -7 - (-4)*2 = 1\n```",
    generate(rng) {
      const b = pick(rng, [2, 3, 4, 5, 7]);
      const mag = int(rng, 1, 4) * b + int(rng, 1, b - 1); // never a multiple
      const [sa, sb] = pick(rng, [[1, 1], [-1, 1], [1, -1], [-1, -1], [-1, 1], [1, -1]]);
      return { code: `a = ${sa * mag}\nb = ${sb * b}\nprint(a // b)\nprint(a % b)\n` };
    },
  },
  "float-precision": {
    topic: "numbers",
    title: "Floats are not exact",
    explain: "Many decimals have no finite **binary** expansion — `0.1` is already an "
      + "approximation before any math happens, and errors compound. Some sums "
      + "(halves, quarters, eighths) ARE exact. Never `==` computed floats:\n\n"
      + "```py\nprint(0.1 + 0.2)\nimport math\nprint(math.isclose(0.1 + 0.2, 0.3))\n```",
    generate(rng) {
      const triple = pick(rng, [
        ["0.1", "0.2", "0.3"], ["0.1", "0.1", "0.2"], ["0.25", "0.5", "0.75"],
        ["0.1", "0.7", "0.8"], ["0.5", "0.125", "0.625"], ["0.2", "0.4", "0.6"],
      ]);
      const [a, b, c] = triple;
      const showSum = rng() < 0.5;
      return { code: `x = ${a} + ${b}\nprint(x == ${c})\n${showSum ? "print(x)\n" : `print(${a} < ${c})\n`}` };
    },
  },
  "bool-is-int": {
    topic: "numbers",
    title: "bool is a kind of int",
    explain: "`bool` is a subclass of `int`: `True` is 1 and `False` is 0, so "
      + "arithmetic and equality just work. This gives the counting idiom "
      + "`sum(condition for x in items)`.\n\n"
      + "```py\nprint(isinstance(True, int))\nprint(True + True)\nprint(sum([True, False, True, True]))\n```",
    generate(rng) {
      const kind = pick(rng, ["plus", "sum", "eq"]);
      if (kind === "plus") {
        const n = int(rng, 2, 4);
        return { code: `print(${Array.from({ length: n }, () => pick(rng, ["True", "False"])).join(" + ")})\n` };
      }
      if (kind === "sum") {
        const flags = Array.from({ length: int(rng, 3, 6) }, () => pick(rng, ["True", "False"]));
        return { code: `flags = [${flags.join(", ")}]\nprint(sum(flags))\nprint(len(flags))\n` };
      }
      return { code: `print(True == ${pick(rng, ["1", "2", "0"])})\nprint(False == ${pick(rng, ["0", "1"])})\n` };
    },
  },

  // ---- strings -----------------------------------------------------------
  "str-compare": {
    topic: "strings",
    title: "String comparison is by code points",
    explain: "Strings compare character-by-character using each character's numeric "
      + "code (`ord`). ALL uppercase letters sort before all lowercase, and digits "
      + "compare as characters — `\"10\" < \"9\"` is True because `'1' < '9'` at "
      + "position 0; length never gets a say. The classic bug: numbers stored as strings.\n\n"
      + "```py\nprint(ord('Z'), ord('a'))\nprint(ord('1'), ord('9'))\n```",
    generate(rng) {
      const pairs = [
        ['"10"', '"9"'], ['"100"', '"2"'], ['"Zebra"', '"apple"'],
        ['"apple"', '"banana"'], ['"app"', '"apple"'], ['"ABC"', '"abc"'],
        ['"img12"', '"img9"'],
      ];
      const [p, q] = pick2(rng, pairs);
      return { code: `print(${p[0]} < ${p[1]})\nprint(${q[0]} < ${q[1]})\n` };
    },
  },
  "str-slice": {
    topic: "strings",
    title: "Indexing and half-open slices",
    explain: "Think of positions BETWEEN characters: `s[a:b]` includes `a`, excludes "
      + "`b`, so its length is `b - a` and `s[:k] + s[k:]` tiles perfectly. "
      + "`s[-1]` is `s[len(s)-1]`; the third slot is the step, and `-1` walks backward.\n\n"
      + "```py\ns = \"python\"\nprint(s[1:4])\nprint(s[:3] + s[3:])\nprint(s[::-1])\n```",
    generate(rng) {
      const word = pick(rng, ["python", "banana", "wizard", "stream", "carpet"]);
      const ops = pick2(rng, ["[0]", "[-1]", "[1:4]", "[:3]", "[3:]", "[::-1]", "[::2]", "[-3:]", "[2]"]);
      return { code: `s = "${word}"\nprint(s${ops[0]})\nprint(s${ops[1]})\n` };
    },
  },
  "str-rebind": {
    topic: "strings",
    title: "Strings are immutable; names rebind",
    explain: "`s[0] = ...` would fail — strings never change. `s = \"b\" + s[1:]` "
      + "builds a **new** string and re-points the name `s`; any other name still "
      + "points at the old, unchanged string.\n\n"
      + "```py\ns = \"cat\"\nt = s\ns = \"b\" + s[1:]\nprint(s, t)\n```",
    generate(rng) {
      const word = pick(rng, ["cat", "map", "sun", "dog", "cup"]);
      const ch = pick(rng, ["b", "r", "t", "h"]);
      return { code: `s = "${word}"\nt = s\ns = "${ch}" + s[1:]\nprint(s)\nprint(t)\n` };
    },
  },

  // ---- lists -------------------------------------------------------------
  "alias-mutate": {
    topic: "lists",
    title: "Two names, one list",
    explain: "Assignment copies the **reference**, not the list: after `b = a` there "
      + "is ONE list with two names, so mutating through either name shows through "
      + "both. A full slice `a[:]` builds a genuinely new list. `b = b + [x]` "
      + "REBINDS `b` to a new list (a unchanged); `b += [x]` MUTATES the shared one.\n\n"
      + "```py\na = [1, 2]\nb = a\nb.append(3)\nprint(a, b, a is b)\n```",
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
      return { code: `a = ${base}\n${op}\nprint(a)\nprint(b)\n` };
    },
  },
  "grid-2d": {
    topic: "lists",
    title: "Shallow copies share the rows",
    explain: "`grid[:]` copies only the OUTER list — both lists hold the same row "
      + "objects, so writing through one shows in the other. `[row] * 3` is three "
      + "references to ONE row. Independent rows need the comprehension form.\n\n"
      + "```py\nrow = [0, 0]\ngrid = [row] * 3\nprint(grid[0] is grid[1])\ngrid2 = [[0, 0] for _ in range(3)]\nprint(grid2[0] is grid2[1])\n```",
    generate(rng) {
      const v = int(rng, 5, 9);
      const kind = pick(rng, ["slice-copy", "star", "compr"]);
      if (kind === "slice-copy") {
        return { code: `grid = [[0, 0], [0, 0]]\ncopy = grid[:]\ncopy[0][0] = ${v}\nprint(grid)\nprint(copy)\n` };
      }
      if (kind === "star") {
        const n = int(rng, 2, 3);
        return { code: `row = [0, 0]\ngrid = [row] * ${n}\ngrid[0][0] = ${v}\nprint(grid)\n` };
      }
      return { code: `grid = [[0, 0] for _ in range(3)]\ngrid[0][0] = ${v}\nprint(grid)\n` };
    },
  },
  "append-extend": {
    topic: "lists",
    title: "append vs extend vs +",
    explain: "`append` adds ONE element — even when that element is a whole list. "
      + "`extend` adds EACH element. `+` builds a new list.\n\n"
      + "```py\na = [1, 2]\na.append([3, 4])\nprint(a, len(a))\nb = [1, 2]\nb.extend([3, 4])\nprint(b, len(b))\n```",
    generate(rng) {
      const x = int(rng, 3, 6), y = int(rng, 7, 9);
      const op = pick(rng, [
        `a.append([${x}, ${y}])`, `a.extend([${x}, ${y}])`,
        `a.append(${x})`, `a.insert(0, ${x})`,
      ]);
      return { code: `a = [1, 2]\n${op}\nprint(a)\nprint(len(a))\n` };
    },
  },
  "remove-while-iterating": {
    topic: "lists",
    title: "Mutating the list you're iterating",
    explain: "The for-loop is an index counter in disguise. Every `remove` shifts the "
      + "tail LEFT while the index marches RIGHT, so the element after each removed "
      + "one is never examined — adjacent odd numbers survive. Fix: build the list "
      + "you want, or iterate a frozen copy.\n\n"
      + "```py\nnums = [x for x in [1, 3, 2, 5, 7, 4] if x % 2 == 0]\nprint(nums)\n```",
    generate(rng) {
      const nums = Array.from({ length: 6 }, () => int(rng, 1, 9));
      return { code: `nums = [${nums.join(", ")}]\nfor x in nums:\n    if x % 2 == 1:\n        nums.remove(x)\nprint(nums)\n` };
    },
  },

  // ---- logic -------------------------------------------------------------
  "truthiness": {
    topic: "logic",
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
    topic: "logic",
    title: "and/or return operands",
    explain: "`a or b`: if `a` is truthy the result is **a** (b never runs); else "
      + "**b**. `a and b`: if `a` is falsy the result is **a**; else **b**. Neither "
      + "converts anything to True/False — they hand back an operand. That's why "
      + "`0 or \"default\"` is the default-value idiom (and why it wrongly replaces "
      + "legitimate `0` too).",
    generate(rng) {
      const exprs = [
        '0 or "default"', '"hi" and 42', "None or [] or 0", "[] and [1]",
        "0 and 99", "1 or 99", '"a" or "b"', '[0] and "yes"', "None or 7",
      ];
      const [e1, e2] = pick2(rng, exprs);
      return { code: `print(${e1})\nprint(${e2})\n` };
    },
  },
  "chained-compare": {
    topic: "logic",
    title: "Chained comparisons",
    explain: "`a OP1 b OP2 c` means `(a OP1 b) and (b OP2 c)` with `b` evaluated "
      + "once. `==` and `in` are BOTH comparison operators, so they chain too: "
      + "`False == False in [False]` means `(False == False) and (False in [False])` "
      + "— both True.",
    generate(rng) {
      if (rng() < 0.2) {
        return { code: `print(False == False in [False])\nprint((False == False) in [False])\n` };
      }
      const x = int(rng, 0, 12);
      const exprs = pick2(rng, ["1 < x < 10", "10 > x > 1", "1 < x > 3", "0 < x < 5 < 100", "x < 5 > 2"]);
      return { code: `x = ${x}\nprint(${exprs[0]})\nprint(${exprs[1]})\n` };
    },
  },

  // ---- loops -------------------------------------------------------------
  "range-halfopen": {
    topic: "loops",
    title: "range is half-open",
    explain: "`range(start, stop, step)`: start included, stop **excluded** — "
      + "`range(10)` is ten numbers ending at 9. Counting down needs a negative "
      + "step. And a range that can't move toward its stop is silently EMPTY — "
      + "`range(5, 1)` runs zero times, no error.",
    generate(rng) {
      const kind = pick(rng, ["simple", "startstop", "empty", "down"]);
      if (kind === "simple") return { code: `print(list(range(${int(rng, 3, 6)})))\n` };
      if (kind === "startstop") {
        const a = int(rng, 1, 4);
        return { code: `print(list(range(${a}, ${a + int(rng, 2, 4)})))\nprint(len(list(range(${a}, ${a + 2}))))\n` };
      }
      if (kind === "empty") {
        const a = int(rng, 4, 8);
        return { code: `print(list(range(${a}, ${a - int(rng, 1, 3)})))\nprint("done")\n` };
      }
      const hi = pick(rng, [10, 8, 9]);
      return { code: `print(list(range(${hi}, 0, -${pick(rng, [2, 3])})))\n` };
    },
  },
  "break-continue": {
    topic: "loops",
    title: "break vs continue",
    explain: "`break` leaves the loop entirely — later values are never seen. "
      + "`continue` abandons only THIS iteration and jumps to the next. Trace it "
      + "as a table, one row per iteration.",
    generate(rng) {
      const hi = int(rng, 5, 7);
      const trig = int(rng, 2, hi - 1);
      const kw = pick(rng, ["break", "continue"]);
      return { code: `for i in range(1, ${hi}):\n    if i == ${trig}:\n        ${kw}\n    print(i)\nprint("end")\n` };
    },
  },
  "for-else": {
    topic: "loops",
    title: "The loop else (nobreak)",
    explain: "The `else` block runs iff the loop finished WITHOUT hitting `break` — "
      + "read it as \"nobreak\". It's the built-in version of the manual "
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

  // ---- structures --------------------------------------------------------
  "dict-basics": {
    topic: "structures",
    title: "Dict lookup, get, and what `in` checks",
    explain: "`in` on a dict checks **keys**, never values. `d[k]` raises on a "
      + "missing key; `d.get(k, default)` doesn't — which is why "
      + "`counts[ch] = counts.get(ch, 0) + 1` is the counting idiom.",
    generate(rng) {
      const k1 = pick(rng, ['"a"', '"x"', '"key"']);
      const v1 = int(rng, 1, 9);
      const k2 = '"b"';
      const v2 = int(rng, 1, 9);
      const kind = pick(rng, ["membership", "get", "count"]);
      const d = `d = {${k1}: ${v1}, ${k2}: ${v2}}`;
      if (kind === "membership") return { code: `${d}\nprint(${k1} in d)\nprint(${v1} in d)\n` };
      if (kind === "get") return { code: `${d}\nprint(d.get("missing", ${int(rng, 0, 5)}))\nprint(d.get(${k2}))\n` };
      return { code: `${d}\nd[${k1}] = d.get(${k1}, 0) + 1\nprint(d)\n` };
    },
  },
  "tuple-comma": {
    topic: "structures",
    title: "The comma makes the tuple; RHS-first unpacking",
    explain: "Parentheses are just grouping — the COMMA creates the tuple, so "
      + "`x = 5,` makes `(5,)` (a classic hidden bug). In `a, b = b, a` the whole "
      + "right side is evaluated FIRST with the old values, then unpacked — that's "
      + "why the swap needs no temp variable.",
    generate(rng) {
      const kind = pick(rng, ["trailing", "grouping", "swap", "fib"]);
      const a = int(rng, 1, 9), b = int(rng, 1, 9);
      if (kind === "trailing") return { code: `x = ${a},\nprint(x)\nprint(type(x).__name__)\n` };
      if (kind === "grouping") return { code: `x = (${a})\nprint(type(x).__name__)\ny = (${a},)\nprint(type(y).__name__)\n` };
      if (kind === "swap") return { code: `a = ${a}\nb = ${b}\na, b = b, a\nprint(a)\nprint(b)\n` };
      return { code: `x = ${a}\ny = ${b}\nx, y = y, x + y\nprint(x)\nprint(y)\n` };
    },
  },
};

// ---- session compiler ------------------------------------------------------

function templateIdsFor(topic) {
  const all = Object.keys(drillTemplates);
  return topic === "all" ? all : all.filter((id) => drillTemplates[id].topic === topic);
}

// Weighted pick: unseen templates get novelty weight; missed ones get boosted.
function weightOf(stats, id) {
  const s = stats?.[id];
  if (!s?.seen) return 1.5;
  return 1 + 2 * (s.missed / s.seen);
}

// Compile a drill round into an ordinary lesson script. Deterministic under
// (topic, seed, count, stats) — a persisted session rebuilds exactly.
export function buildDrillLesson(topic, { count = 8, seed = 1, stats = {} } = {}) {
  const ids = templateIdsFor(topic);
  if (!ids.length) return null;
  const rng = mulberry32(seed >>> 0);
  const topicTitle = topic === "all" ? "everything" : (drillTopics.find((t) => t.id === topic)?.title ?? topic);
  const steps = [{
    say: `**Drill: ${topicTitle}.** ${count} quick programs, each hiding a corner `
      + "case. Predict the exact output before running — precision is the point. "
      + "A miss gets you the underlying rule.",
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
    const { code } = t.generate(rng);
    steps.push({ loadCode: code });
    steps.push({
      ask: {
        kind: "predict-output",
        template: id,
        prompt: `(${i + 1}/${count} · ${t.title}) What exactly does this program print? Lock it in.`,
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
