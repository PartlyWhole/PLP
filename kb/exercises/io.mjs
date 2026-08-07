// The input boundary (expansion ladder §R4a) — the `predict-io` form.
//
// A predict-io generator emits, on top of the usual { code, shape, variant }:
//   stdinScript: [...]   the lines "someone types", in order. The runtime
//                        SHOWS them on the card (the typing is scaffolded;
//                        where the text lands in the transcript is what is
//                        tested) and auto-answers each rendezvous with them.
// The graded answer is the whole console transcript, so every predict-io
// exercise is `multiline: true` by construction: the prompt, the typed line
// and the program's own output are several lines, and all of them together
// ARE the concept.
//
// Closure: ancestors(0026) = {0006, 0005, …roots}, so these programs may use
// print, plain names and input — nothing else.

import { mulberry32, pick } from "../rng.mjs";
import { words, strNames } from "../pools.mjs";

// Prompts are written as real prompts (trailing space, punctuation) so no
// prompt literal can ever equal a bound name — which would make the analyzer
// read it as quoted-vs-name (0007), outside the closure.
const PROMPTS = ["Your name? ", "Who is there? ", "Say a word: ", "Type something: ", "What shall I say? "];

// Two distinct picks from a pool, deterministically.
function pickTwo(rng, pool) {
  const i = Math.floor(rng() * pool.length);
  const j = (i + 1 + Math.floor(rng() * (pool.length - 1))) % pool.length;
  return [pool[i], pool[j]];
}

export default [
  {
    id: "greet-and-echo",
    topic: "state",
    focus: "0026", // input-pauses-for-value
    assumed: ["0005", "0006"],
    role: "intro",
    form: "predict-io",
    multiline: true, // the transcript IS the answer (design §5.2 / E4)
    generator: {
      shapes: ["echo-back", "prompt-then-print-twice", "bind-then-print"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["echo-back", "prompt-then-print-twice", "bind-then-print"]);
        const prompt = pick(rng, PROMPTS);
        const name = pick(rng, strNames);
        const [typed, greeting] = pickTwo(rng, words);
        const stdinScript = [typed];
        if (shape === "echo-back") {
          return {
            code: `print(input(${JSON.stringify(prompt)}))\n`,
            shape, variant: "plain", stdinScript,
            // The learner who thinks the program never waits writes only what
            // `print` emits — no prompt, no typed line (the concept's own
            // characteristic wrong answer).
            misconception: typed,
            variantCard: `The program printed \`${prompt.trimEnd()}\` and then **stopped** — `
              + `nothing else could happen until a line was typed. \`${typed}\` went in, `
              + `straight through \`input(...)\` into \`print(...)\`, and came back out.`,
          };
        }
        if (shape === "prompt-then-print-twice") {
          return {
            code: `${name} = input(${JSON.stringify(prompt)})\nprint(${name})\nprint(${name})\n`,
            shape, variant: "plain", stdinScript,
            misconception: `${typed}\n${typed}`,
            variantCard: `\`${prompt.trimEnd()}\` appeared, and the program waited. `
              + `The typed line \`${typed}\` became an ordinary binding — \`${name}\` — `
              + `and an ordinary binding can be printed as many times as you like. `
              + `The program only asked **once**.`,
          };
        }
        return {
          code: `print(${JSON.stringify(greeting)})\n${name} = input(${JSON.stringify(prompt)})\nprint(${name})\n`,
          shape, variant: "plain", stdinScript,
          misconception: `${greeting}\n${typed}`,
          variantCard: `\`${greeting}\` printed straight away — line 1 needed nothing from `
            + `outside. Then \`${prompt.trimEnd()}\` appeared and the program **stopped** there `
            + `until \`${typed}\` was typed; only then did line 3 run.`,
        };
      },
    },
  },

  {
    id: "two-questions",
    topic: "state",
    focus: "0026",
    assumed: ["0005", "0006"],
    role: "review",
    form: "predict-io",
    multiline: true,
    generator: {
      // Two rendezvous: which typed line landed in which name is the whole
      // question, so the printing order is what varies across shapes.
      shapes: ["both-in-order", "reverse-order", "second-only"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["both-in-order", "reverse-order", "second-only"]);
        const [p1, p2] = pickTwo(rng, PROMPTS);
        const [n1, n2] = pickTwo(rng, strNames);
        const [w1, w2] = pickTwo(rng, words);
        const head = `${n1} = input(${JSON.stringify(p1)})\n${n2} = input(${JSON.stringify(p2)})\n`;
        const transcript = (a, b) => `${p1}${a}\n${p2}${b}\n`;
        if (shape === "both-in-order") {
          return {
            code: `${head}print(${n1})\nprint(${n2})\n`,
            shape, variant: "plain", stdinScript: [w1, w2],
            // The designed confusion: the two answers swapped — the learner
            // who does not track WHICH rendezvous took WHICH line.
            misconception: `${transcript(w1, w2)}${w2}\n${w1}`,
            variantCard: `Two stops, two typed lines, in order: \`${w1}\` answered `
              + `\`${p1.trimEnd()}\` and became \`${n1}\`; \`${w2}\` answered `
              + `\`${p2.trimEnd()}\` and became \`${n2}\`. Printing them back in that `
              + `order replays what was typed.`,
          };
        }
        if (shape === "reverse-order") {
          return {
            code: `${head}print(${n2})\nprint(${n1})\n`,
            shape, variant: "plain", stdinScript: [w1, w2],
            misconception: `${transcript(w1, w2)}${w1}\n${w2}`,
            variantCard: `The **asking** order and the **printing** order are `
              + `independent. \`${w1}\` went into \`${n1}\` and \`${w2}\` into \`${n2}\` `
              + `as they were typed — but the printing lines put \`${n2}\` first, so `
              + `\`${w2}\` comes back out before \`${w1}\`.`,
          };
        }
        return {
          code: `${head}print(${n2})\n`,
          shape, variant: "plain", stdinScript: [w1, w2],
          misconception: `${transcript(w1, w2)}${w1}`,
          variantCard: `Both questions were asked — the program stopped **twice**, so `
            + `both typed lines are in the transcript. But only \`${n2}\` is printed, so `
            + `\`${w1}\` is bound and never shown: it was still needed to get past the `
            + `first stop.`,
        };
      },
    },
  },

  // Review: two rendezvous, and the printing can happen after both stops (in
  // either order) or BETWEEN them — where each typed line lands in the
  // transcript is the whole question. G1 regime: w1 ≠ w2 by pickTwo, and
  // every prompt is non-empty (so a prompt-bearing line never equals a bare
  // word line) — each shape's misconception transcript differs from the
  // truth on every seed. Misconception formulas (rng-free): print-reversed →
  // the prints replayed in ASKING order; print-in-order → the two bindings
  // swapped; echo-between → both questions first, prints after (the
  // non-interleaved transcript).
  {
    id: "two-inputs",
    topic: "state",
    focus: "0026",
    assumed: ["0005", "0006"],
    role: "review",
    form: "predict-io",
    multiline: true,
    generator: {
      shapes: ["print-reversed", "print-in-order", "echo-between"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["print-reversed", "print-in-order", "echo-between"]);
        const [p1, p2] = pickTwo(rng, PROMPTS);
        const [n1, n2] = pickTwo(rng, strNames);
        const [w1, w2] = pickTwo(rng, words);
        const stdinScript = [w1, w2];
        const head = `${n1} = input(${JSON.stringify(p1)})\n${n2} = input(${JSON.stringify(p2)})\n`;
        const asked = `${p1}${w1}\n${p2}${w2}\n`;
        if (shape === "print-reversed") {
          return {
            code: `${head}print(${n2})\nprint(${n1})\n`,
            shape, variant: "plain", stdinScript,
            // The learner who replays the typing order instead of reading the
            // print lines writes w1 before w2.
            misconception: `${asked}${w1}\n${w2}`,
            variantCard: `Two stops: \`${w1}\` answered \`${p1.trimEnd()}\` and became `
              + `\`${n1}\`; \`${w2}\` answered \`${p2.trimEnd()}\` and became \`${n2}\`. `
              + `The print lines then run in THEIR order — \`${n2}\` first — so \`${w2}\` `
              + `comes back out before \`${w1}\`, the opposite of how they went in.`,
          };
        }
        if (shape === "print-in-order") {
          return {
            code: `${head}print(${n1})\nprint(${n2})\n`,
            shape, variant: "plain", stdinScript,
            // The learner who loses track of WHICH stop took WHICH line
            // swaps the two bindings.
            misconception: `${asked}${w2}\n${w1}`,
            variantCard: `Each stop took exactly one typed line, in order: \`${w1}\` `
              + `became \`${n1}\` at the first stop, \`${w2}\` became \`${n2}\` at the `
              + `second. Printing \`${n1}\` then \`${n2}\` replays them as typed — `
              + `\`${w1}\`, then \`${w2}\`.`,
          };
        }
        return {
          code: `${n1} = input(${JSON.stringify(p1)})\nprint(${n1})\n${n2} = input(${JSON.stringify(p2)})\nprint(${n2})\n`,
          shape, variant: "plain", stdinScript,
          // The learner who bunches all the questions first writes the
          // non-interleaved transcript.
          misconception: `${asked}${w1}\n${w2}`,
          variantCard: `The program ran top to bottom: it stopped at `
            + `\`${p1.trimEnd()}\`, got \`${w1}\`, and printed it straight back BEFORE `
            + `asking anything else. Only then did \`${p2.trimEnd()}\` appear, take `
            + `\`${w2}\`, and print it. The echoes sit between the questions, not after `
            + `them.`,
        };
      },
    },
  },

  // Review: one stop, several prints. The program only asked ONCE — a bound
  // name can be printed any number of times without asking again. G1 regime:
  // the misconception transcript inserts a second `${prompt}${typed}` line,
  // so it always has one more line than the truth and a prompt-bearing line
  // where the truth has a bare word (prompts are non-empty) — never equal.
  // Misconception formula (rng-free): the prompt reappears before the final
  // echo, as if the second use of the name re-asked.
  {
    id: "prompt-then-work",
    topic: "state",
    focus: "0026",
    assumed: ["0005", "0006"],
    role: "review",
    form: "predict-io",
    multiline: true,
    generator: {
      shapes: ["twice-then-done", "done-then-echo"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["twice-then-done", "done-then-echo"]);
        const prompt = pick(rng, PROMPTS);
        const name = pick(rng, strNames);
        const [typed, done] = pickTwo(rng, words);
        const stdinScript = [typed];
        if (shape === "twice-then-done") {
          return {
            code: `${name} = input(${JSON.stringify(prompt)})\nprint(${name})\nprint(${name})\nprint("${done}")\n`,
            shape, variant: "plain", stdinScript,
            // "It must ask again to print it again": the prompt and typed
            // line reappear before the second echo.
            misconception: `${prompt}${typed}\n${typed}\n${prompt}${typed}\n${typed}\n${done}`,
            variantCard: `One stop: \`${prompt.trimEnd()}\` appeared, \`${typed}\` went `
              + `in, and \`${name}\` held it from then on. Lines 2 and 3 print that same `
              + `binding twice — no new question, no new typing — and line 4 prints `
              + `\`${done}\`. The program only asked **once**.`,
          };
        }
        return {
          code: `${name} = input(${JSON.stringify(prompt)})\nprint("${done}")\nprint(${name})\nprint(${name})\n`,
          shape, variant: "plain", stdinScript,
          misconception: `${prompt}${typed}\n${done}\n${typed}\n${prompt}${typed}\n${typed}`,
          variantCard: `The stop came first: \`${prompt.trimEnd()}\` waited until `
            + `\`${typed}\` was typed. After that nothing else could interrupt — `
            + `\`${done}\` printed, and then \`${name}\` was echoed twice from the one `
            + `binding. Asking happened once, at the top.`,
        };
      },
    },
  },
];
