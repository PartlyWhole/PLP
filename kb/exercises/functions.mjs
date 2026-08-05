// Functions exercises — the def/call/return half of the sub-graph
// (expansion ladder §R4b, waves 1–3). Every exercise: one focus concept,
// assumed ⊆ ancestors(focus), and a seeded deterministic generator whose
// every program stays inside footprint ⊆ assumed ∪ {focus} ∪ Structural
// (checked across 40 seeds in tests/kb.spec.mjs).
//
// The lineage is TIGHT here, and it shapes the programs:
//   ancestors(0027) has no 0006 → def/intro programs use no variables;
//   ancestors(0028) likewise → call programs are print-only;
//   ancestors(0029) has no 0008 → parameter programs do no arithmetic;
//   ancestors(002A/002B/002C/002G/002H) has no 0029 → every return program
//   uses a PARAMETER-FREE function. That last one is not a workaround: the
//   return story and the parameter story are separate parents in the ledger
//   (frozen), so an exercise may only ever teach one of them at a time.
//
// NOT here: the wave-3 `two-calls-chain` trace table. The trace-table row a
// module binding lands on is attributed to the CALLEE's line (`return n * 2`)
// rather than to the call line, so a table over `x = double(v)` would label
// the row with a line the watched name is not assigned on. Frame-aware
// tables are deferred (ladder §R4b decision); the attribution is PINNED by
// the K-fnattr anchor test so the deferral cannot rot.

import { mulberry32, int, pick } from "../rng.mjs";
import { words, strNames, listNames } from "../pools.mjs";

// Function names (no collision with kb/pools.mjs `names`, which supply the
// variables — a program must never spell a function and a variable alike).
const fnNames = ["greet", "shout", "show", "bark", "cheer", "report"];
// Value names used at module level in the return/None programs.
const valNames = ["x", "n", "score", "count"];

// Two distinct draws from a pool (E7 distinct-word discipline: the word a
// never-run body would print must never coincide with the word that really
// prints, or the trap dissolves).
function twoOf(rng, pool) {
  const i = int(rng, 0, pool.length - 1);
  const j = (i + 1 + int(rng, 0, pool.length - 2)) % pool.length;
  return [pool[i], pool[j]];
}
function threeOf(rng, pool) {
  const [a, b] = twoOf(rng, pool);
  const rest = pool.filter((w) => w !== a && w !== b);
  return [a, b, pick(rng, rest)];
}

export default [
  // --- wave 1: 0027 def-defines-not-runs -------------------------------
  {
    // The intro is footprint-clean BECAUSE the body never runs: an un-called
    // body emits nothing at all, so the only tags are print-text and the def.
    id: "def-then-done",
    topic: "functions",
    focus: "0027", // def-defines-not-runs
    assumed: ["0005"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["def-then-print", "def-two-body-lines", "two-defs"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["def-then-print", "def-two-body-lines", "two-defs"]);
        const [inside, outside, extra] = threeOf(rng, words);
        const [f, g] = twoOf(rng, fnNames);
        if (shape === "def-two-body-lines") {
          return {
            code: `def ${f}():\n    print("${inside}")\n    print("${extra}")\nprint("${outside}")\n`,
            shape, variant: "plain",
            misconception: inside,
            variantCard: `The two prints inside \`${f}\` are only STORED. Nothing calls `
              + `\`${f}\`, so \`${inside}\` and \`${extra}\` never appear — only the `
              + `\`print("${outside}")\` at the bottom runs.`,
          };
        }
        if (shape === "two-defs") {
          return {
            code: `def ${f}():\n    print("${inside}")\ndef ${g}():\n    print("${extra}")\nprint("${outside}")\n`,
            shape, variant: "plain",
            misconception: inside,
            variantCard: `Two recipes are written down and neither is called. Defining `
              + `\`${f}\` and \`${g}\` prints nothing; the output is just \`${outside}\`.`,
          };
        }
        return {
          code: `def ${f}():\n    print("${inside}")\nprint("${outside}")\n`,
          shape, variant: "plain",
          misconception: inside,
          variantCard: `\`def ${f}():\` only writes the recipe down. \`${inside}\` is inside `
            + `the body, and nobody calls \`${f}\`, so the only thing that prints is `
            + `\`${outside}\`.`,
        };
      },
    },
  },

  // --- wave 1: 0028 call-runs-body -------------------------------------
  {
    // MULTILINE on purpose: once-per-call IS the concept, so the answer has
    // to be able to show the body's line more than once. The call COUNT
    // varies across shapes so "the answer is always twice" never works.
    id: "call-count",
    topic: "functions",
    focus: "0028", // call-runs-body
    assumed: ["0005", "0027"],
    role: "intro",
    form: "predict-exact-output",
    multiline: true,
    generator: {
      shapes: ["call-once", "call-twice", "interleaved"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["call-once", "call-twice", "interleaved"]);
        const [inside, outside] = twoOf(rng, words);
        const f = pick(rng, fnNames);
        const def = `def ${f}():\n    print("${inside}")\n`;
        if (shape === "call-twice") {
          return {
            code: `${def}${f}()\n${f}()\n${f}()\n`,
            shape, variant: "plain",
            misconception: inside, // the body ran only once
            variantCard: `Three calls, three runs of the body: \`${inside}\` prints three `
              + `times. Storing the body once does not mean running it once.`,
          };
        }
        if (shape === "interleaved") {
          return {
            code: `${def}${f}()\nprint("${outside}")\n${f}()\n`,
            shape, variant: "plain",
            misconception: `${inside}\n${inside}\n${outside}`, // both calls first
            variantCard: `Each call runs the body right where it is written: \`${inside}\`, `
              + `then the line \`${outside}\` in between, then \`${inside}\` again.`,
          };
        }
        return {
          // No designed misconception here: the tempting wrong answer is
          // "nothing prints", and an EMPTY answer is not a comparable one.
          code: `${def}${f}()\n`,
          shape, variant: "plain",
          variantCard: `The call \`${f}()\` runs the stored body now, so \`${inside}\` prints `
            + `once — one run per call.`,
        };
      },
    },
  },

  {
    // Spot-the-difference against 0027: the ONE changed line is whether the
    // stored body is called at all.
    id: "called-or-not",
    topic: "functions",
    focus: "0028", // call-runs-body
    assumed: ["0005", "0027"],
    contrast: "0027", // def-defines-not-runs — the parent, already assumed
    misconceptionOf: "0027", // answering A's output = "the def ran the body"
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["call-vs-plain-print"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const [inside, outside] = twoOf(rng, words);
        const f = pick(rng, fnNames);
        const def = `def ${f}():\n    print("${inside}")\n`;
        return {
          // A (shown with its output): the body IS called.
          code: `${def}${f}()\n`,
          aOutput: inside,
          // B (predicted): the same stored body, never called — the last line
          // is an ordinary print instead.
          contrastCode: `${def}print("${outside}")\n`,
          shape: "call-vs-plain-print", variant: "plain",
          variantCard: `Only line 3 changed. \`${f}()\` runs the stored body, so A prints `
            + `\`${inside}\`. In B nothing ever calls \`${f}\` — the body just sits there — `
            + `so the only output is \`${outside}\`.`,
        };
      },
    },
  },

  // --- wave 2: 0029 def-params-bind-args --------------------------------
  {
    // MULTILINE for the two-calls shape: "the parameter gets THIS call's
    // value" is only visible when two calls hand it different values.
    // ancestors(0029) has no 0008 — these programs do no arithmetic.
    id: "param-gets-value",
    topic: "functions",
    focus: "0029", // def-params-bind-args
    assumed: ["0005", "0006", "0027", "0028"],
    role: "intro",
    form: "predict-exact-output",
    multiline: true,
    generator: {
      shapes: ["print-param", "two-calls-different-args", "two-params"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["print-param", "two-calls-different-args", "two-params"]);
        const [first, second] = twoOf(rng, words);
        const f = pick(rng, fnNames);
        if (shape === "two-calls-different-args") {
          return {
            code: `def ${f}(word):\n    print(word)\n${f}("${first}")\n${f}("${second}")\n`,
            shape, variant: "plain",
            misconception: `${first}\n${first}`, // the parameter "kept" the first value
            variantCard: `\`word\` is not one fixed value: the first call binds it to `
              + `\`${first}\`, the second call binds it to \`${second}\` — each call gets `
              + `its own binding.`,
          };
        }
        if (shape === "two-params") {
          return {
            code: `def ${f}(first, second):\n    print(second)\n${f}("${first}", "${second}")\n`,
            shape, variant: "plain",
            misconception: first, // arguments matched to the wrong parameter
            variantCard: `The arguments fill the parameters in order: \`first\` gets `
              + `\`${first}\` and \`second\` gets \`${second}\`. The body prints `
              + `\`second\`, so the output is \`${second}\`.`,
          };
        }
        return {
          code: `def ${f}(word):\n    print(word)\n${f}("${first}")\n`,
          shape, variant: "plain",
          misconception: "word", // the parameter NAME rather than its value
          variantCard: `At the call, \`word\` is bound to \`${first}\` for this run of the `
            + `body — so \`print(word)\` prints \`${first}\`, not the letters \`word\`.`,
        };
      },
    },
  },

  {
    // Fill the ARGUMENT. The blank token is a NAME and the shown target is
    // the VALUE that name holds, so the fill can never be a transcription of
    // the target (E5); the second binding is the discriminating distractor.
    id: "pick-the-argument",
    topic: "functions",
    focus: "0029", // def-params-bind-args
    assumed: ["0005", "0006", "0027", "0028"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["pick-first", "pick-second"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["pick-first", "pick-second"]);
        const [n1, n2] = twoOf(rng, valNames);
        const [v1, v2] = twoOf(rng, words);
        const f = pick(rng, fnNames);
        const wanted = shape === "pick-first" ? n1 : n2;
        const target = shape === "pick-first" ? v1 : v2;
        const template = `${n1} = "${v1}"\n${n2} = "${v2}"\ndef ${f}(word):\n    print(word)\n${f}(\x00)\n`;
        const idx = template.indexOf("\x00");
        const before = template.slice(0, idx);
        return {
          code: template.replace("\x00", wanted),
          blank: {
            line: before.split("\n").length,
            col: idx - (before.lastIndexOf("\n") + 1),
            len: wanted.length,
            target: wanted,
          },
          targetOutput: target,
          shape, variant: "plain",
          variantCard: `The call hands \`${f}\` one value. \`${wanted}\` holds \`${target}\`, `
            + `so \`${f}(${wanted})\` binds \`word\` to \`${target}\` and the body prints it.`,
        };
      },
    },
  },

  // --- wave 2: 002F args-evaluated-first --------------------------------
  {
    id: "args-computed-first",
    topic: "functions",
    focus: "002F", // args-evaluated-first
    assumed: ["0005", "0006", "0008", "0009", "0027", "0028", "0029"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["sum-arg", "difference-arg", "name-plus-number"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["sum-arg", "difference-arg", "name-plus-number"]);
        const f = pick(rng, fnNames);
        const k = int(rng, 2, 4);
        if (shape === "difference-arg") {
          // Subtraction, not multiplication: `f(a * b)` would be a dead
          // shape, because `(a * b) * k` and `a * (b * k)` are the same
          // number — the "argument arrives unevaluated" model has to be
          // able to give a DIFFERENT answer (E6).
          const b = int(rng, 2, 4), a = b + int(rng, 2, 6);
          return {
            code: `def ${f}(n):\n    print(n * ${k})\n${f}(${a} - ${b})\n`,
            shape, variant: "plain",
            misconception: String(a - b * k), // as if the body's work came first
            variantCard: `\`${a} - ${b}\` is computed FIRST, to ${a - b}. The body then `
              + `receives that finished value, so it prints ${a - b} * ${k} = ${(a - b) * k}.`,
          };
        }
        if (shape === "name-plus-number") {
          const nm = pick(rng, valNames);
          const v = int(rng, 2, 6), inc = int(rng, 1, 4);
          return {
            code: `def ${f}(n):\n    print(n * ${k})\n${nm} = ${v}\n${f}(${nm} + ${inc})\n`,
            shape, variant: "plain",
            misconception: String(v * k + inc), // the + applied after the body's work
            variantCard: `\`${nm} + ${inc}\` becomes ${v + inc} before the call starts, so `
              + `the body works with ${v + inc}: ${v + inc} * ${k} = ${(v + inc) * k}.`,
          };
        }
        const a = int(rng, 2, 6), b = int(rng, 1, 5);
        return {
          code: `def ${f}(n):\n    print(n * ${k})\n${f}(${a} + ${b})\n`,
          shape, variant: "plain",
          misconception: String(a + b * k), // as if the sum arrived unevaluated
          variantCard: `The argument \`${a} + ${b}\` is computed down to ${a + b} before the `
            + `body starts — the function never sees the \`+\`. It prints `
            + `${a + b} * ${k} = ${(a + b) * k}.`,
        };
      },
    },
  },

  // --- wave 3: 002A return-hands-back-value -----------------------------
  {
    // ancestors(002A) has no 0029 — the returning functions take no
    // parameters, so the exercise teaches exactly one new thing.
    id: "return-then-use",
    topic: "functions",
    focus: "002A", // return-hands-back-value
    assumed: ["0005", "0006", "0008", "0009", "0027", "0028"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["bind-then-print", "direct-print", "bind-then-use-in-math"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["bind-then-print", "direct-print", "bind-then-use-in-math"]);
        const f = pick(rng, fnNames);
        const nm = pick(rng, valNames);
        const a = int(rng, 2, 9), b = int(rng, 2, 9);
        const body = `def ${f}():\n    return ${a} + ${b}\n`;
        if (shape === "direct-print") {
          return {
            code: `${body}print(${f}())\n`,
            shape, variant: "plain",
            misconception: "None", // "a call shows nothing of its own"
            variantCard: `\`${f}()\` HANDS BACK ${a + b}, and \`print\` shows what it was `
              + `handed: ${a + b}.`,
          };
        }
        if (shape === "bind-then-use-in-math") {
          const inc = int(rng, 1, 5);
          return {
            code: `${body}${nm} = ${f}()\nprint(${nm} + ${inc})\n`,
            shape, variant: "plain",
            misconception: String(a + b), // the + inc forgotten
            variantCard: `The call became ${a + b}, so \`${nm}\` holds ${a + b} and the `
              + `printed sum is ${a + b} + ${inc} = ${a + b + inc}.`,
          };
        }
        return {
          code: `${body}${nm} = ${f}()\nprint(${nm})\n`,
          shape, variant: "plain",
          misconception: "None", // nothing came back
          variantCard: `\`return ${a} + ${b}\` hands ${a + b} back to the caller, so `
            + `\`${nm} = ${f}()\` stores ${a + b} — the call EXPRESSION became that value.`,
        };
      },
    },
  },

  // --- wave 3: 002G call-in-expression ----------------------------------
  {
    id: "call-slots-in",
    topic: "functions",
    focus: "002G", // call-in-expression
    assumed: ["0005", "0006", "0008", "0009", "0027", "0028", "002A"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["call-plus-number", "number-minus-call", "call-times-number"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["call-plus-number", "number-minus-call", "call-times-number"]);
        const f = pick(rng, fnNames);
        const v = int(rng, 2, 9);
        const body = `def ${f}():\n    return ${v}\n`;
        if (shape === "number-minus-call") {
          const big = v + int(rng, 2, 9);
          return {
            code: `${body}print(${big} - ${f}())\n`,
            shape, variant: "plain",
            misconception: String(v), // the surrounding math ignored
            variantCard: `\`${f}()\` becomes ${v}, and the subtraction then runs with that `
              + `value in its place: ${big} - ${v} = ${big - v}.`,
          };
        }
        if (shape === "call-times-number") {
          const k = int(rng, 2, 4);
          return {
            code: `${body}print(${f}() * ${k})\n`,
            shape, variant: "plain",
            misconception: String(v),
            variantCard: `The call takes its value's place in the expression: `
              + `\`${f}() * ${k}\` is ${v} * ${k} = ${v * k}.`,
          };
        }
        const inc = int(rng, 1, 9);
        return {
          code: `${body}print(${f}() + ${inc})\n`,
          shape, variant: "plain",
          misconception: String(v),
          variantCard: `\`${f}()\` is an expression worth ${v}, so the line is `
            + `${v} + ${inc} = ${v + inc} — the call joins the calculation.`,
        };
      },
    },
  },

  // --- wave 3: 002B return-vs-print -------------------------------------
  {
    // MULTILINE: the whole point is that TWO things happen — the body's print
    // during the call, and then the None the caller was actually handed.
    id: "shout-trap",
    topic: "functions",
    focus: "002B", // return-vs-print
    assumed: ["0005", "0006", "0027", "0028", "002A"],
    role: "intro",
    form: "predict-exact-output",
    multiline: true,
    generator: {
      shapes: ["bind-then-print", "print-the-call"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["bind-then-print", "print-the-call"]);
        const f = pick(rng, fnNames);
        const nm = pick(rng, valNames);
        const word = pick(rng, words);
        const body = `def ${f}():\n    print("${word}")\n`;
        if (shape === "print-the-call") {
          return {
            code: `${body}print(${f}())\n`,
            shape, variant: "plain",
            misconception: word, // only the body's print counted
            variantCard: `Two lines appear: the body's own \`print\` shows \`${word}\` during `
              + `the call, and then the OUTER print shows what the call handed back — `
              + `nothing was returned, so \`None\`.`,
          };
        }
        return {
          code: `${body}${nm} = ${f}()\nprint(${nm})\n`,
          shape, variant: "plain",
          misconception: word,
          variantCard: `\`${f}\` SHOWS \`${word}\` but hands nothing back, so \`${nm}\` `
            + `holds \`None\` — printing it shows \`None\`, not \`${word}\`.`,
        };
      },
    },
  },

  {
    // The same trap as latent state: what does the name actually hold?
    id: "shout-state",
    topic: "functions",
    focus: "002B", // return-vs-print
    assumed: ["0005", "0006", "0027", "0028", "002A"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["probe-after-print-only-call"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const f = pick(rng, fnNames);
        const nm = pick(rng, valNames);
        const word = pick(rng, words);
        return {
          code: `def ${f}():\n    print("${word}")\n${nm} = ${f}()\n`,
          probeName: nm,
          shape: "probe-after-print-only-call", variant: "plain",
          misconception: word, // the printed text mistaken for the returned value
          variantCard: `\`${word}\` was PRINTED, not returned. \`${f}()\` handed back `
            + `nothing, so \`${nm}\` holds \`None\`.`,
        };
      },
    },
  },

  {
    // One line changed: `return` vs `print` inside the body.
    id: "return-or-print",
    topic: "functions",
    focus: "002B", // return-vs-print
    assumed: ["0005", "0006", "0008", "0009", "0027", "0028", "002A"],
    contrast: "002A", // return-hands-back-value — the parent, already assumed
    misconceptionOf: "002A", // answering A's output = "print and return are the same"
    role: "review",
    form: "spot-the-difference",
    multiline: true,
    generator: {
      shapes: ["return-vs-print-body"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const f = pick(rng, fnNames);
        const nm = pick(rng, valNames);
        const a = int(rng, 2, 9), b = int(rng, 2, 9);
        return {
          // A (shown with its output): the body RETURNS the value.
          code: `def ${f}():\n    return ${a} + ${b}\n${nm} = ${f}()\nprint(${nm})\n`,
          aOutput: String(a + b),
          // B (predicted): the body PRINTS instead — the caller gets None.
          contrastCode: `def ${f}():\n    print(${a} + ${b})\n${nm} = ${f}()\nprint(${nm})\n`,
          shape: "return-vs-print-body", variant: "plain",
          variantCard: `Only line 2 changed. Returning hands ${a + b} back, so A prints it `
            + `once. Printing inside the body shows ${a + b} during the call but hands back `
            + `nothing — so B prints ${a + b} and then \`None\`.`,
        };
      },
    },
  },

  // --- wave 3: 002C return-exits-function -------------------------------
  {
    // The dead code after `return` is the deliberate trap: a learner who
    // thinks the body runs to the end predicts the extra line.
    id: "early-exit",
    topic: "functions",
    focus: "002C", // return-exits-function
    assumed: ["0005", "0006", "0008", "0009", "0027", "0028", "002A"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["dead-print", "two-dead-lines", "dead-assign-then-print"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["dead-print", "two-dead-lines", "dead-assign-then-print"]);
        const f = pick(rng, fnNames);
        const nm = pick(rng, valNames);
        const [w1, w2] = twoOf(rng, words);
        const a = int(rng, 2, 9), b = int(rng, 2, 9);
        if (shape === "two-dead-lines") {
          return {
            code: `def ${f}():\n    return ${a} + ${b}\n    print("${w1}")\n    print("${w2}")\nprint(${f}())\n`,
            shape, variant: "plain",
            misconception: w1,
            variantCard: `\`return\` ends the call immediately, so neither \`${w1}\` nor `
              + `\`${w2}\` is ever reached — the only output is the returned ${a + b}.`,
          };
        }
        if (shape === "dead-assign-then-print") {
          const v = int(rng, 10, 20);
          return {
            code: `def ${f}():\n    return ${a} + ${b}\n    ${nm} = ${v}\n    print(${nm})\nprint(${f}())\n`,
            shape, variant: "plain",
            misconception: String(v),
            variantCard: `The function is already gone by line 3: \`${nm}\` is never bound `
              + `and \`${v}\` never prints. The call handed back ${a + b}.`,
          };
        }
        return {
          code: `def ${f}():\n    return ${a} + ${b}\n    print("${w1}")\nprint(${f}())\n`,
          shape, variant: "plain",
          misconception: w1,
          variantCard: `The \`print("${w1}")\` sits AFTER the return, so it never runs. `
            + `The call became ${a + b}, and that is all that prints.`,
        };
      },
    },
  },

  // --- wave 3: 002H none-when-no-return ---------------------------------
  {
    // Edge concept, discover-first: the surprise IS the lesson, so the form
    // probes the latent binding rather than printed output.
    id: "nothing-comes-back",
    topic: "functions",
    focus: "002H", // none-when-no-return
    assumed: ["0005", "0006", "0008", "0009", "0027", "0028", "002A", "002B"],
    role: "intro",
    form: "predict-state",
    generator: {
      shapes: ["computed-discarded", "bare-return"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["computed-discarded", "bare-return"]);
        const f = pick(rng, fnNames);
        const [nm, other] = twoOf(rng, valNames);
        const v = int(rng, 2, 9), k = int(rng, 2, 4);
        if (shape === "bare-return") {
          return {
            code: `def ${f}():\n    return\n${nm} = ${f}()\n`,
            probeName: nm,
            shape, variant: "plain",
            // No designed misconception: the tempting wrong answer here is
            // "nothing at all", which is not an answer the form can compare.
            variantCard: `A bare \`return\` hands back \`None\` — there is always a value, `
              + `and here it is \`None\`, so \`${nm}\` holds \`None\`.`,
          };
        }
        return {
          code: `${other} = ${v}\ndef ${f}():\n    ${other} * ${k}\n${nm} = ${f}()\n`,
          probeName: nm,
          shape, variant: "plain",
          misconception: String(v * k), // the computed value "coming back by itself"
          variantCard: `The body computed ${v} * ${k} = ${v * k} and threw it away — no `
            + `\`return\` means the caller gets \`None\`, so \`${nm}\` holds \`None\`.`,
        };
      },
    },
  },

  // --- wave 3 (deferred, now shipped): the two-call trace table ----------
  {
    // Held back while a module binding produced by a call was attributed to
    // the CALLEE's `return` line; the builder now charges a globals-scope
    // change to the module statement that owns the frame — the call site —
    // so both rows land on the lines that really bind the watched names
    // (K-fnattr is the regression guard).
    //
    // DEVIATION from the ladder's sketch: the chained program there was
    // `x = double(v)` / `y = double(x)`, which needs a PARAMETER. 0029 and
    // 002A are siblings in the frozen ledger (neither is an ancestor of the
    // other), so one program can never carry both and stay inside any
    // exercise's closure. The chain is therefore built the legal way: a
    // parameter-free function called twice, the second call taking part in an
    // expression that also uses the first call's result — which is exactly
    // 002G's story, so 002G is the focus.
    id: "two-calls-chain",
    topic: "functions",
    focus: "002G", // call-in-expression
    assumed: ["0005", "0006", "0008", "0009", "0027", "0028", "002A"],
    role: "review",
    form: "trace-table",
    generator: {
      shapes: ["second-call-uses-first", "second-call-scaled"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["second-call-uses-first", "second-call-scaled"]);
        const f = pick(rng, fnNames);
        const [x, y] = twoOf(rng, valNames);
        const a = int(rng, 2, 9), b = int(rng, 2, 9);
        const body = `def ${f}():\n    return ${a} + ${b}\n`;
        if (shape === "second-call-scaled") {
          const k = int(rng, 2, 4);
          return {
            code: `${body}${x} = ${f}()\n${y} = ${f}() * ${k}\nprint(${y})\n`,
            probeNames: [x, y],
            maxBlanks: 4,
            shape, variant: "plain",
            variantCard: `Each call is worth ${a + b}. \`${x}\` stores that; on the next `
              + `line the second call becomes ${a + b} again and the expression finishes: `
              + `${a + b} * ${k} = ${(a + b) * k}.`,
          };
        }
        return {
          code: `${body}${x} = ${f}()\n${y} = ${x} + ${f}()\nprint(${y})\n`,
          probeNames: [x, y],
          maxBlanks: 4,
          shape, variant: "plain",
          variantCard: `\`${f}()\` hands back ${a + b} every time. \`${x}\` becomes ${a + b}, `
            + `then \`${y} = ${x} + ${f}()\` adds that to a fresh ${a + b}: ${(a + b) * 2}.`,
        };
      },
    },
  },

  // --- wave 4: 002D local-scope-inside ----------------------------------
  {
    // The honest witness for "it is GONE" is a probe that finds NOTHING, so
    // this rides the predict-state form's `gone` answer token: `probeGone`
    // tells every consumer (docgen, the K-series) that the probed name does
    // not survive, and that appending `print(<probe>)` would RAISE rather
    // than reveal — the program itself must stay a clean run (E3).
    // ancestors(002D) = {0005, 0006, 0027, 0028, 0029} — no arithmetic and no
    // string operations are available here, so the locals hold plain values.
    // MULTILINE: two of the three shapes run the body more than once or use
    // both of the call's names, and the printed lines are not the graded
    // surface anyway (the probe is).
    id: "local-vanishes",
    topic: "functions",
    focus: "002D", // local-scope-inside
    assumed: ["0005", "0006", "0027", "0028", "0029"],
    role: "intro",
    form: "predict-state",
    multiline: true,
    generator: {
      shapes: ["one-call", "two-calls", "local-and-param"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["one-call", "two-calls", "local-and-param"]);
        const f = pick(rng, fnNames);
        const [local, param] = twoOf(rng, strNames);
        const [v, other] = twoOf(rng, words);
        if (shape === "two-calls") {
          return {
            code: `def ${f}():\n    ${local} = "${v}"\n    print(${local})\n${f}()\n${f}()\n`,
            probeName: local,
            probeGone: true,
            shape, variant: "plain",
            misconception: v, // the local "still holding" its last value
            variantCard: `Each call makes its OWN \`${local}\`, uses it, and drops it. `
              + `After the second call ends there is no \`${local}\` anywhere — running `
              + `it twice does not make the name survive.`,
          };
        }
        if (shape === "local-and-param") {
          return {
            code: `def ${f}(${param}):\n    ${local} = "${v}"\n    print(${param})\n    print(${local})\n${f}("${other}")\n`,
            probeName: local,
            probeGone: true,
            shape, variant: "plain",
            misconception: v,
            variantCard: `Both \`${param}\` and \`${local}\` belong to the call: one arrived `
              + `as the argument, one was made inside. When \`${f}\` ends, both are gone — `
              + `so afterwards there is no \`${local}\`.`,
          };
        }
        return {
          code: `def ${f}():\n    ${local} = "${v}"\n    print(${local})\n${f}()\n`,
          probeName: local,
          probeGone: true,
          shape, variant: "plain",
          misconception: v,
          variantCard: `\`${local}\` was made INSIDE \`${f}\`, so it lived only for that `
            + `call. It printed \`${v}\` while the call was running; once the call ended `
            + `the name was gone.`,
        };
      },
    },
  },

  {
    // The other half of the same idea, graded on OUTPUT: a local is perfectly
    // usable inside — the question is WHICH name the body prints. Two names
    // are bound in the frame and only one is printed, so the answer cannot be
    // transcribed off a single line (E5); the other value is the designed
    // wrong answer (E6).
    id: "local-vs-printed",
    topic: "functions",
    focus: "002D", // local-scope-inside
    assumed: ["0005", "0006", "0027", "0028", "0029"],
    role: "review",
    form: "predict-exact-output",
    generator: {
      shapes: ["print-second-local", "print-first-local", "print-param-not-local"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["print-second-local", "print-first-local", "print-param-not-local"]);
        const f = pick(rng, fnNames);
        const [n1, n2] = twoOf(rng, strNames);
        const [v1, v2] = twoOf(rng, words);
        if (shape === "print-param-not-local") {
          return {
            code: `def ${f}(${n1}):\n    ${n2} = "${v2}"\n    print(${n1})\n${f}("${v1}")\n`,
            shape, variant: "plain",
            misconception: v2, // the local mistaken for the printed name
            variantCard: `Inside the call there are two names: \`${n1}\` (the argument, `
              + `\`${v1}\`) and the local \`${n2}\` (\`${v2}\`). The body prints \`${n1}\`, `
              + `so the output is \`${v1}\`.`,
          };
        }
        if (shape === "print-first-local") {
          return {
            code: `def ${f}():\n    ${n1} = "${v1}"\n    ${n2} = "${v2}"\n    print(${n1})\n${f}()\n`,
            shape, variant: "plain",
            misconception: v2,
            variantCard: `Both locals exist during the call, but the body prints \`${n1}\`, `
              + `which holds \`${v1}\`. \`${n2}\` is a separate local — and both vanish when `
              + `the call ends.`,
          };
        }
        return {
          code: `def ${f}():\n    ${n1} = "${v1}"\n    ${n2} = "${v2}"\n    print(${n2})\n${f}()\n`,
          shape, variant: "plain",
          misconception: v1,
          variantCard: `The body makes two locals and prints \`${n2}\`, so the output is `
            + `\`${v2}\` — \`${n1}\` is a different name holding \`${v1}\`.`,
        };
      },
    },
  },

  // --- wave 4: 002E locals-shadow-globals -------------------------------
  {
    // Edge, discover-first: the surprise IS the lesson. MULTILINE is the
    // whole point — the inside value and the outside value must BOTH appear,
    // in that order, for "the outer one was untouched" to be visible.
    id: "shadow-untouched",
    topic: "functions",
    focus: "002E", // locals-shadow-globals
    assumed: ["0005", "0006", "0027", "0028", "002D"],
    role: "intro",
    form: "predict-exact-output",
    multiline: true,
    generator: {
      shapes: ["shadow-then-outer", "shadow-two-calls"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["shadow-then-outer", "shadow-two-calls"]);
        const f = pick(rng, fnNames);
        const nm = pick(rng, valNames);
        const [outer, inner] = twoOf(rng, words);
        const head = `${nm} = "${outer}"\ndef ${f}():\n    ${nm} = "${inner}"\n    print(${nm})\n`;
        if (shape === "shadow-two-calls") {
          return {
            code: `${head}${f}()\n${f}()\nprint(${nm})\n`,
            shape, variant: "plain",
            misconception: `${inner}\n${inner}\n${inner}`, // the outer name overwritten
            variantCard: `Each call makes its own \`${nm}\` holding \`${inner}\` and prints `
              + `it, then drops it. The outer \`${nm}\` never changed — twice \`${inner}\`, `
              + `then \`${outer}\`.`,
          };
        }
        return {
          code: `${head}${f}()\nprint(${nm})\n`,
          shape, variant: "plain",
          misconception: `${inner}\n${inner}`, // the assignment "reached out"
          variantCard: `The \`${nm}\` inside \`${f}\` is a SEPARATE name: it holds `
            + `\`${inner}\` and prints it. The outer \`${nm}\` still holds \`${outer}\`, `
            + `so the last line prints \`${outer}\`.`,
        };
      },
    },
  },

  {
    // The same trap probed as latent state: after the call, what does the
    // MODULE name hold? An ordinary bound probe — the outer name is alive.
    id: "shadow-state",
    topic: "functions",
    focus: "002E", // locals-shadow-globals
    assumed: ["0005", "0006", "0027", "0028", "002D"],
    role: "review",
    form: "predict-state",
    generator: {
      shapes: ["probe-outer-after-shadow", "probe-outer-after-two-calls"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["probe-outer-after-shadow", "probe-outer-after-two-calls"]);
        const f = pick(rng, fnNames);
        const nm = pick(rng, valNames);
        const [outer, inner] = twoOf(rng, words);
        const head = `${nm} = "${outer}"\ndef ${f}():\n    ${nm} = "${inner}"\n    print(${nm})\n`;
        const calls = shape === "probe-outer-after-two-calls" ? `${f}()\n${f}()\n` : `${f}()\n`;
        return {
          code: `${head}${calls}`,
          probeName: nm,
          shape, variant: "plain",
          misconception: inner, // the inner assignment mistaken for a rebind
          variantCard: `\`${f}\` bound its OWN \`${nm}\` to \`${inner}\` — that binding `
            + `vanished with the call. The outer \`${nm}\` was never touched, so it still `
            + `holds \`${outer}\`.`,
        };
      },
    },
  },

  // --- wave 5: 002J mutable-arg-shared ----------------------------------
  {
    // Edge, discover-first. The parameter and the caller's name are two names
    // for ONE list, so a mutation inside is visible outside.
    id: "same-list-inside",
    topic: "functions",
    focus: "002J", // mutable-arg-shared
    assumed: ["0005", "0006", "000D", "000G", "000H", "0027", "0028", "0029"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["append-then-print", "append-twice", "longer-list"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["append-then-print", "append-twice", "longer-list"]);
        const f = pick(rng, fnNames);
        const [param, nm] = twoOf(rng, listNames);
        const a = int(rng, 1, 5), b = int(rng, 6, 9), v = int(rng, 10, 20);
        const def = `def ${f}(${param}):\n    ${param}.append(${v})\n`;
        if (shape === "append-twice") {
          return {
            code: `${def}${nm} = [${a}, ${b}]\n${f}(${nm})\n${f}(${nm})\nprint(${nm})\n`,
            shape, variant: "plain",
            misconception: `[${a}, ${b}]`, // the caller's list assumed untouched
            variantCard: `Both calls append to the SAME list — \`${param}\` is never a copy. `
              + `\`${nm}\` ends as [${a}, ${b}, ${v}, ${v}].`,
          };
        }
        if (shape === "longer-list") {
          const c = int(rng, 1, 9);
          return {
            code: `${def}${nm} = [${a}, ${b}, ${c}]\n${f}(${nm})\nprint(${nm})\n`,
            shape, variant: "plain",
            misconception: `[${a}, ${b}, ${c}]`,
            variantCard: `\`${f}(${nm})\` hands over the list itself, so the \`.append\` `
              + `inside changes \`${nm}\`: [${a}, ${b}, ${c}, ${v}].`,
          };
        }
        return {
          code: `${def}${nm} = [${a}, ${b}]\n${f}(${nm})\nprint(${nm})\n`,
          shape, variant: "plain",
          misconception: `[${a}, ${b}]`,
          variantCard: `\`${param}\` and \`${nm}\` are two names for ONE list, so appending `
            + `${v} inside shows outside: [${a}, ${b}, ${v}].`,
        };
      },
    },
  },

  {
    // One line changed inside the body: MUTATE the list the caller handed
    // over, or REBUILD a new one and point the parameter at it. Only the
    // first is visible outside — and B's fresh list is built to hold exactly
    // A's result, so the difference cannot be read off the values.
    // NOTE: B rebuilds with a LITERAL rather than `${param} + [${v}]` —
    // ancestors(002J) does not contain 0021 (list-concat-new), so a
    // concatenation would leave this exercise's closure (E1).
    id: "append-or-rebuild",
    topic: "functions",
    focus: "002J", // mutable-arg-shared
    assumed: ["0005", "0006", "000A", "000D", "000G", "000H", "0027", "0028", "0029"],
    contrast: "000H", // names-share-list — the parent, already assumed
    misconceptionOf: "000H", // answering A's output = "any change inside shows outside"
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["append-vs-rebuild"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const f = pick(rng, fnNames);
        const [param, nm] = twoOf(rng, listNames);
        const a = int(rng, 1, 5), b = int(rng, 6, 9), v = int(rng, 10, 20);
        const tail = `${nm} = [${a}, ${b}]\n${f}(${nm})\nprint(${nm})\n`;
        return {
          // A (shown with its output): the body MUTATES the shared list.
          code: `def ${f}(${param}):\n    ${param}.append(${v})\n${tail}`,
          aOutput: `[${a}, ${b}, ${v}]`,
          // B (predicted): the body points the PARAMETER at a brand-new list.
          contrastCode: `def ${f}(${param}):\n    ${param} = [${a}, ${b}, ${v}]\n${tail}`,
          shape: "append-vs-rebuild", variant: "plain",
          variantCard: `Only line 2 changed. \`.append\` changes the list \`${nm}\` names, `
            + `so A prints [${a}, ${b}, ${v}]. In B the assignment only re-points `
            + `\`${param}\` at a NEW list — \`${nm}\` still names the old one, so B prints `
            + `[${a}, ${b}].`,
        };
      },
    },
  },
];
