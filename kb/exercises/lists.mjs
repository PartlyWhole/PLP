// Lists & aliasing intro exercises (phase-1 slice), ending at the
// classic trap (alias-trap = design §10.3 E7) and its two deep
// neighbours (list-concat-new, plus-eq-mutates-list = design §10.2 C).

import { mulberry32, int, pick } from "../rng.mjs";
import { words, listNames } from "../pools.mjs";
import { orderPair } from "../contrast.mjs";

// A blank is authored by writing the program with a NUL marker where the hole
// goes; this returns the full (correct) code plus the hole's position (mirrors
// the helper in exercises/forms.mjs — kept local so this module stays
// self-contained).
function blankFrom(template, token) {
  const idx = template.indexOf("\x00");
  const before = template.slice(0, idx);
  const line = before.split("\n").length;
  const col = idx - (before.lastIndexOf("\n") + 1);
  return { code: template.replace("\x00", token), blank: { line, col, len: token.length, target: token } };
}

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
          misconception: `[${items.join(", ")}]`, // "b = a copied it, so the read name is untouched"
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
          // print-original's designed wrong: "the + changed a too".
          ...(shape === "print-original" ? { misconception: `[${[...items, v].join(", ")}]` } : {}),
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
          misconception: `[${p}, ${q}]`, // "+= built b a new list, a is untouched"
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
          // The other method's result — the exact confusion this pair teaches.
          misconception: shape === "append-list"
            ? `[${[...base, ...add].join(", ")}]`
            : `[${base.join(", ")}, [${add.join(", ")}]]`,
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
          misconception: `[${[...items, v].join(", ")}]`, // "b is just another name for a"
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
          misconception: show(g), // "the copy is fully independent"
          variantCard: `\`a[:]\` copied only the OUTER list — \`a[${row}]\` and \`b[${row}]\` are `
            + `one shared inner list. Appending ${x} through \`${via}\` changed it, so `
            + `\`${read}\` shows ${show(after)}.`,
        };
      },
    },
  },

  {
    // Hard sibling (R1.3): a three-name alias chain — availability-gated on
    // met(000H) by selection, so it deals only after the two-name trap lands.
    id: "alias-chain-hard",
    topic: "lists",
    focus: "000H", // names-share-list
    assumed: ["0005", "0006", "000A", "000C", "000D", "000G"],
    role: "review",
    difficulty: "hard",
    form: "predict-exact-output",
    generator: {
      shapes: ["chain-append-read-middle"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = [int(rng, 1, 5), int(rng, 6, 9)];
        const v = int(rng, 10, 99);
        return {
          code: `a = [${items.join(", ")}]\nb = a\nc = b\nc.append(${v})\nprint(b)\n`,
          shape: "chain-append-read-middle", variant: "plain",
          misconception: `[${items.join(", ")}]`, // "b was copied before c changed anything"
          variantCard: `\`b = a\` and \`c = b\` never copied — all three names hold ONE list. `
            + `Appending ${v} through \`c\` changed it, so \`b\` shows [${[...items, v].join(", ")}] too.`,
        };
      },
    },
  },

  {
    // Hard sibling (R1.3): a 3×3 grid read far from the origin — the row/
    // column discipline with no [0]/[1]-only shortcut. No arithmetic here:
    // arith-on-ints is not an ancestor of nested-lists.
    id: "grid-far-corner-hard",
    topic: "lists",
    focus: "0022", // nested-lists
    assumed: ["0005", "0006", "000D", "000E"],
    role: "review",
    difficulty: "hard",
    form: "predict-exact-output",
    generator: {
      shapes: ["far-corner", "whole-last-row"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["far-corner", "whole-last-row"]);
        // 9 distinct cells so every (row, col) confusion reads a DIFFERENT
        // number — the transposed read can never accidentally match.
        const cells = [];
        while (cells.length < 9) { const v = int(rng, 1, 30); if (!cells.includes(v)) cells.push(v); }
        const g = [cells.slice(0, 3), cells.slice(3, 6), cells.slice(6, 9)];
        const lit = `[[${g[0].join(", ")}], [${g[1].join(", ")}], [${g[2].join(", ")}]]`;
        if (shape === "whole-last-row") {
          return {
            code: `g = ${lit}\nprint(g[2])\n`,
            shape, variant: "plain",
            misconception: String(g[2][2]), // read one cell instead of the row
            variantCard: `One subscript picks a WHOLE row: \`g[2]\` is the third row, `
              + `[${g[2].join(", ")}] — brackets and all, not a single number.`,
          };
        }
        return {
          code: `g = ${lit}\nprint(g[2][1])\n`,
          shape, variant: "plain",
          misconception: String(g[1][2]), // swapped row and column
          variantCard: `\`g[2][1]\` is row 2 (the THIRD row), then position 1 — that's ${g[2][1]}. `
            + `Swapping the subscripts would read ${g[1][2]} instead; row always comes first.`,
        };
      },
    },
  },

  // --- order-matters variations (design §5, order discipline) -----------

  {
    id: "append-order",
    topic: "lists",
    focus: "000G", // append-mutates — printing before vs after the append
    assumed: ["0005", "0006", "000D"],
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["one-append", "two-appends"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["one-append", "two-appends"]);
        const nm = pick(rng, listNames);
        const p = int(rng, 1, 5), q = int(rng, 6, 9), v = int(rng, 10, 99), w = int(rng, 10, 99);
        const aOutput = `[${p}, ${q}]`;
        if (shape === "two-appends") {
          const { code, contrastCode } = orderPair(
            [`${nm} = [${p}, ${q}]`, `print(${nm})`, `${nm}.append(${v})`, `${nm}.append(${w})`], 1, 3);
          return {
            code, aOutput, contrastCode,
            shape, variant: "plain",
            variantCard: `Only \`print(${nm})\` moved. Print FIRST and the list is still \`${aOutput}\`; `
              + `print after both appends and it has grown to \`[${p}, ${q}, ${v}, ${w}]\`.`,
          };
        }
        const { code, contrastCode } = orderPair(
          [`${nm} = [${p}, ${q}]`, `print(${nm})`, `${nm}.append(${v})`], 1, 2);
        return {
          code, aOutput, contrastCode,
          shape, variant: "plain",
          variantCard: `The append changes the SAME list. Print before it and you see \`${aOutput}\`; `
            + `print after and you see \`[${p}, ${q}, ${v}]\`.`,
        };
      },
    },
  },

  {
    id: "slot-write-order",
    topic: "lists",
    focus: "000F", // index-assign-mutates — which write lands last wins
    assumed: ["0005", "0006", "000D", "000E"],
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["swap-writes", "read-between"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["swap-writes", "read-between"]);
        const nm = pick(rng, listNames);
        const base = int(rng, 1, 9);
        const v1 = int(rng, 10, 40);
        const v2 = v1 + int(rng, 1, 20); // v2 ≠ v1
        if (shape === "read-between") {
          // The initial slot 0 value is `base` (1..9), well below the first
          // write `v1` (10..40), so the first write is a REAL change, never a
          // no-op like `nums[0] = 15` on `[15, …]`.
          const { code, contrastCode } = orderPair(
            [`${nm} = [${base}, ${base}]`, `${nm}[0] = ${v1}`, `print(${nm})`, `${nm}[0] = ${v2}`], 2, 3);
          return {
            code, aOutput: `[${v1}, ${base}]`, contrastCode,
            shape, variant: "plain",
            variantCard: `Only \`print(${nm})\` moved. Read between the two writes and slot 0 is ${v1}; `
              + `read after both and slot 0 is ${v2} — the last write to a slot wins.`,
          };
        }
        const { code, contrastCode } = orderPair(
          [`${nm} = [${base}, ${base}]`, `${nm}[0] = ${v1}`, `${nm}[0] = ${v2}`, `print(${nm})`], 1, 2);
        return {
          code, aOutput: `[${v2}, ${base}]`, contrastCode,
          shape, variant: "plain",
          variantCard: `Both lines write slot 0; the SECOND one wins. As written slot 0 ends at ${v2}; `
            + `swap the two writes and it ends at ${v1} instead.`,
        };
      },
    },
  },

  {
    id: "copy-timing",
    topic: "lists",
    focus: "0024", // slice-copies — a[:] copies the list AS IT IS right then
    assumed: ["0005", "0006", "000D", "000G", "000H", "0011"],
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["one-append", "two-appends"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["one-append", "two-appends"]);
        const p = int(rng, 1, 5), q = int(rng, 6, 9), v = int(rng, 10, 99), w = int(rng, 10, 99);
        const aOutput = `[${p}, ${q}]`;
        if (shape === "two-appends") {
          const { code, contrastCode } = orderPair(
            [`a = [${p}, ${q}]`, `b = a[:]`, `a.append(${v})`, `a.append(${w})`, `print(b)`], 1, 3);
          return {
            code, aOutput, contrastCode,
            shape, variant: "plain",
            variantCard: `\`b = a[:]\` copies the list exactly as it is at that moment. Copy first and \`b\` `
              + `stays \`${aOutput}\`; copy after both appends and \`b\` is \`[${p}, ${q}, ${v}, ${w}]\`.`,
          };
        }
        const { code, contrastCode } = orderPair(
          [`a = [${p}, ${q}]`, `b = a[:]`, `a.append(${v})`, `print(b)`], 1, 2);
        return {
          code, aOutput, contrastCode,
          shape, variant: "plain",
          variantCard: `Only the \`b = a[:]\` copy moved. Copy BEFORE the append and \`b\` is \`${aOutput}\`; `
            + `copy AFTER and \`b\` is \`[${p}, ${q}, ${v}]\` — the copy freezes the list as it stood.`,
        };
      },
    },
  },

  {
    // Trace walkthrough (design §5.2 trace-table): aliasing in table form —
    // one append changes BOTH columns in the same row, which is the whole
    // point of names-share-list.
    id: "trace-alias",
    topic: "lists",
    focus: "000H", // names-share-list
    assumed: ["0005", "0006", "000A", "000C", "000D", "000G"],
    role: "review",
    form: "trace-table",
    generator: {
      shapes: ["append-through-alias", "append-through-original"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["append-through-alias", "append-through-original"]);
        const items = Array.from({ length: 2 }, () => int(rng, 1, 9));
        const extra = int(rng, 10, 99);
        const code = shape === "append-through-alias"
          ? `a = [${items.join(", ")}]\nb = a\nb.append(${extra})\nprint(a)\n`
          : `a = [${items.join(", ")}]\nb = a\na.append(${extra})\nprint(b)\n`;
        return {
          code,
          probeNames: ["a", "b"],
          shape, variant: "plain",
          misconception: `[${items.join(", ")}]`, // the un-appended list ("the other name kept the old one")
          variantCard: "`b = a` makes two names for ONE list — so the append step changes both columns at once. That shared row is aliasing.",
        };
      },
    },
  },

  {
    // spot-the-difference: same list, extend vs append of the SAME two-item
    // list — one flattens, one nests. Not a `contrast` (both programs are the
    // single focus concept), just the two halves of extend-vs-append.
    id: "extend-vs-append-spot",
    topic: "lists",
    focus: "0020", // extend-vs-append
    assumed: ["0005", "0006", "000D", "000G"],
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["extend-then-append"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const nm = pick(rng, listNames);
        const p = int(rng, 1, 5), q = int(rng, 6, 9);
        const x = int(rng, 10, 15), y = int(rng, 16, 20);
        return {
          // Program A (shown WITH its output): extend adds each item.
          code: `${nm} = [${p}, ${q}]\n${nm}.extend([${x}, ${y}])\nprint(${nm})\n`,
          aOutput: `[${p}, ${q}, ${x}, ${y}]`,
          // Program B (predicted): append adds the whole list as ONE nested item.
          contrastCode: `${nm} = [${p}, ${q}]\n${nm}.append([${x}, ${y}])\nprint(${nm})\n`,
          shape: "extend-then-append", variant: "plain",
          variantCard: `The only change is the method. \`extend([${x}, ${y}])\` folds each item in — `
            + `[${p}, ${q}, ${x}, ${y}]. \`append([${x}, ${y}])\` adds the whole list as ONE item — `
            + `[${p}, ${q}, [${x}, ${y}]].`,
        };
      },
    },
  },

  {
    // spot-the-difference: reading a grid at [1][0] vs [0][1] — row/column
    // order is the whole lesson of nested-lists. Values are chosen so the two
    // cells always differ.
    id: "nested-index-spot",
    topic: "lists",
    focus: "0022", // nested-lists
    assumed: ["0005", "0006", "000D", "000E"],
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["row-col-swap"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        // g[1][0] and g[0][1] are the two probed cells; keep them distinct so
        // A-output ≠ B-output on every seed.
        const g01 = int(rng, 1, 4);
        const g10 = g01 + int(rng, 1, 4); // ≠ g01
        const g00 = int(rng, 1, 9), g11 = int(rng, 1, 9);
        const lit = `[[${g00}, ${g01}], [${g10}, ${g11}]]`;
        return {
          // Program A (shown WITH its output): row 1, position 0.
          code: `g = ${lit}\nprint(g[1][0])\n`,
          aOutput: String(g10),
          // Program B (predicted): row 0, position 1 — a different cell.
          contrastCode: `g = ${lit}\nprint(g[0][1])\n`,
          shape: "row-col-swap", variant: "plain",
          variantCard: `\`g[1][0]\` is row 1 then position 0 — that's ${g10}. Swap the subscripts to `
            + `\`g[0][1]\` and you pick row 0 position 1 instead — ${g01}. Row comes first.`,
        };
      },
    },
  },

  {
    // Membership (002M): `in` answers the yes-or-no question — never the
    // position. Three shapes keep the answer honest: found, not found,
    // and text membership.
    id: "in-list",
    topic: "lists",
    focus: "002M", // in-checks-membership
    assumed: ["0005", "0006", "000D", "0016"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["found", "not-found", "in-text"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["found", "not-found", "in-text"]);
        if (shape === "in-text") {
          const word = pick(rng, ["dog", "map", "fog", "log"]);
          const hit = pick(rng, [true, false]);
          const ch = hit ? word[int(rng, 0, 2)] : pick(rng, ["z", "q", "x"]);
          return {
            code: `word = "${word}"\nprint("${ch}" in word)\n`,
            shape, variant: "plain",
            variantCard: `\`in\` works on text too: is \`"${ch}"\` one of the characters of \`"${word}"\`? ${hit ? "Yes — `True`." : "No — `False`."}`,
          };
        }
        const items = [];
        while (items.length < 3) { const v = int(rng, 1, 9); if (!items.includes(v)) items.push(v); }
        if (shape === "found") {
          const target = items[int(rng, 0, 2)];
          return {
            code: `xs = [${items.join(", ")}]\nprint(${target} in xs)\n`,
            shape, variant: "plain",
            variantCard: `${target} IS one of the items, so \`in\` answers \`True\` — it never says where.`,
          };
        }
        // Draw the not-found probe from the SAME 1..9 band, excluded from the
        // items (do/while) — so a "big number ⇒ not there" shortcut fails.
        let miss = int(rng, 1, 9);
        while (items.includes(miss)) miss = int(rng, 1, 9);
        return {
          code: `xs = [${items.join(", ")}]\nprint(${miss} in xs)\n`,
          shape: "not-found", variant: "plain",
          variantCard: `${miss} is not among the items, so the answer is \`False\` — \`in\` asks membership, nothing more.`,
        };
      },
    },
  },

  {
    // Ramp (review) fill-one-blank: exactly ONE of len/sum/max/min produces the
    // target — items are re-drawn until the intended function's value is unique
    // among all four (so the fill has one right answer, E5/E6).
    id: "fill-aggregate",
    topic: "lists",
    focus: "001Z", // aggregate-builtins
    assumed: ["0005", "000D"],
    role: "review",
    form: "fill-one-blank",
    generator: {
      shapes: ["len", "sum", "max", "min"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const fn = pick(rng, ["len", "sum", "max", "min"]);
        let items, vals;
        do {
          items = Array.from({ length: int(rng, 3, 4) }, () => int(rng, 1, 12));
          vals = {
            len: items.length,
            sum: items.reduce((a, b) => a + b, 0),
            max: Math.max(...items),
            min: Math.min(...items),
          };
        } while (["len", "sum", "max", "min"].filter((f) => vals[f] === vals[fn]).length !== 1);
        const { code, blank } = blankFrom(`print(\x00([${items.join(", ")}]))\n`, fn);
        return {
          code, blank, targetOutput: String(vals[fn]),
          shape: fn, variant: "plain",
          variantCard: `Only \`${fn}\` of [${items.join(", ")}] gives ${vals[fn]} — len is ${vals.len}, `
            + `sum ${vals.sum}, max ${vals.max}, min ${vals.min}.`,
        };
      },
    },
  },

  {
    // Ramp (review) spot-the-difference: `in` answers membership, not position.
    // A hits an item (True); B probes an excluded same-band value (False).
    id: "in-list-spot",
    topic: "lists",
    focus: "002M", // in-checks-membership
    assumed: ["0005", "0006", "000D", "0016"],
    role: "review",
    form: "spot-the-difference",
    generator: {
      // Mirrored shapes so B's answer varies across seeds ("opposite of A"
      // is not a winning meta): half the pairs show the hit and probe the
      // miss, half show the miss and probe the hit. A ≠ B always holds.
      shapes: ["hit-vs-miss", "miss-vs-hit"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["hit-vs-miss", "miss-vs-hit"]);
        const items = [];
        while (items.length < 3) { const v = int(rng, 1, 9); if (!items.includes(v)) items.push(v); }
        const hit = items[int(rng, 0, 2)];
        let miss = int(rng, 1, 9);
        while (items.includes(miss)) miss = int(rng, 1, 9);
        const [shown, probed, aOut] = shape === "hit-vs-miss"
          ? [hit, miss, "True"]
          : [miss, hit, "False"];
        return {
          code: `xs = [${items.join(", ")}]\nprint(${shown} in xs)\n`,
          aOutput: aOut,
          contrastCode: `xs = [${items.join(", ")}]\nprint(${probed} in xs)\n`,
          shape, variant: "plain",
          variantCard: `\`${hit}\` is one of the items, so \`${hit} in xs\` is \`True\`; \`${miss}\` is not, so `
            + `\`${miss} in xs\` is \`False\`. Same band, different membership.`,
        };
      },
    },
  },

  {
    // Ramp (review) spot-the-difference: concat builds a NEW list (original
    // unchanged) — A prints the untouched original, B prints the new list.
    // DEVIATION from the plan's B `a.append(v)`: append-mutates (000G) is a
    // SIBLING of list-concat-new (0021), not an ancestor, so an append B would
    // footprint 000G outside the closure (K-5). This legal version keeps both
    // programs on 0021.
    id: "concat-vs-append-spot",
    topic: "lists",
    focus: "0021", // list-concat-new
    assumed: ["0005", "0006", "000D"],
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["original-vs-new"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = [int(rng, 1, 5), int(rng, 6, 9)];
        const v = int(rng, 10, 99);
        return {
          code: `a = [${items.join(", ")}]\nb = a + [${v}]\nprint(a)\n`,
          aOutput: `[${items.join(", ")}]`,
          contrastCode: `a = [${items.join(", ")}]\nb = a + [${v}]\nprint(b)\n`,
          shape: "original-vs-new", variant: "plain",
          variantCard: `\`a + [${v}]\` builds a brand-new list for \`b\`, leaving \`a\` as [${items.join(", ")}]. `
            + `Print \`b\` instead and you see the new list: [${[...items, v].join(", ")}].`,
        };
      },
    },
  },
];
