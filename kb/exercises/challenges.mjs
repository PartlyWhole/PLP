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
import { words, dictKeys, distinctWords, listNames } from "../pools.mjs";

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
          // starter" gives the SAME answer — there the designed wrong is the
          // SUM of the grown list instead: the 001Z aggregates confused with
          // one another, and sum > max always with ≥3 positive items.)
          misconception: noStart === val ? String(all.reduce((x, y) => x + y, 0)) : String(noStart),
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

  {
    // Challenge: the word-counting idiom — dict-get-default braided with
    // dict-key-assign + a for-loop. G1 regime: the queried word appears
    // m ∈ {2,3} times, so truth m never equals the lookup-final wrong "1"
    // ("every store restarted from the default") nor the get-final wrong
    // "0" ("get always hands back the default"). Misconception formula:
    // lookup-final → "1"; get-final → "0" (rng-free, constant per shape).
    id: "chal-word-count",
    topic: "structures",
    focus: "001T", // dict-get-default, braided with dict-key-assign + for-loop
    assumed: ["0005", "0006", "0008", "000D", "001E", "001R", "001S"],
    braids: ["0008", "001E", "001S"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["lookup-final", "get-final"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["lookup-final", "get-final"]);
        const i = int(rng, 0, dictKeys.length - 1);
        const j = (i + 1 + int(rng, 0, dictKeys.length - 2)) % dictKeys.length;
        const w1 = dictKeys[i], w2 = dictKeys[j];
        const m = int(rng, 2, 3); // w1 appears m times, w2 once
        const items = m === 2 ? [w1, w2, w1] : [w1, w2, w1, w1];
        const read = shape === "lookup-final" ? `d["${w1}"]` : `d.get("${w1}", 0)`;
        return {
          code: `d = {}\nfor w in [${items.map((x) => `"${x}"`).join(", ")}]:\n    d[w] = d.get(w, 0) + 1\nprint(${read})\n`,
          shape, variant: "plain",
          misconception: shape === "lookup-final" ? "1" : "0",
          variantCard: `Each pass stores \`d.get(w, 0) + 1\` — the count so far plus one, `
            + `with the 0 used only the FIRST time a word shows up. \`"${w1}"\` appears `
            + `${m} times, so its tally climbs to ${m}`
            + `${shape === "get-final" ? ` — and the final \`.get\` returns that stored ${m}; the default matters only for missing keys` : ""}.`,
        };
      },
    },
  },

  {
    // Challenge: swap-right-side-first braided with a counted loop — the
    // swap runs range(n) times, so n's PARITY decides which value each name
    // ends holding. G1 regime: p ≠ q by offset draw, so the value one
    // parity off (the misconception) always differs from the truth.
    // Misconception formula: what the printed name holds after n−1 swaps.
    id: "chal-swap-parity",
    topic: "state",
    focus: "000M", // swap-right-side-first, braided with for + range
    assumed: ["0005", "0006", "001E", "001F"],
    braids: ["001E", "001F"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["read-first", "read-second"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["read-first", "read-second"]);
        const p = int(rng, 1, 9);
        const q = 1 + ((p + int(rng, 0, 7)) % 9); // ≠ p by construction
        const n = int(rng, 2, 5);
        const even = n % 2 === 0;
        const [aEnd, bEnd] = even ? [p, q] : [q, p];
        const read = shape === "read-first" ? "a" : "b";
        const truth = shape === "read-first" ? aEnd : bEnd;
        const mis = shape === "read-first" ? bEnd : aEnd;
        return {
          code: `a = ${p}\nb = ${q}\nfor i in range(${n}):\n    a, b = b, a\nprint(${read})\n`,
          shape, variant: "plain",
          misconception: String(mis), // one swap short — the wrong parity
          variantCard: `Each pass swaps the PAIR in one step; ${n} swaps `
            + `${even ? "put both names back where they started" : "leave the pair flipped"} `
            + `— so \`${read}\` holds ${truth}, not ${mis}.`,
        };
      },
    },
  },

  {
    // Challenge: index-from-end braided with str-concat — the negative
    // index counts from the end of the JOINED text, i.e. from the second
    // word's tail. G1 regime: k ≤ 4 and k+1 ≤ len(w2) = 6, so both s[-k]
    // and s[-(k+1)] land inside w2, whose letters are all distinct
    // (distinctWords pool invariant) — the off-by-one wrong never equals
    // the truth. Misconception formula: s[-(k+1)] ("counting from the end
    // starts at zero", so -k is read as the (k+1)th char from the end).
    id: "chal-neg-index-concat",
    topic: "strings",
    focus: "0010", // index-from-end, braided with str-concat
    assumed: ["0005", "0006", "000E", "000Y"],
    braids: ["000Y"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["index-joined", "index-into-name"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["index-joined", "index-into-name"]);
        const i = int(rng, 0, distinctWords.length - 1);
        const j = (i + 1 + int(rng, 0, distinctWords.length - 2)) % distinctWords.length;
        const w1 = distinctWords[i], w2 = distinctWords[j];
        const k = int(rng, 1, 4);
        const s = w1 + w2;
        const truth = s[s.length - k];
        const off = s[s.length - k - 1];
        const card = `\`"${w1}" + "${w2}"\` is \`"${s}"\` first; \`[-${k}]\` counts from `
          + `the END starting at -1, landing on \`${truth}\` — a letter of the SECOND word.`;
        if (shape === "index-into-name") {
          return {
            code: `s = "${w1}" + "${w2}"\nt = s[-${k}]\nprint(t)\n`,
            shape, variant: "plain",
            misconception: off,
            variantCard: card,
          };
        }
        return {
          code: `s = "${w1}" + "${w2}"\nprint(s[-${k}])\n`,
          shape, variant: "plain",
          misconception: off,
          variantCard: card,
        };
      },
    },
  },

  {
    // Challenge: loop-accumulate braided with if-runs-or-skips + compare-ops
    // — only the passes whose test is true reach the accumulator. G1 regime:
    // at least one item on EACH side of the threshold and all items
    // positive, so the unfiltered sum (the misconception) always exceeds
    // the filtered truth. Misconception formula: sum of ALL items.
    id: "chal-filtered-total",
    topic: "loops",
    focus: "001J", // loop-accumulate, braided with if + comparison
    assumed: ["0005", "0006", "0008", "000A", "000B", "000D", "0015", "0017", "001E", "002K"],
    braids: ["0015", "0017", "002K"], // 002K: the rebind-under-if IS the composition (branch-picks-binding)
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["keep-big", "keep-small"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["keep-big", "keep-small"]);
        const t = int(rng, 4, 6);
        // Two items strictly below t, two strictly above: both branches run.
        const items = [int(rng, 1, t - 1), t + int(rng, 1, 3), int(rng, 1, t - 1), t + int(rng, 1, 3)];
        const op = shape === "keep-big" ? ">" : "<";
        const kept = items.filter((x) => (shape === "keep-big" ? x > t : x < t));
        const total = kept.reduce((x, y) => x + y, 0);
        const all = items.reduce((x, y) => x + y, 0);
        return {
          code: `total = 0\nfor x in [${items.join(", ")}]:\n    if x ${op} ${t}:\n        total = total + x\nprint(total)\n`,
          shape, variant: "plain",
          misconception: String(all), // accumulated every pass, ignoring the if
          variantCard: `Only the passes where \`x ${op} ${t}\` is true reach the `
            + `accumulator line: ${kept.join(" + ")} = ${total}. The other items are `
            + `visited but never added — the full-list ${all} is the wrong model.`,
        };
      },
    },
  },

  {
    // Challenge: str-repeat braided with a growing rebind over range(1, n)
    // — each pass glues a LONGER run on, so the result is the triangular
    // total, not one run. G1 regime: n ∈ {3, 4} gives 1+2+…+(n−1) ∈ {3, 6}
    // glyphs, always more than the last pass's n−1 ∈ {2, 3}. Misconception
    // formula: glyph × (n−1) — only the final pass's run.
    id: "chal-star-triangle",
    topic: "strings",
    focus: "000Z", // str-repeat, braided with a growing rebind over range(1, n)
    // NOTE: the analyzer tags string accumulation as a plain rebind (000A) —
    // accumulate-rebind (000B) is numeric-only — and `s + "…" * i` mixes
    // precedence (000N); range(1, n) charges 001G. Braids adjusted to what
    // the footprint really charges.
    assumed: ["0005", "0006", "000A", "000N", "000Y", "001E", "001F", "001G"],
    braids: ["000A", "000N", "001E", "001F", "001G"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["append-run", "prepend-run"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["append-run", "prepend-run"]);
        const g = pick(rng, ["*", "#", "+"]);
        const n = int(rng, 3, 4);
        const count = (n * (n - 1)) / 2; // 1 + 2 + … + (n−1)
        const step = shape === "append-run" ? `s = s + "${g}" * i` : `s = "${g}" * i + s`;
        return {
          code: `s = ""\nfor i in range(1, ${n}):\n    ${step}\nprint(s)\n`,
          shape, variant: "plain",
          misconception: g.repeat(n - 1), // only the LAST pass's run
          variantCard: `\`i\` runs ${Array.from({ length: n - 1 }, (_, x) => x + 1).join(", ")} — each pass glues \`"${g}" * i\` onto the `
            + `${shape === "append-run" ? "end" : "front"}, and the earlier runs STAY. `
            + `\`s\` ends ${count} glyphs long: \`${g.repeat(count)}\`.`,
        };
      },
    },
  },

  {
    // Challenge: in-checks-membership braided with append-mutates — the
    // verdict is taken AFTER the append changed the list. G1 regime:
    // hit-by-append probes exactly the appended value (True only because of
    // the append); miss-outright probes v+1 ≤ 16, never among the ≤9
    // starters or v — so each shape's designed wrong (the opposite verdict)
    // never equals the truth. Misconception formula: hit → "False" (the
    // pre-append list decides); miss → "True" (close-enough eyeballing).
    id: "chal-in-after-append",
    topic: "lists",
    focus: "002M", // in-checks-membership, braided with append-mutates
    assumed: ["0005", "0006", "000D", "000G", "0016"],
    braids: ["000G"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["hit-by-append", "miss-outright"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["hit-by-append", "miss-outright"]);
        const name = pick(rng, listNames);
        const n1 = int(rng, 1, 9);
        const n2 = 1 + ((n1 + int(rng, 0, 7)) % 9); // ≠ n1 by construction
        const v = int(rng, 10, 15);
        const probe = shape === "hit-by-append" ? v : v + 1;
        const truth = shape === "hit-by-append" ? "True" : "False";
        return {
          code: `${name} = [${n1}, ${n2}]\n${name}.append(${v})\nprint(${probe} in ${name})\n`,
          shape, variant: "plain",
          misconception: shape === "hit-by-append" ? "False" : "True",
          variantCard: `By the time \`in\` looks, \`${name}\` is [${n1}, ${n2}, ${v}] — the `
            + `append already happened. ${probe} is ${truth === "True" ? `there (the append put it there)` : `on NO line of it — near ${v} is not in it`}, `
            + `so the check prints ${truth}.`,
        };
      },
    },
  },

  {
    // Challenge: call-in-expression braided with loop-accumulate — the call
    // sits inside the accumulator expression and runs EVERY pass. G1
    // regime: n ≥ 2 and v ≥ 2, so the truth n·v (or (n+1)·v seeded) never
    // equals v. Misconception formula: String(v) — "the function ran once".
    id: "chal-call-total",
    topic: "functions",
    focus: "002G", // call-in-expression, braided with loop-accumulate
    assumed: ["0005", "0006", "0008", "0009", "000A", "000B", "001E", "001F", "001J", "0027", "0028", "002A"],
    braids: ["000B", "001E", "001F", "001J"],
    role: "challenge",
    form: "predict-exact-output",
    generator: {
      shapes: ["sum-of-calls", "seeded-by-call"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["sum-of-calls", "seeded-by-call"]);
        const v = int(rng, 2, 9);
        const n = int(rng, 2, 4);
        const calls = shape === "sum-of-calls" ? n : n + 1;
        const startLine = shape === "sum-of-calls" ? "total = 0" : "total = f()";
        return {
          code: `def f():\n    return ${v}\n${startLine}\nfor i in range(${n}):\n    total = total + f()\nprint(total)\n`,
          shape, variant: "plain",
          misconception: String(v), // "the function only really ran once"
          variantCard: `\`f()\` runs every time the expression needs it — `
            + `${calls} calls in all${shape === "seeded-by-call" ? " (one to seed \`total\`, then one per pass)" : ""}, `
            + `each handing back ${v}: \`total\` ends ${calls} × ${v} = ${calls * v}.`,
        };
      },
    },
  },

  {
    // Challenge: input-pauses-for-value braided with int-of-str + arith —
    // the typed digits become a NUMBER, so the print does arithmetic, not
    // gluing. G1 regime: d ≥ 2, so d+k ≠ 10·d+k (the two-digit concat) and
    // 2·d ≠ 11·d — the pasted-text transcript never equals the truth.
    // Misconception formula: the same transcript with the digits CONCATENATED
    // (`${d}${k}` / `${d}${d}`) in place of the sum.
    id: "chal-input-number",
    topic: "state",
    focus: "0026", // input-pauses-for-value, braided with int-of-str + arith
    assumed: ["0005", "0006", "0008", "0009", "000V"],
    braids: ["0008", "0009", "000V"],
    role: "challenge",
    form: "predict-io",
    multiline: true, // the transcript IS the answer
    generator: {
      shapes: ["plus-constant", "plus-itself"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["plus-constant", "plus-itself"]);
        const prompt = pick(rng, ["How many? ", "Pick a number: ", "Count? ", "Give a number: "]);
        const d = int(rng, 2, 9);
        const k = int(rng, 2, 9); // drawn on every shape (G7 budget discipline)
        const typed = String(d);
        const expr = shape === "plus-constant" ? `n + ${k}` : "n + n";
        const truth = shape === "plus-constant" ? d + k : d + d;
        const glued = shape === "plus-constant" ? `${typed}${k}` : `${typed}${typed}`;
        return {
          code: `n = int(input(${JSON.stringify(prompt)}))\nprint(${expr})\n`,
          shape, variant: "plain",
          stdinScript: [typed],
          misconception: `${prompt}${typed}\n${glued}`, // treated the digits as text and glued them
          variantCard: `\`input\` hands back the TEXT \`${typed}\`; \`int(...)\` turns it into `
            + `the number ${d} before \`n\` is bound. So \`${expr}\` is arithmetic — `
            + `${truth} — not the glued text \`${glued}\`.`,
        };
      },
    },
  },
];
