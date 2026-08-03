// Lists & aliasing intro exercises (phase-1 slice), ending at the
// classic trap (alias-trap = design §10.3 E7) and its two deep
// neighbours (list-concat-new, plus-eq-mutates-list = design §10.2 C).

import { mulberry32, int, pick } from "../rng.mjs";
import { words, listNames } from "../pools.mjs";

export default [
  {
    id: "list-shows-brackets",
    topic: "lists",
    focus: "000D", // list-literal
    assumed: ["0005", "0006"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["two-items", "three-items", "direct-print"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const name = pick(rng, listNames);
        const shape = pick(rng, ["two-items", "three-items", "direct-print"]);
        if (shape === "direct-print") {
          const items = Array.from({ length: 2 }, () => int(rng, 1, 9));
          return { code: `print([${items.join(", ")}])\n`, shape, variant: "plain" };
        }
        const n = shape === "two-items" ? 2 : 3;
        const items = Array.from({ length: n }, () => int(rng, 1, 9));
        return {
          code: `${name} = [${items.join(", ")}]\nprint(${name})\n`,
          shape, variant: "plain",
        };
      },
    },
  },

  {
    id: "index-char",
    topic: "lists",
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
    id: "slot-assign",
    topic: "lists",
    focus: "000F", // index-assign-mutates
    assumed: ["0005", "0006", "000D", "000E"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["set-slot", "set-two-slots", "read-untouched-slot"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const name = pick(rng, listNames);
        const items = [int(rng, 1, 5), int(rng, 6, 9)];
        const i = int(rng, 0, 1);
        const v = int(rng, 10, 99);
        const after = items.slice();
        after[i] = v;
        const shape = pick(rng, ["set-slot", "set-two-slots", "read-untouched-slot"]);
        if (shape === "set-two-slots") {
          const w = int(rng, 10, 99);
          return {
            code: `${name} = [${items.join(", ")}]\n${name}[0] = ${v}\n${name}[1] = ${w}\nprint(${name})\n`,
            shape, variant: "plain",
            variantCard: `Each store changes one slot of the SAME list: [${v}, ${w}].`,
          };
        }
        if (shape === "read-untouched-slot") {
          const other = 1 - i;
          return {
            code: `${name} = [${items.join(", ")}]\n${name}[${i}] = ${v}\nprint(${name}[${other}])\n`,
            shape, variant: "plain",
            variantCard: `Only slot ${i} changed; slot ${other} still holds ${items[other]}.`,
          };
        }
        return {
          code: `${name} = [${items.join(", ")}]\n${name}[${i}] = ${v}\nprint(${name})\n`,
          shape: "set-slot", variant: "plain",
          variantCard: `\`${name}[${i}] = ${v}\` changes slot ${i} of the existing `
            + `list — the other slot keeps its value. The list is now `
            + `[${after.join(", ")}].`,
        };
      },
    },
  },

  {
    id: "append-grows",
    topic: "lists",
    focus: "000G", // append-mutates
    assumed: ["0005", "0006", "000D"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["append-then-print", "double-append", "append-to-empty"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const name = pick(rng, listNames);
        const items = [int(rng, 1, 5), int(rng, 6, 9)];
        const v = int(rng, 10, 99);
        const shape = pick(rng, ["append-then-print", "double-append", "append-to-empty"]);
        if (shape === "double-append") {
          const w = int(rng, 10, 99);
          return {
            code: `${name} = [${items.join(", ")}]\n${name}.append(${v})\n${name}.append(${w})\nprint(${name})\n`,
            shape, variant: "plain",
            variantCard: `Each append adds one item at the end, in order: [${[...items, v, w].join(", ")}].`,
          };
        }
        if (shape === "append-to-empty") {
          return {
            code: `${name} = []\n${name}.append(${v})\nprint(${name})\n`,
            shape, variant: "plain",
            variantCard: `Appending to an empty list gives a one-item list: [${v}].`,
          };
        }
        return {
          code: `${name} = [${items.join(", ")}]\n${name}.append(${v})\nprint(${name})\n`,
          shape: "append-then-print", variant: "plain",
        };
      },
    },
  },

  {
    id: "alias-trap",
    topic: "lists",
    focus: "000H", // names-share-list — the classic (design §10.3 E7)
    assumed: ["0005", "0006", "000A", "000C", "000D", "000G"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["mutate-alias-read-original", "mutate-original-read-alias"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = [int(rng, 1, 5), int(rng, 6, 9)];
        const v = int(rng, 10, 99);
        const shape = pick(rng, ["mutate-alias-read-original", "mutate-original-read-alias"]);
        const [via, read] = shape === "mutate-alias-read-original" ? ["b", "a"] : ["a", "b"];
        return {
          code: `a = [${items.join(", ")}]\nb = a\n${via}.append(${v})\nprint(${read})\n`,
          shape, variant: "plain",
          variantCard: `\`b = a\` did not copy the list — \`a\` and \`b\` are two `
            + `names for ONE list. Appending ${v} through \`${via}\` changed that `
            + `one list, so \`${read}\` shows it too: [${[...items, v].join(", ")}].`,
        };
      },
    },
  },

  {
    id: "concat-builds-new",
    topic: "lists",
    focus: "0021", // list-concat-new
    assumed: ["0005", "0006", "000D"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["print-original", "print-new", "concat-two-names"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = [int(rng, 1, 5), int(rng, 6, 9)];
        const v = int(rng, 10, 99);
        const shape = pick(rng, ["print-original", "print-new", "concat-two-names"]);
        if (shape === "concat-two-names") {
          const more = [int(rng, 10, 15), int(rng, 16, 20)];
          return {
            code: `a = [${items.join(", ")}]\nb = [${more.join(", ")}]\nprint(a + b)\n`,
            shape, variant: "plain",
            variantCard: `\`a + b\` builds a brand-new list from the pieces: `
              + `[${[...items, ...more].join(", ")}]. Neither original changes.`,
          };
        }
        const read = shape === "print-original" ? "a" : "b";
        const result = shape === "print-original" ? items : [...items, v];
        return {
          code: `a = [${items.join(", ")}]\nb = a + [${v}]\nprint(${read})\n`,
          shape, variant: "plain",
          variantCard: `\`a + [${v}]\` built a brand-new list for \`b\`; \`a\` was `
            + `not touched. So \`${read}\` holds [${result.join(", ")}].`,
        };
      },
    },
  },

  {
    id: "aug-assign-shared-list",
    topic: "lists",
    focus: "0023", // plus-eq-mutates-list (design §10.2 C)
    assumed: ["0005", "0006", "000A", "000C", "000D", "000G", "000H", "0021"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["aug-then-print-original"],
      variants: ["aug"],
      generate(seed) {
        const rng = mulberry32(seed);
        const p = int(rng, 1, 5), q = int(rng, 6, 9);
        const x = int(rng, 10, 99);
        return {
          code: `a = [${p}, ${q}]\nb = a\nb += [${x}]\nprint(a)\n`,
          shape: "aug-then-print-original", variant: "aug",
          variantCard: `\`b += [${x}]\` does NOT build a new list — it changes the `
            + `list \`b\` already names. That list is the one \`a\` names too, so `
            + `\`a\` shows the change: [${p}, ${q}, ${x}]. (\`b = b + [${x}]\` `
            + `would have built a new list and left \`a\` alone.)`,
        };
      },
    },
  },

  {
    id: "aggregate-one-value",
    topic: "lists",
    focus: "001Z", // aggregate-builtins
    assumed: ["0005", "000D"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["len", "sum", "max", "min"],
      variants: ["len", "sum", "max", "min"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["len", "sum", "max", "min"]);
        const items = Array.from({ length: int(rng, 3, 4) }, () => int(rng, 1, 20));
        return {
          code: `print(${shape}([${items.join(", ")}]))\n`,
          shape, variant: shape,
          variantCard: `\`${shape}\` of [${items.join(", ")}] is `
            + `${shape === "len" ? items.length : shape === "sum" ? items.reduce((a, b) => a + b, 0) : shape === "max" ? Math.max(...items) : Math.min(...items)}.`,
        };
      },
    },
  },

  {
    id: "append-vs-extend",
    topic: "lists",
    focus: "0020", // extend-vs-append
    assumed: ["0005", "0006", "000D", "000G"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["append-list", "extend-list"],
      variants: ["append", "extend"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["append-list", "extend-list"]);
        const name = pick(rng, listNames);
        const base = [int(rng, 1, 5), int(rng, 6, 9)];
        const add = [int(rng, 10, 15), int(rng, 16, 20)];
        const method = shape === "append-list" ? "append" : "extend";
        return {
          code: `${name} = [${base.join(", ")}]\n${name}.${method}([${add.join(", ")}])\nprint(${name})\n`,
          shape, variant: method,
          variantCard: shape === "append-list"
            ? `\`append([${add.join(", ")}])\` adds ONE item — the whole list — so it nests: [${base.join(", ")}, [${add.join(", ")}]].`
            : `\`extend([${add.join(", ")}])\` adds each item separately: [${[...base, ...add].join(", ")}].`,
        };
      },
    },
  },

  {
    id: "grid-lookup",
    topic: "lists",
    focus: "0022", // nested-lists
    assumed: ["0005", "0006", "000D", "000E"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["name-grid", "bare-grid", "whole-row"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["name-grid", "bare-grid", "whole-row"]);
        const grid = [[int(rng, 1, 9), int(rng, 1, 9)], [int(rng, 1, 9), int(rng, 1, 9)]];
        const r = int(rng, 0, 1), c = int(rng, 0, 1);
        const lit = `[[${grid[0].join(", ")}], [${grid[1].join(", ")}]]`;
        const card = `\`[${r}][${c}]\` picks row ${r} then position ${c}: that's \`${grid[r][c]}\`.`;
        if (shape === "whole-row") {
          return {
            code: `g = ${lit}\nprint(g[${r}])\n`, shape, variant: "plain",
            variantCard: `One subscript picks the WHOLE row: \`g[${r}]\` is [${grid[r].join(", ")}].`,
          };
        }
        if (shape === "name-grid") return { code: `g = ${lit}\nprint(g[${r}][${c}])\n`, shape, variant: "plain", variantCard: card };
        return { code: `print(${lit}[${r}][${c}])\n`, shape, variant: "plain", variantCard: card };
      },
    },
  },

  {
    id: "slice-makes-copy",
    topic: "lists",
    focus: "0024", // slice-copies
    assumed: ["0005", "0006", "000D", "000G", "000H", "0011"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["copy-then-mutate"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = [int(rng, 1, 5), int(rng, 6, 9)];
        const v = int(rng, 10, 99);
        return {
          code: `a = [${items.join(", ")}]\nb = a[:]\nb.append(${v})\nprint(a)\n`,
          shape: "copy-then-mutate", variant: "plain",
          variantCard: `\`a[:]\` copied the list, so \`b\` is separate. Appending ${v} to \`b\` `
            + `leaves \`a\` as [${items.join(", ")}].`,
        };
      },
    },
  },

  {
    id: "shallow-copy-shares-rows",
    topic: "lists",
    focus: "0025", // copy-is-shallow (vocab-gap mint)
    assumed: ["0005", "0006", "000D", "000E", "000G", "000H", "0011", "0022", "0024"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["mutate-copy-read-original", "mutate-original-read-copy"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const g = [[int(rng, 1, 4), int(rng, 5, 9)], [int(rng, 1, 4), int(rng, 5, 9)]];
        const x = int(rng, 10, 99);
        const row = int(rng, 0, 1);
        const shape = pick(rng, ["mutate-copy-read-original", "mutate-original-read-copy"]);
        const [via, read] = shape === "mutate-copy-read-original" ? ["b", "a"] : ["a", "b"];
        const after = g.map((r, i) => (i === row ? [...r, x] : r));
        const show = (grid) => `[[${grid[0].join(", ")}], [${grid[1].join(", ")}]]`;
        return {
          code: `a = ${show(g)}\nb = a[:]\n${via}[${row}].append(${x})\nprint(${read})\n`,
          shape, variant: "plain",
          variantCard: `\`a[:]\` copied only the OUTER list — \`a[${row}]\` and \`b[${row}]\` are `
            + `one shared inner list. Appending ${x} through \`${via}\` changed it, so `
            + `\`${read}\` shows ${show(after)}.`,
        };
      },
    },
  },
];
