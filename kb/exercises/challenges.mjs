// Challenge exercises (expansion ladder R1.2). A challenge introduces ZERO
// new things: it braids the met focus with met material from OUTSIDE the
// focus lineage (`braids`), under the relaxed static closure
// assumed ⊆ ancestors(focus) ∪ braids ∪ ⋃ancestors(braid) — legal ONLY for
// this role, compensated by the dynamic gate (dealt only when focus AND
// every assumed tag are met; kb/index.mjs offerable + app/kb-session.mjs
// pool filter). Challenges bump stats on the focus only and never grant met
// (the met gate makes the grant a no-op — the focus is met by definition).
// Each challenge lives in its focus concept's lane.

import { mulberry32, int, pick } from "../rng.mjs";
import { words } from "../pools.mjs";

export default [
  {
    id: "chal-alias-in-loop",
    topic: "lists",
    focus: "000H", // names-share-list, braided with loop-build-list
    assumed: ["0005", "0006", "000A", "000C", "000D", "000G", "001E", "001K"],
    braids: ["001K"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["loop-through-alias", "loop-through-original"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["loop-through-alias", "loop-through-original"]);
        const start = int(rng, 1, 9);
        const items = [int(rng, 10, 40), int(rng, 41, 70)];
        const [via, read] = shape === "loop-through-alias" ? ["b", "a"] : ["a", "b"];
        const after = [start, ...items];
        return {
          code: `a = [${start}]\nb = a\nfor x in [${items.join(", ")}]:\n    ${via}.append(x)\nprint(${read})\n`,
          shape, variant: "plain",
          misconception: `[${start}]`, // "b = a copied it, so the loop grew only the other name"
          variantCard: `\`b = a\` never copied the list — the loop appends through \`${via}\` `
            + `into the ONE list both names hold, so \`${read}\` shows every item: `
            + `[${after.join(", ")}].`,
        };
      },
    },
  },

  {
    id: "chal-accumulate-until-break",
    topic: "loops",
    focus: "001N", // break-exits, braided with loop-accumulate
    assumed: ["0005", "0006", "0008", "0009", "000A", "000B", "000D", "0015", "0017", "001E", "001J"],
    braids: ["001J"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["break-at-second", "break-at-third"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["break-at-second", "break-at-third"]);
        // Distinct small items; the threshold trips at the 2nd or 3rd item,
        // so the total counts only what came before the break.
        const a = int(rng, 1, 4), b = int(rng, 1, 4), big = int(rng, 8, 12);
        const items = shape === "break-at-second" ? [a, big, b] : [a, b, big];
        const kept = shape === "break-at-second" ? [a] : [a, b];
        const total = kept.reduce((x, y) => x + y, 0);
        return {
          code: `total = 0\nfor x in [${items.join(", ")}]:\n    if x > 7:\n        break\n    total = total + x\nprint(total)\n`,
          shape, variant: "plain",
          misconception: String(items.reduce((x, y) => x + y, 0)), // ran the whole list
          variantCard: `${kept.join(" + ") || 0} accumulates, then ${big} trips \`x > 7\` and `
            + `\`break\` leaves the loop BEFORE adding it — the total stops at ${total}, `
            + `not the full-list ${items.reduce((x, y) => x + y, 0)}.`,
        };
      },
    },
  },

  {
    id: "chal-filter-build",
    topic: "loops",
    focus: "001K", // loop-build-list, braided with if-runs-or-skips
    assumed: ["0005", "0006", "0008", "000D", "000G", "0015", "0016", "0017", "001E"],
    braids: ["0017"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["keep-big", "keep-small"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["keep-big", "keep-small"]);
        const t = int(rng, 4, 6);
        // Four items straddling the threshold: at least one on each side.
        const items = [int(rng, 1, t - 1), t + int(rng, 1, 3), int(rng, 1, t - 1), t + int(rng, 1, 3)];
        const op = shape === "keep-big" ? ">" : "<";
        const kept = items.filter((x) => (shape === "keep-big" ? x > t : x < t));
        return {
          code: `xs = []\nfor x in [${items.join(", ")}]:\n    if x ${op} ${t}:\n        xs.append(x)\nprint(xs)\n`,
          shape, variant: "plain",
          misconception: `[${items.join(", ")}]`, // appended every pass, ignoring the if
          variantCard: `Only the passes where \`x ${op} ${t}\` is true reach the append — `
            + `the rest are skipped, so xs ends [${kept.join(", ")}], not the whole list.`,
        };
      },
    },
  },

  {
    id: "chal-dict-under-branch",
    topic: "structures",
    focus: "001S", // dict-key-assign, braided with else-otherwise
    assumed: ["0005", "0006", "0007", "0008", "000E", "0015", "0016", "0017", "0018", "001R"],
    braids: ["0018"],
    role: "challenge",
    form: "predict-state",
    generator: {
      shapes: ["if-adds", "else-overwrites"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["if-adds", "else-overwrites"]);
        const [k1, k2] = pick(rng, [["a", "b"], ["x", "y"], ["id", "n"]]);
        const v1 = int(rng, 1, 9), v2 = int(rng, 10, 20), v3 = int(rng, 21, 30);
        const t = int(rng, 4, 7);
        const n = shape === "if-adds" ? t + 2 : t - 2;
        const after = shape === "if-adds"
          ? `{'${k1}': ${v1}, '${k2}': ${v2}}`
          : `{'${k1}': ${v3}}`;
        const other = shape === "if-adds"
          ? `{'${k1}': ${v3}}`
          : `{'${k1}': ${v1}, '${k2}': ${v2}}`;
        return {
          code: `d = {"${k1}": ${v1}}\nn = ${n}\nif n > ${t}:\n    d["${k2}"] = ${v2}\nelse:\n    d["${k1}"] = ${v3}\n`,
          probeName: "d",
          shape, variant: "plain",
          misconception: other, // took the branch the test actually skipped
          variantCard: `\`${n} > ${t}\` is ${n > t ? "True, so the if branch adds a new key" : "False, so the else branch overwrites the existing key"} — `
            + `only that ONE store runs, leaving \`d\` as ${after}.`,
        };
      },
    },
  },

  {
    id: "chal-slice-of-concat",
    topic: "strings",
    focus: "0011", // slice-half-open, braided with str-concat
    assumed: ["0005", "0006", "0007", "000E", "000Y"],
    braids: ["000Y"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["slice-joined", "slice-into-name"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["slice-joined", "slice-into-name"]);
        // Two short words; the slice spans the join, so the answer exists
        // only in the CONCATENATED text — neither original contains it.
        const a = pick(rng, ["sun", "cat", "map", "log"]);
        const b = pick(rng, ["set", "nap", "pin", "jam"]);
        const s = a + b;
        const lo = int(rng, 1, 2), hi = lo + 3; // always crosses index 3 (the joint)
        const card = `\`"${a}" + "${b}"\` is \`"${s}"\` first; then \`[${lo}:${hi}]\` takes `
          + `positions ${lo} up to but not ${hi} of the JOINED text: \`${s.slice(lo, hi)}\`.`;
        if (shape === "slice-into-name") {
          return {
            code: `s = "${a}" + "${b}"\nt = s[${lo}:${hi}]\nprint(t)\n`,
            shape, variant: "plain",
            misconception: a.slice(lo, hi), // sliced the first word alone
            variantCard: card,
          };
        }
        return {
          code: `s = "${a}" + "${b}"\nprint(s[${lo}:${hi}])\n`,
          shape, variant: "plain",
          misconception: a.slice(lo, hi),
          variantCard: card,
        };
      },
    },
  },

  {
    id: "chal-sum-of-built-list",
    topic: "lists",
    focus: "001Z", // aggregate-builtins, braided with loop-build-list
    assumed: ["0005", "0006", "000D", "000G", "001E", "001K"],
    braids: ["001K"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["sum-collected", "len-collected", "max-collected"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["sum-collected", "len-collected", "max-collected"]);
        const start = int(rng, 1, 9);
        const items = Array.from({ length: int(rng, 2, 3) }, () => int(rng, 1, 9));
        const all = [start, ...items];
        const fn = shape === "sum-collected" ? "sum" : shape === "len-collected" ? "len" : "max";
        const val = fn === "sum" ? all.reduce((x, y) => x + y, 0) : fn === "len" ? all.length : Math.max(...all);
        const noStart = fn === "sum" ? items.reduce((x, y) => x + y, 0) : fn === "len" ? items.length : Math.max(...items);
        return {
          code: `xs = [${start}]\nfor x in [${items.join(", ")}]:\n    xs.append(x)\nprint(${fn}(xs))\n`,
          shape, variant: "plain",
          // Forgot the starter item the list already held before the loop.
          // (max-collected: when the starter isn't the max, "forgot the
          // starter" gives the SAME answer — no designed wrong exists there,
          // so the field is omitted on those seeds.)
          ...(noStart === val ? {} : { misconception: String(noStart) }),
          variantCard: `The loop grows \`xs\` to [${all.join(", ")}] — starter included — `
            + `so \`${fn}\` of it is ${val}${val === noStart ? "" : `, not the ${noStart} you get by counting only the appended items`}.`,
        };
      },
    },
  },

  {
    // DEVIATION from the R1 spec (trace-table on s/len(s), braids
    // [000Y, 001Z]): `len()` of a str is OUTSIDE the analyzer subset
    // (footprint.mjs hard-errors on it), so a len-conditioned while can
    // never pass K-5, and without len the 001Z braid has no honest
    // witness. Per the spec's own contingency this is downgraded to
    // predict-output: a countdown-driven while that GROWS a string, braids
    // [000Y] only.
    id: "chal-while-grows-string",
    topic: "loops",
    focus: "001M", // while-repeats-while-true, braided with str-concat
    assumed: ["0005", "0006", "0007", "0008", "0009", "000A", "000B", "0015", "000Y"],
    braids: ["000Y"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["grow-suffix", "grow-prefix"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["grow-suffix", "grow-prefix"]);
        const w = pick(rng, words);
        const t = pick(rng, ["!", "?", "*"]);
        const n = int(rng, 2, 4);
        const grown = shape === "grow-suffix" ? w + t.repeat(n) : t.repeat(n) + w;
        const step = shape === "grow-suffix" ? `s = s + "${t}"` : `s = "${t}" + s`;
        return {
          code: `s = "${w}"\nn = ${n}\nwhile n > 0:\n    ${step}\n    n = n - 1\nprint(s)\n`,
          shape, variant: "plain",
          misconception: shape === "grow-suffix" ? w + t : t + w, // one pass, not n
          variantCard: `The loop runs while \`n > 0\` — ${n} passes, each gluing one \`${t}\` `
            + `${shape === "grow-suffix" ? "onto the end" : "onto the front"}. \`s\` ends \`${grown}\`.`,
        };
      },
    },
  },

  {
    id: "chal-grid-total",
    topic: "lists",
    focus: "0022", // nested-lists, braided with loop-for-visits-each + loop-accumulate
    assumed: ["0005", "0006", "0008", "0009", "000A", "000B", "000D", "000E", "001E", "001J"],
    braids: ["001E", "001J"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["sum-grid", "count-cells"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["sum-grid", "count-cells"]);
        const rows = int(rng, 2, 3);
        const g = Array.from({ length: rows }, () => [int(rng, 1, 6), int(rng, 1, 6)]);
        const lit = `[${g.map((r) => `[${r.join(", ")}]`).join(", ")}]`;
        if (shape === "count-cells") {
          const cells = rows * 2;
          return {
            code: `count = 0\nfor row in ${lit}:\n    for x in row:\n        count = count + 1\nprint(count)\n`,
            shape, variant: "plain",
            misconception: String(rows), // counted rows, not cells
            variantCard: `The outer loop visits ${rows} rows; the inner loop visits each `
              + `row's 2 numbers — the counter ticks once per CELL, ending at ${cells}.`,
          };
        }
        const total = g.flat().reduce((x, y) => x + y, 0);
        const rowSums = g.map((r) => r[0] + r[1]);
        return {
          code: `total = 0\nfor row in ${lit}:\n    for x in row:\n        total = total + x\nprint(total)\n`,
          shape, variant: "plain",
          misconception: String(rowSums[0]), // summed only the first row
          variantCard: `The inner loop adds every number of every row: `
            + `${g.flat().join(" + ")} = ${total}.`,
        };
      },
    },
  },
];
