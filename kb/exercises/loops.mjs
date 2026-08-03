// Loops & ranges intro exercises (design §3.7). range intros use
// print(list(range(...))) so they stay one line; loop-for-visits-each is
// the flagged multi-line intro; the rest print a single summary line.

import { mulberry32, int, pick } from "../rng.mjs";

export default [
  {
    id: "for-visits",
    topic: "loops",
    focus: "001E", // loop-for-visits-each
    assumed: ["0005", "0006", "000D"],
    role: "intro",
    form: "predict-exact-output",
    multiline: true,
    generator: {
      shapes: ["three-items", "four-items", "named-list"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["three-items", "four-items", "named-list"]);
        if (shape === "named-list") {
          const items = Array.from({ length: 3 }, () => int(rng, 1, 9) * 10);
          return { code: `xs = [${items.join(", ")}]\nfor x in xs:\n    print(x)\n`, shape, variant: "plain" };
        }
        const n = shape === "three-items" ? 3 : 4;
        const items = Array.from({ length: n }, () => int(rng, 1, 9) * 10);
        return { code: `for x in [${items.join(", ")}]:\n    print(x)\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "range-stop",
    topic: "loops",
    focus: "001F", // range-stop-excluded
    assumed: ["0005", "0006", "001E"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["bare-range", "named-range"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const n = int(rng, 3, 6);
        if (pick(rng, ["bare-range", "named-range"]) === "named-range") {
          return {
            code: `xs = list(range(${n}))\nprint(xs)\n`,
            shape: "named-range", variant: "plain",
            variantCard: `\`range(${n})\` counts from 0 and stops before ${n}: ${Array.from({ length: n }, (_, i) => i).join(", ")}.`,
          };
        }
        return {
          code: `print(list(range(${n})))\n`,
          shape: "bare-range", variant: "plain",
          variantCard: `\`range(${n})\` counts from 0 and stops before ${n}: ${Array.from({ length: n }, (_, i) => i).join(", ")}.`,
        };
      },
    },
  },

  {
    id: "range-start",
    topic: "loops",
    focus: "001G", // range-start-stop
    assumed: ["0005", "0006", "001E", "001F"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["start-stop", "named-start-stop"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 1, 4), b = a + int(rng, 3, 5);
        if (pick(rng, ["start-stop", "named-start-stop"]) === "named-start-stop") {
          return {
            code: `xs = list(range(${a}, ${b}))\nprint(xs)\n`,
            shape: "named-start-stop", variant: "plain",
            variantCard: `\`range(${a}, ${b})\` starts at ${a}, stops before ${b}.`,
          };
        }
        return {
          code: `print(list(range(${a}, ${b})))\n`,
          shape: "start-stop", variant: "plain",
          variantCard: `\`range(${a}, ${b})\` starts at ${a}, stops before ${b}.`,
        };
      },
    },
  },

  {
    id: "range-with-step",
    topic: "loops",
    focus: "001H", // range-step
    assumed: ["0005", "0006", "001E", "001F", "001G"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["step", "named-step"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 1, 3), s = int(rng, 2, 3), b = a + s * int(rng, 2, 3) + 1;
        if (pick(rng, ["step", "named-step"]) === "named-step") {
          return {
            code: `xs = list(range(${a}, ${b}, ${s}))\nprint(xs)\n`,
            shape: "named-step", variant: "plain",
            variantCard: `\`range(${a}, ${b}, ${s})\` starts at ${a} and steps by ${s}, stopping before ${b}.`,
          };
        }
        return {
          code: `print(list(range(${a}, ${b}, ${s})))\n`,
          shape: "step", variant: "plain",
          variantCard: `\`range(${a}, ${b}, ${s})\` starts at ${a} and steps by ${s}, stopping before ${b}.`,
        };
      },
    },
  },

  {
    id: "loop-total",
    topic: "loops",
    focus: "001J", // loop-accumulate
    assumed: ["0005", "0006", "0008", "0009", "000A", "000B", "000D", "001E"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["sum-items", "count-items", "product-items"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["sum-items", "count-items", "product-items"]);
        if (shape === "count-items") {
          const items = Array.from({ length: int(rng, 3, 5) }, () => int(rng, 1, 9));
          return {
            code: `count = 0\nfor x in [${items.join(", ")}]:\n    count = count + 1\nprint(count)\n`,
            shape, variant: "plain",
            variantCard: `The counter adds 1 per pass — one pass per item — so it ends at ${items.length}.`,
          };
        }
        if (shape === "product-items") {
          const items = Array.from({ length: 3 }, () => int(rng, 1, 4));
          const prod = items.reduce((a, b) => a * b, 1);
          return {
            code: `total = 1\nfor x in [${items.join(", ")}]:\n    total = total * x\nprint(total)\n`,
            shape, variant: "plain",
            variantCard: `Starting at 1 and multiplying each pass: ${items.join(" × ")} = ${prod}.`,
          };
        }
        const items = Array.from({ length: 3 }, () => int(rng, 1, 6));
        const total = items.reduce((a, b) => a + b, 0);
        return {
          code: `total = 0\nfor x in [${items.join(", ")}]:\n    total = total + x\nprint(total)\n`,
          shape: "sum-items", variant: "plain",
          variantCard: `The total grows each pass: ${items.join(" + ")} = ${total}.`,
        };
      },
    },
  },

  {
    id: "loop-collect",
    topic: "loops",
    focus: "001K", // loop-build-list
    assumed: ["0005", "0006", "000D", "000G", "001E"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["append-each", "append-constant", "append-to-nonempty"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["append-each", "append-constant", "append-to-nonempty"]);
        const items = Array.from({ length: 3 }, () => int(rng, 1, 9));
        if (shape === "append-constant") {
          const k = int(rng, 1, 9);
          return {
            code: `xs = []\nfor x in [${items.join(", ")}]:\n    xs.append(${k})\nprint(xs)\n`,
            shape, variant: "plain",
            variantCard: `One append per pass, always ${k}: [${[k, k, k].join(", ")}].`,
          };
        }
        if (shape === "append-to-nonempty") {
          const start = int(rng, 10, 20);
          return {
            code: `xs = [${start}]\nfor x in [${items.join(", ")}]:\n    xs.append(x)\nprint(xs)\n`,
            shape, variant: "plain",
            variantCard: `The list starts with ${start} and grows one item per pass: [${[start, ...items].join(", ")}].`,
          };
        }
        return {
          code: `xs = []\nfor x in [${items.join(", ")}]:\n    xs.append(x)\nprint(xs)\n`,
          shape: "append-each", variant: "plain",
          variantCard: `Each pass appends one item, so xs becomes [${items.join(", ")}].`,
        };
      },
    },
  },

  {
    id: "while-counts-down",
    topic: "loops",
    focus: "001M", // while-repeats-while-true
    assumed: ["0005", "0006", "0008", "000A", "000B", "0015"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["count-down", "count-up", "doubling"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["count-down", "count-up", "doubling"]);
        if (shape === "count-up") {
          const stop = int(rng, 4, 8);
          return {
            code: `n = 0\nwhile n < ${stop}:\n    n = n + 2\nprint(n)\n`,
            shape, variant: "plain",
            variantCard: `\`n\` climbs by 2 until \`n < ${stop}\` fails — the first value NOT below ${stop} is what remains: ${Math.ceil(stop / 2) * 2}.`,
          };
        }
        if (shape === "doubling") {
          const stop = int(rng, 5, 12);
          let n = 1; while (n < stop) n *= 2;
          return {
            code: `n = 1\nwhile n < ${stop}:\n    n = n * 2\nprint(n)\n`,
            shape, variant: "plain",
            variantCard: `\`n\` doubles each pass and stops the moment \`n < ${stop}\` fails: ${n}.`,
          };
        }
        const start = int(rng, 3, 7);
        return {
          code: `n = ${start}\nwhile n > 0:\n    n = n - 1\nprint(n)\n`,
          shape: "count-down", variant: "plain",
          variantCard: `\`n\` goes ${start} down to 0, then \`n > 0\` is false, so the loop stops at \`0\`.`,
        };
      },
    },
  },

  {
    id: "break-stops",
    topic: "loops",
    focus: "001N", // break-exits
    assumed: ["0005", "0006", "000D", "0015", "0017", "001E"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["break-on-threshold", "break-on-equal", "break-then-after"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 4, 6);
        const shape = pick(rng, ["break-on-threshold", "break-on-equal", "break-then-after"]);
        if (shape === "break-on-equal") {
          return {
            code: `for x in [${a}, ${a + 1}, ${a + 2}]:\n    if x == ${a + 1}:\n        break\n    print(x)\n`,
            shape, variant: "plain",
            variantCard: `${a} prints; at ${a + 1} the \`==\` test is true, so \`break\` leaves the whole loop. Only \`${a}\` prints.`,
          };
        }
        if (shape === "break-then-after") {
          const w = "done";
          return {
            code: `for x in [${a}, ${a + 1}, ${a + 2}]:\n    if x > ${a - 1}:\n        break\nprint("${w}")\n`,
            shape, variant: "plain",
            variantCard: `The very first item trips the test, so \`break\` leaves the loop before anything prints; then the after-line prints \`${w}\`.`,
          };
        }
        return {
          code: `for x in [${a}, ${a + 1}, ${a + 2}]:\n    if x > ${a}:\n        break\n    print(x)\n`,
          shape: "break-on-threshold", variant: "plain",
          variantCard: `At ${a} the test is false, so ${a} prints; at ${a + 1} the test is true, so \`break\` ends the loop. Only \`${a}\` prints.`,
        };
      },
    },
  },

  {
    id: "continue-skips-one",
    topic: "loops",
    focus: "001P", // continue-skips
    assumed: ["0005", "0006", "000D", "0015", "0017", "001E"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["skip-first", "skip-second", "skip-big"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 2, 6), b = a + int(rng, 1, 3);
        const shape = pick(rng, ["skip-first", "skip-second", "skip-big"]);
        if (shape === "skip-second") {
          return {
            code: `for x in [${a}, ${b}]:\n    if x == ${b}:\n        continue\n    print(x)\n`,
            shape, variant: "plain",
            variantCard: `${a} prints normally; the pass for ${b} is skipped by \`continue\`, and the loop simply ends.`,
          };
        }
        if (shape === "skip-big") {
          // Two of the three items trip the skip; exactly one survives.
          return {
            code: `for x in [${b + 10}, ${a}, ${b + 12}]:\n    if x > ${b}:\n        continue\n    print(x)\n`,
            shape, variant: "plain",
            variantCard: `\`continue\` skips ${b + 10} and ${b + 12} (both > ${b}); only \`${a}\` survives to print.`,
          };
        }
        return {
          code: `for x in [${a}, ${b}]:\n    if x == ${a}:\n        continue\n    print(x)\n`,
          shape: "skip-first", variant: "plain",
          variantCard: `The pass for ${a} is skipped by \`continue\`, but the loop goes on and prints \`${b}\`.`,
        };
      },
    },
  },

  {
    id: "for-else-runs",
    topic: "loops",
    focus: "001Q", // for-else-no-break
    assumed: ["0005", "0006", "000D", "0016", "0017", "001E", "001N"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["no-break"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = Array.from({ length: 3 }, () => int(rng, 1, 9));
        const word = pick(rng, ["done", "clear", "found", "ready"]);
        return {
          code: `for x in [${items.join(", ")}]:\n    if False:\n        break\nelse:\n    print("${word}")\n`,
          shape: "no-break", variant: "plain",
          variantCard: `No \`break\` happens, so the loop's \`else\` runs and prints \`${word}\`.`,
        };
      },
    },
  },
];
