// Numbers & bools intro exercises (phase-1 slice).

import { mulberry32, int, pick } from "../rng.mjs";
import { words } from "../pools.mjs";

// Float pairs whose sum shows a rounding tail in IEEE-754 (same in JS and
// Python), so float-inexact's "long tail" is always visible.
const FLOAT_PAIRS = [[0.1, 0.2], [0.2, 0.4], [0.3, 0.6], [0.1, 0.7]];

export default [
  {
    id: "precedence-mix",
    topic: "numbers",
    focus: "000N", // op-precedence
    assumed: ["0005", "0008"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["add-times", "times-add", "sub-times"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 2, 6), b = int(rng, 2, 6), c = int(rng, 2, 6);
        const shape = pick(rng, ["add-times", "times-add", "sub-times"]);
        if (shape === "add-times") {
          return {
            code: `print(${a} + ${b} * ${c})\n`, shape, variant: "plain",
            variantCard: `\`${b} * ${c}\` happens first (\`${b * c}\`), then \`${a} + ${b * c}\` `
              + `is ${a + b * c}. Going left to right would wrongly give ${(a + b) * c}.`,
          };
        }
        if (shape === "times-add") {
          return {
            code: `print(${a} * ${b} + ${c})\n`, shape, variant: "plain",
            variantCard: `\`${a} * ${b}\` happens first (\`${a * b}\`), then \`${a * b} + ${c}\` `
              + `is ${a * b + c}. Going left to right would wrongly give ${a * (b + c)}.`,
          };
        }
        const big = a + 8; // keep the subtraction non-negative
        return {
          code: `print(${big} - ${b} * ${c})\n`, shape, variant: "plain",
          variantCard: `\`${b} * ${c}\` happens first (\`${b * c}\`), then \`${big} - ${b * c}\` `
            + `is ${big - b * c}. Going left to right would wrongly give ${(big - b) * c}.`,
        };
      },
    },
  },

  {
    id: "floor-div",
    topic: "numbers",
    focus: "000Q", // floordiv-quotient
    assumed: ["0005", "0008"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["bare-floordiv", "chain-floordiv", "big-floordiv"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["bare-floordiv", "chain-floordiv", "big-floordiv"]);
        const b = int(rng, 2, 9);
        const k = int(rng, 2, 9);
        const r = int(rng, 1, b - 1); // non-zero remainder → the answer is not a/b
        const a = b * k + r;
        if (shape === "chain-floordiv") {
          const c = int(rng, 2, 3);
          return {
            code: `print(${a} // ${b} // ${c})\n`, shape, variant: "plain",
            variantCard: `Left to right: \`${a} // ${b}\` is ${k}, then \`${k} // ${c}\` is ${Math.floor(k / c)}.`,
          };
        }
        if (shape === "big-floordiv") {
          const c = int(rng, 2, 3), d = 2;
          const step1 = Math.floor(a / b), step2 = Math.floor(step1 / c);
          return {
            code: `print(${a} // ${b} // ${c} // ${d})\n`, shape, variant: "plain",
            variantCard: `Left to right: \`${a} // ${b}\` is ${step1}, \`// ${c}\` is ${step2}, \`// ${d}\` is ${Math.floor(step2 / d)}.`,
          };
        }
        return {
          code: `print(${a} // ${b})\n`, shape, variant: "plain",
          variantCard: `\`//\` asks how many whole \`${b}\`s fit in \`${a}\` — that's ${k}. `
            + `The leftover ${r} is dropped, so the answer is \`${k}\`, not \`${(a / b).toFixed(2)}\`.`,
        };
      },
    },
  },

  {
    id: "mod-basic",
    topic: "numbers",
    focus: "000R", // mod-remainder
    assumed: ["0005", "0008", "000Q"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["bare-mod"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const b = int(rng, 3, 9);
        const r = int(rng, 1, b - 1);
        const k = r + int(rng, 1, 5); // quotient strictly greater than the remainder
        const a = b * k + r;
        return {
          code: `print(${a} % ${b})\n`, shape: "bare-mod", variant: "plain",
          variantCard: `\`${b}\` fits into \`${a}\` ${k} whole times, using up ${b * k}; `
            + `\`${a} - ${b * k}\` is ${r} left over. So \`${a} % ${b}\` is \`${r}\`, `
            + `the remainder — not the ${k} whole times it fit.`,
        };
      },
    },
  },

  {
    id: "mod-neg",
    topic: "numbers",
    focus: "000S", // mod-sign-of-divisor
    assumed: ["0005", "000R"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["neg-dividend"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const b = int(rng, 2, 9);
        let m = int(rng, 2, 9);
        if (m % b === 0) m += 1; // keep the remainder non-zero so the sign is visible
        const out = (((-m) % b) + b) % b; // Python's divisor-signed result
        return {
          code: `print(-${m} % ${b})\n`,
          shape: "neg-dividend", variant: "plain",
          variantCard: `In Python \`%\` takes the sign of the divisor \`${b}\` (positive), so `
            + `\`-${m} % ${b}\` is \`${out}\` — a positive number — not the \`-${m % b}\` you `
            + `might expect from the left operand's sign.`,
        };
      },
    },
  },
  {
    id: "plain-arith",
    topic: "numbers",
    focus: "0008", // arith-on-ints
    assumed: ["0005"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      // The operator makes the skeleton (different token, different result),
      // so each is its own shape.
      shapes: ["add", "subtract", "multiply"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["add", "subtract", "multiply"]);
        if (shape === "add") {
          const a = int(rng, 2, 40), b = int(rng, 2, 40);
          return { code: `print(${a} + ${b})\n`, shape, variant: "plain" };
        }
        if (shape === "subtract") {
          const b = int(rng, 2, 20), a = b + int(rng, 1, 20); // stays non-negative
          return { code: `print(${a} - ${b})\n`, shape, variant: "plain" };
        }
        const a = int(rng, 2, 9), b = int(rng, 2, 9);
        return { code: `print(${a} * ${b})\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "div-always-float",
    topic: "numbers",
    focus: "000P", // div-yields-float
    assumed: ["0005", "0008"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["bare-div", "chain-div", "times-then-div"],
      variants: ["even-div"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["bare-div", "chain-div", "times-then-div"]);
        const b = pick(rng, [2, 4, 5]);
        // a is a clean multiple of b, so the answer is always x.0 — the lesson
        // is the TYPE, not decimal expansion (float-inexact's job; §10.2-B).
        const a = b * int(rng, 2, 9);
        if (shape === "chain-div") {
          const c = pick(rng, [1, 2]); // keeps the result a clean x.0
          const a2 = a * c;
          return {
            code: `print(${a2} / ${b} / ${c})\n`, shape, variant: "even-div",
            variantCard: `Even chained, \`/\` stays a float: \`${a2} / ${b} / ${c}\` is ${(a2 / b / c).toFixed(1)}.`,
          };
        }
        if (shape === "times-then-div") {
          // * and / share precedence and go left to right, no float surprises.
          return {
            code: `print(${b} * ${a / b} / ${b})\n`, shape, variant: "even-div",
            variantCard: `\`*\` and \`/\` go left to right; the \`/\` still makes the result a float: ${((b * (a / b)) / b).toFixed(1)}.`,
          };
        }
        return {
          code: `print(${a} / ${b})\n`, shape, variant: "even-div",
          variantCard: `\`/\` is true division and ALWAYS gives a float — even `
            + `when it divides evenly. So \`${a} / ${b}\` is ${(a / b).toFixed(1)} `
            + `(with the .0), not ${a / b}.`,
        };
      },
    },
  },

  {
    id: "text-from-int",
    topic: "numbers",
    focus: "000T", // str-of-int
    assumed: ["0005", "000K", "000Y"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["str-then-digit", "digit-then-str", "str-then-word"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["str-then-digit", "digit-then-str", "str-then-word"]);
        const n = int(rng, 1, 9), d = int(rng, 1, 9), w = pick(rng, words);
        if (shape === "str-then-digit") {
          return {
            code: `print(str(${n}) + "${d}")\n`, shape, variant: "plain",
            variantCard: `\`str(${n})\` is the text \`"${n}"\`, joined to \`"${d}"\` gives \`${n}${d}\` — not ${n + d}.`,
          };
        }
        if (shape === "digit-then-str") return { code: `print("${d}" + str(${n}))\n`, shape, variant: "plain" };
        return { code: `print(str(${n}) + "${w}")\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "int-from-text",
    topic: "numbers",
    focus: "000V", // int-of-str
    assumed: ["0005", "0008", "000K"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["add-after", "add-before", "subtract"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["add-after", "add-before", "subtract"]);
        const d = int(rng, 20, 60), n = int(rng, 1, 9);
        if (shape === "add-after") {
          return {
            code: `print(int("${d}") + ${n})\n`, shape, variant: "plain",
            variantCard: `\`int("${d}")\` is the number ${d}, and ${d} + ${n} is ${d + n} — not the text \`"${d}${n}"\`.`,
          };
        }
        if (shape === "add-before") return { code: `print(${n} + int("${d}"))\n`, shape, variant: "plain" };
        return { code: `print(int("${d}") - ${n})\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "float-tail",
    topic: "numbers",
    focus: "000W", // float-inexact  (focus-salience waiver — analyzer cannot see the tail; see waivers.json)
    assumed: ["0005", "0008", "000P"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["sum-tenths"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const [a, b] = pick(rng, FLOAT_PAIRS);
        return {
          code: `print(${a} + ${b})\n`,
          shape: "sum-tenths", variant: "plain",
          variantCard: `\`${a} + ${b}\` cannot be stored exactly, so the result prints with a long tail instead of \`${(a + b).toFixed(1)}\`.`,
        };
      },
    },
  },

  {
    id: "bool-arithmetic",
    topic: "numbers",
    focus: "000X", // bool-is-int
    assumed: ["0005", "0008", "0016"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["true-plus-true", "true-plus-int", "false-plus-int"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["true-plus-true", "true-plus-int", "false-plus-int"]);
        const n = int(rng, 2, 9);
        if (shape === "true-plus-true") {
          return { code: `print(True + True)\n`, shape, variant: "plain", variantCard: `Each \`True\` counts as 1, so \`True + True\` is 2.` };
        }
        if (shape === "true-plus-int") return { code: `print(True + ${n})\n`, shape, variant: "plain", variantCard: `\`True\` counts as 1, so \`True + ${n}\` is ${n + 1}.` };
        return { code: `print(False + ${n})\n`, shape, variant: "plain", variantCard: `\`False\` counts as 0, so \`False + ${n}\` is ${n}.` };
      },
    },
  },
];
