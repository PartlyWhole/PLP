// Alternate-form exercises (design §5.2). predict-state asks "after this
// program runs, what does `a` hold?" — the way LATENT state (a value the
// program never prints) becomes examinable. The displayed program does NOT
// print the probed name; the KB analyzer footprints it AS-GRADED (the probe
// read is what makes the concept observable), so the K-series augments the
// program with `print(<probeName>)` before footprinting (see tests/kb.spec.mjs
// footprintSource). These review the same concepts their predict-output
// intros teach, through a second form.

import { mulberry32, int, pick } from "../rng.mjs";
import { names } from "../pools.mjs";

// A blank is authored by writing the program with a NUL marker where the
// hole goes; this returns the full (correct) code plus the hole's position,
// so the runtime can display `code` with a `___` and grade a substituted
// fill by real execution.
function blankFrom(template, token) {
  const idx = template.indexOf("\x00");
  const before = template.slice(0, idx);
  const line = before.split("\n").length;                 // 1-indexed
  const col = idx - (before.lastIndexOf("\n") + 1);        // 0-indexed on its line
  return { code: template.replace("\x00", token), blank: { line, col, len: token.length, target: token } };
}

export default [
  {
    id: "fill-arith-op",
    topic: "numbers",
    focus: "0008", // arith-on-ints — fill the operator that makes it print the target
    assumed: ["0005"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["fill-op"],
      variants: ["plus", "minus", "times"],
      generate(seed) {
        const rng = mulberry32(seed);
        const variant = pick(rng, ["plus", "minus", "times"]);
        let a, b, op, result;
        if (variant === "plus") { a = int(rng, 2, 9); b = int(rng, 2, 9); op = "+"; result = a + b; }
        else if (variant === "minus") { b = int(rng, 2, 9); a = b + int(rng, 1, 9); op = "-"; result = a - b; }
        else { a = int(rng, 2, 6); b = int(rng, 2, 6); op = "*"; result = a * b; }
        const { code, blank } = blankFrom(`print(${a} \x00 ${b})\n`, op);
        return {
          code, blank, targetOutput: String(result),
          shape: "fill-op", variant,
          variantCard: `Filling in \`${op}\` makes \`${a} ${op} ${b}\`, which prints \`${result}\`.`,
        };
      },
    },
  },

  {
    id: "fill-value",
    topic: "state",
    focus: "0006", // name-holds-value — fill a value that makes the name print the target
    assumed: ["0005"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["fill-assign"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const name = pick(rng, names);
        const v = int(rng, 2, 20);
        const { code, blank } = blankFrom(`${name} = \x00\nprint(${name})\n`, String(v));
        return {
          code, blank, targetOutput: String(v),
          shape: "fill-assign", variant: "plain",
          variantCard: `Any value that makes \`${name}\` hold ${v} works — the simplest is \`${v}\`.`,
        };
      },
    },
  },

  {
    id: "fill-mod",
    topic: "numbers",
    focus: "000R", // mod-remainder — pick the operator that yields the remainder
    assumed: ["0005", "0008", "000Q"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["fill-mod-op"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const b = int(rng, 3, 9);
        const r = int(rng, 1, b - 1);
        const k = r + int(rng, 1, 5); // quotient ≠ remainder, so % is the only fit
        const a = b * k + r;
        const { code, blank } = blankFrom(`print(${a} \x00 ${b})\n`, "%");
        return {
          code, blank, targetOutput: String(r),
          shape: "fill-mod-op", variant: "plain",
          variantCard: `Only \`%\` gives the remainder: \`${a} % ${b}\` is ${r} `
            + `(\`//\` would give the ${k} whole times instead).`,
        };
      },
    },
  },

  {
    id: "mod-vs-floordiv",
    topic: "numbers",
    focus: "000R", // mod-remainder — contrasted against // (its parent)
    assumed: ["0005", "0008", "000Q"],
    contrast: "000Q",
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["floordiv-vs-mod"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const b = int(rng, 3, 9);
        const r = int(rng, 1, b - 1);
        const k = r + int(rng, 1, 5); // quotient ≠ remainder
        const a = b * k + r;
        return {
          code: `print(${a} // ${b})\n`,
          aOutput: String(k),
          contrastCode: `print(${a} % ${b})\n`,
          shape: "floordiv-vs-mod", variant: "plain",
          variantCard: `\`//\` gives the ${k} whole times \`${b}\` fits; \`%\` gives what is `
            + `LEFT OVER after those fits: ${r}.`,
        };
      },
    },
  },

  {
    id: "fill-bool",
    topic: "logic",
    focus: "0016", // bool-values — spell the value that prints True/False
    assumed: ["0005"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["fill-bool-value"],
      variants: ["true", "false"],
      generate(seed) {
        const rng = mulberry32(seed);
        const want = pick(rng, ["True", "False"]);
        const { code, blank } = blankFrom(`print(\x00)\n`, want);
        return {
          code, blank, targetOutput: want,
          shape: "fill-bool-value", variant: want.toLowerCase(),
          variantCard: `The yes-or-no values are spelled \`True\` and \`False\` — capital `
            + `first letter, no quotes. \`${want}\` prints exactly \`${want}\`.`,
        };
      },
    },
  },

  {
    id: "fill-range-stop",
    topic: "loops",
    focus: "001F", // range-stop-excluded — fill the n that yields the list
    assumed: ["0005", "001E"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["fill-stop"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const n = int(rng, 3, 6);
        const target = `[${Array.from({ length: n }, (_, i) => i).join(", ")}]`;
        const { code, blank } = blankFrom(`print(list(range(\x00)))\n`, String(n));
        return {
          code, blank, targetOutput: target,
          shape: "fill-stop", variant: "plain",
          variantCard: `The list ends at ${n - 1}, and the stop is NOT included — so the `
            + `stop must be ${n}.`,
        };
      },
    },
  },

  {
    id: "range-start-contrast",
    topic: "loops",
    focus: "001G", // range-start-stop — contrasted against range(n)
    assumed: ["0005", "001E", "001F"],
    contrast: "001F",
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["one-arg-vs-two"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const b = int(rng, 5, 7), a = int(rng, 2, 3);
        return {
          code: `print(list(range(${b})))\n`,
          aOutput: `[${Array.from({ length: b }, (_, i) => i).join(", ")}]`,
          contrastCode: `print(list(range(${a}, ${b})))\n`,
          shape: "one-arg-vs-two", variant: "plain",
          variantCard: `With two arguments the count STARTS at ${a} instead of 0 — the stop `
            + `${b} is still left out: [${Array.from({ length: b - a }, (_, i) => a + i).join(", ")}].`,
        };
      },
    },
  },

  {
    id: "range-step-contrast",
    topic: "loops",
    focus: "001H", // range-step — contrasted against range(a, b)
    assumed: ["0005", "001E", "001F", "001G"],
    contrast: "001G",
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["two-args-vs-three"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 1, 2), s = int(rng, 2, 3), b = a + s * int(rng, 2, 3) + 1;
        const noStep = [];
        for (let v = a; v < b; v++) noStep.push(v);
        const withStep = [];
        for (let v = a; v < b; v += s) withStep.push(v);
        return {
          code: `print(list(range(${a}, ${b})))\n`,
          aOutput: `[${noStep.join(", ")}]`,
          contrastCode: `print(list(range(${a}, ${b}, ${s})))\n`,
          shape: "two-args-vs-three", variant: "plain",
          variantCard: `The third argument is the STEP: counting by ${s} from ${a}, still `
            + `stopping before ${b}: [${withStep.join(", ")}].`,
        };
      },
    },
  },

  {
    id: "plus-eq-contrast",
    topic: "lists",
    focus: "0023", // plus-eq-mutates-list — taught by contrasting += against + [x]
    assumed: ["0005", "0006", "000A", "000C", "000D", "000G", "000H", "0021"],
    contrast: "0021", // list-concat-new — an ancestor of the focus, in assumed (§2.8)
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["aug-vs-concat"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const p = int(rng, 1, 5), q = int(rng, 6, 9), x = int(rng, 10, 99);
        return {
          // Program A (shown WITH its output): += mutates the shared list.
          code: `a = [${p}, ${q}]\nb = a\nb += [${x}]\nprint(a)\n`,
          aOutput: `[${p}, ${q}, ${x}]`,
          // Program B (predicted): b = b + [x] builds a NEW list, so a is untouched.
          contrastCode: `a = [${p}, ${q}]\nb = a\nb = b + [${x}]\nprint(a)\n`,
          shape: "aug-vs-concat", variant: "plain",
          variantCard: `The only change is line 3. \`b += [${x}]\` changes the ONE shared list, `
            + `so \`a\` becomes [${p}, ${q}, ${x}]. But \`b = b + [${x}]\` builds a brand-new list `
            + `just for \`b\`, leaving \`a\` as [${p}, ${q}].`,
        };
      },
    },
  },

  {
    id: "alias-latent-state",
    topic: "lists",
    focus: "000H", // names-share-list — the classic latent aliasing state
    assumed: ["0005", "0006", "000A", "000C", "000D", "000G"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["append-through-alias"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = [int(rng, 1, 5), int(rng, 6, 9)];
        const v = int(rng, 10, 99);
        return {
          code: `a = [${items.join(", ")}]\nb = a\nb.append(${v})\n`,
          probeName: "a",
          shape: "append-through-alias", variant: "plain",
          variantCard: `\`b = a\` did not copy the list — \`a\` and \`b\` are two names for `
            + `ONE list. Appending ${v} through \`b\` changed it, so \`a\` now holds `
            + `[${[...items, v].join(", ")}].`,
        };
      },
    },
  },

  {
    id: "swap-latent-state",
    topic: "state",
    focus: "000M", // swap-right-side-first — the values after a tuple swap
    assumed: ["0005", "0006"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["swap-probe-a"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const p = int(rng, 2, 9);
        const q = ((p - 2 + int(rng, 1, 7)) % 8) + 2; // in [2,9], ≠ p
        return {
          code: `a = ${p}\nb = ${q}\na, b = b, a\n`,
          probeName: "a",
          shape: "swap-probe-a", variant: "plain",
          variantCard: `The whole right side is read first, then stored — so \`a\` ends up `
            + `with the old \`b\`: ${q}.`,
        };
      },
    },
  },

  {
    id: "slice-open-contrast",
    topic: "strings",
    focus: "0012", // slice-open-ended — contrasted against the two-end slice
    assumed: ["0005", "0006", "0007", "000E", "0011"],
    contrast: "0011", // slice-half-open — parent of the focus, in assumed (§2.8)
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["two-ends-vs-open"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const word = pick(rng, ["python", "planet", "yellow", "garden", "silver", "orange"]);
        const a = int(rng, 1, 2), b = a + 2;
        return {
          code: `s = "${word}"\nprint(s[${a}:${b}])\n`,
          aOutput: word.slice(a, b),
          contrastCode: `s = "${word}"\nprint(s[${a}:])\n`,
          shape: "two-ends-vs-open", variant: "plain",
          variantCard: `Dropping the endpoint means "to the end": \`s[${a}:]\` runs from `
            + `position ${a} all the way out — \`${word.slice(a)}\`, not just the `
            + `${b - a} characters of \`s[${a}:${b}]\`.`,
        };
      },
    },
  },

  {
    id: "repeat-vs-concat",
    topic: "strings",
    focus: "000Z", // str-repeat — contrasted against gluing with +
    assumed: ["0005", "0007", "0008", "000Y"],
    contrast: "000Y", // str-concat — parent of the focus
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["concat-vs-repeat"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const w = pick(rng, ["hi", "cat", "sun", "ab"]);
        const n = int(rng, 2, 3);
        return {
          code: `print("${w}" + "${w}")\n`,
          aOutput: w + w,
          contrastCode: `print("${w}" * ${n})\n`,
          shape: "concat-vs-repeat", variant: "plain",
          variantCard: `\`+\` glues the two copies you wrote; \`* ${n}\` repeats the text `
            + `${n} times by itself: \`${w.repeat(n)}\`.`,
        };
      },
    },
  },

  {
    id: "get-vs-lookup",
    topic: "structures",
    focus: "001T", // dict-get-default — contrasted against plain lookup
    assumed: ["0005", "0006", "0007", "000E", "001R"],
    contrast: "001R", // dict-lookup-by-key — parent of the focus
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["lookup-vs-get"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const k = pick(rng, ["a", "b", "cat", "sun"]);
        const v = int(rng, 1, 9), alt = int(rng, 10, 20);
        return {
          code: `d = {"${k}": ${v}}\nprint(d["${k}"])\n`,
          aOutput: String(v),
          contrastCode: `d = {"${k}": ${v}}\nprint(d.get("zz", ${alt}))\n`,
          shape: "lookup-vs-get", variant: "plain",
          variantCard: `\`d["${k}"]\` fetches a key that exists. \`.get("zz", ${alt})\` asks `
            + `for a MISSING key — instead of an error it hands back the default: \`${alt}\`.`,
        };
      },
    },
  },

  {
    id: "tuple-comma-contrast",
    topic: "structures",
    focus: "001Y", // tuple-by-comma — contrasted against the ordinary pair
    assumed: ["0005", "0006", "001W"],
    contrast: "001W", // tuple-pack-print — parent of the focus
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["pair-vs-trailing-comma"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 1, 9), b = int(rng, 10, 20);
        return {
          code: `x = (${a}, ${b})\nprint(x)\n`,
          aOutput: `(${a}, ${b})`,
          contrastCode: `x = ${a},\nprint(x)\n`,
          shape: "pair-vs-trailing-comma", variant: "plain",
          variantCard: `The COMMA makes the tuple, not the parentheses: \`x = ${a},\` is a `
            + `one-item tuple and prints as \`(${a},)\` — comma included.`,
        };
      },
    },
  },

  {
    id: "alias-chain",
    topic: "lists",
    focus: "000H", // names-share-list — braided: THREE names, one list
    assumed: ["0005", "0006", "000A", "000C", "000D", "000G"],
    role: "review",
    form: "predict-exact-output",
    generator: {
      shapes: ["chain-read-first", "chain-read-middle"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = [int(rng, 1, 5), int(rng, 6, 9)];
        const v = int(rng, 10, 99);
        const shape = pick(rng, ["chain-read-first", "chain-read-middle"]);
        const read = shape === "chain-read-first" ? "a" : "b";
        return {
          code: `a = [${items.join(", ")}]\nb = a\nc = b\nc.append(${v})\nprint(${read})\n`,
          shape, variant: "plain",
          variantCard: `\`b = a\` and \`c = b\` never copied anything — all three names hold `
            + `ONE list. Appending ${v} through \`c\` changed it, so \`${read}\` shows `
            + `[${[...items, v].join(", ")}] too.`,
        };
      },
    },
  },

  {
    id: "first-true-wins-contrast",
    topic: "logic",
    focus: "0019", // elif-first-true-wins — both tests true, only the FIRST runs
    assumed: ["0005", "0016", "0017", "0018"],
    contrast: "0018", // else-otherwise — parent of the focus
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["elif-wins-vs-if-wins"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const w1 = pick(rng, ["red", "gold", "high"]);
        const w2 = pick(rng, ["blue", "silver", "mid"]);
        const w3 = pick(rng, ["green", "bronze", "low"]);
        return {
          code: `if False:\n    print("${w1}")\nelif True:\n    print("${w2}")\nelse:\n    print("${w3}")\n`,
          aOutput: w2,
          contrastCode: `if True:\n    print("${w1}")\nelif True:\n    print("${w2}")\nelse:\n    print("${w3}")\n`,
          shape: "elif-wins-vs-if-wins", variant: "plain",
          variantCard: `Now BOTH tests are true — but the chain stops at the FIRST true `
            + `one. Only \`${w1}\` prints; the true \`elif\` below is never even looked at.`,
        };
      },
    },
  },

  {
    id: "or-value-contrast",
    topic: "logic",
    focus: "001C", // and-or-return-operand — or hands back an operand, not True
    assumed: ["0005", "0016", "001A", "001B"],
    contrast: "001A", // bool-ops — parent of the focus
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["bool-or-vs-value-or"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const n = int(rng, 2, 9);
        return {
          code: `print(True or False)\n`,
          aOutput: "True",
          contrastCode: `print(${n} or 0)\n`,
          shape: "bool-or-vs-value-or", variant: "plain",
          variantCard: `With plain values, \`or\` does not convert anything: \`${n}\` counts `
            + `as true, so \`or\` hands back \`${n}\` ITSELF — not \`True\`.`,
        };
      },
    },
  },

  {
    id: "copy-latent-value",
    topic: "state",
    focus: "000C", // name-from-name — the copied value survives the rebind, latently
    assumed: ["0005", "0006", "000A"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["copy-rebind-probe-copy"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const p = int(rng, 2, 9), q = int(rng, 10, 20);
        return {
          code: `a = ${p}\nb = a\na = ${q}\n`,
          probeName: "b",
          shape: "copy-rebind-probe-copy", variant: "plain",
          variantCard: `\`b = a\` copied the value \`a\` held at that moment: ${p}. Rebinding `
            + `\`a\` to ${q} afterwards never touches \`b\` — it still holds ${p}.`,
        };
      },
    },
  },

  {
    id: "loop-total-latent",
    topic: "loops",
    focus: "001J", // loop-accumulate — the finished total as latent state
    assumed: ["0005", "0006", "0008", "0009", "000A", "000B", "000D", "001E"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["sum-probe-total"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = Array.from({ length: 3 }, () => int(rng, 1, 6));
        const total = items.reduce((a, b) => a + b, 0);
        return {
          code: `total = 0\nfor x in [${items.join(", ")}]:\n    total = total + x\n`,
          probeName: "total",
          shape: "sum-probe-total", variant: "plain",
          variantCard: `The total updated once per pass: ${items.join(" + ")} = ${total}. `
            + `After the loop, that finished value is what \`total\` holds.`,
        };
      },
    },
  },

  {
    id: "div-type-contrast",
    topic: "numbers",
    focus: "000P", // div-yields-float — same numbers, / always hands back a float
    assumed: ["0005", "0008"],
    contrast: "0008", // arith-on-ints — parent of the focus
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["times-vs-div"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const b = pick(rng, [2, 4, 5]);
        const a = b * int(rng, 2, 9); // divides evenly, so the .0 is the whole lesson
        return {
          code: `print(${a} * ${b})\n`,
          aOutput: String(a * b),
          contrastCode: `print(${a} / ${b})\n`,
          shape: "times-vs-div", variant: "plain",
          variantCard: `\`*\` on whole numbers gives a whole number — but \`/\` ALWAYS gives `
            + `a float, even dividing evenly: \`${(a / b).toFixed(1)}\`, with the .0.`,
        };
      },
    },
  },

  {
    id: "copy-latent-state",
    topic: "lists",
    focus: "0024", // slice-copies — the copy's independence as latent state
    assumed: ["0005", "0006", "000D", "000G", "000H", "0011"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["probe-original", "probe-copy"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = [int(rng, 1, 5), int(rng, 6, 9)];
        const v = int(rng, 10, 99);
        const shape = pick(rng, ["probe-original", "probe-copy"]);
        const probeName = shape === "probe-original" ? "a" : "b";
        const held = shape === "probe-original" ? items : [...items, v];
        return {
          code: `a = [${items.join(", ")}]\nb = a[:]\nb.append(${v})\n`,
          probeName,
          shape, variant: "plain",
          variantCard: `\`a[:]\` made a real copy, so the append changed only \`b\`. `
            + `\`${probeName}\` holds [${held.join(", ")}].`,
        };
      },
    },
  },
];
