// Shared value/name pools (design §5.3): variety is uniform across
// generators and collision review (no confusables like l/1, no digits in
// words, no pool word that shadows a name) happens in exactly one place.

// Letters-only, lowercase, no name collisions with `names` below.
export const words = ["hi", "cat", "sun", "moon", "blue", "fish", "tree", "star", "frog", "drum"];

// Two-word phrases for multi-word string shapes.
export const phrases = [["blue", "sky"], ["red", "fox"], ["one", "day"], ["big", "sur"]];

// Single-value names (ints, strings).
export const names = ["x", "n", "total", "score", "count"];

// List-holding names, and the alias pair used by aliasing shapes.
export const listNames = ["xs", "nums", "vals"];
export const aliasPair = ["a", "b"];

// String-holding names (no collision with `words`), and words long enough
// to index and slice (≥4 letters).
export const strNames = ["s", "w", "word", "msg"];
export const longWords = ["python", "planet", "yellow", "garden", "silver", "orange"];

// Capitalised vs lowercase words: any capital-initial word sorts before any
// lowercase-initial one by code point, so `cap < low` is always True.
export const capWords = ["Zoo", "Apple", "Box", "Sun"];
export const lowWords = ["apple", "melon", "zebra", "grape"];

// Dict key/value pools.
export const dictKeys = ["a", "b", "cat", "sun", "red"];
