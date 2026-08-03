// Dicts & tuples concepts (design §3.8).

export default [
  {
    tag: "001R",
    slug: "dict-lookup-by-key",
    kind: "core",
    parents: ["0007", "000E"],
    statement: "d = {\"a\": 1} maps keys to values; d[\"a\"] fetches the value stored under that key.",
    wrongAnswer: "the key itself, or a value looked up by position",
    card: "A dict pairs keys with values. `d[\"a\"]` looks up the value "
      + "stored under the key `\"a\"` — not a position, and not the key.\n\n"
      + "```py\nd = {\"cat\": 4}\nprint(d[\"cat\"])\n```\n\n"
      + "This prints `4` — the value stored under `\"cat\"`.",
  },
  {
    tag: "001S",
    slug: "dict-key-assign",
    kind: "core",
    parents: ["001R"],
    statement: "d[k] = v stores v under k — adding the key if it is new, replacing it if it exists.",
    wrongAnswer: "the old value survives, or a new key is rejected",
    card: "`d[k] = v` stores `v` under key `k`. If `k` is new, it is added; "
      + "if it already exists, its value is replaced.\n\n"
      + "```py\nd = {\"a\": 1}\nd[\"b\"] = 2\nprint(d)\n```\n\n"
      + "This prints `{'a': 1, 'b': 2}` — the new key was added.",
  },
  {
    tag: "001T",
    slug: "dict-get-default",
    kind: "core",
    parents: ["001R"],
    statement: "d.get(k, alt) fetches like d[k] but hands back alt when the key is missing.",
    wrongAnswer: "alt even when the key is present",
    card: "`d.get(k, alt)` looks up `k` like `d[k]`, but if `k` is missing "
      + "it hands back `alt` instead of raising an error.\n\n"
      + "```py\nd = {\"a\": 1}\nprint(d.get(\"z\", 0))\n```\n\n"
      + "This prints `0`: there is no key `\"z\"`, so the default is used.",
  },
  {
    tag: "001V",
    slug: "in-dict-checks-keys",
    kind: "edge",
    parents: ["001R", "0016"],
    statement: "k in d asks about keys only — values are invisible to in.",
    wrongAnswer: "True for a value that is stored but not a key",
    card: "`k in d` asks whether `k` is one of the dict's KEYS. The values "
      + "are invisible to `in`.\n\n"
      + "```py\nd = {\"a\": 1}\nprint(1 in d)\n```\n\n"
      + "This prints `False`: `1` is a value, not a key, so `in` does not "
      + "find it.",
  },
  {
    tag: "001W",
    slug: "tuple-pack-print",
    kind: "core",
    parents: ["0006", "0002"],
    statement: "(a, b) groups values into one fixed bundle; it prints with parentheses and commas.",
    wrongAnswer: "printed without the parentheses",
    card: "`(a, b)` bundles values into one tuple. A printed tuple shows "
      + "parentheses and commas.\n\n"
      + "```py\nt = (3, 5)\nprint(t)\n```\n\n"
      + "This prints `(3, 5)` — with the parentheses.",
  },
  {
    tag: "001X",
    slug: "tuple-unpack",
    kind: "core",
    parents: ["001W"],
    statement: "x, y = pair spreads a two-item bundle into two names, in order.",
    wrongAnswer: "both names get the whole tuple",
    card: "`x, y = (a, b)` spreads the bundle into two names: `x` gets the "
      + "first item, `y` the second.\n\n"
      + "```py\nx, y = (3, 5)\nprint(x)\n```\n\n"
      + "This prints `3` — the first item went into `x`.",
  },
  {
    tag: "001Y",
    slug: "tuple-by-comma",
    kind: "edge",
    parents: ["001W"],
    statement: "The comma makes the tuple, not the parentheses: x = 3, is a one-item tuple.",
    wrongAnswer: "just the number, with no tuple",
    card: "It is the COMMA that makes a tuple, not the parentheses. A "
      + "trailing comma makes a one-item tuple.\n\n"
      + "```py\nx = 3,\nprint(x)\n```\n\n"
      + "This prints `(3,)` — a one-item tuple, shown with its comma.",
  },
];
