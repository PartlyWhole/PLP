// Error-literacy exercises (expansion ladder §R3): the `predict-the-error`
// form. The learner sees a program that STOPS, taps the line it stops on and
// picks the kind of error from a fixed four-name palette.
//
// `expectedError` is PROVENANCE, for the K-series only: it is what the
// analyzer's expectRaise footprint and real execution are checked against
// (K-5 and K-10). It never rides on the ask and it is never used to grade —
// the real terminal exception is (app/tutor.mjs execPredictError).
//
// DISCIPLINE for every program here: straight-line up to the raise (no
// branches, no loops), at most one printed line before the crash, and the
// raising LINE varies across shapes so tapping "line 2 every time" is not a
// winning strategy (quality bar E6).

import { mulberry32, int, pick } from "../rng.mjs";
import { words, longWords } from "../pools.mjs";

// Names long enough to misspell recognisably, with the near-miss a learner
// really produces: two adjacent letters swapped, or one letter dropped.
const longNames = ["total", "score", "count", "points", "result"];
const swapLast = (n) => n.slice(0, -2) + n[n.length - 1] + n[n.length - 2];
const dropOne = (n) => n.slice(0, 2) + n.slice(3);
const nearMisses = (n) => [swapLast(n), dropOne(n)].filter((m) => m !== n);

// Dict keys: short lowercase words, never also a name in the program. Each
// has a plausible near-miss (the last two letters swapped) that is itself
// never a key in the pool — so a "typo" key is always genuinely absent.
const keyPool = ["cat", "sun", "fish", "frog", "drum", "star"];

export default [
  {
    id: "err-name-unbound",
    topic: "state",
    focus: "002N", // errors-are-information — NameError is its canonical witness
    assumed: ["0005", "0006"],
    role: "intro",
    form: "predict-the-error",
    generator: {
      // Three shapes, three DIFFERENT raising lines (1, 2, 3): the line
      // picker has to discriminate, not memorise.
      shapes: ["print-before-assign", "forgot-to-start", "misspelled-name"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["print-before-assign", "forgot-to-start", "misspelled-name"]);
        const name = pick(rng, longNames);
        const v = int(rng, 2, 20);
        if (shape === "print-before-assign") {
          // The print got written ABOVE the line that gives the name a value.
          return {
            code: `print(${name})\n${name} = ${v}\nprint(${name})\n`,
            expectedError: { type: "NameError", line: 1 },
            shape, variant: "plain",
            variantCard: `Line 1 asks for \`${name}\` before any line has given it a `
              + `value, so Python stops right there with a \`NameError\`. The `
              + `\`${name} = ${v}\` on line 2 never runs — nothing is printed at all.`,
          };
        }
        if (shape === "forgot-to-start") {
          // The classic missing initialiser: `count = count + 1` reads `count`
          // on its own right-hand side before anything ever bound it.
          const label = pick(rng, words);
          return {
            code: `print("${label}")\n${name} = ${name} + 1\nprint(${name})\n`,
            expectedError: { type: "NameError", line: 2 },
            shape, variant: "plain",
            variantCard: `Line 1 runs and prints \`${label}\`. Line 2 has to work out `
              + `\`${name} + 1\` before it can store anything — and \`${name}\` has no `
              + `value yet, so that is where it stops with a \`NameError\`. Starting `
              + `with \`${name} = 0\` first is the fix.`,
          };
        }
        const typo = pick(rng, nearMisses(name));
        const label = pick(rng, words);
        return {
          code: `${name} = ${v}\nprint("${label}")\nprint(${typo})\n`,
          expectedError: { type: "NameError", line: 3 },
          shape, variant: "plain",
          variantCard: `\`${typo}\` and \`${name}\` are different names — Python does not `
            + `guess. Lines 1 and 2 run fine (\`${label}\` is printed), and line 3 stops `
            + `with a \`NameError\` because nothing ever bound \`${typo}\`.`,
        };
      },
    },
  },

  {
    id: "err-str-plus-int",
    topic: "strings",
    focus: "002P",
    assumed: ["0005", "0006", "000K", "002N"],
    role: "intro",
    form: "predict-the-error",
    generator: {
      shapes: ["join-in-print", "build-message"],
      // The operand order flips: a learner who thinks "text first is fine"
      // has to meet the other order too.
      variants: ["str-first", "num-first"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["join-in-print", "build-message"]);
        const variant = pick(rng, ["str-first", "num-first"]);
        const n = int(rng, 2, 9);
        const text = pick(rng, longWords);
        const sum = variant === "str-first" ? `label + ${"count"}` : `count + label`;
        if (shape === "join-in-print") {
          return {
            code: `count = ${n}\nlabel = "${text}"\nprint(${sum})\n`,
            expectedError: { type: "TypeError", line: 3 },
            shape, variant,
            variantCard: `\`+\` joins two strings or adds two numbers. Line 3 has one of `
              + `each — \`label\` holds the text \`${text}\` and \`count\` holds the number `
              + `${n} — so Python stops with a \`TypeError\` instead of guessing. `
              + `\`label + str(count)\` would join them.`,
          };
        }
        return {
          code: `count = ${n}\nlabel = "${text}"\nmsg = ${sum}\nprint(msg)\n`,
          expectedError: { type: "TypeError", line: 3 },
          shape, variant,
          variantCard: `The \`+\` on line 3 mixes the text \`${text}\` with the number `
            + `${n}, so it never gets as far as storing \`msg\` — that line raises a `
            + `\`TypeError\` and line 4 never runs. Nothing is printed.`,
        };
      },
    },
  },

  {
    id: "err-index-range",
    topic: "lists",
    focus: "002Q",
    assumed: ["0005", "0006", "000D", "000E", "002N"],
    role: "intro",
    form: "predict-the-error",
    generator: {
      shapes: ["index-past-end", "after-a-good-read"],
      // at-length is the off-by-one a learner actually writes (xs[3] on three
      // items); past-length is the plainly-too-far read.
      variants: ["at-length", "past-length"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["index-past-end", "after-a-good-read"]);
        const variant = pick(rng, ["at-length", "past-length"]);
        const len = int(rng, 3, 4);
        const base = int(rng, 1, 9) * 10;
        const items = Array.from({ length: len }, (_, i) => base + i * 10);
        const bad = variant === "at-length" ? len : len + int(rng, 1, 2);
        const list = `xs = [${items.join(", ")}]`;
        if (shape === "index-past-end") {
          return {
            code: `${list}\nprint(xs[${bad}])\n`,
            expectedError: { type: "IndexError", line: 2 },
            shape, variant,
            variantCard: `\`xs\` holds ${len} items, so its positions are 0 to ${len - 1} — `
              + `\`xs[${len - 1}]\` is ${items[len - 1]}, the last one. \`xs[${bad}]\` asks for a `
              + `position that does not exist, so line 2 stops with an \`IndexError\`.`,
          };
        }
        return {
          code: `${list}\nprint(xs[0])\nprint(xs[${bad}])\n`,
          expectedError: { type: "IndexError", line: 3 },
          shape, variant,
          variantCard: `Line 2 works: \`xs[0]\` is ${items[0]}, so ${items[0]} is printed. `
            + `Line 3 asks for position ${bad} of a ${len}-item list, whose last position `
            + `is ${len - 1} — that is where it stops, with an \`IndexError\`.`,
        };
      },
    },
  },

  {
    id: "err-key-missing",
    topic: "structures",
    focus: "002R",
    assumed: ["0005", "0006", "001R", "002N"],
    role: "intro",
    form: "predict-the-error",
    generator: {
      shapes: ["missing-key", "after-a-good-read"],
      // typo-key is a near-miss of a key that IS there; other-key is simply
      // absent. Either way the asked-for key is drawn DISJOINT from the
      // present keys, so a miss can never accidentally hit (quality bar E7).
      variants: ["typo-key", "other-key"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["missing-key", "after-a-good-read"]);
        const variant = pick(rng, ["typo-key", "other-key"]);
        const start = int(rng, 0, 2);
        const present = [keyPool[start], keyPool[start + 1]];
        const rest = keyPool.filter((k) => !present.includes(k));
        // A near-miss of a PRESENT key (last two letters swapped) still has to
        // be absent, so it is only used when it is not itself in the pool.
        const typo = swapLast(present[0]);
        const missing = variant === "typo-key" && !keyPool.includes(typo) ? typo : pick(rng, rest);
        const vals = [int(rng, 2, 9), int(rng, 2, 9)];
        const dict = `counts = {"${present[0]}": ${vals[0]}, "${present[1]}": ${vals[1]}}`;
        if (shape === "missing-key") {
          return {
            code: `${dict}\nprint(counts["${missing}"])\n`,
            expectedError: { type: "KeyError", line: 2 },
            shape, variant,
            variantCard: `\`counts\` has exactly two keys, \`${present[0]}\` and \`${present[1]}\`. `
              + `Line 2 asks for \`${missing}\`, which is not one of them, so Python stops `
              + `with a \`KeyError\` instead of handing back a blank.`,
          };
        }
        return {
          code: `${dict}\nprint(counts["${present[1]}"])\nprint(counts["${missing}"])\n`,
          expectedError: { type: "KeyError", line: 3 },
          shape, variant,
          variantCard: `Line 2 finds \`${present[1]}\` and prints ${vals[1]}. Line 3 asks for `
            + `\`${missing}\`, which \`counts\` never had, so that is where it stops with a `
            + `\`KeyError\`. \`counts.get("${missing}", 0)\` is how you ask without stopping.`,
        };
      },
    },
  },
];
