// Strings concepts (design §3.4). Statements and wrong answers from the
// inventory; rule cards authored to the student-facing style contract.
// (index-from-zero 000E is a Strings node but stays in lists.mjs, where it
// was minted for the phase-1 slice — a file placement, not a topology fact.)

export default [
  {
    tag: "000Y",
    slug: "str-concat",
    kind: "core",
    parents: ["0007"],
    statement: "+ on two texts glues them together with nothing in between.",
    wrongAnswer: "an inserted space, or the two treated as numbers to add",
    card: "`+` on two pieces of text joins them end to end, with nothing "
      + "added in between — no space.\n\n```py\nprint(\"cat\" + \"dog\")\n```\n\n"
      + "This prints `catdog`, all one word.",
  },
  {
    tag: "000Z",
    slug: "str-repeat",
    kind: "core",
    parents: ["000Y", "0008"],
    statement: "text * number repeats the text that many times.",
    wrongAnswer: "multiplication of a number, or one copy only",
    card: "Text `*` a number repeats the text that many times, joined "
      + "together.\n\n```py\nprint(\"ab\" * 3)\n```\n\n"
      + "This prints `ababab` — three copies, back to back.",
  },
  {
    tag: "0010",
    slug: "index-from-end",
    kind: "edge",
    parents: ["000E"],
    statement: "Negative positions count from the end: s[-1] is the last character.",
    wrongAnswer: "an error, or a character off by one from the end",
    card: "A negative position counts from the END. `s[-1]` is the last "
      + "character, `s[-2]` the one before it.\n\n"
      + "```py\ns = \"cat\"\nprint(s[-1])\n```\n\n"
      + "This prints `t` — the last character.",
  },
  {
    tag: "0011",
    slug: "slice-half-open",
    kind: "core",
    parents: ["000E"],
    statement: "s[a:b] is the characters from position a up to but not including b.",
    wrongAnswer: "includes the character at position b",
    card: "`s[a:b]` takes the characters from position a up to — but NOT "
      + "including — position b.\n\n```py\ns = \"python\"\nprint(s[1:3])\n```\n\n"
      + "This prints `yt`: positions 1 and 2. Position 3 is left out.",
  },
  {
    tag: "0012",
    slug: "slice-open-ended",
    kind: "core",
    parents: ["0011"],
    statement: "A missing endpoint means from the start or to the end: s[a:], s[:b].",
    wrongAnswer: "stops one short, or raises an error",
    card: "Leave an endpoint out and the slice runs to that edge. `s[a:]` "
      + "goes from a to the end; `s[:b]` goes from the start up to b.\n\n"
      + "```py\ns = \"python\"\nprint(s[2:])\n```\n\n"
      + "This prints `thon` — from position 2 all the way to the end.",
  },
  {
    tag: "0013",
    slug: "str-immutable-rebind",
    kind: "edge",
    parents: ["000C", "000Y"],
    statement: "Text never changes in place; building new text and rebinding leaves earlier copies untouched.",
    wrongAnswer: "the earlier copy shows the change too",
    card: "Text cannot be changed in place. `a + \"s\"` builds a NEW piece "
      + "of text; it does not alter the old one.\nSo if another name copied "
      + "the old text, that name still holds the old text.\n\n"
      + "```py\na = \"cat\"\nb = a\na = a + \"s\"\nprint(b)\n```\n\n"
      + "This prints `cat`: `b` kept the original; only `a` was rebound.",
  },
  {
    tag: "0014",
    slug: "str-compare-code-points",
    kind: "edge",
    parents: ["0015", "0007"],
    statement: "Text compares character by character by code point — all capitals come before all lowercase.",
    wrongAnswer: "compares by dictionary order, ignoring case",
    card: "Text is compared character by character using each character's "
      + "code number. Every capital letter comes before every lowercase "
      + "letter.\n\n```py\nprint(\"Zoo\" < \"apple\")\n```\n\n"
      + "This prints `True`: capital `Z` (code 90) is less than lowercase "
      + "`a` (code 97), so `\"Zoo\"` comes first.",
  },
];
