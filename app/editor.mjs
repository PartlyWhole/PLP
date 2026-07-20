// CodeMirror 5 wrapper for the single-file editor (main.py). Expects
// window.CodeMirror from vendor/codemirror loaded as classic scripts.

import { events } from "./events.mjs";

const REMOTE_ACTIVITY_MS = 1800;
const PEER_LABEL_MS = 1400;

export function createEditor({ hostEl }) {
  const cm = window.CodeMirror(hostEl, {
    mode: "python",
    lineNumbers: true,
    indentUnit: 4,
    viewportMargin: Infinity,
  });
  let marked = null; // line index of the current step highlight
  let remoteTextMark = null;
  let remoteCursorMark = null;
  let remoteActivityTimer = null;
  const peerPresenceMarks = new Map();

  function clearRemoteActivity() {
    if (remoteActivityTimer !== null) clearTimeout(remoteActivityTimer);
    remoteActivityTimer = null;
    remoteTextMark?.clear();
    remoteTextMark = null;
    remoteCursorMark?.clear();
    remoteCursorMark = null;
  }

  function showRemoteActivity(fromIndex, insertedLength) {
    clearRemoteActivity();
    const toIndex = fromIndex + insertedLength;
    if (insertedLength > 0) {
      remoteTextMark = cm.markText(
        cm.posFromIndex(fromIndex),
        cm.posFromIndex(toIndex),
        { className: "cm-remote-edit" },
      );
    }

    // This is the caret implied by the remote splice, not persisted cursor
    // presence. It also gives a deletion (whose inserted span is empty) a
    // visible landing point without changing this learner's selection.
    const cursor = document.createElement("span");
    cursor.className = "cm-remote-cursor";
    cursor.setAttribute("aria-hidden", "true");
    remoteCursorMark = cm.setBookmark(cm.posFromIndex(toIndex), {
      widget: cursor,
      insertLeft: true,
    });
    remoteActivityTimer = setTimeout(clearRemoteActivity, REMOTE_ACTIVITY_MS);
  }

  function clampIndex(index) {
    return Math.max(0, Math.min(Number.isInteger(index) ? index : 0, cm.getValue().length));
  }

  function selection() {
    const primary = cm.listSelections()[0];
    return {
      anchor: cm.indexFromPos(primary.anchor),
      head: cm.indexFromPos(primary.head),
    };
  }

  function clearPeerPresence(peerId) {
    const marks = peerPresenceMarks.get(peerId);
    if (!marks) return;
    if (marks.labelTimer !== null) clearTimeout(marks.labelTimer);
    marks.selectionMark?.clear();
    marks.cursorMark?.clear();
    peerPresenceMarks.delete(peerId);
  }

  function showPeerPresence({ peerId, name, color, anchor, head, showLabel = true }) {
    const previous = peerPresenceMarks.get(peerId);
    const labelUntil = showLabel
      ? Date.now() + PEER_LABEL_MS
      : previous?.labelUntil ?? 0;
    clearPeerPresence(peerId);
    const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : "#56b6c2";
    const anchorIndex = clampIndex(anchor);
    const headIndex = clampIndex(head);
    const fromIndex = Math.min(anchorIndex, headIndex);
    const toIndex = Math.max(anchorIndex, headIndex);
    let selectionMark = null;
    if (fromIndex !== toIndex) {
      selectionMark = cm.markText(
        cm.posFromIndex(fromIndex),
        cm.posFromIndex(toIndex),
        {
          className: "cm-peer-selection",
          css: `background-color: ${safeColor}38; box-shadow: inset 0 -1px 0 ${safeColor};`,
          attributes: { "data-peer-id": peerId },
        },
      );
    }

    const cursor = document.createElement("span");
    cursor.className = "cm-peer-cursor";
    cursor.dataset.peerId = peerId;
    cursor.style.setProperty("--peer-color", safeColor);
    cursor.setAttribute("aria-hidden", "true");
    let label = null;
    if (labelUntil > Date.now()) {
      label = document.createElement("span");
      label.className = "cm-peer-label";
      label.textContent = String(name || "Collaborator").slice(0, 40);
      cursor.append(label);
    }
    const cursorMark = cm.setBookmark(cm.posFromIndex(headIndex), {
      widget: cursor,
      insertLeft: true,
    });
    const marks = { selectionMark, cursorMark, labelTimer: null, labelUntil };
    if (label) {
      const remaining = Math.max(0, labelUntil - Date.now());
      marks.labelTimer = setTimeout(() => {
        label.remove();
        marks.labelTimer = null;
        marks.labelUntil = 0;
      }, remaining);
    }
    peerPresenceMarks.set(peerId, marks);
  }

  function retainPeerPresence(peerIds) {
    const active = new Set(peerIds);
    for (const peerId of peerPresenceMarks.keys()) {
      if (!active.has(peerId)) clearPeerPresence(peerId);
    }
  }

  cm.on("change", (_cm, ch) => {
    if (ch.origin !== "collab") clearRemoteActivity();
    if (ch.origin !== "setValue" && ch.origin !== "collab") events.emit("edited");
  });

  function clearHighlight() {
    if (marked !== null) {
      cm.removeLineClass(marked, "background", "cm-active-step");
      marked = null;
    }
  }

  function highlightLine(line) {
    clearHighlight();
    const idx = Math.max(0, Math.min(line - 1, cm.lineCount() - 1));
    cm.addLineClass(idx, "background", "cm-active-step");
    marked = idx;
    cm.scrollIntoView({ line: idx, ch: 0 }, 60);
  }

  // Textual occurrence highlight for a variable name (memory-model hover).
  // This intentionally includes whole-word matches inside strings/comments:
  // the teaching gesture is "where do these characters appear?", not a
  // Python name-resolution query. lineFilter still enforces frame scope.
  let nameMarks = [];
  function clearNameHighlight() {
    for (const mk of nameMarks) mk.clear();
    nameMarks = [];
  }
  // lineFilter (optional): (oneBasedLine) => bool — restricts highlighting
  // to the hovered name's scope (provided by the memory model).
  function highlightName(name, lineFilter) {
    clearNameHighlight();
    if (!name || !/^[A-Za-z_]\w*$/.test(name)) return;
    const re = new RegExp(`\\b${name}\\b`, "g");
    for (let i = 0; i < cm.lineCount(); i++) {
      if (lineFilter && !lineFilter(i + 1)) continue;
      const text = cm.getLine(i);
      for (let m = re.exec(text); m; m = re.exec(text)) {
        nameMarks.push(cm.markText(
          { line: i, ch: m.index },
          { line: i, ch: m.index + name.length },
          { className: "cm-name-hl" },
        ));
      }
    }
  }

  // Replace only the changed span (common prefix/suffix) so the local
  // cursor, scroll, and undo history survive remote collaborative edits.
  function applyRemote(text) {
    const cur = cm.getValue();
    if (cur === text) return;
    let p = 0;
    const max = Math.min(cur.length, text.length);
    while (p < max && cur[p] === text[p]) p++;
    let s = 0;
    while (s < max - p && cur[cur.length - 1 - s] === text[text.length - 1 - s]) s++;
    const inserted = text.slice(p, text.length - s);
    cm.replaceRange(
      inserted,
      cm.posFromIndex(p),
      cm.posFromIndex(cur.length - s),
      "collab",
    );
    showRemoteActivity(p, inserted.length);
  }

  return {
    getValue: () => cm.getValue(),
    setValue: (text) => { clearHighlight(); clearNameHighlight(); cm.setValue(text); },
    applyRemote,
    // Fires on local edits, typed or programmatic (NOT on applyRemote —
    // remote applications carry the "collab" origin; the collab module's
    // applyingRemote flag additionally guards its own setValue adoption).
    onLocalChange: (fn) => cm.on("change", (_cm, ch) => {
      if (ch.origin !== "collab") fn();
    }),
    // Fires for every buffer change, including collaboration splices. Used
    // by browser-local persistence, which must save the code a follower sees.
    onChange: (fn) => cm.on("change", fn),
    selection,
    setSelection: (anchor, head = anchor) => cm.setSelection(
      cm.posFromIndex(clampIndex(anchor)),
      cm.posFromIndex(clampIndex(head)),
    ),
    onCursorActivity: (fn) => cm.on("cursorActivity", () => fn(selection())),
    showPeerPresence,
    retainPeerPresence,
    highlightLine,
    clearHighlight,
    highlightName,
    clearNameHighlight,
    refresh: () => cm.refresh(),
    // Director/stage hooks.
    setReadOnly: (v) => cm.setOption("readOnly", v ? "nocursor" : false),
    isReadOnly: () => Boolean(cm.getOption("readOnly")),
  };
}
