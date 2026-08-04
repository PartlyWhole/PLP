// Strings intro exercises (design §3.4). Every generated program stays
// inside footprint ⊆ assumed ∪ {focus} ∪ Structural (checked over 40 seeds
// by the K-series). Core concepts carry ≥3 program-shape archetypes.

import { mulberry32, int, pick } from "../rng.mjs";
import { words, longWords, strNames, capWords, lowWords } from "../pools.mjs";
import { orderPair } from "../contrast.mjs";

export default [
  {
    id: "concat-text",
    topic: "strings",
    focus: "000Y", // str-concat
    assumed: ["0005", "0006", "0007"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["two-literals", "three-literals", "name-plus-literal"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["two-literals", "three-literals", "name-plus-literal"]);
        const a = pick(rng, words), b = pick(rng, words), c = pick(rng, words);
        if (shape === "two-literals") return { code: `print("${a}" + "${b}")\n`, shape, variant: "plain" };
        if (shape === "three-literals") return { code: `print("${a}" + "${b}" + "${c}")\n`, shape, variant: "plain" };
        const nm = pick(rng, strNames);
        return { code: `${nm} = "${a}"\nprint(${nm} + "${b}")\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "repeat-text",
    topic: "strings",
    focus: "000Z", // str-repeat
    assumed: ["0005", "0006", "0008", "000Y"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["literal-times", "times-literal", "name-times"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["literal-times", "times-literal", "name-times"]);
        const w = pick(rng, words), n = int(rng, 2, 4);
        if (shape === "literal-times") return { code: `print("${w}" * ${n})\n`, shape, variant: "plain" };
        if (shape === "times-literal") return { code: `print(${n} * "${w}")\n`, shape, variant: "plain" };
        const nm = pick(rng, strNames);
        return { code: `${nm} = "${w}"\nprint(${nm} * ${n})\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "index-negative",
    topic: "strings",
    focus: "0010", // index-from-end
    assumed: ["0005", "0006", "0007", "000E"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["last", "near-end"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const word = pick(rng, longWords);
        const shape = pick(rng, ["last", "near-end"]);
        const i = shape === "last" ? 1 : int(rng, 2, 3);
        return {
          code: `s = "${word}"\nprint(s[-${i}])\n`,
          shape, variant: "plain",
          variantCard: `Counting from the end, \`s[-${i}]\` is the ${i}${i === 1 ? "st" : i === 2 ? "nd" : "rd"} `
            + `character from the right of \`"${word}"\` — that's \`${word[word.length - i]}\`.`,
        };
      },
    },
  },

  {
    id: "slice-two-ends",
    topic: "strings",
    focus: "0011", // slice-half-open
    assumed: ["0005", "0006", "0007", "000E"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["bare-slice", "name-slice", "assigned-slice"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const word = pick(rng, longWords);
        const a = int(rng, 0, 1), b = a + int(rng, 2, 3);
        const shape = pick(rng, ["bare-slice", "name-slice", "assigned-slice"]);
        const card = `\`[${a}:${b}]\` takes positions ${a} up to but not ${b}, so `
          + `\`"${word}"[${a}:${b}]\` is \`${word.slice(a, b)}\`.`;
        if (shape === "bare-slice") return { code: `print("${word}"[${a}:${b}])\n`, shape, variant: "plain", variantCard: card };
        if (shape === "name-slice") return { code: `s = "${word}"\nprint(s[${a}:${b}])\n`, shape, variant: "plain", variantCard: card };
        return { code: `s = "${word}"\nt = s[${a}:${b}]\nprint(t)\n`, shape, variant: "plain", variantCard: card };
      },
    },
  },

  {
    id: "slice-open",
    topic: "strings",
    focus: "0012", // slice-open-ended
    assumed: ["0005", "0006", "0007", "0011"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["open-right", "open-left", "name-open-right"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const word = pick(rng, longWords);
        const shape = pick(rng, ["open-right", "open-left", "name-open-right"]);
        if (shape === "open-right") {
          const a = int(rng, 2, 3);
          return { code: `print("${word}"[${a}:])\n`, shape, variant: "plain", variantCard: `\`[${a}:]\` runs from position ${a} to the end: \`${word.slice(a)}\`.` };
        }
        if (shape === "open-left") {
          const b = int(rng, 2, 3);
          return { code: `print("${word}"[:${b}])\n`, shape, variant: "plain", variantCard: `\`[:${b}]\` runs from the start up to position ${b}: \`${word.slice(0, b)}\`.` };
        }
        const a = int(rng, 2, 3);
        return { code: `s = "${word}"\nprint(s[${a}:])\n`, shape, variant: "plain", variantCard: `\`[${a}:]\` runs from position ${a} to the end: \`${word.slice(a)}\`.` };
      },
    },
  },

  {
    id: "text-immutable",
    topic: "strings",
    focus: "0013", // str-immutable-rebind
    assumed: ["0005", "0006", "000A", "000C", "000Y"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["copy-then-rebuild"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const w = pick(rng, words), suffix = pick(rng, words);
        return {
          code: `a = "${w}"\nb = a\na = a + "${suffix}"\nprint(b)\n`,
          shape: "copy-then-rebuild", variant: "plain",
          variantCard: `\`a + "${suffix}"\` builds NEW text and rebinds \`a\`; it does not `
            + `change the old text. \`b\` still holds the copy it took: \`${w}\`.`,
        };
      },
    },
  },

  {
    id: "text-compare",
    topic: "strings",
    focus: "0014", // str-compare-code-points
    assumed: ["0005", "0015", "0016"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["capital-vs-lower"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const cap = pick(rng, capWords), low = pick(rng, lowWords);
        return {
          code: `print("${cap}" < "${low}")\n`,
          shape: "capital-vs-lower", variant: "plain",
          variantCard: `Capital \`${cap[0]}\` has a smaller code than lowercase \`${low[0]}\`, so `
            + `\`"${cap}"\` sorts before \`"${low}"\` and the answer is \`True\`.`,
        };
      },
    },
  },

  {
    id: "capture-order",
    topic: "strings",
    focus: "0013", // str-immutable-rebind — t = s captures the text it sees NOW
    assumed: ["0005", "0006", "000A", "000C", "000Y"],
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["one-suffix", "two-suffix"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["one-suffix", "two-suffix"]);
        const w = pick(rng, words), s1 = pick(rng, words), s2 = pick(rng, words);
        if (shape === "two-suffix") {
          const { code, contrastCode } = orderPair(
            [`s = "${w}"`, `t = s`, `s = s + "${s1}"`, `s = s + "${s2}"`, `print(t)`], 1, 3);
          return {
            code, aOutput: w, contrastCode,
            shape, variant: "plain",
            variantCard: `\`t = s\` captures the text \`s\` holds when it runs. Capture first and \`t\` `
              + `keeps \`${w}\`; capture after both rebuilds and \`t\` is \`${w + s1 + s2}\`. `
              + `Building new text never changes the copy already taken.`,
          };
        }
        const { code, contrastCode } = orderPair(
          [`s = "${w}"`, `t = s`, `s = s + "${s1}"`, `print(t)`], 1, 2);
        return {
          code, aOutput: w, contrastCode,
          shape, variant: "plain",
          variantCard: `Only the \`t = s\` line moved. Take the copy BEFORE \`s\` is rebuilt and \`t\` `
            + `is \`${w}\`; take it AFTER and \`t\` is \`${w + s1}\`.`,
        };
      },
    },
  },
];
