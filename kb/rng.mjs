// KB-local RNG + seed derivation. Deliberately a copy of the app's
// mulberry32 (app/questions.mjs): kb/ imports NOTHING from app/ — the KB
// must load in plain Node (tests, docgen) where app modules pull in
// DOM-adjacent code. tests/kb.spec.mjs asserts both copies produce the
// same stream so they cannot drift silently.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// FNV-1a over the exercise id: the invariant-suite seed family for
// exercise X is fnv1a32(X) ^ k for k = 0..N-1 (design §4.5).
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
