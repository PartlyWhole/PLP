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
import { names, listNames, aliasPair } from "../pools.mjs";

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
];
