// Conditions & logic intro exercises (design §3.6). Branch intros are kept
// to one printed line: a taken branch prints and stops, or a skipped branch
// leaves an after-line, so output never spans two lines.

import { mulberry32, int, pick } from "../rng.mjs";
import { words } from "../pools.mjs";

export default [
  {
    id: "bool-prints",
    topic: "logic",
    focus: "0016", // bool-values
    assumed: ["0005"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["true", "false"],
      variants: ["true", "false"],
      generate(seed) {
        const rng = mulberry32(seed);
        const v = pick(rng, ["true", "false"]);
        return { code: `print(${v === "true" ? "True" : "False"})\n`, shape: v, variant: v };
      },
    },
  },

  {
    id: "compare-values",
    topic: "logic",
    focus: "0015", // compare-ops
    assumed: ["0005", "0008", "0016"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["less", "greater", "equal"],
      variants: ["less", "greater", "equal"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["less", "greater", "equal"]);
        const a = int(rng, 2, 9), b = int(rng, 2, 9);
        const op = shape === "less" ? "<" : shape === "greater" ? ">" : "==";
        const truth = op === "<" ? a < b : op === ">" ? a > b : a === b;
        return {
          code: `print(${a} ${op} ${b})\n`,
          shape, variant: shape,
          variantCard: `\`${a} ${op} ${b}\` is \`${truth ? "True" : "False"}\`.`,
        };
      },
    },
  },

  {
    id: "bool-and-or-not",
    topic: "logic",
    focus: "001A", // bool-ops
    assumed: ["0005", "0016"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["and", "or", "not"],
      variants: ["and", "or", "not"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["and", "or", "not"]);
        const x = pick(rng, ["True", "False"]);
        if (shape === "not") return { code: `print(not ${x})\n`, shape, variant: "not" };
        const y = pick(rng, ["True", "False"]);
        return { code: `print(${x} ${shape} ${y})\n`, shape, variant: shape };
      },
    },
  },

  {
    id: "if-runs",
    topic: "logic",
    focus: "0017", // if-runs-or-skips
    assumed: ["0005", "0008", "0015", "0016"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      // Bool-literal tests isolate the if-mechanics; the compare-test shape
      // is legal because compare-ops is 0017's parent in the corrected DAG.
      shapes: ["runs", "skips", "compare-test"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["runs", "skips", "compare-test"]);
        const w = pick(rng, words), after = pick(rng, words);
        if (shape === "runs") return { code: `if True:\n    print("${w}")\n`, shape, variant: "plain" };
        if (shape === "compare-test") {
          const a = int(rng, 2, 9), b = int(rng, 2, 9);
          const runs = a > b;
          return {
            code: `if ${a} > ${b}:\n    print("${w}")\nprint("${after}")\n`,
            shape, variant: "plain",
            // Two lines when the branch runs — keep it one-line: only emit
            // the after-print when the branch is skipped.
            ...(runs ? { code: `if ${a} > ${b}:\n    print("${w}")\n` } : {}),
            variantCard: `\`${a} > ${b}\` is ${runs ? "True, so the block runs" : "False, so the block is skipped"}.`,
          };
        }
        return { code: `if False:\n    print("${w}")\nprint("${after}")\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "if-else-one-branch",
    topic: "logic",
    focus: "0018", // else-otherwise
    assumed: ["0005", "0008", "0015", "0016", "0017"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["then", "else-branch", "compare-else"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["then", "else-branch", "compare-else"]);
        const w1 = pick(rng, words), w2 = pick(rng, words);
        if (shape === "compare-else") {
          const a = int(rng, 2, 9), b = int(rng, 2, 9);
          return {
            code: `if ${a} > ${b}:\n    print("${w1}")\nelse:\n    print("${w2}")\n`,
            shape, variant: "plain",
            variantCard: `\`${a} > ${b}\` is ${a > b ? `True, so the \`if\` branch prints \`${w1}\`` : `False, so the \`else\` branch prints \`${w2}\``} — one branch, never both.`,
          };
        }
        const test = shape === "then" ? "True" : "False";
        return {
          code: `if ${test}:\n    print("${w1}")\nelse:\n    print("${w2}")\n`,
          shape, variant: "plain",
          variantCard: `The test is \`${test}\`, so ${shape === "then" ? `the \`if\` block runs: \`${w1}\`` : `the \`else\` block runs: \`${w2}\``} — never both.`,
        };
      },
    },
  },

  {
    id: "elif-chain",
    topic: "logic",
    focus: "0019", // elif-first-true-wins
    assumed: ["0005", "0016", "0017", "0018"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["if-wins", "elif-wins", "else-wins"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["if-wins", "elif-wins", "else-wins"]);
        // Draw three DISTINCT branch words: identical words would leak the
        // answer (any branch printing the same word grades correct regardless
        // of which branch wins). Same 3 rng draws as before, now collision-free.
        const pool = words.slice();
        const w1 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w2 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w3 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const t1 = shape === "if-wins" ? "True" : "False";
        const t2 = shape === "elif-wins" ? "True" : "False";
        return {
          code: `if ${t1}:\n    print("${w1}")\nelif ${t2}:\n    print("${w2}")\nelse:\n    print("${w3}")\n`,
          shape, variant: "plain",
          variantCard: `The first true test wins: ${shape === "if-wins" ? `\`${w1}\`` : shape === "elif-wins" ? `\`${w2}\`` : `neither is true, so \`${w3}\``}.`,
        };
      },
    },
  },

  {
    id: "empty-is-falsy",
    topic: "logic",
    focus: "001B", // truthiness-empty-falsy
    assumed: ["0005", "0006", "000D", "0017"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["empty-list", "zero", "empty-string"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["empty-list", "zero", "empty-string"]);
        // Distinct words so the skipped-branch word can never equal the
        // after-line word (a collision would leak the answer). Same 2 draws.
        const pool = words.slice();
        const w = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const after = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const val = shape === "empty-list" ? "[]" : shape === "zero" ? "0" : '""';
        return {
          code: `x = ${val}\nif x:\n    print("${w}")\nprint("${after}")\n`,
          shape, variant: "plain",
          variantCard: `\`${val}\` counts as false, so the block is skipped. Only \`${after}\` prints.`,
        };
      },
    },
  },

  {
    id: "and-or-value",
    topic: "logic",
    focus: "001C", // and-or-return-operand
    assumed: ["0005", "001A", "001B"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["or-first-true", "or-first-false", "and-both-true"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["or-first-true", "or-first-false", "and-both-true"]);
        const a = int(rng, 2, 9), b = int(rng, 2, 9);
        if (shape === "or-first-true") return { code: `print(${a} or 0)\n`, shape, variant: "plain", variantCard: `\`${a}\` counts as true, so \`or\` hands back \`${a}\`.` };
        if (shape === "or-first-false") return { code: `print(0 or ${b})\n`, shape, variant: "plain", variantCard: `\`0\` counts as false, so \`or\` hands back the second value, \`${b}\`.` };
        return { code: `print(${a} and ${b})\n`, shape, variant: "plain", variantCard: `\`${a}\` counts as true, so \`and\` moves on and hands back \`${b}\`.` };
      },
    },
  },

  {
    id: "chain-compare",
    topic: "logic",
    focus: "001D", // chained-compare
    assumed: ["0005", "0015", "0016", "001A"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["ascending", "middle-breaks"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["ascending", "middle-breaks"]);
        const a = int(rng, 1, 3);
        const b = a + int(rng, 1, 3);
        const c = shape === "ascending" ? b + int(rng, 1, 3) : a - 1; // middle-breaks: b<c fails
        return {
          code: `print(${a} < ${b} < ${c})\n`,
          shape, variant: "plain",
          variantCard: `\`${a} < ${b} < ${c}\` means \`${a} < ${b} and ${b} < ${c}\` — ${shape === "ascending" ? "both true, so `True`" : "the second link fails, so `False`"}.`,
        };
      },
    },
  },

  {
    // The branch decides which rebind runs (002K): the deferred
    // branch-rebind exercise — legal now that the focus concept's parents
    // are else-otherwise AND accumulate-rebind.
    id: "branch-rebind",
    topic: "logic",
    focus: "002K", // branch-picks-binding
    assumed: ["0005", "0006", "0008", "0009", "000A", "000B", "0015", "0016", "0017", "0018"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["if-taken", "if-skipped", "if-else"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["if-taken", "if-skipped", "if-else"]);
        const t = int(rng, 4, 7);
        const d = int(rng, 1, 3);
        if (shape === "if-else") {
          const start = pick(rng, [t - 2, t + 2]);
          const result = start > t ? start - d : start + d;
          return {
            code: `n = ${start}\nif n > ${t}:\n    n = n - ${d}\nelse:\n    n = n + ${d}\nprint(n)\n`,
            shape, variant: "plain",
            variantCard: `\`${start} > ${t}\` is ${start > t ? "True, so the if branch" : "False, so the else branch"} rebinds \`n\` — it ends holding ${result}.`,
          };
        }
        const taken = shape === "if-taken";
        const start = taken ? t + 2 : t - 2;
        return {
          code: `n = ${start}\nif n > ${t}:\n    n = n - ${d}\nprint(n)\n`,
          shape, variant: "plain",
          variantCard: taken
            ? `\`${start} > ${t}\` is True, so the rebind runs: \`n\` ends at ${start - d}.`
            : `\`${start} > ${t}\` is False, so the rebind is SKIPPED — \`n\` still holds ${start}.`,
        };
      },
    },
  },

  {
    // Trace walkthrough (design §5.2 trace-table): which branch rebound
    // `n`? The if-else shape always rebinds exactly once, so both watched
    // steps are real.
    id: "trace-branch",
    topic: "logic",
    focus: "002K", // branch-picks-binding
    assumed: ["0005", "0006", "0008", "0009", "000A", "000B", "0015", "0016", "0017", "0018"],
    role: "review",
    form: "trace-table",
    generator: {
      shapes: ["else-taken", "if-taken"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["else-taken", "if-taken"]);
        const t = int(rng, 4, 7);
        const d = int(rng, 1, 3);
        const start = shape === "if-taken" ? t + 2 : t - 2;
        return {
          code: `n = ${start}\nif n > ${t}:\n    n = n - ${d}\nelse:\n    n = n + ${d}\nprint(n)\n`,
          probeNames: ["n"],
          shape, variant: "plain",
          variantCard: "Only ONE of the two rebind lines ever runs — the table has exactly one branch row, and which line number it is tells you which branch won.",
        };
      },
    },
  },
];
