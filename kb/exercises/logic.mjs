// Conditions & logic intro exercises (design §3.6). Branch intros are kept
// to one printed line: a taken branch prints and stops, or a skipped branch
// leaves an after-line, so output never spans two lines.

import { mulberry32, int, pick } from "../rng.mjs";
import { words, listNames } from "../pools.mjs";

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
    id: "bool-prints",
    topic: "logic",
    focus: "0016", // bool-values
    assumed: ["0005"],
    role: "intro",
    form: "predict-exact-output",
    // Multiline: the `both` shape prints True then False so BOTH spellings-as-
    // written are the concept. (Third shape restores the ≥3 core-shape floor
    // after the transcription-only `fill-bool` was retired — a pure bool print
    // can only be `print(True)` / `print(False)`, so the floor must come from
    // the intro itself.)
    multiline: true,
    generator: {
      shapes: ["true", "false", "both"],
      variants: ["true", "false", "both"],
      generate(seed) {
        const rng = mulberry32(seed);
        const v = pick(rng, ["true", "false", "both"]);
        if (v === "both") {
          return {
            code: `print(True)\nprint(False)\n`,
            shape: "both", variant: "both",
            misconception: "true\nfalse", // "lowercase spelling — bools print like other languages'"
            variantCard: "Each yes-or-no value prints exactly as spelled: `True`, then `False` — capital first letter, no quotes.",
          };
        }
        const spelled = v === "true" ? "True" : "False";
        return {
          code: `print(${spelled})\n`, shape: v, variant: v,
          misconception: v, // "lowercase spelling — bools print like other languages'"
          variantCard: `\`print(${spelled})\` shows the yes-or-no value spelled exactly: \`${spelled}\` — capital first letter, no quotes.`,
        };
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
        const a = int(rng, 2, 9);
        let b = int(rng, 2, 9);
        // E7: never reproduce compare-ops' own card example `3 < 5`.
        while (shape === "less" && a === 3 && b === 5) b = int(rng, 2, 9);
        // E6: the equal shape lands `b === a` on a coin flip, so ~half the
        // seeds are genuinely True — not a constant-False meta.
        if (shape === "equal" && pick(rng, [true, false])) b = a;
        const op = shape === "less" ? "<" : shape === "greater" ? ">" : "==";
        const truth = op === "<" ? a < b : op === ">" ? a > b : a === b;
        return {
          code: `print(${a} ${op} ${b})\n`,
          shape, variant: shape,
          // The comparison read backwards (b op a) flips the verdict exactly
          // when a ≠ b; omitted for == and for a == b, where the backwards
          // reading lands on the truth (G1).
          ...(shape !== "equal" && a !== b ? { misconception: truth ? "False" : "True" } : {}),
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
        if (shape === "not") {
          return {
            code: `print(not ${x})\n`, shape, variant: "not",
            misconception: x, // "not read as leaving the value alone"
            variantCard: `\`not\` flips the value: \`not ${x}\` is \`${x === "True" ? "False" : "True"}\`.`,
          };
        }
        const y = pick(rng, ["True", "False"]);
        const result = shape === "and"
          ? ((x === "True" && y === "True") ? "True" : "False")
          : ((x === "True" || y === "True") ? "True" : "False");
        return {
          code: `print(${x} ${shape} ${y})\n`, shape, variant: shape,
          // and/or swapped (mixed sides) or `or` read as exclusive (True/True):
          // each named wrong flips the verdict exactly where it differs at
          // all; omitted where the wrong reading lands on the truth (and with
          // x == y; or with both sides False) (G1).
          ...((shape === "and" ? x !== y : result === "True") ? { misconception: result === "True" ? "False" : "True" } : {}),
          variantCard: `\`${x} ${shape} ${y}\` is \`${result}\` — \`${shape}\` needs ${shape === "and" ? "both sides" : "just one side"} to be \`True\`.`,
        };
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
      // The *-before shapes put the unconditional print BEFORE a skipped `if`,
      // so the LAST quoted literal is never the answer (defeats a last-literal
      // guess).
      shapes: ["runs", "skips", "compare-test", "skips-before", "compare-skips-before"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["runs", "skips", "compare-test", "skips-before", "compare-skips-before"]);
        // Two DISTINCT words (splice-draw, like elif-chain) so the skipped
        // branch's word can never equal the unconditional word.
        const pool = words.slice();
        const w = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const after = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        if (shape === "runs") {
          // No misconception here (nor on compare-test's runs branch): the
          // inverted-decision wrong ("the block is skipped") is the EMPTY
          // transcript, which K-mc bars.
          return {
            code: `if True:\n    print("${w}")\n`, shape, variant: "plain",
            variantCard: `The test is \`True\`, so the block runs and prints \`${w}\`.`,
          };
        }
        if (shape === "skips") {
          return {
            code: `if False:\n    print("${w}")\nprint("${after}")\n`, shape, variant: "plain", misconception: w,
            variantCard: `The test is \`False\`, so the indented block is skipped — \`${w}\` never prints. Only \`${after}\` shows.`,
          };
        }
        if (shape === "compare-test") {
          const a = int(rng, 2, 9), b = int(rng, 2, 9);
          const runs = a > b;
          return {
            // Two lines when the branch runs — keep it one-line: only emit
            // the after-print when the branch is skipped.
            code: runs ? `if ${a} > ${b}:\n    print("${w}")\n` : `if ${a} > ${b}:\n    print("${w}")\nprint("${after}")\n`,
            shape, variant: "plain",
            ...(runs ? {} : { misconception: w }), // read the skipped branch anyway
            variantCard: `\`${a} > ${b}\` is ${runs ? "True, so the block runs" : "False, so the block is skipped"}.`,
          };
        }
        if (shape === "skips-before") {
          return {
            code: `print("${after}")\nif False:\n    print("${w}")\n`,
            shape, variant: "plain",
            misconception: w,
            variantCard: `\`${after}\` prints first; the \`if False\` block is skipped, so \`${w}\` never prints.`,
          };
        }
        // compare-skips-before: plain print first, then an always-False compare
        // test (a < b), so the last literal \`${w}\` is again not the answer.
        const a = int(rng, 2, 5), b = a + int(rng, 1, 4);
        return {
          code: `print("${after}")\nif ${a} > ${b}:\n    print("${w}")\n`,
          shape, variant: "plain",
          misconception: w,
          variantCard: `\`${after}\` prints first; \`${a} > ${b}\` is False, so \`${w}\` is skipped.`,
        };
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
            // The skipped branch's word (omitted when the two independent
            // word draws collide — a shared word designs nothing).
            ...(w1 === w2 ? {} : { misconception: a > b ? w2 : w1 }),
            variantCard: `\`${a} > ${b}\` is ${a > b ? `True, so the \`if\` branch prints \`${w1}\`` : `False, so the \`else\` branch prints \`${w2}\``} — one branch, never both.`,
          };
        }
        const test = shape === "then" ? "True" : "False";
        return {
          code: `if ${test}:\n    print("${w1}")\nelse:\n    print("${w2}")\n`,
          shape, variant: "plain",
          ...(w1 === w2 ? {} : { misconception: shape === "then" ? w2 : w1 }),
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
          // The nearest skipped branch's word (distinct by the splice draws).
          misconception: shape === "if-wins" ? w2 : shape === "elif-wins" ? w1 : w1,
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
      shapes: ["empty-list", "zero", "empty-string", "truthy-list", "truthy-int", "truthy-string", "falsy-before"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["empty-list", "zero", "empty-string", "truthy-list", "truthy-int", "truthy-string", "falsy-before"]);
        // Distinct words so the branch word can never equal the after-line
        // word (a collision would leak the answer).
        const pool = words.slice();
        const w = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const after = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        // Truthy shapes: the block RUNS and there is no after-line (one-line
        // law), so the answer is the branch word. They carry no misconception:
        // "non-empty treated as false" prints NOTHING, and K-mc bars empty.
        if (shape === "truthy-list") {
          const n = int(rng, 1, 9);
          return {
            code: `x = [${n}]\nif x:\n    print("${w}")\n`,
            shape, variant: "plain",
            variantCard: `\`[${n}]\` has an item, so it counts as true and the block runs.`,
          };
        }
        if (shape === "truthy-int") {
          const n = int(rng, 1, 9);
          return {
            code: `x = ${n}\nif x:\n    print("${w}")\n`,
            shape, variant: "plain",
            variantCard: `\`${n}\` is not zero, so it counts as true and the block runs.`,
          };
        }
        if (shape === "truthy-string") {
          const s = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
          return {
            code: `x = "${s}"\nif x:\n    print("${w}")\n`,
            shape, variant: "plain",
            variantCard: `\`"${s}"\` is not empty, so it counts as true and the block runs.`,
          };
        }
        if (shape === "falsy-before") {
          // Unconditional print BEFORE a falsy `if`, so the answer is the
          // first line, not the skipped branch word.
          return {
            code: `print("${after}")\nx = []\nif x:\n    print("${w}")\n`,
            shape, variant: "plain",
            misconception: w, // "[] is a value, so the block runs"
            variantCard: `\`${after}\` prints first; \`[]\` counts as false, so the block is skipped and \`${w}\` never prints.`,
          };
        }
        const val = shape === "empty-list" ? "[]" : shape === "zero" ? "0" : '""';
        return {
          code: `x = ${val}\nif x:\n    print("${w}")\nprint("${after}")\n`,
          shape, variant: "plain",
          misconception: w, // "the branch runs" (it is skipped — x is falsy)
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
        // The named wrong on every shape: "and/or boil down to True/False" —
        // the truth is always a bare number, never `True` (G1).
        if (shape === "or-first-true") return { code: `print(${a} or 0)\n`, shape, variant: "plain", misconception: "True", variantCard: `\`${a}\` counts as true, so \`or\` hands back \`${a}\`.` };
        if (shape === "or-first-false") return { code: `print(0 or ${b})\n`, shape, variant: "plain", misconception: "True", variantCard: `\`0\` counts as false, so \`or\` hands back the second value, \`${b}\`.` };
        return { code: `print(${a} and ${b})\n`, shape, variant: "plain", misconception: "True", variantCard: `\`${a}\` counts as true, so \`and\` moves on and hands back \`${b}\`.` };
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
          // Grouped left-to-right: (a < b) is True, i.e. 1, then 1 < c. That
          // flips the verdict only on middle-breaks seeds with c > 1; on every
          // other seed the grouped reading lands on the truth, so no
          // misconception is emitted there (G1).
          ...(shape === "middle-breaks" && c > 1 ? { misconception: "True" } : {}),
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
            misconception: String(start > t ? start + d : start - d), // the skipped branch's rebind
            variantCard: `\`${start} > ${t}\` is ${start > t ? "True, so the if branch" : "False, so the else branch"} rebinds \`n\` — it ends holding ${result}.`,
          };
        }
        const taken = shape === "if-taken";
        const start = taken ? t + 2 : t - 2;
        return {
          code: `n = ${start}\nif n > ${t}:\n    n = n - ${d}\nprint(n)\n`,
          shape, variant: "plain",
          misconception: String(taken ? start : start - d), // got the branch decision backwards
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
        // Two computed blanks: the test's value (True/False decides
        // everything) and the one rebind the winning branch runs. The
        // literal first bind renders as a given, not a blank.
        return {
          code: `n = ${start}\nbig = n > ${t}\nif big:\n    n = n - ${d}\nelse:\n    n = n + ${d}\nprint(n)\n`,
          probeNames: ["big", "n"],
          shape, variant: "plain",
          variantCard: "First work out `big` — that True/False picks the branch, and only the branch that runs gets to rebind `n`. The row's line number tells you which one won.",
        };
      },
    },
  },

  {
    // Ramp (review): one line moved across the branch boundary. In A the extra
    // print sits INSIDE a skipped `if`, so it never runs; move it out (B) and
    // it becomes unconditional. Multiline: B prints one more line than A.
    id: "branch-boundary-order",
    topic: "logic",
    focus: "0017", // if-runs-or-skips
    assumed: ["0005", "0015"],
    role: "review",
    form: "spot-the-difference",
    multiline: true,
    generator: {
      shapes: ["move-out-of-skip"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const pool = words.slice();
        const w0 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w1 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w2 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const a = int(rng, 2, 5), b = a + int(rng, 1, 4); // a < b, so the if is skipped
        return {
          // A: both branch prints are INSIDE the skipped if; only the after
          // line runs.
          code: `if ${a} > ${b}:\n    print("${w1}")\n    print("${w2}")\nprint("${w0}")\n`,
          aOutput: w0,
          // B: print("${w2}") moved OUT of the if — now it always runs.
          contrastCode: `if ${a} > ${b}:\n    print("${w1}")\nprint("${w2}")\nprint("${w0}")\n`,
          shape: "move-out-of-skip", variant: "plain",
          misconception: w0, // "moving the print changes nothing" — B read as A (spot-diff law: = aOutput)
          variantCard: `\`${a} > ${b}\` is False, so everything indented under the \`if\` is skipped — `
            + `A prints just \`${w0}\`. Move \`print("${w2}")\` out from under the \`if\` and it runs no `
            + `matter what: B prints \`${w2}\` then \`${w0}\`.`,
        };
      },
    },
  },

  {
    // Review (fill-one-blank): pick the comparison that makes it print True.
    // G1 regime: the operands are STRICTLY ordered (hi = lo + d, d ≥ 1), so
    // the flipped operator always prints False ≠ the target. Misconception
    // formula (G2, rng-free): the flipped operator token (">" for the less
    // shape, "<" for greater). Execution grades the fill, so `<=` or `!=`
    // where they also print True are legitimately correct — the form's law.
    id: "fill-compare-op",
    topic: "logic",
    focus: "0015", // compare-ops
    assumed: ["0005", "0016"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["less", "greater"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["less", "greater"]);
        const lo = int(rng, 2, 6);
        const hi = lo + int(rng, 1, 3); // G1: strictly ordered, never equal
        const [a, b, op, flip] = shape === "less" ? [lo, hi, "<", ">"] : [hi, lo, ">", "<"];
        const { code, blank } = blankFrom(`print(${a} \x00 ${b})\n`, op);
        return {
          code, blank, targetOutput: "True",
          shape, variant: "plain",
          misconception: flip, // the comparison flipped — prints False, never True
          variantCard: `\`${a} ${op} ${b}\` is \`True\` — ${a} really is `
            + `${op === "<" ? "smaller" : "bigger"} than ${b}. Flipped, \`${a} ${flip} ${b}\` `
            + `would print \`False\`.`,
        };
      },
    },
  },

  {
    // Review (predict-exact-output): else with a COMPUTED condition, one line
    // out. The brief's `x = A` binding is a closure wall (name-holds-value
    // 0006 is NOT an ancestor of else-otherwise 0018), so the condition
    // computes with arithmetic instead (0008 IS an ancestor). G1 regime per
    // shape: sum-greater makes a+c = b+d > b (if branch); sum-smaller makes
    // a+c = b-d < b (else); sum-equal makes a+c = b, and `>` is strict, so
    // the else runs — "equal is not greater" is the discriminating case.
    // Misconception formula (G2, rng-free): the OTHER branch's word, distinct
    // by the splice draws.
    id: "else-review",
    topic: "logic",
    focus: "0018", // else-otherwise
    assumed: ["0005", "0008", "0015", "0016", "0017"],
    role: "review",
    form: "predict-exact-output",
    generator: {
      shapes: ["sum-greater", "sum-smaller", "sum-equal"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["sum-greater", "sum-smaller", "sum-equal"]);
        // Two DISTINCT branch words by splice-draw (G3).
        const pool = words.slice();
        const w1 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w2 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        // Fixed draw order (G7): c, d, m always consumed; d is unused by
        // sum-equal but still drawn.
        const c = int(rng, 1, 3);
        const d = int(rng, 1, 3);
        const m = int(rng, 1, 4);
        const [a, b] = shape === "sum-greater" ? [m + d, c + m]
          : shape === "sum-smaller" ? [m, c + d + m]
          : [m, c + m];
        const taken = a + c > b;
        return {
          code: `if ${a} + ${c} > ${b}:\n    print("${w1}")\nelse:\n    print("${w2}")\n`,
          shape, variant: "plain",
          misconception: taken ? w2 : w1, // the branch that did NOT run
          variantCard: `\`${a} + ${c}\` is ${a + c}, and \`${a + c} > ${b}\` is `
            + `${taken ? `True, so the \`if\` branch prints \`${w1}\`` : `False${a + c === b ? " — equal is not greater" : ""}, so the \`else\` branch prints \`${w2}\``} `
            + `— one branch, never both.`,
        };
      },
    },
  },

  {
    // Review (spot-the-difference): ONE line changed — the list gains an
    // item. In A `xs = []` is falsy, the block is skipped, only the after
    // line prints; in B `xs = [k]` is truthy, so the branch word prints too.
    // Multiline: B prints two lines. G1 regime: the branch word is distinct
    // from the after word (splice draws), so A ≠ B on every seed. The
    // misconception is A's shown output (spot-diff law): "a list is a value
    // either way, so nothing changes".
    id: "empty-vs-full-spot",
    topic: "logic",
    focus: "001B", // truthiness-empty-falsy
    assumed: ["0005", "0006", "000D", "0017"],
    role: "review",
    form: "spot-the-difference",
    multiline: true,
    generator: {
      shapes: ["empty-to-full"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        // Two DISTINCT words by splice-draw (G3): branch word ≠ after word.
        const pool = words.slice();
        const w1 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w2 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const nm = pick(rng, listNames);
        const k = int(rng, 1, 9);
        return {
          code: `${nm} = []\nif ${nm}:\n    print("${w1}")\nprint("${w2}")\n`,
          aOutput: w2,
          contrastCode: `${nm} = [${k}]\nif ${nm}:\n    print("${w1}")\nprint("${w2}")\n`,
          shape: "empty-to-full", variant: "plain",
          misconception: w2, // "one item changes nothing" — B read as A (= aOutput)
          variantCard: `\`[]\` counts as false, so A skips the block: just \`${w2}\`. Give the list `
            + `an item and \`[${k}]\` counts as true — B prints \`${w1}\` and then \`${w2}\`.`,
        };
      },
    },
  },

  {
    // Review (spot-the-difference, contrast: bool-ops): the SAME comparison
    // chained vs grouped. G1 regime: a ≥ b, so the chain's first link fails
    // and A prints False; grouped, `(a < b)` is False — which compares as 0 —
    // and c ≥ 2 > 0, so B prints True. A ≠ B on every seed by construction.
    // The misconception is A's shown output (spot-diff law): "the
    // parentheses change nothing".
    id: "chain-vs-grouped-spot",
    topic: "logic",
    focus: "001D", // chained-compare
    assumed: ["0005", "0015", "0016", "001A"],
    contrast: "001A", // bool-ops — chaining means `and`; grouping breaks it. In assumed.
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["grouped-vs-chained"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const b = int(rng, 2, 5);
        const a = b + int(rng, 0, 3); // G1: a ≥ b — the first link fails
        const c = int(rng, 2, 5);     // G1: c ≥ 2 > 0, so `False < c` is True
        return {
          code: `print(${a} < ${b} < ${c})\n`,
          aOutput: "False",
          contrastCode: `print((${a} < ${b}) < ${c})\n`,
          shape: "grouped-vs-chained", variant: "plain",
          misconception: "False", // "the parentheses change nothing" (= aOutput)
          variantCard: `Chained, \`${a} < ${b} < ${c}\` means \`${a} < ${b} and ${b} < ${c}\` — the `
            + `first link fails, so A prints \`False\`. Grouped, \`(${a} < ${b})\` is \`False\`, and `
            + `comparing THAT to ${c} treats it as 0: \`0 < ${c}\` is \`True\`.`,
        };
      },
    },
  },

  {
    // Hard sibling (R1.3, review + difficulty "hard"): a 3-test ladder over
    // ONE computed value with BOUNDARY tests — on most seeds more than one
    // test is true and only the FIRST fires. Binding `x = a + c` is a
    // closure wall (name-holds-value 0006 is NOT an ancestor of 0019), so
    // the computed sum sits in the conditions themselves (0008 IS an
    // ancestor, same move as else-review).
    // Thresholds are strictly ordered t3 < t2 < t1, so with x = a + c:
    //   first-wins:  x = t1 + e > t1      → ALL THREE tests true, w1 prints;
    //   second-wins: t2 < x = t2 + e ≤ t1 → tests 2 and 3 true, w2 prints
    //                (e ∈ 1..2 ≤ gap1, so x never leaks past t1);
    //   third-wins:  x == t2 exactly      → `>` is strict, so test 2 fails
    //                ("equal is not greater") and test 3 (x > t3 < t2) is
    //                the first true one: w3 prints.
    // G1 regime + misconception formula (G2, rng-free): on first/second the
    // wrong is the LAST true test's word — always w3 ("a later true branch
    // wins"), ≠ the truth w1/w2 by the splice draws. On third-wins the
    // last-true reading lands ON the truth, so the wrong there is w2
    // ("equal counts as passing `>`", and first-true-wins then stops at
    // test 2) — again distinct by splice. w4's else branch is the live
    // decoy for "none of them is true".
    id: "elif-ladder-hard",
    topic: "logic",
    focus: "0019", // elif-first-true-wins
    assumed: ["0005", "0008", "0015", "0017", "0018"],
    role: "review",
    difficulty: "hard",
    form: "predict-exact-output",
    generator: {
      shapes: ["first-wins", "second-wins", "third-wins"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["first-wins", "second-wins", "third-wins"]);
        // Four DISTINCT branch words by splice-draw (G3).
        const pool = words.slice();
        const w1 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w2 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w3 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        const w4 = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
        // Fixed draw order across shapes (G7): t3, both gaps, e, and the
        // a-split are consumed on every seed.
        const t3 = int(rng, 2, 4);
        const t2 = t3 + int(rng, 2, 3);
        const t1 = t2 + int(rng, 2, 3);
        const e = int(rng, 1, 2); // ≤ both gaps — see the regime above
        const x = shape === "first-wins" ? t1 + e
          : shape === "second-wins" ? t2 + e
          : t2; // third-wins: dead on the t2 boundary
        const a = int(rng, 1, x - 1), c = x - a;
        const winner = shape === "first-wins" ? w1 : shape === "second-wins" ? w2 : w3;
        return {
          code: `if ${a} + ${c} > ${t1}:\n    print("${w1}")\nelif ${a} + ${c} > ${t2}:\n    print("${w2}")\nelif ${a} + ${c} > ${t3}:\n    print("${w3}")\nelse:\n    print("${w4}")\n`,
          shape, variant: "plain",
          misconception: shape === "third-wins" ? w2 : w3,
          variantCard: `\`${a} + ${c}\` is ${x}. ${shape === "first-wins"
            ? `\`${x} > ${t1}\` is already True — the later tests are true too, but the FIRST true test wins: \`${w1}\`.`
            : shape === "second-wins"
              ? `\`${x} > ${t1}\` fails, and \`${x} > ${t2}\` is the first true test — \`${x} > ${t3}\` is also true, but the ladder already stopped: \`${w2}\`.`
              : `\`${x} > ${t2}\` is False — equal is not greater — so \`${x} > ${t3}\` is the first true test: \`${w3}\`.`}`,
        };
      },
    },
  },
];
