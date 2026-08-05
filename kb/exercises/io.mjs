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
];
