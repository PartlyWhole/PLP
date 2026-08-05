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
      // The blank is the NAME in the print, not the value in the assignment,
      // so the token you fill (`${name}`) is never the same as the printed
      // output (${v}) — real work, not a transcription of the shown target.
      shapes: ["fill-name"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const name = pick(rng, names);
        const v = int(rng, 2, 20);
        const { code, blank } = blankFrom(`${name} = ${v}\nprint(\x00)\n`, name);
        return {
          code, blank, targetOutput: String(v),
          shape: "fill-name", variant: "plain",
          variantCard: `The blank is the NAME, not the number. Bare \`${name}\` looks up the value `
            + `it holds — ${v} — and prints it. \`"${name}"\` with quotes would print the letters instead.`,
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
    misconceptionOf: "000Q", // answering A's quotient = confusing % with //
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
    // Replaces the retired `fill-bool` (which spelled `True`/`False` into a
    // blank whose token WAS the shown target — a transcription, E5). Here the
    // filled token is COMPUTED against by `not`/`and`, so it never equals the
    // shown target.
    id: "fill-bool-op",
    topic: "logic",
    focus: "001A", // bool-ops
    assumed: ["0005", "0016"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["not", "and-false"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["not", "and-false"]);
        if (shape === "and-false") {
          // Fill `True`; `True and False` still prints `False` — token ≠ target.
          const { code, blank } = blankFrom(`print(\x00 and False)\n`, "True");
          return {
            code, blank, targetOutput: "False",
            shape, variant: "plain",
            variantCard: "`and` needs BOTH sides true. Filling `True` gives `True and False`, which is still `False`.",
          };
        }
        const want = pick(rng, ["True", "False"]);
        const out = want === "True" ? "False" : "True";
        const { code, blank } = blankFrom(`print(not \x00)\n`, want);
        return {
          code, blank, targetOutput: out,
          shape, variant: "plain",
          variantCard: `\`not\` flips it: \`not ${want}\` is \`${out}\` — the fill is the opposite of what prints.`,
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
    misconceptionOf: "0021", // answering A's output = thinking + [x] mutates like +=
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
          misconception: `[${items.join(", ")}]`, // the unmutated list ("b = a copied it")
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
        // n ∈ {3, 4} only: at n = 2 the repeat `"w" * 2` equals the concat
        // `"w" + "w"`, collapsing A and B — draw n so they always differ.
        const n = pick(rng, [3, 4]);
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
    misconceptionOf: "001A", // answering A's bool = thinking or always yields True/False
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["bool-or-vs-value-or"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        // Vary program A across the bool pairs so its output isn't a constant
        // `True` — the shown A must not telegraph a fixed answer.
        const [l, r] = pick(rng, [["True", "False"], ["False", "True"], ["False", "False"]]);
        const aOut = (l === "True" || r === "True") ? "True" : "False";
        const n = int(rng, 2, 9);
        return {
          code: `print(${l} or ${r})\n`,
          aOutput: aOut,
          contrastCode: `print(${n} or 0)\n`,
          shape: "bool-or-vs-value-or", variant: "plain",
          variantCard: `With plain \`True\`/\`False\`, \`or\` gives back \`True\`/\`False\`. But with plain `
            + `values it does not convert anything: \`${n}\` counts as true, so \`or\` hands back `
            + `\`${n}\` ITSELF — not \`True\`.`,
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
      shapes: ["copy-rebind-probe-copy", "probe-source-after-rebind"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        // Overlapping ranges (both 2..20, distinct) so the answer isn't always
        // the smaller value.
        const p = int(rng, 2, 20);
        const q = ((p - 2 + int(rng, 1, 18)) % 19) + 2; // in [2, 20], ≠ p
        const shape = pick(rng, ["copy-rebind-probe-copy", "probe-source-after-rebind"]);
        if (shape === "probe-source-after-rebind") {
          // Probe the REBOUND source: it holds the NEW value, not the copy's —
          // the counter to "the answer is always the first number".
          return {
            code: `a = ${p}\nb = a\na = ${q}\n`,
            probeName: "a",
            shape, variant: "plain",
            variantCard: `\`a\` was rebound to ${q}, so it now holds ${q}. The copy \`b\` kept the old ${p}.`,
          };
        }
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
          // The OTHER list's contents — aliasing/copying read backwards.
          misconception: `[${(shape === "probe-original" ? [...items, v] : items).join(", ")}]`,
          variantCard: `\`a[:]\` made a real copy, so the append changed only \`b\`. `
            + `\`${probeName}\` holds [${held.join(", ")}].`,
        };
      },
    },
  },

  {
    // predict-state: a new-key store then an overwrite — the dict never prints
    // itself, so `d`'s final contents are latent.
    id: "dict-store-latent",
    topic: "structures",
    focus: "001S", // dict-key-assign
    assumed: ["0005", "0006", "001R"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["add-then-overwrite"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const [k1, k2] = pick(rng, [["a", "b"], ["x", "y"], ["cat", "sun"], ["red", "id"]]);
        const v1 = int(rng, 1, 9), v2 = int(rng, 10, 20), v3 = int(rng, 21, 30);
        return {
          code: `d = {"${k1}": ${v1}}\nd["${k2}"] = ${v2}\nd["${k1}"] = ${v3}\n`,
          probeName: "d",
          shape: "add-then-overwrite", variant: "plain",
          misconception: `{'${k1}': ${v1}, '${k2}': ${v2}}`, // missed the overwrite
          variantCard: `\`"${k2}"\` is new, so it is added (${v2}); then \`"${k1}"\` is overwritten from ${v1} `
            + `to ${v3}. \`d\` ends holding {'${k1}': ${v3}, '${k2}': ${v2}}.`,
        };
      },
    },
  },

  {
    // predict-state: `+=` on a shared list mutates in place; the original name
    // is never printed, so its post-mutation value is latent.
    id: "plus-eq-latent",
    topic: "lists",
    focus: "0023", // plus-eq-mutates-list
    assumed: ["0005", "0006", "000A", "000C", "000D", "000G", "000H", "0021"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["aug-probe-original"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const p = int(rng, 1, 5), q = int(rng, 6, 9), x = int(rng, 10, 99);
        return {
          code: `a = [${p}, ${q}]\nb = a\nb += [${x}]\n`,
          probeName: "a",
          shape: "aug-probe-original", variant: "plain",
          misconception: `[${p}, ${q}]`, // "+= rebound b to a new list; a untouched"
          variantCard: `\`b += [${x}]\` changes the ONE shared list in place, so \`a\` shows it too: `
            + `[${p}, ${q}, ${x}]. (\`b = b + [${x}]\` would have left \`a\` alone.)`,
        };
      },
    },
  },

  {
    // predict-state: two appends, then probe the list — its grown contents are
    // latent (the program never prints it).
    id: "append-latent",
    topic: "lists",
    focus: "000G", // append-mutates
    assumed: ["0005", "0006", "000D"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["two-appends-probe"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const nm = pick(rng, ["xs", "nums", "vals"]);
        const p = int(rng, 1, 5), q = int(rng, 6, 9), v = int(rng, 10, 50), w = int(rng, 51, 99);
        return {
          code: `${nm} = [${p}, ${q}]\n${nm}.append(${v})\n${nm}.append(${w})\n`,
          probeName: nm,
          shape: "two-appends-probe", variant: "plain",
          misconception: `[${p}, ${q}]`, // "append builds a new list; the name keeps the old one"
          variantCard: `Each append adds one item at the end, in order — \`${nm}\` ends [${p}, ${q}, ${v}, ${w}].`,
        };
      },
    },
  },

  {
    // predict-state: a shallow copy shares the inner rows; appending through
    // the copy's inner list shows through the original. Latent.
    id: "shallow-copy-latent",
    topic: "lists",
    focus: "0025", // copy-is-shallow
    assumed: ["0005", "0006", "000D", "000E", "000G", "000H", "0011", "0022", "0024"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["copy-mutate-inner-probe"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const g = [[int(rng, 1, 4), int(rng, 5, 9)], [int(rng, 1, 4), int(rng, 5, 9)]];
        const v = int(rng, 10, 99);
        const row = int(rng, 0, 1);
        const after = g.map((r, i) => (i === row ? [...r, v] : r));
        const show = (grid) => `[[${grid[0].join(", ")}], [${grid[1].join(", ")}]]`;
        return {
          code: `a = ${show(g)}\nb = a[:]\nb[${row}].append(${v})\n`,
          probeName: "a",
          shape: "copy-mutate-inner-probe", variant: "plain",
          misconception: show(g), // "the copy is fully independent"
          variantCard: `\`a[:]\` copied only the OUTER list — \`a[${row}]\` and \`b[${row}]\` are one shared `
            + `inner list. Appending ${v} through \`b[${row}]\` changes it, so \`a\` becomes ${show(after)}.`,
        };
      },
    },
  },

  {
    // fill-one-blank: the blank is the slice STOP; the student reverse-engineers
    // it from the shown substring target.
    id: "fill-slice-stop",
    topic: "strings",
    focus: "0011", // slice-half-open
    assumed: ["0005", "0006", "0007", "000E"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["fill-stop-index"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const word = pick(rng, ["python", "planet", "yellow", "garden", "silver", "orange"]);
        const a = int(rng, 1, 2), b = a + int(rng, 2, 3);
        const { code, blank } = blankFrom(`print("${word}"[${a}:\x00])\n`, String(b));
        return {
          code, blank, targetOutput: word.slice(a, b),
          shape: "fill-stop-index", variant: "plain",
          variantCard: `The slice runs from ${a} up to but NOT including the stop. To land on `
            + `\`${word.slice(a, b)}\`, the stop must be ${b}.`,
        };
      },
    },
  },

  {
    // fill-one-blank: the blank is the range START, reverse-engineered from the
    // printed list.
    id: "fill-range-start",
    topic: "loops",
    focus: "001H", // range-step
    assumed: ["0005", "0006", "001E", "001F", "001G"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["fill-start-index"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 1, 3), s = int(rng, 2, 3), b = a + s * int(rng, 2, 3) + 1;
        const seq = [];
        for (let v = a; v < b; v += s) seq.push(v);
        const { code, blank } = blankFrom(`print(list(range(\x00, ${b}, ${s})))\n`, String(a));
        return {
          code, blank, targetOutput: `[${seq.join(", ")}]`,
          shape: "fill-start-index", variant: "plain",
          variantCard: `The list starts at ${a} and steps by ${s}, stopping before ${b} — so the start `
            + `argument must be ${a}: [${seq.join(", ")}].`,
        };
      },
    },
  },

  {
    // fill-one-blank: reverse-engineer the OPERATOR whose precedence lands the
    // shown target. Values chosen so exactly ONE operator fits (E5/E6).
    id: "fill-precedence-op",
    topic: "numbers",
    focus: "000N", // op-precedence
    assumed: ["0005", "0008"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["fill-op"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        let a, b, c, cand;
        do {
          a = int(rng, 2, 9); b = int(rng, 2, 6); c = int(rng, 2, 6);
          cand = {
            "+": a + b * c,
            "-": a - b * c,
            "*": a * b * c,
            "//": Math.floor(a / b) * c,
            "%": (a % b) * c,
          };
        } while (Object.values(cand).filter((v) => v === cand["+"]).length !== 1);
        const target = cand["+"];
        const { code, blank } = blankFrom(`print(${a} \x00 ${b} * ${c})\n`, "+");
        return {
          code, blank, targetOutput: String(target),
          shape: "fill-op", variant: "plain",
          variantCard: `\`${b} * ${c}\` happens first (${b * c}), then \`+\` makes \`${a} + ${b * c}\` = ${target}. `
            + `Filling \`*\` would group as \`(${a} * ${b}) * ${c}\` = ${a * b * c} instead.`,
        };
      },
    },
  },

  // ---------------------------------------------------------------------
  // write-the-line (expansion ladder §R5): fill-one-blank generalized from a
  // TOKEN to a whole line. The emitted shape is identical — {code, blank,
  // targetOutput} — with the blank spanning a line's content (col = the
  // indentation width, len = the rest of the line), so spliceBlank, the
  // substitute-and-run grader, and the docgen branch all work unchanged.
  //
  // THE SCOPE RULE (quality bar E5/E6 for this form): the blanked line must
  // execute more than once OR feed ≥2 distinct later observations, so that no
  // CONSTANT line can fake the target. Both exercises below satisfy it by
  // construction: the blanked line sits in a loop body whose effect is
  // printed on EVERY pass, so a constant line prints the same value n times
  // where the truth grows. Each generator emits `constantLine` — the most
  // plausible constant a gamer would type — and K-10 asserts that splicing it
  // does NOT reproduce the target on every stratified seed.
  {
    id: "write-loop-step",
    topic: "loops",
    focus: "001J", // loop-accumulate — WRITE the accumulate line, don't read it
    assumed: ["0005", "0006", "0008", "000A", "000B", "000D", "001E"],
    role: "review",
    form: "write-the-line",
    multiline: true, // the running value on every pass IS the concept (E4)
    generator: {
      shapes: ["sum-items", "sum-from-start", "count-items"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["sum-items", "sum-from-start", "count-items"]);
        const items = Array.from({ length: int(rng, 3, 4) }, () => int(rng, 1, 9));
        let name, start, step, running;
        if (shape === "count-items") {
          name = "count"; start = 0; step = "count = count + 1";
          let c = 0; running = items.map(() => (c += 1));
        } else {
          name = "total";
          start = shape === "sum-from-start" ? int(rng, 5, 15) : 0;
          step = "total = total + x";
          let t = start; running = items.map((v) => (t += v));
        }
        const { code, blank } = blankFrom(
          `${name} = ${start}\nfor x in [${items.join(", ")}]:\n    \x00\n    print(${name})\n`,
          step,
        );
        const final = running[running.length - 1];
        return {
          code, blank, targetOutput: running.join("\n"),
          // The scope-rule refutation: a constant line prints `final` on every
          // pass, and the truth grows — so it never reproduces the target.
          constantLine: `${name} = ${final}`,
          shape, variant: "plain",
          variantCard: `\`${step}\` runs once per pass, so \`${name}\` grows: `
            + `${running.join(", ")}. A line that just sets \`${name} = ${final}\` would print `
            + `${final} on every pass instead.`,
        };
      },
    },
  },

  {
    id: "write-build-append",
    topic: "loops",
    focus: "001K", // loop-build-list — WRITE the append line
    assumed: ["0005", "0006", "000D", "000G", "001E"],
    role: "review",
    form: "write-the-line",
    multiline: true, // the list growing one item per pass IS the concept (E4)
    generator: {
      shapes: ["collect-each", "collect-onto-start"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["collect-each", "collect-onto-start"]);
        const items = Array.from({ length: int(rng, 3, 4) }, () => int(rng, 1, 9));
        const startList = shape === "collect-onto-start" ? [int(rng, 10, 20)] : [];
        const grown = [];
        const acc = [...startList];
        for (const v of items) { acc.push(v); grown.push(`[${acc.join(", ")}]`); }
        const { code, blank } = blankFrom(
          `xs = [${startList.join(", ")}]\nfor x in [${items.join(", ")}]:\n    \x00\n    print(xs)\n`,
          "xs.append(x)",
        );
        return {
          code, blank, targetOutput: grown.join("\n"),
          constantLine: `xs = ${grown[grown.length - 1]}`,
          shape, variant: "plain",
          variantCard: `\`xs.append(x)\` adds ONE item per pass, so the list grows: `
            + `${grown.join(", ")}. Assigning the finished list instead would print it whole on the first pass.`,
        };
      },
    },
  },
];
