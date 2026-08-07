// Parsons exercises (expansion ladder §R2): the `order-the-lines` form.
// The generator emits the CANONICAL line list plus the output that order
// produces; it never shuffles — the deal is drawn at compile time from the
// round's rng (app/kb-session.mjs), so a reload, a review and a retry all
// rebuild the same puzzle. An element of `lines` may itself contain "\n":
// such a compound block (a `for` header with its body) moves as ONE unit,
// because splitting a suite would make the puzzle about indentation
// instead of about order.
//
// Discrimination (E6) is by construction: every wrong arrangement either
// raises (a name read before it is bound → the run never completes) or
// prints something other than the target. Grading executes the learner's
// arrangement, so ANY order that really prints the target is right.

import { mulberry32, int, pick } from "../rng.mjs";
import { names, listNames, aliasPair, words, dictKeys } from "../pools.mjs";

export default [
  {
    id: "order-copy-timing",
    topic: "state",
    focus: "000C", // name-from-name — the copy takes the value a holds NOW
    assumed: ["0005", "0006", "000A"],
    role: "review",
    form: "order-the-lines",
    generator: {
      shapes: ["copy-then-rebind"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const [a, b] = aliasPair;
        const p = int(rng, 2, 9);
        const q = p + int(rng, 1, 9); // the later value always differs
        return {
          lines: [`${a} = ${p}`, `${b} = ${a}`, `${a} = ${q}`, `print(${b})`],
          targetOutput: String(p),
          shape: "copy-then-rebind", variant: "plain",
          variantCard: `\`${b} = ${a}\` has to happen while \`${a}\` still holds ${p} — `
            + `it copies the value, not the name. Rebinding \`${a}\` to ${q} afterwards `
            + `leaves \`${b}\` at ${p}.`,
        };
      },
    },
  },

  {
    id: "order-rebind-last-wins",
    topic: "state",
    focus: "000A", // rebind-updates-name — the last bind before the read wins
    assumed: ["0005", "0006"],
    role: "review",
    form: "order-the-lines",
    generator: {
      shapes: ["two-binds-one-read"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const n = pick(rng, names);
        const first = int(rng, 2, 9);
        const last = first + int(rng, 1, 9);
        return {
          lines: [`${n} = ${first}`, `${n} = ${last}`, `print(${n})`],
          targetOutput: String(last),
          shape: "two-binds-one-read", variant: "plain",
          variantCard: `A second \`${n} = …\` replaces the first: to print ${last}, `
            + `\`${n} = ${last}\` has to be the last bind before the print. `
            + `The other way round it prints ${first}.`,
        };
      },
    },
  },

  {
    id: "order-noncommutative-steps",
    topic: "state",
    focus: "000B", // accumulate-rebind — each step reads what the last one left
    assumed: ["0005", "0006", "0008", "0009", "000A"],
    role: "review",
    form: "order-the-lines",
    generator: {
      shapes: ["subtract-then-multiply"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const n = pick(rng, names);
        // x ≥ 1 and y ≥ 2 make the two steps non-commutative on EVERY seed:
        // (v - x)·y ≠ v·y - x whenever x·(y - 1) ≠ 0 (E6 by construction).
        const x = int(rng, 1, 5);
        const v = x + int(rng, 2, 9); // the intermediate stays positive
        const y = int(rng, 2, 4);
        return {
          lines: [`${n} = ${v}`, `${n} = ${n} - ${x}`, `${n} = ${n} * ${y}`, `print(${n})`],
          targetOutput: String((v - x) * y),
          shape: "subtract-then-multiply", variant: "plain",
          variantCard: `Each step reads what the previous one left: ${v} − ${x} = ${v - x}, `
            + `then ${v - x} × ${y} = ${(v - x) * y}. Multiplying first would give `
            + `${v * y} − ${x} = ${v * y - x} instead.`,
        };
      },
    },
  },

  {
    id: "order-loop-total",
    topic: "loops",
    focus: "001J", // loop-accumulate — the total starts before the loop, reads after
    assumed: ["0005", "0006", "0008", "0009", "000A", "000B", "000D", "001E"],
    role: "review",
    form: "order-the-lines",
    generator: {
      shapes: ["total-before-loop"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const items = Array.from({ length: 3 }, () => int(rng, 1, 6));
        const total = items.reduce((a, b) => a + b, 0);
        return {
          // The for header and its body move as ONE unit: the suite is not
          // what the puzzle is about.
          lines: [
            "total = 0",
            `for x in [${items.join(", ")}]:\n    total = total + x`,
            "print(total)",
          ],
          targetOutput: String(total),
          shape: "total-before-loop", variant: "plain",
          variantCard: `The total has to exist before the first pass and is only finished `
            + `after the last one: 0 + ${items.join(" + ")} = ${total}.`,
        };
      },
    },
  },

  {
    id: "order-append-then-print",
    topic: "lists",
    focus: "000G", // append-mutates — the list must exist, and appends land in order
    assumed: ["0005", "0006", "000D"],
    role: "review",
    form: "order-the-lines",
    generator: {
      shapes: ["empty-then-appends"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const name = pick(rng, listNames);
        const u = int(rng, 10, 49);
        const w = u + int(rng, 1, 40); // the two appends are never interchangeable
        return {
          lines: [`${name} = []`, `${name}.append(${u})`, `${name}.append(${w})`, `print(${name})`],
          targetOutput: `[${u}, ${w}]`,
          shape: "empty-then-appends", variant: "plain",
          variantCard: `\`${name}\` has to exist before anything can be appended to it, `
            + `and each append lands at the end — so ${u} first, then ${w}: [${u}, ${w}].`,
        };
      },
    },
  },
  {
    // Review Parsons on the very first concept: three prints, three DISTINCT
    // words — top-to-bottom order IS the transcript. Order-the-lines takes no
    // misconception (form-exempt); the wrong path is any other arrangement.
    // G1 regime: the three words are distinct by construction (filtered
    // draws, G3), so each of the 6 arrangements prints a DIFFERENT
    // three-line transcript — only the canonical deal matches (E6).
    id: "order-prints",
    topic: "state",
    focus: "0005", // print-text — prints land in program order, one line each
    assumed: [], // only structural ancestors (0001, 0004) — never listed
    role: "review",
    form: "order-the-lines",
    multiline: true, // the three-line transcript IS the concept (E4)
    generator: {
      shapes: ["three-prints"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        // Three distinct words, distinct-by-construction (G3): each later
        // draw picks from the pool with the earlier words filtered out.
        const w1 = words[int(rng, 0, words.length - 1)];
        const rest = words.filter((w) => w !== w1);
        const w2 = rest[int(rng, 0, rest.length - 1)];
        const rest2 = rest.filter((w) => w !== w2);
        const w3 = rest2[int(rng, 0, rest2.length - 1)];
        return {
          lines: [`print("${w1}")`, `print("${w2}")`, `print("${w3}")`],
          targetOutput: `${w1}\n${w2}\n${w3}`,
          shape: "three-prints", variant: "plain",
          variantCard: `Each \`print\` writes its own line, and the lines run top to `
            + `bottom — so the transcript reads ${w1}, then ${w2}, then ${w3}. `
            + `Any other arrangement prints the same words in a different order.`,
        };
      },
    },
  },

  {
    // Review Parsons: build a list literal that READS a name. No
    // misconception (order-the-lines is form-exempt).
    // G1 regime: line 2 reads the name line 1 binds, and line 3 reads the
    // name line 2 binds — every one of the 5 non-canonical arrangements puts
    // a read before its bind and raises NameError, so only the canonical
    // order completes (E6 by construction; all 6 permutations verified by
    // real execution).
    id: "order-make-list",
    topic: "lists",
    focus: "000D", // list-literal — the literal freezes the name's current value
    assumed: ["0005", "0006"],
    role: "review",
    form: "order-the-lines",
    generator: {
      shapes: ["bind-build-print"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const n = pick(rng, names);
        const xs = pick(rng, listNames); // pools never shadow: names ∩ listNames = ∅
        const v = int(rng, 2, 9);
        const w = v + int(rng, 1, 9); // offset draw — the two items always differ (G3)
        return {
          lines: [`${n} = ${v}`, `${xs} = [${n}, ${w}]`, `print(${xs})`],
          targetOutput: `[${v}, ${w}]`,
          shape: "bind-build-print", variant: "plain",
          variantCard: `\`${xs} = [${n}, ${w}]\` reads \`${n}\`, so \`${n} = ${v}\` has to `
            + `run first — the literal freezes ${v} into the list. And \`${xs}\` must exist `
            + `before \`print(${xs})\` can read it: \`[${v}, ${w}]\`.`,
        };
      },
    },
  },

  {
    // Review Parsons: pack a tuple from a name, then print it. No
    // misconception (order-the-lines is form-exempt).
    // G1 regime: identical dependency chain to order-make-list — line 2
    // reads line 1's name, line 3 reads line 2's — so all 5 non-canonical
    // arrangements raise NameError and only the canonical order completes
    // (E6 by construction; all 6 permutations verified by real execution).
    id: "order-pack-tuple",
    topic: "structures",
    focus: "001W", // tuple-pack-print — the pack happens, then the print shows brackets
    assumed: ["0005", "0006"],
    role: "review",
    form: "order-the-lines",
    generator: {
      shapes: ["bind-pack-print"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = pick(rng, names);
        const v = int(rng, 1, 9);
        const w = v + int(rng, 1, 9); // offset draw — the two items always differ (G3)
        return {
          lines: [`${a} = ${v}`, `t = (${a}, ${w})`, `print(t)`],
          targetOutput: `(${v}, ${w})`,
          shape: "bind-pack-print", variant: "plain",
          variantCard: `\`t = (${a}, ${w})\` reads \`${a}\`, so \`${a} = ${v}\` has to run `
            + `first — the pack freezes ${v} into the tuple. \`print(t)\` needs \`t\` to `
            + `exist, and shows it in round brackets: \`(${v}, ${w})\`.`,
        };
      },
    },
  },

  {
    // Review Parsons: create the dict, store under a NEW key, read that key
    // back. No misconception (order-the-lines is form-exempt).
    // G1 regime: line 2 stores into the dict line 1 creates, and line 3
    // reads the key ONLY line 2 stores — every one of the 5 non-canonical
    // arrangements either reads `d` before it exists (NameError) or looks
    // up the second key before its store lands (KeyError), so only the
    // canonical order completes (E6 by construction; all 6 permutations
    // verified by real execution).
    id: "order-store-read",
    topic: "structures",
    focus: "001S", // dict-key-assign — the store must land before the read
    assumed: ["0005", "0006", "001R"],
    role: "review",
    form: "order-the-lines",
    generator: {
      shapes: ["create-store-read"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        // Two distinct keys, distinct-by-construction (G3): offset draw.
        const i = int(rng, 0, dictKeys.length - 1);
        const j = (i + 1 + int(rng, 0, dictKeys.length - 2)) % dictKeys.length;
        const k1 = dictKeys[i], k2 = dictKeys[j];
        const v = int(rng, 1, 9);
        const w = int(rng, 10, 40); // disjoint ranges — the read never shows the literal value
        return {
          lines: [`d = {"${k1}": ${v}}`, `d["${k2}"] = ${w}`, `print(d["${k2}"])`],
          targetOutput: String(w),
          shape: "create-store-read", variant: "plain",
          variantCard: `\`d["${k2}"] = ${w}\` needs \`d\` to exist, and \`print(d["${k2}"])\` `
            + `needs the key \`"${k2}"\` already stored — any other order raises. Create, `
            + `store, then read: ${w}.`,
        };
      },
    },
  },

  {
    // Review Parsons: bind the counter, run the while-loop, then the
    // after-line. No misconception (order-the-lines is form-exempt). The
    // while header and its body move as ONE unit; multiline because the
    // countdown transcript IS the concept (E4).
    // G1 regime: n0 = s·(p − 1) + r with r ∈ 1..s gives exactly p ∈ {2, 3}
    // passes, so the loop always prints ≥2 lines. Any arrangement that puts
    // the while before `n = n0` raises NameError; the two that only move
    // `print("done")` earlier print "done" BEFORE the countdown instead of
    // after it — a reordered transcript. Only the canonical order matches
    // (E6 by construction; all 6 permutations verified by real execution).
    id: "order-while-setup",
    topic: "loops",
    focus: "001M", // while-repeats-while-true — setup, loop, then the after-line
    assumed: ["0005", "0006", "0008", "000A", "000B", "0015"],
    role: "review",
    form: "order-the-lines",
    multiline: true,
    generator: {
      shapes: ["setup-loop-after"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const s = int(rng, 2, 3);                 // step down per pass
        const p = int(rng, 2, 3);                 // exactly 2–3 passes
        const n0 = s * (p - 1) + int(rng, 1, s);  // s·(p−1) < n0 ≤ s·p
        const seq = [];
        for (let n = n0; n > 0; n -= s) seq.push(n);
        return {
          lines: [
            `n = ${n0}`,
            `while n > 0:\n    print(n)\n    n = n - ${s}`,
            `print("done")`,
          ],
          targetOutput: `${seq.join("\n")}\ndone`,
          shape: "setup-loop-after", variant: "plain",
          variantCard: `The while-test reads \`n\`, so \`n = ${n0}\` has to run first. The `
            + `loop prints ${seq.join(", ")} while \`n > 0\` holds, and \`done\` can only `
            + `appear after the loop has finished — never before it.`,
        };
      },
    },
  },

];
