// State & I/O intro exercises (phase-1 slice). Every exercise: one focus
// concept, assumed ⊆ ancestors(focus), and a seeded deterministic
// generator whose every program stays inside footprint ⊆ assumed ∪
// {focus} ∪ Structural (checked across 40 seeds in tests/kb.spec.mjs).

import { mulberry32, int, pick } from "../rng.mjs";
import { words, phrases, names, strNames } from "../pools.mjs";

export default [
  {
    id: "digit-text",
    topic: "state",
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
            variantCard: `\`"${a}"\` and \`"${b}"\` are text, so \`+\` joins them into \`${a}${b}\` — not the number ${a + b}.`,
          };
        }
        if (shape === "three-digit-strings") return { code: `print("${a}" + "${b}" + "${c}")\n`, shape, variant: "plain" };
        const nm = pick(rng, strNames);
        return { code: `${nm} = "${a}"\nprint(${nm} + "${b}")\n`, shape, variant: "plain" };
      },
    },
  },
  {
    id: "hello-print",
    topic: "state",
    focus: "0005", // print-text
    assumed: [],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["one-word", "two-words", "three-words"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["one-word", "two-words", "three-words"]);
        let text;
        if (shape === "one-word") text = pick(rng, words);
        else if (shape === "two-words") text = pick(rng, phrases).join(" ");
        else text = `${pick(rng, words)} ${pick(rng, words)} ${pick(rng, words)}`;
        return { code: `print("${text}")\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "name-then-print",
    topic: "state",
    focus: "0006", // name-holds-value
    assumed: ["0005"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      // 2 structural shapes here + fill-value's "fill-assign" form → ≥3 for 0006.
      shapes: ["bind-and-print", "two-binds"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const i1 = int(rng, 0, names.length - 1);
        const i2 = (i1 + 1 + int(rng, 0, names.length - 2)) % names.length;
        const n1 = names[i1], n2 = names[i2];
        const v = int(rng, 2, 9), w = int(rng, 10, 20);
        if (pick(rng, ["bind-and-print", "two-binds"]) === "two-binds") {
          return { code: `${n1} = ${v}\n${n2} = ${w}\nprint(${n1})\n`, shape: "two-binds", variant: "plain" };
        }
        return { code: `${n1} = ${v}\nprint(${n1})\n`, shape: "bind-and-print", variant: "plain" };
      },
    },
  },

  {
    id: "quoted-or-name",
    topic: "state",
    focus: "0007", // quoted-vs-name
    assumed: ["0005", "0006"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["print-quoted", "print-name", "decoy-bind"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const name = pick(rng, names);
        const v = int(rng, 2, 9);
        const shape = pick(rng, ["print-quoted", "print-name", "decoy-bind"]);
        if (shape === "print-quoted") {
          return {
            code: `${name} = ${v}\nprint("${name}")\n`,
            shape, variant: "plain",
            variantCard: `The quotes make \`"${name}"\` a piece of text — just the `
              + `letters ${name}. The value ${v} is only reached through the bare `
              + `name, without quotes.`,
          };
        }
        if (shape === "decoy-bind") {
          // Two names bound; the quoted one is printed — the decoy bind makes
          // "which one is text?" a real decision, not a pattern match.
          const other = names[(names.indexOf(name) + 1) % names.length];
          const w = int(rng, 10, 20);
          return {
            code: `${name} = ${v}\n${other} = ${w}\nprint("${other}")\n`,
            shape, variant: "plain",
            variantCard: `The quotes make \`"${other}"\` a piece of text — the letters `
              + `${other} — no matter what value the name ${other} holds.`,
          };
        }
        return {
          code: `${name} = ${v}\nprint(${name})\n`,
          shape, variant: "plain",
          variantCard: `Bare \`${name}\` (no quotes) looks up the name ${name} and `
            + `prints the value it holds: ${v}. Quoted \`"${name}"\` would print `
            + `the letters ${name} instead.`,
        };
      },
    },
  },

  {
    id: "bind-computed",
    topic: "state",
    focus: "0009", // evaluate-before-bind
    assumed: ["0005", "0006", "0008"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["bind-sum", "bind-product", "bind-three-terms"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const name = pick(rng, names);
        const shape = pick(rng, ["bind-sum", "bind-product", "bind-three-terms"]);
        const a = int(rng, 2, 6), b = int(rng, 2, 6), c = int(rng, 2, 6);
        if (shape === "bind-three-terms") {
          return { code: `${name} = ${a} + ${b} + ${c}\nprint(${name})\n`, shape, variant: "plain" };
        }
        const op = shape === "bind-sum" ? "+" : "*";
        return { code: `${name} = ${a} ${op} ${b}\nprint(${name})\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "rebind-replaces",
    topic: "state",
    focus: "000A", // rebind-updates-name
    assumed: ["0005", "0006"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["rebind", "three-rebinds", "decoy-neighbor"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const i1 = int(rng, 0, names.length - 1);
        const i2 = (i1 + 1 + int(rng, 0, names.length - 2)) % names.length;
        const name = names[i1], other = names[i2];
        const a = int(rng, 2, 9);
        const b = int(rng, 10, 20);
        const c = int(rng, 21, 30);
        const shape = pick(rng, ["rebind", "three-rebinds", "decoy-neighbor"]);
        if (shape === "three-rebinds") {
          return {
            code: `${name} = ${a}\n${name} = ${b}\n${name} = ${c}\nprint(${name})\n`,
            shape, variant: "plain",
            variantCard: `Only the LAST assignment survives: \`${name}\` holds ${c}.`,
          };
        }
        if (shape === "decoy-neighbor") {
          // A second name binds in between; only the rebound one changes.
          return {
            code: `${name} = ${a}\n${other} = ${b}\n${name} = ${c}\nprint(${name})\n`,
            shape, variant: "plain",
            variantCard: `\`${other}\` is a different name — rebinding \`${name}\` to ${c} `
              + `replaces its ${a}; the print shows ${c}.`,
          };
        }
        return { code: `${name} = ${a}\n${name} = ${b}\nprint(${name})\n`, shape: "rebind", variant: "plain" };
      },
    },
  },

  {
    id: "accumulate-step",
    topic: "state",
    focus: "000B", // accumulate-rebind
    assumed: ["0005", "0006", "0008", "0009", "000A"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["plus-step", "minus-step", "two-steps"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const name = pick(rng, names);
        const shape = pick(rng, ["plus-step", "minus-step", "two-steps"]);
        const start = int(rng, 5, 12);
        const step = int(rng, 2, 4);
        if (shape === "two-steps") {
          const step2 = int(rng, 2, 4);
          return {
            code: `${name} = ${start}\n${name} = ${name} + ${step}\n${name} = ${name} + ${step2}\nprint(${name})\n`,
            shape, variant: "plain",
            variantCard: `Each line reads the CURRENT value: ${start} → ${start + step} → `
              + `${start + step + step2}.`,
          };
        }
        const op = shape === "plus-step" ? "+" : "-";
        return {
          code: `${name} = ${start}\n${name} = ${name} ${op} ${step}\nprint(${name})\n`,
          shape, variant: "plain",
          variantCard: `The right side uses the OLD value: \`${name} ${op} ${step}\` `
            + `is \`${start} ${op} ${step}\`, which is ${op === "+" ? start + step : start - step}. `
            + `Then that result replaces ${start} in \`${name}\`.`,
        };
      },
    },
  },

  {
    id: "print-two-values",
    topic: "state",
    focus: "000J", // print-multi-args
    assumed: ["0005", "0006"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["two-names", "three-args", "label-and-name"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const i1 = int(rng, 0, names.length - 1);
        const i2 = (i1 + 1 + int(rng, 0, names.length - 2)) % names.length; // ≠ i1
        const n1 = names[i1], n2 = names[i2];
        const a = int(rng, 2, 9), b = int(rng, 2, 9);
        const shape = pick(rng, ["two-names", "three-args", "label-and-name"]);
        if (shape === "three-args") {
          const c = int(rng, 10, 20);
          return {
            code: `${n1} = ${a}\n${n2} = ${b}\nprint(${n1}, ${n2}, ${c})\n`,
            shape, variant: "plain",
            variantCard: `Each comma puts ONE space between the pieces: \`${a} ${b} ${c}\`.`,
          };
        }
        if (shape === "label-and-name") {
          const w = pick(rng, words);
          return {
            code: `${n1} = ${a}\nprint("${w}", ${n1})\n`,
            shape, variant: "plain",
            variantCard: `The text and the value print on one line with a single space: \`${w} ${a}\`.`,
          };
        }
        return {
          code: `${n1} = ${a}\n${n2} = ${b}\nprint(${n1}, ${n2})\n`,
          shape: "two-names", variant: "plain",
          variantCard: `\`print(${n1}, ${n2})\` prints both values on one line with a `
            + `single space between them: \`${a} ${b}\` — not \`${a}${b}\`, not a comma.`,
        };
      },
    },
  },

  {
    id: "swap-two",
    topic: "state",
    focus: "000M", // swap-right-side-first
    assumed: ["0005", "0006"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["swap-print-b"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const p = int(rng, 2, 9);
        const q = ((p - 2 + int(rng, 1, 7)) % 8) + 2; // in [2,9], ≠ p
        return {
          code: `a = ${p}\nb = ${q}\na, b = b, a\nprint(b)\n`,
          shape: "swap-print-b", variant: "plain",
          variantCard: `The whole right side \`b, a\` is read first (the old ${q} and ${p}), `
            + `then stored into \`a\` and \`b\`. So \`b\` ends up with the old \`a\`: ${p}. `
            + `Doing it one step at a time would wrongly leave both at ${q}.`,
        };
      },
    },
  },

  {
    id: "copy-then-rebind",
    topic: "state",
    focus: "000C", // name-from-name
    assumed: ["0005", "0006", "000A"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["copy-then-rebind-source", "copy-of-copy", "read-source-after-copy"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 2, 9);
        const b = int(rng, 10, 20);
        const shape = pick(rng, ["copy-then-rebind-source", "copy-of-copy", "read-source-after-copy"]);
        if (shape === "copy-of-copy") {
          return {
            code: `a = ${a}\nb = a\nc = b\nb = ${b}\nprint(c)\n`,
            shape, variant: "plain",
            variantCard: `\`c = b\` copied ${a} at that moment. Rebinding \`b\` later does not `
              + `touch \`c\` — it still holds ${a}.`,
          };
        }
        if (shape === "read-source-after-copy") {
          return {
            code: `a = ${a}\nb = a\nb = ${b}\nprint(a)\n`,
            shape, variant: "plain",
            variantCard: `\`b = a\` copied the VALUE; the names stay separate. Rebinding `
              + `\`b\` to ${b} leaves \`a\` at ${a}.`,
          };
        }
        return {
          code: `a = ${a}\nb = a\na = ${b}\nprint(b)\n`,
          shape: "copy-then-rebind-source",
          variant: "plain",
          variantCard: `\`b = a\` copied the value a held at that moment: ${a}. `
            + `Rebinding \`a\` to ${b} afterwards does not touch \`b\` — it still `
            + `holds ${a}.`,
        };
      },
    },
  },
];
