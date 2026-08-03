import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

export const TAG_RE = /^[0-9A-HJKMNP-TV-Z]{4}$/; // Crockford base-32, no I L O U

export function checkLedger(before, after) {
  const violations = [];

  // Rule 1: input shape.
  if (!Array.isArray(before)) {
    return ["ledger: base is not a JSON array"];
  }
  if (!Array.isArray(after)) {
    return ["ledger: working copy is not a JSON array"];
  }

  // Rule 2: strict prefix, length.
  if (after.length < before.length) {
    for (let i = after.length; i < before.length; i++) {
      violations.push(`entry removed: ${before[i].tag} (${before[i].slug})`);
    }
  }

  // Rule 3: per-entry checks over the shared prefix.
  const shared = Math.min(before.length, after.length);
  const afterTags = new Set(after.map((e) => e.tag));
  for (let i = 0; i < shared; i++) {
    const b = before[i];
    const a = after[i];

    if (a.tag !== b.tag) {
      violations.push(`tag changed at index ${i}: ${b.tag} → ${a.tag}`);
      continue; // downstream checks would be noise
    }

    if (a.kind !== b.kind) {
      violations.push(`kind changed on ${a.tag}: ${b.kind} → ${a.kind}`);
    }

    if (JSON.stringify(a.parents) !== JSON.stringify(b.parents)) {
      violations.push(
        `parents changed on ${a.tag}: ${JSON.stringify(b.parents)} → ${JSON.stringify(a.parents)}`,
      );
    }

    // Slug changes are legal.

    if (a.status === b.status) {
      if (
        b.status !== "active" &&
        JSON.stringify(a.successors ?? null) !== JSON.stringify(b.successors ?? null)
      ) {
        violations.push(`successors changed on ${a.tag}`);
      }
    } else {
      const legal =
        b.status === "active" && (a.status === "split" || a.status === "merged-into");
      if (!legal) {
        violations.push(
          `illegal status change on ${a.tag}: ${b.status} → ${a.status}`,
        );
      } else {
        if (!(Array.isArray(a.successors) && a.successors.length > 0)) {
          violations.push(`status change on ${a.tag} lacks successors`);
        } else {
          for (const s of a.successors) {
            if (!afterTags.has(s)) {
              violations.push(`successor ${s} of ${a.tag} not in ledger`);
            }
          }
        }
      }
    }
  }

  // Rule 4: new entries.
  for (let i = before.length; i < after.length; i++) {
    const a = after[i];
    if (!TAG_RE.test(a.tag)) {
      violations.push(`new tag ${a.tag} is not 4-char Crockford base-32`);
    }
    let dupCount = 0;
    for (let j = 0; j < after.length; j++) {
      if (j !== i && after[j].tag === a.tag) dupCount++;
    }
    if (dupCount > 0) {
      violations.push(`duplicate tag ${a.tag}`);
    }
    if (a.status !== "active") {
      violations.push(`new entry ${a.tag} must start active`);
    }
    for (const p of a.parents) {
      if (!afterTags.has(p)) {
        violations.push(`new entry ${a.tag} parent ${p} unknown`);
      }
    }
  }

  return violations;
}

const isMain =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  const ref = process.argv[2];
  const path = process.argv[3] || "kb/tags.ledger.json";

  if (!ref) {
    process.stderr.write("usage: node tools/check-ledger.mjs <base-ref> [ledger-path]\n");
    process.exit(2);
  }

  let baseText;
  try {
    baseText = execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" });
  } catch {
    process.stderr.write(`note: ledger missing at ${ref}; treating base as empty\n`);
    baseText = "[]";
  }

  let workingText;
  try {
    workingText = readFileSync(path, "utf8");
  } catch (err) {
    process.stderr.write(`error: cannot parse working copy: ${err.message}\n`);
    process.exit(2);
  }

  let before, after;
  try {
    before = JSON.parse(baseText);
  } catch (err) {
    process.stderr.write(`error: cannot parse base: ${err.message}\n`);
    process.exit(2);
  }
  try {
    after = JSON.parse(workingText);
  } catch (err) {
    process.stderr.write(`error: cannot parse working copy: ${err.message}\n`);
    process.exit(2);
  }

  const violations = checkLedger(before, after);
  if (violations.length > 0) {
    for (const v of violations) process.stderr.write(v + "\n");
    process.exit(1);
  }
  process.stdout.write(
    `ledger OK (${after.length} entries, ${after.length - before.length} new)\n`,
  );
  process.exit(0);
}
