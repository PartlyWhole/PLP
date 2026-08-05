// Lists & aliasing concepts in the phase-1 slice.
// (000E index-from-zero lives here for phase 1; it moves to strings.mjs
// in phase 2 when the strings topic arrives — a pure file reorganization,
// tags and parents unaffected.)

export default [
  {
    tag: "000D",
    slug: "list-literal",
    kind: "core",
    parents: ["0002", "0006"],
    statement: "[a, b, c] builds a list; it prints with brackets, commas, and spaces.",
    wrongAnswer: "the items without brackets, or without the spaces after the commas",
    card: "`[3, 5]` builds a list — one value that holds items in order.\n"
      + "A printed list shows brackets, commas, and a space after each "
      + "comma.\n\n```py\nxs = [3, 5]\nprint(xs)\n```\n\n"
      + "This prints `[3, 5]` — exactly like that.",
  },
  {
    tag: "000E",
    slug: "index-from-zero",
    kind: "core",
    parents: ["0007"],
    statement: "s[i] fetches one item by position, counting from 0.",
    wrongAnswer: "the item at that position counting from 1",
    card: "Positions count from 0. In `\"cat\"`, position 0 is `c`, "
      + "position 1 is `a`, position 2 is `t`.\n"
      + "`s[1]` fetches the item at position 1 — the second one.\n\n"
      + "```py\ns = \"cat\"\nprint(s[1])\n```\n\nThis prints `a`.",
  },
  {
    tag: "000F",
    slug: "index-assign-mutates",
    kind: "core",
    parents: ["000E", "000D"],
    statement: "xs[i] = v changes that one slot of the existing list.",
    wrongAnswer: "the old list, unchanged",
    card: "`xs[0] = 9` changes slot 0 of the list that already exists.\n"
      + "The other slots stay as they were.\n\n"
      + "```py\nxs = [3, 5]\nxs[0] = 9\nprint(xs)\n```\n\nThis prints `[9, 5]`.",
  },
  {
    tag: "000G",
    slug: "append-mutates",
    kind: "core",
    parents: ["000D"],
    statement: "xs.append(v) changes the existing list, adding v at the end.",
    wrongAnswer: "the list without the appended item",
    card: "`xs.append(7)` changes the list itself: it now has one more "
      + "item, at the end.\nNo new list is made — the same list grows.\n\n"
      + "```py\nxs = [1, 2]\nxs.append(7)\nprint(xs)\n```\n\nThis prints `[1, 2, 7]`.",
  },
  {
    tag: "000H",
    slug: "names-share-list",
    kind: "edge",
    parents: ["000C", "000G"],
    statement: "b = a does not copy a list — one list, two names, so a change through either shows through both.",
    wrongAnswer: "the list as it was before the change",
    card: "For lists, `b = a` does NOT make a copy. Now ONE list has two "
      + "names.\nA change made through either name shows through both — "
      + "they are the same list.\n\n"
      + "```py\na = [1, 2]\nb = a\nb.append(7)\nprint(a)\n```\n\n"
      + "This prints `[1, 2, 7]`. Appending through `b` changed the one "
      + "shared list, so `a` shows it too.",
  },
  {
    tag: "0021",
    slug: "list-concat-new",
    kind: "core",
    parents: ["000D"],
    statement: "+ on two lists builds a brand-new list; neither original changes.",
    wrongAnswer: "an original list shown as changed",
    card: "`a + [7]` builds a brand-new list out of the pieces.\n"
      + "The originals are not touched.\n\n"
      + "```py\na = [1, 2]\nb = a + [7]\nprint(a)\n```\n\n"
      + "This prints `[1, 2]` — `a` is unchanged; only `b` holds the new list.",
  },
  {
    tag: "0023",
    slug: "plus-eq-mutates-list",
    kind: "edge",
    parents: ["000H", "0021"],
    statement: "On a list, b += […] changes the shared list in place; b = b + […] builds a new list just for b.",
    wrongAnswer: "the unmutated list for +=, or the mutated one for +",
    card: "On lists, `b += [7]` and `b = b + [7]` are NOT the same.\n"
      + "`b = b + [7]` builds a new list just for `b`. `b += [7]` changes "
      + "the list `b` already names — and if that list is shared, every "
      + "name sharing it sees the change.\n\n"
      + "```py\na = [1, 2]\nb = a\nb += [7]\nprint(a)\n```\n\n"
      + "This prints `[1, 2, 7]` — `+=` changed the one shared list.",
  },
  {
    tag: "001Z",
    slug: "aggregate-builtins",
    kind: "core",
    parents: ["000D"],
    statement: "len, sum, max, min compute one value from a whole list.",
    wrongAnswer: "an off-by-one count, or the wrong end of the range",
    card: "`len`, `sum`, `max`, and `min` each look at a whole list and "
      + "return one value: how many, the total, the biggest, the smallest.\n\n"
      + "```py\nprint(len([4, 8, 1]))\n```\n\n"
      + "This prints `3` — the list has three items.",
  },
  {
    tag: "0020",
    slug: "extend-vs-append",
    kind: "edge",
    parents: ["000G"],
    statement: "append([4, 5]) adds one item (a nested list); extend([4, 5]) adds each item.",
    wrongAnswer: "flattened where it should nest, or nested where it should flatten",
    card: "`append(x)` adds `x` as ONE item. If `x` is a list, it becomes "
      + "a nested list inside.\n`extend(x)` adds each item of `x` "
      + "separately.\n\n```py\nxs = [1, 2]\nxs.append([3, 4])\nprint(xs)\n```\n\n"
      + "This prints `[1, 2, [3, 4]]` — one new item, itself a list.",
  },
  {
    tag: "0022",
    slug: "nested-lists",
    kind: "core",
    parents: ["000D", "000E"],
    statement: "A list can hold lists; g[r][c] picks row r, then position c inside it.",
    wrongAnswer: "row and column swapped",
    card: "A list can hold other lists. `g[r]` picks row r (itself a list); "
      + "`g[r][c]` then picks position c inside that row.\n\n"
      + "```py\ng = [[1, 2], [3, 4]]\nprint(g[1][0])\n```\n\n"
      + "This prints `3`: row 1 is `[3, 4]`, and position 0 of it is `3`.",
  },
  {
    tag: "0024",
    slug: "slice-copies",
    kind: "edge",
    parents: ["0011", "000H"],
    statement: "a[:] builds a real copy — mutating the copy leaves the original alone.",
    wrongAnswer: "the original shows the change too",
    card: "`a[:]` makes a full copy of the list — a separate list with the "
      + "same items. Changing the copy does NOT change the original.\n\n"
      + "```py\na = [1, 2]\nb = a[:]\nb.append(3)\nprint(a)\n```\n\n"
      + "This prints `[1, 2]`: `b` is a copy, so appending to it leaves `a` "
      + "alone.",
  },
  {
    tag: "0025",
    slug: "copy-is-shallow",
    kind: "edge",
    parents: ["0024", "0022"],
    statement: "a[:] copies only the outer list — the inner lists are shared, so a change through the copy shows in the original.",
    wrongAnswer: "the original grid unchanged",
    card: "`a[:]` copies only the OUTER list. The inner lists are not "
      + "copied — both outers hold the SAME inner lists.\nSo changing an "
      + "inner list through the copy shows in the original too.\n\n"
      + "```py\na = [[1, 2], [3, 4]]\nb = a[:]\nb[0].append(9)\nprint(a)\n```\n\n"
      + "This prints `[[1, 2, 9], [3, 4]]`: the outer copy is new, but "
      + "`b[0]` and `a[0]` are one shared list.",
  },
  {
    tag: "002M",
    slug: "in-checks-membership",
    kind: "core",
    parents: ["000D", "0016"],
    statement: "`in` asks \"is this value one of the items?\" — it answers True or False.",
    wrongAnswer: "the item's position, or an error",
    card: "`in` checks membership: is the value on the left one of the "
      + "items in the container on the right?\n\n"
      + "```py\nxs = [3, 8, 5]\nprint(8 in xs)\nprint(4 in xs)\n```\n\n"
      + "This prints `True` then `False`. It answers the yes-or-no "
      + "question only — it never tells you WHERE the item is. Text "
      + "works too: `\"a\" in \"cat\"` is `True`.",
  },
];
