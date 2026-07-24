# Collaborator presence — design note

Why the shared editor shows what it shows. Written after the first version
was reported as "quite distracting" in real use.

## What was wrong

Three mechanisms fired **on every remote keystroke**, and they stacked:

1. `.cm-remote-edit` — every remotely inserted span was tinted cyan (32%
   alpha) with a 1.8 s fade. A peer typing a sentence painted and repainted
   the line continuously.
2. `.cm-remote-cursor` — the splice also drew a *second* caret with a 7 px
   glow, so during typing two carets sat within a character of each other,
   one of them pulsing.
3. `.cm-peer-label` — the name badge was recreated with a fresh 1.4 s timer
   on every cursor update, so it flickered in and out the whole time
   someone typed.

The root confusion: **edit decoration and presence are different features.**
Highlighting changed characters answers "what changed while I was away?" —
a review/track-changes question. Applied per keystroke to live typing, it
answers a question nobody asked and costs continuous peripheral motion.

## What the industry does

| product | remote presence |
|---|---|
| [y-codemirror](https://github.com/yjs/y-codemirror) (the Yjs/CodeMirror binding) | a remote caret is literally `border-left: 2px` at `height: 1em`. Nothing else — no glow, no inserted-text tint |
| [Tiptap CollaborationCaret](https://tiptap.dev/docs/editor/extensions/functionality/collaboration-caret) | caret + the user's name rendered as a label near it |
| Google Docs | coloured caret, name label on movement that fades, light selection tint; typed text is never highlighted |
| [Figma](https://www.figma.com/blog/multiplayer-editing-in-figma/) | cursor + name, persistent; cursors are for pointing and attention, not change history |

The convergent rule: **one calm caret per peer, a name that identifies it,
a light selection tint — and no decoration of the content itself.** Where
"what changed" matters, products give it a separate, coarse-grained,
opt-in surface (suggestions, version history), never a per-keystroke flash.

Prototypr's [survey of live cursors](https://prototypr.io/post/collaboration-tools-live-cursors)
makes the failure mode explicit: cursors "dancing around" is the standard
complaint about multiplayer UI, and the fix is fewer, quieter signals.

## What PLP does now

- **One caret per peer**, 2 px, in the peer's colour. The splice-derived
  caret and the tint are gone entirely.
- **Remotely inserted text is never decorated.** `applyRemote` splices and
  stops.
- **The name announces, then gets out of the way.** It appears when a peer
  arrives or resumes after a `PEER_LABEL_IDLE_MS` (2.5 s) pause, stays for
  `PEER_LABEL_MS` (1.6 s), then fades. Continuous typing never re-triggers
  it, which is what killed the flicker.
- **The name is always reachable**: it stays in the DOM at `opacity: 0`, so
  hovering a caret reveals whose it is at any time — the "who is that?"
  question without the constant answer.
- **Selection** stays a light tint of the peer's colour with a thin
  underline; enough to attribute, not enough to compete with syntax
  highlighting.
- `prefers-reduced-motion` removes the fade.

## If "what changed?" comes back as a real need

Do it as its own feature, not by reviving the tint: a diff view against a
snapshot, or a "N changes since you looked away" affordance that a learner
opts into. Both are coarse-grained by construction, which is exactly the
property the per-keystroke version lacked.

## Tested by

`tests/collab.spec.mjs` → "create/join, two-way editor sync": asserts zero
`.cm-remote-edit`/`.cm-remote-cursor` elements after remote inserts *and*
deletes, exactly one `.cm-peer-cursor` per peer, and that the label is
visible on arrival then reaches `opacity: 0` without disappearing from the
DOM.
