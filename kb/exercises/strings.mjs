// Strings intro exercises (design §3.4). Every generated program stays
// inside footprint ⊆ assumed ∪ {focus} ∪ Structural (checked over 40 seeds
// by the K-series). Core concepts carry ≥3 program-shape archetypes.

import { mulberry32, int, pick } from "../rng.mjs";
import { words, longWords, strNames, capWords, lowWords, distinctWords } from "../pools.mjs";
import { orderPair } from "../contrast.mjs";

// A blank is authored by writing the program with a NUL marker where the
// hole goes (same helper as forms.mjs/lists.mjs): full correct code plus the
// hole's position, so the runtime shows `___` and grades a fill by execution.
function blankFrom(template, token) {
  const idx = template.indexOf("\x00");
  const before = template.slice(0, idx);
  const line = before.split("\n").length;                 // 1-indexed
  const col = idx - (before.lastIndexOf("\n") + 1);        // 0-indexed on its line
  return { code: template.replace("\x00", token), blank: { line, col, len: token.length, target: token } };
}

export default [
  {
    // Concept-lane fix: index-from-zero belongs to the Strings lane (its
    // siblings index-from-end/slice-half-open live here), so its topic is
    // "strings". The program indexes a STRING, matching the lane.
    id: "index-char",
    topic: "strings",
    focus: "000E", // index-from-zero
    assumed: ["0005", "0006", "0007"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["word-index", "literal-index", "assign-char"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const word = pick(rng, words.filter((w) => w.length >= 3));
        const i = int(rng, 0, 2);
        const shape = pick(rng, ["word-index", "literal-index", "assign-char"]);
        const card = `Positions count from 0, so \`[${i}]\` is the character at `
          + `position ${i} of \`"${word}"\` — that's \`${word[i]}\`.`;
        if (shape === "literal-index") {
          return { code: `print("${word}"[${i}])\n`, shape, variant: "plain", variantCard: card };
        }
        if (shape === "assign-char") {
          return { code: `s = "${word}"\nc = s[${i}]\nprint(c)\n`, shape, variant: "plain", variantCard: card };
        }
        return { code: `s = "${word}"\nprint(s[${i}])\n`, shape, variant: "plain", variantCard: card };
      },
    },
  },

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
        if (shape === "two-literals") {
          return {
            code: `print("${a}" + "${b}")\n`, shape, variant: "plain",
            misconception: `${a} ${b}`, // an inserted space
            variantCard: `\`+\` on text joins the pieces end to end: \`"${a}" + "${b}"\` is \`${a}${b}\` — one word, no space.`,
          };
        }
        if (shape === "three-literals") {
          return {
            code: `print("${a}" + "${b}" + "${c}")\n`, shape, variant: "plain",
            misconception: `${a} ${b} ${c}`, // inserted spaces
            variantCard: `\`+\` joins each piece end to end: \`${a}${b}${c}\` — no spaces added.`,
          };
        }
        const nm = pick(rng, strNames);
        return {
          code: `${nm} = "${a}"\nprint(${nm} + "${b}")\n`, shape, variant: "plain",
          misconception: `${a} ${b}`, // an inserted space
          variantCard: `\`${nm}\` holds \`"${a}"\`, joined to \`"${b}"\` gives \`${a}${b}\`.`,
        };
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
        if (shape === "literal-times") {
          return {
            code: `print("${w}" * ${n})\n`, shape, variant: "plain",
            misconception: w, // one copy only
            variantCard: `\`* ${n}\` repeats the text ${n} times, end to end: \`${w.repeat(n)}\`.`,
          };
        }
        if (shape === "times-literal") {
          return {
            code: `print(${n} * "${w}")\n`, shape, variant: "plain",
            misconception: w, // one copy only
            variantCard: `\`${n} *\` repeats \`"${w}"\` ${n} times: \`${w.repeat(n)}\`.`,
          };
        }
        const nm = pick(rng, strNames);
        return {
          code: `${nm} = "${w}"\nprint(${nm} * ${n})\n`, shape, variant: "plain",
          misconception: w, // one copy only
          variantCard: `\`${nm}\` holds \`"${w}"\`; \`* ${n}\` repeats it ${n} times: \`${w.repeat(n)}\`.`,
        };
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
        const out = {
          code: `s = "${word}"\nprint(s[-${i}])\n`,
          shape, variant: "plain",
          variantCard: `Counting from the end, \`s[-${i}]\` is the ${i}${i === 1 ? "st" : i === 2 ? "nd" : "rd"} `
            + `character from the right of \`"${word}"\` — that's \`${word[word.length - i]}\`.`,
        };
        // Off by one from the end — guaranteed distinct only for s[-1] (no
        // longWord repeats its last two letters; deeper in, doubles like
        // "yellow" could collide, so near-end carries no misconception).
        if (shape === "last") out.misconception = word[word.length - 2];
        return out;
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
        const misconception = word.slice(a, b + 1); // includes the character at position b
        if (shape === "bare-slice") return { code: `print("${word}"[${a}:${b}])\n`, shape, variant: "plain", misconception, variantCard: card };
        if (shape === "name-slice") return { code: `s = "${word}"\nprint(s[${a}:${b}])\n`, shape, variant: "plain", misconception, variantCard: card };
        return { code: `s = "${word}"\nt = s[${a}:${b}]\nprint(t)\n`, shape, variant: "plain", misconception, variantCard: card };
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
          return { code: `print("${word}"[${a}:])\n`, shape, variant: "plain", misconception: word.slice(a, -1), /* stops one short of the end */ variantCard: `\`[${a}:]\` runs from position ${a} to the end: \`${word.slice(a)}\`.` };
        }
        if (shape === "open-left") {
          const b = int(rng, 2, 3);
          return { code: `print("${word}"[:${b}])\n`, shape, variant: "plain", misconception: word.slice(0, b - 1), /* stops one short of b */ variantCard: `\`[:${b}]\` runs from the start up to position ${b}: \`${word.slice(0, b)}\`.` };
        }
        const a = int(rng, 2, 3);
        return { code: `s = "${word}"\nprint(s[${a}:])\n`, shape, variant: "plain", misconception: word.slice(a, -1), /* stops one short of the end */ variantCard: `\`[${a}:]\` runs from position ${a} to the end: \`${word.slice(a)}\`.` };
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
          misconception: w + suffix, // the earlier copy shows the change too
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
      shapes: ["capital-vs-lower", "lower-descending", "capital-on-right", "lower-ascending"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["capital-vs-lower", "lower-descending", "capital-on-right", "lower-ascending"]);
        if (shape === "capital-on-right") {
          // Capital on the RIGHT, so `low < cap` is False even though a capital
          // is present — defeats the "capital ⇒ True" meta.
          const cap = pick(rng, capWords), low = pick(rng, lowWords);
          return {
            code: `print("${low}" < "${cap}")\n`,
            shape, variant: "plain",
            variantCard: `Lowercase \`${low[0]}\` has a LARGER code than capital \`${cap[0]}\`, so \`"${low}"\` `
              + `sorts AFTER \`"${cap}"\` — \`"${low}" < "${cap}"\` is \`False\`.`,
          };
        }
        if (shape === "lower-ascending") {
          // Two lowercase words in ASCENDING order → True, with no capital in
          // sight — defeats the "capital present ⇒ True" meta.
          const pool = lowWords.slice();
          const p = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
          const q = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
          const [lo, hi] = p < q ? [p, q] : [q, p];
          return {
            code: `print("${lo}" < "${hi}")\n`,
            shape, variant: "plain",
            variantCard: `Both are lowercase and \`${lo}\` comes first: \`${lo[0]}\` has a SMALLER code than `
              + `\`${hi[0]}\`, so \`"${lo}" < "${hi}"\` is \`True\`.`,
          };
        }
        if (shape === "lower-descending") {
          // Two lowercase words in DESCENDING order, so `<` is really False —
          // the answer isn't always True. Distinct picks, then the larger word
          // first so the comparison genuinely fails on code points.
          const pool = lowWords.slice();
          const p = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
          const q = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
          const [hi, lo] = p > q ? [p, q] : [q, p];
          return {
            code: `print("${hi}" < "${lo}")\n`,
            shape, variant: "plain",
            variantCard: `Both are lowercase, so it comes down to the first letters: \`${hi[0]}\` `
              + `has a LARGER code than \`${lo[0]}\`, so \`"${hi}"\` sorts AFTER \`"${lo}"\` — `
              + `\`"${hi}" < "${lo}"\` is \`False\`.`,
          };
        }
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
            misconception: w, // the moved capture changes nothing (= aOutput)
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
          misconception: w, // the moved capture changes nothing (= aOutput)
          variantCard: `Only the \`t = s\` line moved. Take the copy BEFORE \`s\` is rebuilt and \`t\` `
            + `is \`${w}\`; take it AFTER and \`t\` is \`${w + s1}\`.`,
        };
      },
    },
  },

  {
    // Trace walkthrough (design §5.2 trace-table): the immutability
    // contrast to trace-alias — `t = s` captures a value, so `t`'s column
    // NEVER moves when `s` rebinds (lists share; strings don't).
    id: "trace-str-capture",
    topic: "strings",
    focus: "0013", // str-immutable-rebind
    assumed: ["0005", "0006", "000A", "000C", "000Y"],
    role: "review",
    form: "trace-table",
    generator: {
      shapes: ["capture-then-grow", "grow-then-capture"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["capture-then-grow", "grow-then-capture"]);
        const word = pick(rng, ["hi", "go", "yo", "ok"]);
        const tail = pick(rng, ["!", "?", "!!"]);
        const code = shape === "capture-then-grow"
          ? `s = "${word}"\nt = s\ns = s + "${tail}"\nprint(t)\n`
          : `s = "${word}"\ns = s + "${tail}"\nt = s\nprint(t)\n`;
        return {
          code,
          probeNames: ["s", "t"],
          shape, variant: "plain",
          variantCard: "Rebinding `s` makes a NEW string and points `s` at it — `t` keeps whatever it captured when `t = s` ran. Compare the two columns.",
        };
      },
    },
  },

  {
    // Review (predict-state): concatenation as LATENT state — the program
    // builds `s` but never prints it. G1 regime: the truth is the words
    // joined END TO END; the named wrong inserts a space between them, and
    // words are non-empty, so wrong ≠ truth on every seed. Misconception
    // formula (G2, rng-free): the drawn words joined with " ".
    id: "concat-state",
    topic: "strings",
    focus: "000Y", // str-concat
    assumed: ["0005", "0006"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["direct", "via-names", "three-parts"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["direct", "via-names", "three-parts"]);
        // Three DISTINCT words by splice-draw (G3); the third is only used by
        // the three-parts shape but always drawn (G7 uniform rng budget).
        const pool = words.slice();
        const w1 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w2 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w3 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        // Two DISTINCT helper names by offset (G3), skipping the probe name
        // `s`; always drawn (G7), used only by via-names.
        const nmPool = strNames.filter((n) => n !== "s");
        const p = int(rng, 0, nmPool.length - 1);
        const q = (p + 1 + int(rng, 0, nmPool.length - 2)) % nmPool.length;
        if (shape === "via-names") {
          return {
            code: `${nmPool[p]} = "${w1}"\n${nmPool[q]} = "${w2}"\ns = ${nmPool[p]} + ${nmPool[q]}\n`,
            probeName: "s",
            shape, variant: "plain",
            misconception: `${w1} ${w2}`, // "+ inserts a space between the words"
            variantCard: `\`${nmPool[p]} + ${nmPool[q]}\` joins the two texts end to end — no space appears `
              + `unless one of the pieces holds it. \`s\` ends up holding \`${w1}${w2}\`.`,
          };
        }
        if (shape === "three-parts") {
          return {
            code: `s = "${w1}" + "${w2}" + "${w3}"\n`,
            probeName: "s",
            shape, variant: "plain",
            misconception: `${w1} ${w2} ${w3}`, // "+ inserts spaces between the words"
            variantCard: `Each \`+\` joins the pieces end to end, so \`s\` holds \`${w1}${w2}${w3}\` — `
              + `one run of text, no spaces added.`,
          };
        }
        return {
          code: `s = "${w1}" + "${w2}"\n`,
          probeName: "s",
          shape: "direct", variant: "plain",
          misconception: `${w1} ${w2}`, // "+ inserts a space between the words"
          variantCard: `\`"${w1}" + "${w2}"\` builds the joined text \`${w1}${w2}\` and \`s\` holds it — `
            + `\`+\` never adds a space.`,
        };
      },
    },
  },

  {
    // Review (fill-one-blank): which index reaches this character? Words come
    // from distinctWords (all 6 letters distinct — the pool's documented
    // invariant), so the shown target character has exactly one non-negative
    // position: the drawn i (its negative twin i-6 also grades correct by
    // execution — the form's law). G1 regime: i ∈ 1..4, so the count-from-1
    // slip i+1 stays in range and prints word[i+1] ≠ word[i] (distinct
    // letters). Misconception formula (G2, rng-free): String(i + 1).
    id: "fill-index",
    topic: "strings",
    focus: "000E", // index-from-zero
    assumed: ["0005", "0006"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["fill-position"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const word = pick(rng, distinctWords);
        const i = int(rng, 1, 4); // G1: i+1 in range, and never position 0
        const { code, blank } = blankFrom(`w = "${word}"\nprint(w[\x00])\n`, String(i));
        return {
          code, blank, targetOutput: word[i],
          shape: "fill-position", variant: "plain",
          misconception: String(i + 1), // counting positions from 1
          variantCard: `Positions count from 0: in \`"${word}"\`, \`${word[0]}\` is position 0, so `
            + `\`${word[i]}\` sits at position ${i} — \`w[${i}]\`. Counting from 1 lands on `
            + `\`${word[i + 1]}\` instead.`,
        };
      },
    },
  },

  {
    // Review (fill-one-blank): reach the LAST character. distinctWords again
    // (all letters distinct), so the first character never equals the last.
    // G1 regime: the "-0 intuition" fills 0 ("position 0 from the end"),
    // which really indexes from the FRONT and prints word[0] ≠ word[5].
    // Misconception formula (G2, rng-free): "0". `-1` is the canonical fill;
    // `5` (len-1 from the front) also grades correct by execution — the
    // form's law.
    id: "fill-neg-index",
    topic: "strings",
    focus: "0010", // index-from-end
    assumed: ["0005", "0006", "000E"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["fill-last"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const word = pick(rng, distinctWords);
        const { code, blank } = blankFrom(`w = "${word}"\nprint(w[\x00])\n`, "-1");
        return {
          code, blank, targetOutput: word[word.length - 1],
          shape: "fill-last", variant: "plain",
          misconception: "0", // "position 0 from the end" — really the FIRST character
          variantCard: `Counting from the end starts at \`-1\`: \`w[-1]\` is the last character of `
            + `\`"${word}"\` — \`${word[word.length - 1]}\`. \`w[0]\` counts from the FRONT and gives `
            + `\`${word[0]}\`.`,
        };
      },
    },
  },

  {
    // Review (spot-the-difference, contrast: compare-ops): the SAME two words
    // with the operands swapped. A shows `cap < low` → True (the pool
    // invariant: every capital-initial word sorts before every lowercase one
    // by code point); B asks `low < cap` → False. G1 regime: A ≠ B by the
    // pool invariant alone. The misconception is A's shown output "True"
    // (spot-diff law): the case-blind alphabetical model — and the capital is
    // drawn so its LOWERCASED form still sorts after the lowercase word, so
    // that model genuinely predicts True for B on every seed.
    id: "case-compare-spot",
    topic: "strings",
    focus: "0014", // str-compare-code-points
    assumed: ["0005", "0006", "0015", "0016"],
    contrast: "0015", // compare-ops — the parent being contrasted, in assumed
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["literal-pair", "named-pair"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["literal-pair", "named-pair"]);
        const low = pick(rng, lowWords);
        // Only capitals whose lowercased form sorts AFTER `low`: the naive
        // alphabetical model then really answers True for B (G1).
        const caps = capWords.filter((c) => c.toLowerCase() > low);
        const cap = pick(rng, caps);
        // Two DISTINCT names by offset (G3); always drawn (G7), used only by
        // the named-pair shape.
        const p = int(rng, 0, strNames.length - 1);
        const q = (p + 1 + int(rng, 0, strNames.length - 2)) % strNames.length;
        const card = `Text compares by code points, and every capital sorts before every lowercase `
          + `letter: \`${cap[0]}\` < \`${low[0]}\`. So \`"${cap}" < "${low}"\` is \`True\`, and swapped, `
          + `\`"${low}" < "${cap}"\` is \`False\` — alphabetical feel says True both ways, code points say no.`;
        if (shape === "named-pair") {
          const [n1, n2] = [strNames[p], strNames[q]];
          return {
            code: `${n1} = "${cap}"\n${n2} = "${low}"\nprint(${n1} < ${n2})\n`,
            aOutput: "True",
            contrastCode: `${n1} = "${cap}"\n${n2} = "${low}"\nprint(${n2} < ${n1})\n`,
            shape, variant: "plain",
            misconception: "True", // the case-blind alphabetical model (= aOutput)
            variantCard: card,
          };
        }
        return {
          code: `print("${cap}" < "${low}")\n`,
          aOutput: "True",
          contrastCode: `print("${low}" < "${cap}")\n`,
          shape: "literal-pair", variant: "plain",
          misconception: "True", // the case-blind alphabetical model (= aOutput)
          variantCard: card,
        };
      },
    },
  },
];
