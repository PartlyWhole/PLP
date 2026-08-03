// Placement diagnostic tests (design/kb-sidework-plan.md §2.3). Pure Node —
// no `page` fixture. Every expectation is derived from loadKB() at runtime:
// no concept counts, no exercise-id lists, no ≤N constants hard-coded.
import { test, expect } from "@playwright/test";
import { loadKB } from "../kb/index.mjs";
import { startPlacement, nextProbe, recordAnswer, result } from "../tools/kb-placement.mjs";

// Set of non-structural tags with ≥1 intro exercise.
function exercisable(kb) {
  const out = new Set();
  for (const ex of kb.exercises) {
    if (ex.role === "intro" && !kb.structural.has(ex.focus)) out.add(ex.focus);
  }
  return out;
}

// Drive a full placement session with the given answer policy.
function run(kb, answers /* (exercise) => boolean */) {
  const s = startPlacement(kb);
  const sequence = [];
  for (let ex = nextProbe(s); ex; ex = nextProbe(s)) {
    sequence.push(ex.id);
    recordAnswer(s, ex.id, answers(ex));
  }
  return { s, sequence };
}

const sorted = (set) => [...set].sort();

test("P-1 perfect student converges fast", () => {
  const kb = loadKB();
  const { s, sequence } = run(kb, () => true);
  const ex = exercisable(kb);
  expect(ex.size).toBeGreaterThan(1);
  for (const tag of ex) expect(result(s).met.has(tag)).toBeTruthy();
  expect(sequence.length).toBeLessThan(ex.size);
});

test("P-2 all-wrong student", () => {
  const kb = loadKB();
  const { s, sequence } = run(kb, () => false);
  expect(result(s).met.size).toBe(0);
  expect(sequence.length).toBeLessThanOrEqual(exercisable(kb).size);
});

test("P-3 knows exactly the names-share-list lineage", () => {
  const kb = loadKB();
  let tag0 = null;
  for (const c of kb.concepts.values()) {
    if (c.slug === "names-share-list") { tag0 = c.tag; break; }
  }
  expect(tag0, "slug names-share-list missing").toBeTruthy();
  const knows = new Set(
    [...kb.ancestors(tag0)].filter((t) => !kb.structural.has(t))
  );
  const { s } = run(kb, (ex) => knows.has(ex.focus));
  expect(sorted(result(s).met)).toEqual(sorted(knows));
});

test("P-4 determinism", () => {
  const kb = loadKB();
  const policy = (ex) => ex.focus.charCodeAt(3) % 2 === 0;
  const a = run(kb, policy);
  const b = run(kb, policy);
  expect(a.sequence).toEqual(b.sequence);
  expect(sorted(result(a.s).met)).toEqual(sorted(result(b.s).met));
});

test("P-5 no probe repeats / convergence", () => {
  const kb = loadKB();
  const { sequence } = run(kb, (ex) => ex.focus.charCodeAt(3) % 2 === 0);
  const byId = new Map(kb.exercises.map((ex) => [ex.id, ex.focus]));
  const focuses = sequence.map((id) => byId.get(id));
  expect(new Set(focuses).size).toBe(focuses.length);
  expect(sequence.length).toBeLessThanOrEqual(exercisable(kb).size);
});

test("P-6 result frontier is the KB frontier", () => {
  const kb = loadKB();
  const { s } = run(kb, () => true);
  const r = result(s);
  expect(sorted(r.frontier)).toEqual(sorted(kb.frontier(r.met)));
  expect(r.frontier.size).toBe(0);
});

test("P-7 unknown exercise id throws", () => {
  const kb = loadKB();
  expect(() => recordAnswer(startPlacement(kb), "no-such-exercise", true))
    .toThrow(/placement: unknown exercise/);
});
