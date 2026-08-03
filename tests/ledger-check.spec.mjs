import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkLedger } from "../tools/check-ledger.mjs";

const base = [
  { tag: "0001", slug: "root-a", kind: "structural", parents: [], status: "active" },
  { tag: "0005", slug: "leaf-b", kind: "core", parents: ["0001"], status: "active" },
];

test("LC-1 legal append", () => {
  const after = structuredClone(base);
  after.push({ tag: "0006", slug: "new-c", kind: "core", parents: ["0005"], status: "active" });
  expect(checkLedger(base, after)).toEqual([]);
});

test("LC-2 illegal deletion", () => {
  const after = structuredClone(base).slice(0, 1);
  expect(checkLedger(base, after)).toEqual(["entry removed: 0005 (leaf-b)"]);
});

test("LC-3 illegal tag edit", () => {
  const after = structuredClone(base);
  after[1].tag = "0007";
  expect(checkLedger(base, after)).toEqual(["tag changed at index 1: 0005 → 0007"]);
});

test("LC-4 illegal parent edit", () => {
  const after = structuredClone(base);
  after[1].parents = [];
  expect(checkLedger(base, after)).toEqual(['parents changed on 0005: ["0001"] → []']);
});

test("LC-5 legal slug rename", () => {
  const after = structuredClone(base);
  after[1].slug = "leaf-renamed";
  expect(checkLedger(base, after)).toEqual([]);
});

test("LC-6 legal split", () => {
  const after = structuredClone(base);
  after.push({ tag: "0006", slug: "split-c", kind: "core", parents: ["0001"], status: "active" });
  after.push({ tag: "0007", slug: "split-d", kind: "core", parents: ["0001"], status: "active" });
  after[1].status = "split";
  after[1].successors = ["0006", "0007"];
  expect(checkLedger(base, after)).toEqual([]);
});

test("LC-7 status flip without successors", () => {
  const after = structuredClone(base);
  after[1].status = "split";
  expect(checkLedger(base, after)).toEqual(["status change on 0005 lacks successors"]);
});

test("LC-8 duplicate new tag", () => {
  const after = structuredClone(base);
  after.push({ tag: "0005", slug: "dup-c", kind: "core", parents: ["0001"], status: "active" });
  expect(checkLedger(base, after)).toEqual(["duplicate tag 0005"]);
});

test("LC-9 illegal status transition", () => {
  const after = structuredClone(base);
  after[1].status = "retired";
  expect(checkLedger(base, after)).toEqual(["illegal status change on 0005: active → retired"]);
});

test("LC-10 bad new tag charset", () => {
  const after = structuredClone(base);
  after.push({ tag: "00IL", slug: "bad-c", kind: "core", parents: ["0001"], status: "active" });
  expect(checkLedger(base, after)).toContain("new tag 00IL is not 4-char Crockford base-32");
});

test("LC-11 split successor unknown", () => {
  const after = structuredClone(base);
  after.push({ tag: "0006", slug: "split-c", kind: "core", parents: ["0001"], status: "active" });
  after[1].status = "split";
  after[1].successors = ["0006", "ZZZZ"];
  expect(checkLedger(base, after)).toEqual(["successor ZZZZ of 0005 not in ledger"]);
});

test("LC-12 non-array input", () => {
  expect(checkLedger({}, base)).toEqual(["ledger: base is not a JSON array"]);
});

test("LC-13 real-ledger smoke", () => {
  const path = fileURLToPath(new URL("../kb/tags.ledger.json", import.meta.url));
  const ledger = JSON.parse(readFileSync(path, "utf8"));
  expect(checkLedger(ledger, ledger)).toEqual([]);
  expect(checkLedger([], ledger)).toEqual([]);
});
