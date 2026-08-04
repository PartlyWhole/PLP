// Dicts & tuples intro exercises (design §3.8).

import { mulberry32, int, pick } from "../rng.mjs";
import { dictKeys } from "../pools.mjs";
import { orderPair } from "../contrast.mjs";

const twoKeys = (rng) => {
  const i = int(rng, 0, dictKeys.length - 1);
  const j = (i + 1 + int(rng, 0, dictKeys.length - 2)) % dictKeys.length;
  return [dictKeys[i], dictKeys[j]];
};

export default [
  {
    id: "dict-lookup",
    topic: "structures",
    focus: "001R", // dict-lookup-by-key
    assumed: ["0005", "0006", "0007", "000E"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["one-pair", "two-pair-first", "two-pair-second"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["one-pair", "two-pair-first", "two-pair-second"]);
        const [k1, k2] = twoKeys(rng);
        const v1 = int(rng, 1, 9), v2 = int(rng, 1, 9);
        if (shape === "one-pair") return { code: `d = {"${k1}": ${v1}}\nprint(d["${k1}"])\n`, shape, variant: "plain" };
        const lookup = shape === "two-pair-first" ? k1 : k2;
        return { code: `d = {"${k1}": ${v1}, "${k2}": ${v2}}\nprint(d["${lookup}"])\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "dict-store",
    topic: "structures",
    focus: "001S", // dict-key-assign
    assumed: ["0005", "0006", "001R"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["add-new", "replace", "two-stores"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["add-new", "replace", "two-stores"]);
        if (shape === "two-stores") {
          const [k1, k2] = twoKeys(rng);
          const v1 = int(rng, 1, 9), v2 = int(rng, 10, 20), v3 = int(rng, 21, 30);
          return {
            code: `d = {"${k1}": ${v1}}\nd["${k2}"] = ${v2}\nd["${k1}"] = ${v3}\nprint(d)\n`,
            shape, variant: "plain",
            variantCard: `The first store adds \`"${k2}"\`; the second replaces \`"${k1}"\`'s value with ${v3}.`,
          };
        }
        const [k1, k2] = twoKeys(rng);
        const v1 = int(rng, 1, 9), v2 = int(rng, 10, 20);
        const key = shape === "add-new" ? k2 : k1;
        return {
          code: `d = {"${k1}": ${v1}}\nd["${key}"] = ${v2}\nprint(d)\n`,
          shape, variant: "plain",
          variantCard: shape === "add-new"
            ? `\`"${key}"\` is new, so it is added: \`{'${k1}': ${v1}, '${key}': ${v2}}\`.`
            : `\`"${key}"\` already exists, so its value is replaced: \`{'${k1}': ${v2}}\`.`,
        };
      },
    },
  },

  {
    id: "dict-get",
    topic: "structures",
    focus: "001T", // dict-get-default
    assumed: ["0005", "0006", "001R"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["missing-key", "present-key", "assign-get"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["missing-key", "present-key", "assign-get"]);
        if (shape === "assign-get") {
          const [k1, k2] = twoKeys(rng);
          const v1 = int(rng, 1, 9), alt = int(rng, 10, 20);
          return {
            code: `d = {"${k1}": ${v1}}\nv = d.get("${k2}", ${alt})\nprint(v)\n`,
            shape, variant: "plain",
            variantCard: `\`"${k2}"\` is missing, so \`get\` hands back the default ${alt}, stored in \`v\`.`,
          };
        }
        const [k1, k2] = twoKeys(rng);
        const v1 = int(rng, 1, 9), alt = int(rng, 10, 20);
        const key = shape === "present-key" ? k1 : k2;
        return {
          code: `d = {"${k1}": ${v1}}\nprint(d.get("${key}", ${alt}))\n`,
          shape, variant: "plain",
          variantCard: shape === "present-key"
            ? `\`"${key}"\` is present, so \`get\` returns its value ${v1}, not the default.`
            : `\`"${key}"\` is missing, so \`get\` returns the default ${alt}.`,
        };
      },
    },
  },

  {
    id: "in-checks-keys",
    topic: "structures",
    focus: "001V", // in-dict-checks-keys
    assumed: ["0005", "0006", "0016", "001R"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["key-present", "key-absent", "value-not-key"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["key-present", "key-absent", "value-not-key"]);
        const [k1, k2] = twoKeys(rng);
        const v1 = int(rng, 1, 9);
        if (shape === "key-present") return { code: `d = {"${k1}": ${v1}}\nprint("${k1}" in d)\n`, shape, variant: "plain" };
        if (shape === "key-absent") return { code: `d = {"${k1}": ${v1}}\nprint("${k2}" in d)\n`, shape, variant: "plain" };
        return {
          code: `d = {"${k1}": ${v1}}\nprint(${v1} in d)\n`,
          shape, variant: "plain",
          variantCard: `\`${v1}\` is a value, not a key, so \`in\` does not find it: \`False\`.`,
        };
      },
    },
  },

  {
    id: "tuple-pack",
    topic: "structures",
    focus: "001W", // tuple-pack-print
    assumed: ["0005", "0006"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["two-items", "three-items", "direct-print"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["two-items", "three-items", "direct-print"]);
        const a = int(rng, 1, 9), b = int(rng, 1, 9), c = int(rng, 1, 9);
        if (shape === "two-items") return { code: `t = (${a}, ${b})\nprint(t)\n`, shape, variant: "plain" };
        if (shape === "three-items") return { code: `t = (${a}, ${b}, ${c})\nprint(t)\n`, shape, variant: "plain" };
        return { code: `print((${a}, ${b}))\n`, shape, variant: "plain" };
      },
    },
  },

  {
    id: "tuple-spread",
    topic: "structures",
    focus: "001X", // tuple-unpack
    assumed: ["0005", "0006", "001W"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["print-first", "print-second", "unpack-three"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["print-first", "print-second", "unpack-three"]);
        if (shape === "unpack-three") {
          const a = int(rng, 1, 9), b = int(rng, 10, 20), c = int(rng, 21, 30);
          const read = pick(rng, ["x", "y", "z"]);
          const val = read === "x" ? a : read === "y" ? b : c;
          return {
            code: `x, y, z = (${a}, ${b}, ${c})\nprint(${read})\n`,
            shape, variant: "plain",
            variantCard: `Three items spread into three names in order; \`${read}\` gets ${val}.`,
          };
        }
        const a = int(rng, 1, 9), b = int(rng, 10, 20);
        const read = shape === "print-first" ? "x" : "y";
        return {
          code: `x, y = (${a}, ${b})\nprint(${read})\n`,
          shape, variant: "plain",
          variantCard: `\`x\` gets the first item (${a}), \`y\` the second (${b}). This prints ${read === "x" ? a : b}.`,
        };
      },
    },
  },

  {
    id: "tuple-comma",
    topic: "structures",
    focus: "001Y", // tuple-by-comma
    assumed: ["0005", "0006", "001W"],
    role: "intro",
    form: "predict-exact-output",
    generator: {
      shapes: ["trailing-comma"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const a = int(rng, 1, 9);
        return {
          code: `x = ${a},\nprint(x)\n`,
          shape: "trailing-comma", variant: "plain",
          variantCard: `The trailing comma makes \`x\` a one-item tuple, so it prints as \`(${a},)\`.`,
        };
      },
    },
  },

  // --- order-matters variation (design §5, order discipline) ------------

  {
    id: "store-order",
    topic: "structures",
    focus: "001S", // dict-key-assign — the last store to a key wins
    assumed: ["0005", "0006", "001R"],
    role: "review",
    form: "spot-the-difference",
    generator: {
      shapes: ["swap-stores", "read-between"],
      variants: ["plain"],
      generate(seed) {
        const rng = mulberry32(seed);
        const shape = pick(rng, ["swap-stores", "read-between"]);
        const k = pick(rng, dictKeys);
        const i0 = int(rng, 1, 9);
        const v1 = int(rng, 10, 40);
        const v2 = v1 + int(rng, 1, 20); // v2 ≠ v1
        if (shape === "read-between") {
          const { code, contrastCode } = orderPair(
            [`d = {"${k}": ${i0}}`, `d["${k}"] = ${v1}`, `print(d)`, `d["${k}"] = ${v2}`], 2, 3);
          return {
            code, aOutput: `{'${k}': ${v1}}`, contrastCode,
            shape, variant: "plain",
            variantCard: `Only \`print(d)\` moved. Read between the two stores and \`"${k}"\` maps to ${v1}; `
              + `read after both and it maps to ${v2} — the last store to a key wins.`,
          };
        }
        const { code, contrastCode } = orderPair(
          [`d = {"${k}": ${i0}}`, `d["${k}"] = ${v1}`, `d["${k}"] = ${v2}`, `print(d)`], 1, 2);
        return {
          code, aOutput: `{'${k}': ${v2}}`, contrastCode,
          shape, variant: "plain",
          variantCard: `Both lines store under \`"${k}"\`; the SECOND wins. As written \`"${k}"\` ends at ${v2}; `
            + `swap the two stores and it ends at ${v1}.`,
        };
      },
    },
  },
];
