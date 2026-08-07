// Numbers & bools intro exercises (phase-1 slice).

import { mulberry32, int, pick } from "../rng.mjs";
import { words, strNames } from "../pools.mjs";

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
            misconception: String((a + b) * c), // strict left-to-right
            variantCard: `\`${b} * ${c}\` happens first (\`${b * c}\`), then \`${a} + ${b * c}\` `
              + `is ${a + b * c}. Going left to right would wrongly give ${(a + b) * c}.`,
          };
        }
        if (shape === "times-add") {
          return {
            code: `print(${a} * ${b} + ${c})\n`, shape, variant: "plain",
            misconception: String(a * (b + c)), // "+ first"
            variantCard: `\`${a} * ${b}\` happens first (\`${a * b}\`), then \`${a * b} + ${c}\` `
              + `is ${a * b + c}. Doing the \`+\` first would wrongly give ${a * (b + c)}.`,
          };
        }
        const big = a + 8; // keep the subtraction non-negative
        return {
          code: `print(${big} - ${b} * ${c})\n`, shape, variant: "plain",
          misconception: String((big - b) * c), // strict left-to-right
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
            misconception: (a / b / c).toFixed(2), // a decimal answer, as if // were / (r ≠ 0, so never a whole number)
            variantCard: `Left to right: \`${a} // ${b}\` is ${k}, then \`${k} // ${c}\` is ${Math.floor(k / c)}.`,
          };
        }
        if (shape === "big-floordiv") {
          // A wider quotient (k up to 40) so the chained result spreads well
          // beyond {0, 1}: `a // b` lands in 12..40 before the two more //s.
          const kBig = int(rng, 12, 40);
          const aBig = b * kBig + r;
          const c = int(rng, 2, 3), d = 2;
          const step1 = Math.floor(aBig / b), step2 = Math.floor(step1 / c);
          return {
            code: `print(${aBig} // ${b} // ${c} // ${d})\n`, shape, variant: "plain",
            misconception: (aBig / b / c / d).toFixed(2), // a decimal answer, as if // were /
            variantCard: `Left to right: \`${aBig} // ${b}\` is ${step1}, \`// ${c}\` is ${step2}, \`// ${d}\` is ${Math.floor(step2 / d)}.`,
          };
        }
        return {
          code: `print(${a} // ${b})\n`, shape, variant: "plain",
          misconception: (a / b).toFixed(2), // a decimal answer, as if // were / (the card's own foil)
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
          misconception: String(k), // the quotient instead of the remainder (k > r by construction)
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
          misconception: `-${m % b}`, // took the sign of the left operand (truth is positive)
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
      // No designed misconception (G2): 0008's wrongAnswer is "an arithmetic
      // slip (no reasoned misconception — the intro checks fluency)", and the
      // only computable foil (an op mixup) collides with the truth at
      // a = b = 2 (2 + 2 = 2 * 2) under these draws.
      shapes: ["add", "subtract", "multiply"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["add", "subtract", "multiply"]);
        if (shape === "add") {
          const a = int(rng, 2, 40), b = int(rng, 2, 40);
          return {
            code: `print(${a} + ${b})\n`, shape, variant: "plain",
            variantCard: `Python adds the two numbers: \`${a} + ${b}\` is ${a + b}.`,
          };
        }
        if (shape === "subtract") {
          const b = int(rng, 2, 20), a = b + int(rng, 1, 20); // stays non-negative
          return {
            code: `print(${a} - ${b})\n`, shape, variant: "plain",
            variantCard: `Python subtracts: \`${a} - ${b}\` is ${a - b}.`,
          };
        }
        const a = int(rng, 2, 9), b = int(rng, 2, 9);
        return {
          code: `print(${a} * ${b})\n`, shape, variant: "plain",
          variantCard: `Python multiplies: \`${a} * ${b}\` is ${a * b}.`,
        };
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
            misconception: String(a2 / b / c), // the int, without the .0
            variantCard: `Even chained, \`/\` stays a float: \`${a2} / ${b} / ${c}\` is ${(a2 / b / c).toFixed(1)}.`,
          };
        }
        if (shape === "times-then-div") {
          // * and / share precedence and go left to right, no float surprises.
          return {
            code: `print(${b} * ${a / b} / ${b})\n`, shape, variant: "even-div",
            misconception: String((b * (a / b)) / b), // the int, without the .0
            variantCard: `\`*\` and \`/\` go left to right; the \`/\` still makes the result a float: ${((b * (a / b)) / b).toFixed(1)}.`,
          };
        }
        return {
          code: `print(${a} / ${b})\n`, shape, variant: "even-div",
          misconception: String(a / b), // the int, without the .0
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
            misconception: String(n + d), // did arithmetic on the text
            variantCard: `\`str(${n})\` is the text \`"${n}"\`, joined to \`"${d}"\` gives \`${n}${d}\` — not ${n + d}.`,
          };
        }
        if (shape === "digit-then-str") {
          return {
            code: `print("${d}" + str(${n}))\n`, shape, variant: "plain", misconception: String(d + n),
            variantCard: `\`str(${n})\` is the text \`"${n}"\`, and \`"${d}" + "${n}"\` joins them into \`${d}${n}\` — not ${d + n}.`,
          };
        }
        // No designed misconception here: 000T's wrong model ("adds the
        // numbers") has no instantiation against a word — it predicts an
        // error, not an output line.
        return {
          code: `print(str(${n}) + "${w}")\n`, shape, variant: "plain",
          variantCard: `\`str(${n})\` turns the number into the text \`"${n}"\`, joined to \`"${w}"\` gives \`${n}${w}\`.`,
        };
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
            misconception: `${d}${n}`, // joined the text instead of adding (3 digits vs a ≤2-digit sum)
            variantCard: `\`int("${d}")\` is the number ${d}, and ${d} + ${n} is ${d + n} — not the text \`"${d}${n}"\`.`,
          };
        }
        if (shape === "add-before") {
          return {
            code: `print(${n} + int("${d}"))\n`, shape, variant: "plain",
            misconception: `${n}${d}`, // joined the text instead of adding (3 digits vs a ≤2-digit sum)
            variantCard: `\`int("${d}")\` is the number ${d}, so ${n} + ${d} is ${n + d} — real addition, not joining text.`,
          };
        }
        // No designed misconception here: the "stays text" model cannot
        // subtract — it predicts an error, not an output line.
        return {
          code: `print(int("${d}") - ${n})\n`, shape, variant: "plain",
          variantCard: `\`int("${d}")\` is the number ${d}, so ${d} - ${n} is ${d - n}.`,
        };
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
          misconception: (a + b).toFixed(1), // the short, exact-looking decimal (the pool guarantees a visible tail)
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
      shapes: ["bool-plus-bool", "true-plus-int", "false-plus-int"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["bool-plus-bool", "true-plus-int", "false-plus-int"]);
        const n = int(rng, 2, 9);
        if (shape === "bool-plus-bool") {
          // Both operands drawn from {True, False}, so the answer is 0, 1, or 2
          // — no constant program.
          const x = pick(rng, ["True", "False"]), y = pick(rng, ["True", "False"]);
          const out = (x === "True" ? 1 : 0) + (y === "True" ? 1 : 0);
          return {
            code: `print(${x} + ${y})\n`, shape, variant: "plain",
            misconception: `${x}${y}`, // the words joined like TrueTrue — never a digit string
            variantCard: `\`${x}\` counts as ${x === "True" ? 1 : 0} and \`${y}\` as ${y === "True" ? 1 : 0}, so \`${x} + ${y}\` is ${out}.`,
          };
        }
        if (shape === "true-plus-int") {
          return {
            code: `print(True + ${n})\n`, shape, variant: "plain",
            misconception: `True${n}`, // the word joined to the digit, as if + glued them
            variantCard: `\`True\` counts as 1, so \`True + ${n}\` is ${n + 1}.`,
          };
        }
        return {
          code: `print(False + ${n})\n`, shape, variant: "plain",
          misconception: `False${n}`, // the word joined to the digit, as if + glued them
          variantCard: `\`False\` counts as 0, so \`False + ${n}\` is ${n}.`,
        };
      },
    },
  },

  {
    // Lane fix: str-literal-vs-number (000K) is a Numbers-lane concept — its
    // whole point is "text that looks like a number is not a number". Moved
    // here from state.mjs; footprint unchanged.
    id: "digit-text",
    topic: "numbers",
    focus: "000K", // str-literal-vs-number
    assumed: ["0005", "0006", "0007", "000Y"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["two-digit-strings", "three-digit-strings", "name-digit"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["two-digit-strings", "three-digit-strings", "name-digit"]);
        const a = int(rng, 1, 9), b = int(rng, 1, 9), c = int(rng, 1, 9);
        if (shape === "two-digit-strings") {
          return {
            code: `print("${a}" + "${b}")\n`, shape, variant: "plain",
            misconception: String(a + b), // added the digits
            variantCard: `\`"${a}"\` and \`"${b}"\` are text, so \`+\` joins them into \`${a}${b}\` — not the number ${a + b}.`,
          };
        }
        if (shape === "three-digit-strings") {
          return {
            code: `print("${a}" + "${b}" + "${c}")\n`, shape, variant: "plain", misconception: String(a + b + c),
            variantCard: `Each piece is text, so \`+\` joins them: \`${a}${b}${c}\` — not the number ${a + b + c}.`,
          };
        }
        const nm = pick(rng, strNames);
        return {
          code: `${nm} = "${a}"\nprint(${nm} + "${b}")\n`, shape, variant: "plain", misconception: String(a + b),
          variantCard: `\`${nm}\` holds the text \`"${a}"\`, so \`${nm} + "${b}"\` joins them into \`${a}${b}\` — not ${a + b}.`,
        };
      },
    },
  },

  {
    // Hard sibling (R1.3): three mixed-precedence operators in one line —
    // availability-gated on met(000N), so it deals only after the two-op
    // intro lands. The misconception is the strict left-to-right value.
    id: "precedence-gauntlet-hard",
    topic: "numbers",
    focus: "000N", // op-precedence
    assumed: ["0005", "0008"],
    role: "review",
    difficulty: "hard",
    form: "predict-exact-output",
    generator: {
      shapes: ["plus-times-minus", "minus-times-plus", "times-plus-times"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["plus-times-minus", "minus-times-plus", "times-plus-times"]);
        let a = int(rng, 2, 6), b = int(rng, 2, 4), c = int(rng, 2, 4), d = int(rng, 1, 4);
        if (shape === "times-plus-times") {
          const real = a * b + c * d;
          const ltr = ((a * b) + c) * d;
          if (real === ltr) d += 1; // keep the wrong path genuinely wrong (rng-free nudge)
          return {
            code: `print(${a} * ${b} + ${c} * ${d})\n`, shape, variant: "plain",
            misconception: String(((a * b) + c) * d),
            variantCard: `Both \`*\` happen first: ${a * b} + ${c * d} = ${a * b + c * d}. `
              + `Marching left to right would wrongly give ${((a * b) + c) * d}.`,
          };
        }
        if (shape === "minus-times-plus") {
          const big = a + b * c; // keeps the subtraction non-negative
          const real = big - b * c + d;
          const ltr = (big - b) * c + d;
          return {
            code: `print(${big} - ${b} * ${c} + ${d})\n`, shape, variant: "plain",
            misconception: String(ltr),
            variantCard: `\`${b} * ${c}\` happens first (${b * c}); then left to right: `
              + `${big} - ${b * c} + ${d} = ${real}. Doing the \`-\` first would give ${ltr}.`,
          };
        }
        const real = a + b * c - d;
        const ltr = (a + b) * c - d;
        return {
          code: `print(${a} + ${b} * ${c} - ${d})\n`, shape: "plus-times-minus", variant: "plain",
          misconception: String(ltr),
          variantCard: `\`${b} * ${c}\` happens first (${b * c}); then left to right: `
            + `${a} + ${b * c} - ${d} = ${real}. Left-to-right throughout would give ${ltr}.`,
        };
      },
    },
  },

  {
    // Ramp (review): floordiv drops the remainder, so a different divisor gives
    // a different whole count. DEVIATION from the plan's "000Q-vs-000P"
    // (`//` vs `/`): div-yields-float (000P) is a SIBLING of 000Q, not an
    // ancestor, so a `print(a / b)` contrast program footprints 000P outside
    // the closure (K-5). This legal single-concept spot-diff stays on 000Q.
    id: "floordiv-divisor-spot",
    topic: "numbers",
    focus: "000Q", // floordiv-quotient
    assumed: ["0005", "0008"],
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["divisor-change"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const b = int(rng, 2, 3);
        let c = b + int(rng, 1, 3); // c > b, distinct divisor
        let a = int(rng, 13, 40);
        // Ensure the two quotients genuinely differ on every seed.
        while (Math.floor(a / b) === Math.floor(a / c)) a = int(rng, 13, 40);
        return {
          code: `print(${a} // ${b})\n`,
          aOutput: String(Math.floor(a / b)),
          contrastCode: `print(${a} // ${c})\n`,
          misconception: String(Math.floor(a / b)), // "the changed line changes nothing" (= aOutput)
          shape: "divisor-change", variant: "plain",
          variantCard: `\`${a} // ${b}\` is ${Math.floor(a / b)} — how many whole \`${b}\`s fit. `
            + `Divide the same ${a} by ${c} instead and only ${Math.floor(a / c)} fit; the remainder is dropped either way.`,
        };
      },
    },
  },

  {
    // Ramp (review): the SAME dividend magnitude, sign flipped — Python's
    // `%` answers with the DIVISOR's sign, so -a % b is b − r, never the r
    // the positive program showed. Contrast 000R: answering A's remainder
    // for B is plain mod-remainder intuition applied where the sign rule
    // fires.
    id: "mod-sign-spot",
    topic: "numbers",
    focus: "000S", // mod-sign-of-divisor
    assumed: ["0005", "000R"],
    contrast: "000R",
    misconceptionOf: "000R", // answering A's r = the sign changes nothing
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["sign-flip"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        // G1: b odd → b ≠ 2r for any r, and r ≥ 1 → r ≠ 0; so
        // -a % b = b − r differs from a % b = r on every seed.
        const b = pick(rng, [3, 5, 7, 9]);
        const r = int(rng, 1, b - 1);
        const k = int(rng, 2, 9);
        const a = b * k + r;
        return {
          code: `print(${a} % ${b})\n`,
          aOutput: String(r),
          contrastCode: `print(-${a} % ${b})\n`,
          shape: "sign-flip", variant: "plain",
          misconception: String(r), // the sign changes nothing (= aOutput)
          variantCard: `\`${a} % ${b}\` leaves ${r}. Flip the dividend's sign and Python still `
            + `answers with the DIVISOR's sign (positive): \`-${a} % ${b}\` is ${b} - ${r} = ${b - r} — `
            + `not ${r}, and not \`-${r}\`.`,
        };
      },
    },
  },

  {
    // Review through a second form: str() results CONCATENATE — the latent
    // binding (never printed) is the digit string "ab", not the sum.
    // G1: a ≥ 2 → the joined digits "ab" read as 10a + b ≥ 21, while
    // a + b ≤ 18 — the misconception can never collide with the truth.
    id: "str-of-int-state",
    topic: "numbers",
    focus: "000T", // str-of-int
    assumed: ["0005", "0006", "000Y"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["two-str-calls"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const nm = pick(rng, strNames);
        const a = int(rng, 2, 9), b = int(rng, 2, 9);
        return {
          code: `${nm} = str(${a}) + str(${b})\n`,
          probeName: nm,
          shape: "two-str-calls", variant: "plain",
          misconception: String(a + b), // did arithmetic instead of joining the texts
          variantCard: `\`str(${a})\` and \`str(${b})\` are the TEXTS \`"${a}"\` and \`"${b}"\`, `
            + `so \`+\` joins them: \`${nm}\` holds \`"${a}${b}"\`, not ${a + b}.`,
        };
      },
    },
  },

  {
    // Ramp (review): one line, two readings — int("d") + k really adds;
    // leave the digits quoted and + joins text instead. Contrast 000Y:
    // answering A's sum for B = believing the quotes convert themselves.
    id: "int-vs-concat-spot",
    topic: "numbers",
    focus: "000V", // int-of-str
    assumed: ["0005", "0008", "000K", "000Y"],
    contrast: "000Y",
    misconceptionOf: "000K", // answering A's sum = quoted digits treated as numbers
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["convert-vs-concat"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        // G1: the joined digits "dk" read as 10·d + k, which equals d + k
        // only when 9·d = 0 — impossible for a two-digit d, so A ≠ B on
        // every seed.
        const d = int(rng, 12, 60);
        const k = int(rng, 1, 9);
        return {
          code: `print(int("${d}") + ${k})\n`,
          aOutput: String(d + k),
          contrastCode: `print("${d}" + "${k}")\n`,
          shape: "convert-vs-concat", variant: "plain",
          misconception: String(d + k), // the quotes convert themselves (= aOutput)
          variantCard: `\`int("${d}")\` makes a real number, so A adds: ${d + k}. Without \`int\`, `
            + `\`"${d}" + "${k}"\` stays text and \`+\` joins it: \`${d}${k}\`.`,
        };
      },
    },
  },

  {
    // Ramp (review): one word changed — True + n vs False + n. bool IS an
    // int: True counts 1, False counts 0, so the flip always moves the sum
    // by exactly 1. Contrast 0016 (the parent: True/False as values).
    // NOTE (closure): the pair stays literal — binding the bool to a name
    // would footprint 0006 name-holds-value, which is NOT an ancestor of
    // 000X in the frozen ledger.
    // No designed misconception (G2): the K-mc law pins a spot-diff
    // misconception to aOutput, and answering A's sum for B does not
    // encode 000X's real wrong model ("+ glues the word to the digit").
    id: "bool-arith-spot",
    topic: "numbers",
    focus: "000X", // bool-is-int
    assumed: ["0005", "0008", "0016"],
    contrast: "0016",
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["flip-lead-bool", "flip-trail-bool"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["flip-lead-bool", "flip-trail-bool"]);
        // G1: True + n = n + 1 and False + n = n differ by exactly 1 on
        // every seed — flipping the word always moves the sum.
        const n = int(rng, 2, 9);
        if (shape === "flip-trail-bool") {
          return {
            code: `print(${n} + True)\n`,
            aOutput: String(n + 1),
            contrastCode: `print(${n} + False)\n`,
            shape, variant: "plain",
            variantCard: `\`True\` counts as 1 and \`False\` as 0, so \`${n} + True\` is ${n + 1} `
              + `while \`${n} + False\` stays ${n}.`,
          };
        }
        return {
          code: `print(True + ${n})\n`,
          aOutput: String(n + 1),
          contrastCode: `print(False + ${n})\n`,
          shape: "flip-lead-bool", variant: "plain",
          variantCard: `\`True\` counts as 1 and \`False\` as 0, so \`True + ${n}\` is ${n + 1} `
            + `while \`False + ${n}\` is just ${n}.`,
        };
      },
    },
  },

  {
    // 000K's lane is Numbers (see digit-text): text that LOOKS numeric
    // still concatenates. predict-state makes the digit string latent —
    // the program never prints `s`. Operand strings are single DIGITS,
    // never letters that could read as a bound name (analyzer row 2).
    // G1: n ≥ 1 → the joined digits "nm" read as 10·n + m, which equals
    // n + m only when 9·n = 0 — never; truth "nm" ≠ String(n + m).
    id: "text-arith-state",
    topic: "numbers",
    focus: "000K", // str-literal-vs-number
    assumed: ["0005", "0006", "000Y"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["two-names-concat"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        // Operand names drawn distinct from strNames minus the probe `s`.
        const opPool = strNames.filter((x) => x !== "s");
        const i1 = int(rng, 0, opPool.length - 1);
        const i2 = (i1 + 1 + int(rng, 0, opPool.length - 2)) % opPool.length; // ≠ i1
        const n1 = opPool[i1], n2 = opPool[i2];
        const a = int(rng, 1, 9), b = int(rng, 1, 9);
        return {
          code: `${n1} = "${a}"\n${n2} = "${b}"\ns = ${n1} + ${n2}\n`,
          probeName: "s",
          shape: "two-names-concat", variant: "plain",
          misconception: String(a + b), // added the digits instead of joining the texts
          variantCard: `\`"${a}"\` and \`"${b}"\` are text, so \`${n1} + ${n2}\` joins them: `
            + `\`s\` holds \`"${a}${b}"\`, not the number ${a + b}.`,
        };
      },
    },
  },
];
