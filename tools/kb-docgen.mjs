// Node CLI wrapper for the KB reference generator (design §8). Executes each
// recorded sample through the SYSTEM python3 and renders the markdown via the
// pure kb/docgen.mjs. The authoritative regeneration path in CI is the
// `K-doc` fidelity test (real Pyodide); this CLI is a local convenience that
// produces the identical bytes (Pyodide is CPython, so outputs match for the
// closed subset).
//
//   node tools/kb-docgen.mjs           # print the reference to stdout
//   node tools/kb-docgen.mjs --write   # write curriculum/KB-REFERENCE.md
//   node tools/kb-docgen.mjs --check   # exit 1 if the committed file has drifted
//
// python3 must be on PATH.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadKB } from "../kb/index.mjs";
import { docSamples, renderReference } from "../kb/docgen.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const REF_PATH = new URL("../curriculum/KB-REFERENCE.md", import.meta.url);

function runPython(code) {
  try {
    return execFileSync("python3", ["-c", code], { encoding: "utf8", cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`python3 failed on sample:\n${code}\n${e.stderr ?? e.message}`);
  }
}

function generate() {
  const kb = loadKB();
  const waivers = JSON.parse(readFileSync(new URL("../kb/waivers.json", import.meta.url), "utf8"));
  const outputs = {};
  for (const { key, run } of docSamples(kb)) outputs[key] = runPython(run);
  return renderReference(kb, outputs, waivers);
}

const mode = process.argv[2];
const md = generate();
if (mode === "--write") {
  writeFileSync(REF_PATH, md);
  console.error(`wrote ${fileURLToPath(REF_PATH)}`);
} else if (mode === "--check") {
  let committed = "";
  try { committed = readFileSync(REF_PATH, "utf8"); } catch { /* missing */ }
  if (committed !== md) {
    console.error("KB-REFERENCE.md is out of date — run `node tools/kb-docgen.mjs --write`.");
    process.exit(1);
  }
  console.error("KB-REFERENCE.md is up to date.");
} else {
  process.stdout.write(md);
}
