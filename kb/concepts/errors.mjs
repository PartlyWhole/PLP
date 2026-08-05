// Error-literacy concepts (expansion ladder §R3). The family a learner needs
// before an error message can be read as INFORMATION rather than as failure:
// the parent says what an error is and where it happens, and three edge
// children name the three traps a beginner meets first.
//
// NameError has no node of its own: it is folded into errors-are-information
// as that concept's canonical witness. A separate NameError child would make
// the parent's own intro program footprint-illegal — the parent's simplest
// possible demonstration IS a name read before assignment, so its footprint
// would emit the child's tag, which is not inside the parent's closure
// (design §2.8 / quality bar E1). The analyzer encodes the same decision:
// RAISE_TAG["name-unbound"] maps to 002N itself (kb/analyzer/footprint.mjs).
//
// Card examples below are verified against real python3 — the claimed
// exception type, message and line are what CPython actually reports.

export default [
  {
    tag: "002N",
    slug: "errors-are-information",
    kind: "core",
    parents: ["0006"],
    statement: "When a line cannot run, Python stops there and tells you the kind of error and the line it happened on.",
    wrongAnswer: "the program prints the earlier lines and keeps going",
    card: "An error is not the program failing quietly — it is Python telling "
      + "you exactly where it got stuck.\n"
      + "Everything above the bad line has already run and printed. The bad "
      + "line, and everything after it, does not run at all.\n"
      + "The last line of the message names the KIND of error. Reading a name "
      + "that was never given a value is a `NameError`.\n\n"
      + "```py\ntotal = 5\nprint(totl)\n```\n\n"
      + "This stops on line 2 with `NameError: name 'totl' is not defined` — "
      + "`totl` was never assigned. Nothing is printed.",
  },
  {
    tag: "002P",
    slug: "type-error-str-int",
    kind: "edge",
    parents: ["002N", "000K"],
    statement: "Adding a string and a number is a TypeError — Python will not guess which one you meant.",
    wrongAnswer: "the number is turned into text and glued on",
    card: "`+` means \"join\" between two strings and \"add\" between two "
      + "numbers. Between one of each it means nothing, so Python refuses.\n"
      + "It does not silently convert. You have to say which you meant — "
      + "`str(count)` to join, or `int(text)` to add.\n\n"
      + "```py\ncount = 3\nprint(\"you have \" + count)\n```\n\n"
      + "This stops on line 2 with "
      + "`TypeError: can only concatenate str (not \"int\") to str`.",
  },
  {
    tag: "002Q",
    slug: "index-error-out-of-range",
    kind: "edge",
    parents: ["002N", "000D", "000E"],
    statement: "Asking a list for a position it does not have is an IndexError.",
    wrongAnswer: "the last item, or an empty value",
    card: "Positions start at 0, so a list of 3 items has positions 0, 1 and "
      + "2 — and nothing at 3.\n"
      + "Python does not hand back the nearest item or a blank. It stops.\n\n"
      + "```py\nxs = [10, 20, 30]\nprint(xs[3])\n```\n\n"
      + "This stops on line 2 with `IndexError: list index out of range`. "
      + "The last real position is `xs[2]`.",
  },
  {
    tag: "002R",
    slug: "key-error-missing",
    kind: "edge",
    parents: ["002N", "001R"],
    statement: "Looking up a key a dict does not have is a KeyError.",
    wrongAnswer: "an empty value, or zero",
    card: "A dict only knows the keys you put in it. Asking for any other key "
      + "stops the program.\n"
      + "The error names the key it could not find — check the spelling "
      + "first. Use `.get(key, default)` when a miss should be allowed.\n\n"
      + "```py\nages = {\"ana\": 7, \"bo\": 9}\nprint(ages[\"cy\"])\n```\n\n"
      + "This stops on line 2 with `KeyError: 'cy'` — the dict has `ana` and "
      + "`bo`, and nothing else.",
  },
];
