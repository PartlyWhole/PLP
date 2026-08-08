// Alternate-form exercises (design §5.2). predict-state asks "after this
// program runs, what does `a` hold?" — the way LATENT state (a value the
// program never prints) becomes examinable. The displayed program does NOT
// print the probed name; the KB analyzer footprints it AS-GRADED (the probe
// read is what makes the concept observable), so the K-series augments the
// program with `print(<probeName>)` before footprinting (see tests/kb.spec.mjs
// footprintSource). These review the same concepts their predict-output
// intros teach, through a second form.

import { mulberry32, int, pick } from "../rng.mjs";
import { names, words } from "../pools.mjs";

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

// fix-the-bug's blank is the CONTENT of an existing line (indentation kept):
// the same {line, col, len, target} shape spliceBlank consumes, authored from
// the program plus the line number rather than from a NUL marker — the buggy
// program is shown whole, never holed.
function blankAtLine(code, line, target) {
  const text = code.split("\n")[line - 1] ?? "";
  const col = text.length - text.trimStart().length;
  return { line, col, len: text.length - col, target };
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
      // No designed misconception (G2): 0008's wrongAnswer is "an arithmetic
      // slip (no reasoned misconception — the intro checks fluency)", and the
      // only computable wrong TOKEN (the +/* mixup) produces the target at
      // a = b = 2 (2 + 2 = 2 * 2) under these draws — no algebraic guarantee.
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
          misconception: `"${name}"`, // quoted the name — prints the letters, never the digits
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
          misconception: "//", // the quotient operator — prints k, never the remainder r (k ≠ r by construction)
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
          misconception: String(k), // A's quotient — % confused with // (= aOutput; k ≠ r by construction)
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
      // Variety ceiling (2026-08 variety pass): the legal code space is
      // exactly 4 programs. Bools are a two-value space, and G8 bars a blank
      // whose token equals the shown target — so `True and \x00` (fill
      // `False`, target `False`) and `False or \x00` (fill `True`, target
      // `True`) are transcription, and a named-intermediate shape is barred
      // because assignment (0006) is NOT an ancestor of 001A. What remains:
      // `not True`, `not False`, `\x00 and False`, `\x00 or True` — the
      // or-true shape below completes that space; 4/12 distinct is the cap.
      shapes: ["not", "and-false", "or-true"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["not", "and-false", "or-true"]);
        if (shape === "and-false") {
          // Fill `True`; `True and False` still prints `False` — token ≠ target.
          // No designed misconception here: BOTH plausible fills (`True`,
          // `False`) print the target `False`, and the interpreter grades by
          // output — no discriminating wrong token exists.
          const { code, blank } = blankFrom(`print(\x00 and False)\n`, "True");
          return {
            code, blank, targetOutput: "False",
            shape, variant: "plain",
            variantCard: "`and` needs BOTH sides true. Filling `True` gives `True and False`, which is still `False`.",
          };
        }
        if (shape === "or-true") {
          // The and-false shape mirrored: fill `False`; `False or True` still
          // prints `True` — token ≠ target. No designed misconception here
          // for the same reason: BOTH plausible fills (`True`, `False`) print
          // the target `True`, so no discriminating wrong token exists.
          const { code, blank } = blankFrom(`print(\x00 or True)\n`, "False");
          return {
            code, blank, targetOutput: "True",
            shape, variant: "plain",
            variantCard: "`or` needs just ONE side true. Filling `False` gives `False or True`, which is still `True`.",
          };
        }
        const want = pick(rng, ["True", "False"]);
        const out = want === "True" ? "False" : "True";
        const { code, blank } = blankFrom(`print(not \x00)\n`, want);
        return {
          code, blank, targetOutput: out,
          shape, variant: "plain",
          // No designed misconception: the only wrong token is the shown
          // target itself ("False" for target False), and K-10's fill law
          // requires the misconception string to differ from the graded
          // answer — in a two-value bool space no third token exists (same
          // bar as the and-false skip).
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
        // n ∈ 3..9 (variety pass 2026-08; was 3..6). Regime: the fill n − 1
        // ("stop read as included") prints [0..n−2], which is missing the
        // shown last item n − 1 — it misses the target for every n ≥ 3, and
        // the token String(n) never equals the shown list (G8).
        const n = int(rng, 3, 9);
        const target = `[${Array.from({ length: n }, (_, i) => i).join(", ")}]`;
        const { code, blank } = blankFrom(`print(list(range(\x00)))\n`, String(n));
        return {
          code, blank, targetOutput: target,
          shape: "fill-stop", variant: "plain",
          misconception: String(n - 1), // stop read as included — transcribed the last shown item
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
        // b ∈ 5..11 (variety pass 2026-08; was 5..7), a ∈ 2..3. Regime:
        // a ≥ 2 > 0, so the truth [a..b−1] never contains 0 while the
        // misconception (= aOutput, [0..b−1]) always does — the start
        // difference is VISIBLE in the outputs on every seed; b − a ≥ 2
        // keeps B's list at ≥ 2 elements so the excluded stop stays visible.
        const b = int(rng, 5, 11), a = int(rng, 2, 3);
        return {
          code: `print(list(range(${b})))\n`,
          aOutput: `[${Array.from({ length: b }, (_, i) => i).join(", ")}]`,
          contrastCode: `print(list(range(${a}, ${b})))\n`,
          misconception: `[${Array.from({ length: b }, (_, i) => i).join(", ")}]`, // "still starts at 0" (= aOutput; a ≥ 2)
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
        // a ∈ 1..3 (variety pass 2026-08; was 1..2), s ∈ 2..3, k ∈ 2..3,
        // b = a + s·k + 1. Regime: s ≥ 2 means the truth (counting by s)
        // omits a + 1, which the misconception (= aOutput, counting by 1
        // over b − a ≥ 5 values) always contains — the step difference is
        // VISIBLE in the outputs on every seed. Max list length s·k + 1 ≤ 10
        // is unchanged by the wider a.
        const a = int(rng, 1, 3), s = int(rng, 2, 3), b = a + s * int(rng, 2, 3) + 1;
        const noStep = [];
        for (let v = a; v < b; v++) noStep.push(v);
        const withStep = [];
        for (let v = a; v < b; v += s) withStep.push(v);
        return {
          code: `print(list(range(${a}, ${b})))\n`,
          aOutput: `[${noStep.join(", ")}]`,
          contrastCode: `print(list(range(${a}, ${b}, ${s})))\n`,
          misconception: `[${noStep.join(", ")}]`, // the step ignored — counts by 1 (= aOutput; s ≥ 2)
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
          misconception: `[${p}, ${q}, ${x}]`, // "+ [x] mutates the shared list like +=" (= aOutput)
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
        // No designed misconception (G1): 000M's wrong model ("both names end
        // up with the same value" — the sequential left-to-right read) gives
        // a = q, which IS the truth for the probed name `a`; only probing `b`
        // would discriminate it. No collision-free wrong exists for this probe.
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
          misconception: word.slice(a, b), // the open end read as stopping short, like A's slice (= aOutput)
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
        // Word pool widened to the shared `words` pool (variety pass 2026-08;
        // was an inline 4-word list) — all ≤ 4 letters, so even `* 5` stays a
        // short readable line.
        const w = pick(rng, words);
        // n ∈ {3, 4, 5}, NEVER 2: at n = 2 the repeat `"w" * 2` equals the
        // concat `"w" + "w"`, collapsing A and B — draw n so they always
        // differ. Regime: the truth w·n has n·len(w) chars, the misconception
        // (= aOutput, w + w) has 2·len(w); n ≥ 3 keeps them unequal on every
        // seed. (2026-08: n gained 5; the n ≥ 3 guard is unchanged.)
        const n = pick(rng, [3, 4, 5]);
        return {
          code: `print("${w}" + "${w}")\n`,
          aOutput: w + w,
          contrastCode: `print("${w}" * ${n})\n`,
          misconception: w + w, // "* just glues a pair like +" (= aOutput; n ≥ 3 copies in truth)
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
          misconception: String(v), // .get read as still reaching the stored value (= aOutput; alt ≥ 10 > v)
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
          misconception: `(${a}, ${b})`, // "the moved comma changes nothing" (= aOutput; truth is the 1-tuple)
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
          misconception: `[${items.join(", ")}]`, // the unmutated list ("the chain copied it")
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
          misconception: w2, // the later true elif still runs (= aOutput; distinct word pools)
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
      // Two structural shapes (variety pass 2026-08 — the and-shape is the
      // same fact through the other operator, both within 001C): the focus
      // fires on B via analyzer rule11 for `or` AND `and` over ints alike.
      shapes: ["bool-or-vs-value-or", "bool-and-vs-value-and"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["bool-or-vs-value-or", "bool-and-vs-value-and"]);
        // Vary program A across ALL four bool pairs so its output isn't a
        // constant `True`/`False` — the shown A must not telegraph a fixed
        // answer (both operators produce both outputs across the pool).
        const [l, r] = pick(rng, [["True", "False"], ["False", "True"], ["False", "False"], ["True", "True"]]);
        const n = int(rng, 2, 9);
        // Second operand for the and-shape, ≠ n by offset (G3); drawn every
        // seed so the rng budget is shape-uniform (G7).
        const m = 2 + ((n - 2 + 1 + int(rng, 0, 6)) % 8);
        if (shape === "bool-and-vs-value-and") {
          const aOut = (l === "True" && r === "True") ? "True" : "False";
          return {
            code: `print(${l} and ${r})\n`,
            aOutput: aOut,
            contrastCode: `print(${n} and ${m})\n`,
            // Regime: "and still hands back a bool" (= aOutput ∈ {True,
            // False}); the truth is the digit m (both operands truthy, `and`
            // hands back the LAST one), and m ∈ 2..9 is never True/False.
            misconception: aOut,
            shape, variant: "plain",
            variantCard: `With plain \`True\`/\`False\`, \`and\` gives back \`True\`/\`False\`. But with plain `
              + `values it does not convert anything: \`${n}\` counts as true, so \`and\` moves on and `
              + `hands back the LAST operand \`${m}\` ITSELF — not \`True\`.`,
          };
        }
        const aOut = (l === "True" || r === "True") ? "True" : "False";
        return {
          code: `print(${l} or ${r})\n`,
          aOutput: aOut,
          contrastCode: `print(${n} or 0)\n`,
          misconception: aOut, // "or still hands back a bool" (= aOutput; truth is the digit n, never True/False)
          shape, variant: "plain",
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
            // 000C's own wrong model ("the copy follows a") predicts the TRUTH
            // for `a` — the designed wrong here is the shape's meta-pattern
            // answer: the first value, as if the rebind never landed (p ≠ q).
            misconception: String(p),
            variantCard: `\`a\` was rebound to ${q}, so it now holds ${q}. The copy \`b\` kept the old ${p}.`,
          };
        }
        return {
          code: `a = ${p}\nb = a\na = ${q}\n`,
          probeName: "b",
          shape: "copy-rebind-probe-copy", variant: "plain",
          misconception: String(q), // a's new value — the copy read as still linked to a (p ≠ q)
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
          misconception: String(items[items.length - 1]), // only the last value — "=" read as replacing, not accumulating (sum > last: items positive)
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
          misconception: String(a * b), // "the changed operator changes nothing" (= aOutput; truth carries the .0)
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
          misconception: String(b - 1), // stop read as included — the last taken index transcribed
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
          misconception: String(a - s), // start read as excluded like the stop — one step before the first item (s ≥ 2, so ≠ a)
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
          misconception: "*", // the left-to-right grouping's fill — (a * b) * c; the do-while keeps its output off-target
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

  // ---------------------------------------------------------------------
  // fix-the-bug (expansion ladder §R5): the COMPOSITION of two shipped forms,
  // never a third grading path. The program RUNS CLEAN but prints the wrong
  // thing; the card states what it should print beside what it really prints,
  // and the learner (1) FINDS the line — predict-the-error's line picker —
  // then (2) FIXES it — write-the-line's box. Grading is write-the-line's
  // exactly: splice the typed line in place of the PICKED line, run it,
  // compare the real output with the intended one. A learner who repairs a
  // DIFFERENT line and still lands the intended output is CORRECT — the
  // interpreter is the only answer key.
  //
  // Emitted shape: {code (the BUGGY program), buggyLine, blank (the INTENDED
  // fix, provenance for the reveal), targetOutput (what it SHOULD print),
  // wrongOutput (what the buggy program really prints — computed here in JS
  // and verified against real execution by K-10), constantLine}.
  //
  // THE ANTI-GAMING RULE (quality bar E10c, inherited): the buggy line must
  // execute more than once OR feed ≥2 later observations, so the intended
  // output cannot be reproduced by writing the answer into that one line.
  // `constantLine` records the most plausible conceptless answer and K-10
  // asserts it MISSES the target.
  {
    id: "fix-accumulator",
    topic: "loops",
    focus: "001J", // loop-accumulate — the running total is what's broken
    assumed: ["0005", "0006", "0008", "000A", "000B", "000D", "001E"],
    role: "review",
    form: "fix-the-bug",
    multiline: true, // the running value on every pass IS the concept (E4)
    generator: {
      // Two classic accumulator bugs, both of which keep the ACCUMULATION and
      // get the ITEM wrong: counting instead of summing, and hard-coding the
      // first item where the loop variable belongs. (`total = x`, the other
      // classic, is out of closure — a value-copy rebind emits 000C, which is
      // not an ancestor of 001J.)
      shapes: ["adds-one", "adds-a-constant"],
      variants: ["from-zero", "from-start"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["adds-one", "adds-a-constant"]);
        const variant = pick(rng, ["from-zero", "from-start"]);
        const name = pick(rng, ["total", "score"]);
        const items = Array.from({ length: int(rng, 3, 4) }, () => int(rng, 2, 9));
        // The hard-coded item can only be spotted if some later item differs,
        // so the second item is redrawn until it does (E6 discrimination).
        while (items[1] === items[0]) items[1] = int(rng, 2, 9);
        const start = variant === "from-start" ? int(rng, 5, 15) : 0;
        const stuck = items[0];
        const buggyStep = shape === "adds-one" ? `${name} = ${name} + 1` : `${name} = ${name} + ${stuck}`;
        const fixStep = `${name} = ${name} + x`;
        // Intended: the running sum on every pass. Wrong: what the buggy
        // line really produces (computed here; K-10 checks it for real).
        let t = start;
        const intended = items.map((v) => (t += v));
        let w = start;
        const wrong = items.map(() => (w += shape === "adds-one" ? 1 : stuck));
        const code = `${name} = ${start}\nfor x in [${items.join(", ")}]:\n    ${buggyStep}\n    print(${name})\n`;
        const final = intended[intended.length - 1];
        return {
          code, buggyLine: 3,
          blank: blankAtLine(code, 3, fixStep),
          targetOutput: intended.join("\n"),
          wrongOutput: wrong.join("\n"),
          // The scope rule made concrete: the buggy line runs once per pass,
          // so a constant prints the finished value every time while the
          // truth grows — it can never reproduce the target.
          constantLine: `${name} = ${final}`,
          shape, variant,
          variantCard: `The line inside the loop runs once per item, so it has to fold `
            + `THIS item — the loop variable \`x\` — into what \`${name}\` already holds: `
            + `\`${fixStep}\`. \`${buggyStep}\` adds the same `
            + `${shape === "adds-one" ? "1" : String(stuck)} every pass no matter which item it is on, `
            + `which is why it prints ${wrong.join(", ")} instead of ${intended.join(", ")}.`,
        };
      },
    },
  },

  {
    id: "fix-off-by-one",
    topic: "loops",
    focus: "001G", // range-start-stop — both ends of the range are the concept
    assumed: ["0005", "0006", "001E", "001F"],
    role: "review",
    form: "fix-the-bug",
    multiline: true, // the SET of printed numbers is exactly the concept (E4)
    generator: {
      shapes: ["stop-wrong", "start-wrong"],
      variants: ["one-too-many", "one-too-few"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["stop-wrong", "start-wrong"]);
        const variant = pick(rng, ["one-too-many", "one-too-few"]);
        const start = int(rng, 2, 6);          // never 0: see constantLine
        const count = int(rng, 3, 4);
        const stop = start + count;
        const off = variant === "one-too-many" ? 1 : -1;
        const buggy = shape === "stop-wrong"
          ? `for i in range(${start}, ${stop + off}):`
          : `for i in range(${start - off}, ${stop}):`;
        const fix = `for i in range(${start}, ${stop}):`;
        const seq = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
        const intended = seq(start, stop);
        const wrong = shape === "stop-wrong" ? seq(start, stop + off) : seq(start - off, stop);
        const code = `${buggy}\n    print(i)\n`;
        return {
          code, buggyLine: 1,
          blank: blankAtLine(code, 1, fix),
          targetOutput: intended.join("\n"),
          wrongOutput: wrong.join("\n"),
          // A loop HEADER cannot hold a constant (the indented body would not
          // parse), so the plausible conceptless answer here is the other
          // shortcut: count the lines you need and use `range(n)`. It starts
          // at 0, so it never reproduces a target that starts at ${start} —
          // the same discrimination the scope rule buys elsewhere.
          constantLine: `for i in range(${intended.length}):`,
          shape, variant,
          variantCard: `\`range(${start}, ${stop})\` starts AT ${start} and stops BEFORE ${stop}, `
            + `so it walks ${intended.join(", ")}. The program's `
            + `\`${buggy.replace(/^for i in |:$/g, "")}\` walks ${wrong.join(", ")} — `
            + `${variant === "one-too-many" ? "one number too many" : "one number too few"}, `
            + `because the ${shape === "stop-wrong" ? "stop" : "start"} is off by one.`,
        };
      },
    },
  },

  {
    id: "fix-alias",
    topic: "lists",
    // 0024 slice-copies, NOT 000H: the FIXED program contains `b = a[:]`, and
    // both sides of a fix-the-bug must satisfy the closure — 0024 is a CHILD
    // of 000H, so a 000H-focused exercise could not legally show the repair.
    focus: "0024",
    assumed: ["0005", "0006", "000D", "000G", "000H"],
    role: "review",
    form: "fix-the-bug",
    multiline: true, // the two lists side by side ARE the observation (E4)
    generator: {
      shapes: ["alias-then-append", "both-grow"],
      variants: ["two-items", "three-items"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["alias-then-append", "both-grow"]);
        const variant = pick(rng, ["two-items", "three-items"]);
        const items = Array.from({ length: variant === "two-items" ? 2 : 3 }, () => int(rng, 1, 9));
        const v = int(rng, 10, 19);
        const w = int(rng, 20, 29);
        const show = (xs) => `[${xs.join(", ")}]`;
        const mutations = shape === "both-grow"
          ? `b.append(${v})\na.append(${w})\n`
          : `b.append(${v})\n`;
        const code = `a = ${show(items)}\nb = a\n${mutations}print(a)\nprint(b)\n`;
        // Intended (b is a real copy): a keeps its own history, b keeps its.
        const intendedA = shape === "both-grow" ? [...items, w] : [...items];
        const intendedB = [...items, v];
        // Really (b is the same list): every mutation lands in one list.
        const shared = shape === "both-grow" ? [...items, v, w] : [...items, v];
        return {
          code, buggyLine: 2,
          blank: blankAtLine(code, 2, "b = a[:]"),
          targetOutput: `${show(intendedA)}\n${show(intendedB)}`,
          wrongOutput: `${show(shared)}\n${show(shared)}`,
          // The copy line feeds TWO later observations (both prints) and is
          // followed by more mutation, so writing the answer into it fails:
          // the append lands on the constant too.
          constantLine: `b = ${show(intendedB)}`,
          shape, variant,
          variantCard: `\`b = a\` gives the SAME list a second name, so \`${`b.append(${v})`}\` `
            + `shows through \`a\` too — that is why both lines print ${show(shared)}. `
            + `\`b = a[:]\` copies it, so \`a\` stays ${show(intendedA)} while \`b\` becomes ${show(intendedB)}.`,
        };
      },
    },
  },

  // ---------------------------------------------------------------------
  // Production-form expansion, wave 2: while loops, the range header, and
  // the build/copy repairs. Same contracts as the block above — write-the-
  // line carries the SCOPE RULE + `constantLine` (E10c); fix-the-bug adds
  // buggyLine/wrongOutput with BOTH sides inside the closure (E10d).
  {
    id: "write-while-step",
    topic: "loops",
    focus: "001M", // while-repeats-while-true — WRITE the step that ends it
    assumed: ["0005", "0006", "0008", "000A", "000B", "0015"],
    role: "review",
    form: "write-the-line",
    multiline: true, // the countdown printed on every pass IS the concept (E4)
    generator: {
      // G1/scope-rule regime: p ∈ [2,4] passes and r ∈ [1,S] give
      // N = (p−1)·S + r, so the canonical `n = n - S` prints p ≥ 2 numbers
      // (N, N−S, …, r) before `done`, while the constant `n = 0` ends the
      // loop after ONE pass (one number, then done) — the transcripts differ
      // on every seed. The canonical line terminates by construction (n
      // strictly drops by S ≥ 1); any OTHER learner line is bounded by the
      // grader's runtime budget, which is why N stays single-digit small.
      shapes: ["minus-one", "minus-step"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["minus-one", "minus-step"]);
        const p = int(rng, 2, 4);       // passes the canonical line makes
        const sRaw = int(rng, 2, 3);    // drawn for BOTH shapes — fixed rng budget (G7)
        const S = shape === "minus-one" ? 1 : sRaw;
        const r = int(rng, 1, S);       // the final printed value (always 1 when S = 1)
        const N = (p - 1) * S + r;
        const step = `n = n - ${S}`;
        const { code, blank } = blankFrom(
          `n = ${N}\nwhile n > 0:\n    print(n)\n    \x00\nprint("done")\n`,
          step,
        );
        const values = Array.from({ length: p }, (_, k) => N - k * S);
        return {
          code, blank, targetOutput: [...values, "done"].join("\n"),
          // The scope-rule refutation: `n = 0` kills the loop after its
          // first pass, so only N and `done` print — never the p ≥ 2 passes.
          constantLine: "n = 0",
          shape, variant: "plain",
          variantCard: `\`${step}\` runs once per pass, so \`n\` drops ${values.join(", ")} — `
            + `and the moment \`n > 0\` fails, the loop ends and \`done\` prints. `
            + `\`n = 0\` would end the loop after its FIRST pass, printing only ${N} before done.`,
        };
      },
    },
  },

  {
    id: "write-range-header",
    topic: "loops",
    focus: "001G", // range-start-stop — WRITE the whole for-header
    assumed: ["0005", "0006", "001E", "001F"],
    role: "review",
    form: "write-the-line",
    multiline: true, // the SET of printed numbers is exactly the concept (E4)
    generator: {
      // G1/scope-rule regime, loop-HEADER variant (the E10d precedent
      // applied to write): a header slot cannot hold a constant at all, so
      // the recorded conceptless shortcut is "count the lines you need" —
      // `range(count)`. It starts at 0, and a ≥ 2 keeps every target's
      // first line at ≥ 2, so the shortcut misses on every seed.
      shapes: ["two-arg-header"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 2, 5);
        const count = int(rng, 3, 5);
        const b = a + count;
        const header = `for i in range(${a}, ${b}):`;
        const { code, blank } = blankFrom(`\x00\n    print(i)\n`, header);
        const seq = Array.from({ length: count }, (_, k) => a + k);
        return {
          code, blank, targetOutput: seq.join("\n"),
          constantLine: `for i in range(${count}):`,
          shape: "two-arg-header", variant: "plain",
          variantCard: `\`range(${a}, ${b})\` starts AT ${a} and stops BEFORE ${b}, so the loop `
            + `walks ${seq.join(", ")}. \`range(${count})\` has the right NUMBER of lines `
            + `but starts them at 0.`,
        };
      },
    },
  },

  {
    id: "fix-build-list",
    topic: "loops",
    focus: "001K", // loop-build-list — the append is what's broken
    assumed: ["0005", "0006", "000D", "000G", "001E"],
    role: "review",
    form: "fix-the-bug",
    multiline: true, // the list growing one item per pass IS the concept (E4)
    generator: {
      // The bug hard-codes the FIRST item where the loop variable belongs.
      // (`xs.append(x + 1)`, the other classic, is OUT of closure here: the
      // `+ 1` emits 0008 arith-on-ints, which is not an ancestor of 001K.)
      // G1 regime: items[1] is drawn ≠ items[0] by offset, so the buggy
      // transcript diverges from the intended one at pass 2 on every seed.
      // Scope rule: the buggy line runs once per pass, and the constant
      // `xs = [finished list]` prints the finished list on EVERY pass while
      // the truth grows one item at a time — it can never match.
      shapes: ["from-empty", "onto-start"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["from-empty", "onto-start"]);
        const items = Array.from({ length: int(rng, 3, 4) }, () => int(rng, 2, 9));
        items[1] = ((items[0] - 2 + int(rng, 1, 7)) % 8) + 2; // in [2,9], ≠ items[0] (G3)
        const startList = shape === "onto-start" ? [int(rng, 10, 20)] : [];
        const stuck = items[0];
        const code = `xs = [${startList.join(", ")}]\nfor x in [${items.join(", ")}]:\n    xs.append(${stuck})\n    print(xs)\n`;
        const show = (xs) => `[${xs.join(", ")}]`;
        const intended = [], wrong = [];
        const iAcc = [...startList], wAcc = [...startList];
        for (const v of items) {
          iAcc.push(v); intended.push(show(iAcc));
          wAcc.push(stuck); wrong.push(show(wAcc));
        }
        return {
          code, buggyLine: 3,
          blank: blankAtLine(code, 3, "xs.append(x)"),
          targetOutput: intended.join("\n"),
          wrongOutput: wrong.join("\n"),
          constantLine: `xs = ${intended[intended.length - 1]}`,
          shape, variant: "plain",
          variantCard: `The append runs once per item, so it has to add THIS item — the loop `
            + `variable \`x\`: \`xs.append(x)\`. \`xs.append(${stuck})\` adds ${stuck} every pass `
            + `no matter which item it is on, which is why pass 2 shows ${wrong[1]} `
            + `instead of ${intended[1]}.`,
        };
      },
    },
  },

  {
    id: "fix-while-condition",
    topic: "loops",
    focus: "001M", // while-repeats-while-true — the guard is what's broken
    assumed: ["0005", "0006", "0008", "000A", "000B", "0015"],
    role: "review",
    form: "fix-the-bug",
    multiline: true, // the countdown printed on every pass IS the concept (E4)
    generator: {
      // G1 regime: N = (p−1)·S + 1 with p ∈ [2,4] makes N ≡ 1 (mod S), so
      // the intended `while n > 0:` prints N, N−S, …, 1 and then done,
      // while the buggy `while n > 1:` quits exactly one pass early — its
      // transcript is the intended one minus the final `1` line, so
      // wrongOutput ≠ targetOutput on every seed (and both loops terminate:
      // n strictly drops by S ≥ 1 each pass). The conceptless answer in a
      // loop-HEADER slot is the lazy retype of the buggy line itself; it
      // reproduces wrongOutput, which the regime keeps off-target.
      shapes: ["minus-one", "minus-step"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["minus-one", "minus-step"]);
        const p = int(rng, 2, 4);       // passes the INTENDED loop makes
        const sRaw = int(rng, 2, 3);    // drawn for BOTH shapes — fixed rng budget (G7)
        const S = shape === "minus-one" ? 1 : sRaw;
        const N = (p - 1) * S + 1;
        const code = `n = ${N}\nwhile n > 1:\n    print(n)\n    n = n - ${S}\nprint("done")\n`;
        const values = Array.from({ length: p }, (_, k) => N - k * S); // N … 1
        return {
          code, buggyLine: 2,
          blank: blankAtLine(code, 2, "while n > 0:"),
          targetOutput: [...values, "done"].join("\n"),
          wrongOutput: [...values.slice(0, -1), "done"].join("\n"),
          constantLine: "while n > 1:",
          shape, variant: "plain",
          variantCard: `\`while n > 0:\` keeps looping while \`n\` is still positive, so the `
            + `final 1 prints too: ${values.join(", ")}, done. \`n > 1\` throws that last `
            + `pass away — the loop quits the moment \`n\` reaches 1, printing only `
            + `${values.slice(0, -1).join(", ")}.`,
        };
      },
    },
  },

  {
    id: "fix-shared-copy",
    topic: "lists",
    // 0024 slice-copies (like fix-alias above, and for the same reason: the
    // FIXED program contains `b = a[:]`, and both sides must satisfy the
    // closure). A deliberate sibling to fix-alias, narrower on purpose:
    // every mutation goes through the COPY alone, and the recorded
    // conceptless answer is the lazy retype `b = a` — NOT the enumerated
    // finished list, because the E10d precedent treats `b = [p, q]` as a
    // LEGITIMATE repair (enumerating the copy takes the same diagnosis, and
    // the interpreter is the only answer key).
    focus: "0024",
    assumed: ["0005", "0006", "000D", "000G", "000H"],
    role: "review",
    form: "fix-the-bug",
    multiline: true, // the two lists side by side ARE the observation (E4)
    generator: {
      // G1 regime: ≥ 1 append lands through `b`, so the buggy (shared) run
      // shows the mutation in BOTH printed lines while the intended
      // (copied) run keeps `a` at its literal — wrong ≠ target on every
      // seed. Scope rule: line 2 feeds BOTH later prints (≥ 2 distinct
      // observations); `b = a` retypes the bug and reproduces wrongOutput.
      shapes: ["append-one", "append-two"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["append-one", "append-two"]);
        const p = int(rng, 1, 5), q = int(rng, 6, 9);   // disjoint ranges: distinct (G3)
        const x = int(rng, 10, 19), y = int(rng, 20, 29); // y drawn for BOTH shapes (G7)
        const appended = shape === "append-two" ? [x, y] : [x];
        const show = (xs) => `[${xs.join(", ")}]`;
        const mutations = appended.map((v) => `b.append(${v})\n`).join("");
        const code = `a = [${p}, ${q}]\nb = a\n${mutations}print(a)\nprint(b)\n`;
        const grown = [p, q, ...appended];
        return {
          code, buggyLine: 2,
          blank: blankAtLine(code, 2, "b = a[:]"),
          targetOutput: `${show([p, q])}\n${show(grown)}`,
          wrongOutput: `${show(grown)}\n${show(grown)}`,
          constantLine: "b = a",
          shape, variant: "plain",
          variantCard: `\`b = a\` gives the ONE list a second name, so appending through \`b\` `
            + `shows in \`a\` too — both lines print ${show(grown)}. \`b = a[:]\` makes a real `
            + `copy: \`a\` stays ${show([p, q])} while \`b\` grows to ${show(grown)}.`,
        };
      },
    },
  },
];
