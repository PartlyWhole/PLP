// Zero-dependency static dev server for the PLP site (copied from the
// Engine Pilot reference repo).
//
// Serves this repository under a simulated GitHub Pages *project* path
// (default /PLP/) so root-absolute path bugs surface locally exactly as
// they would on partlywhole.github.io/PLP/. GitHub Pages sends no
// COOP/COEP headers (the site relies on coi-serviceworker.js); pass --coi
// to send real headers instead, which is what the smoke suite's
// deterministic variant uses.
//
//   node tools/dev-server.mjs [--coi] [--port N] [--prefix name]
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const COI = args.includes("--coi");
const PORT = Number(argValue("--port", 8619));
const PREFIX = "/" + String(argValue("--prefix", "PLP")).replace(/\//g, "") + "/";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".py": "text/x-python",
  ".wasm": "application/wasm",
  ".whl": "application/octet-stream",
  ".zip": "application/zip",
  ".png": "image/png",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".jpg": "image/jpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (url === "/" || url === PREFIX.slice(0, -1)) {
    res.writeHead(302, { location: PREFIX }).end();
    return;
  }
  if (!url.startsWith(PREFIX)) {
    res.writeHead(404).end("outside site prefix " + PREFIX);
    return;
  }
  let rel = normalize(url.slice(PREFIX.length)).replace(/^([/\\]|\.\.)+/, "");
  if (rel === "" || rel === "." || rel.endsWith("/")) rel = rel.replace(/\.?$/, "") + "index.html";
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found: " + rel);
    return;
  }
  const headers = {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  };
  if (COI) {
    headers["Cross-Origin-Opener-Policy"] = "same-origin";
    headers["Cross-Origin-Embedder-Policy"] = "require-corp";
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`plp dev server: http://127.0.0.1:${PORT}${PREFIX} (coi headers: ${COI})`);
});
