// Order-matters combinator (design §5, "order-matters variation
// discipline"). The order-matters exercises teach that statement ORDER
// changes the observable result: two programs, A and B, that differ by
// exactly ONE statement having moved — a spot-the-difference over a single
// concept rather than a contrast between two concepts.
//
// This module is dependency-light (plain strings/arrays; it may borrow the
// KB RNG helpers). It imports NOTHING from app/ — like the rest of kb/ it
// must load in plain Node.
//
// There is deliberately no "assert the outputs differ" helper here: nothing
// in kb/ executes Python, so an in-module difference assertion is impossible
// and would be a lie. The generators instead guarantee A-output ≠ B-output
// BY CONSTRUCTION (operand values chosen so the moved statement always
// changes what is printed), and the K-10 real-execution oracle plus the
// K-series discrimination oracle enforce that the two programs really do
// produce different output on every sampled seed.

// orderPair(lines, from, to) → { code, contrastCode }
//   lines       — an array of statement strings (a "line" element may itself
//                 contain newlines, e.g. an indented `if …:\n    break`
//                 block, so a compound statement moves as one unit).
//   from, to    — program B is program A with the single element at index
//                 `from` spliced out and reinserted at index `to`; every
//                 other line keeps its exact text and indentation.
// Program A is `code`; program B (the one the student predicts) is
// `contrastCode`. Both are newline-terminated. The caller is responsible
// for choosing `from`/`to` such that the moved statement stays syntactically
// legal in place (same-indent body swaps); moves that cross an indentation
// boundary (in-loop ↔ after-loop) are built by the generator directly, since
// they require re-indenting the moved line.
export function orderPair(lines, from, to) {
  const code = lines.join("\n") + "\n";
  const moved = lines.slice();
  const [stmt] = moved.splice(from, 1);
  moved.splice(to, 0, stmt);
  const contrastCode = moved.join("\n") + "\n";
  return { code, contrastCode };
}
