// CodeMirror 5 wrapper for the single-file editor (main.py). Expects
// window.CodeMirror from vendor/codemirror loaded as classic scripts.

export function createEditor({ hostEl }) {
  const cm = window.CodeMirror(hostEl, {
    mode: "python",
    lineNumbers: true,
    indentUnit: 4,
    viewportMargin: Infinity,
  });
  let marked = null; // line index of the current step highlight

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

  // Occurrence highlight for a variable name (memory-model hover).
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
    cm.replaceRange(
      text.slice(p, text.length - s),
      cm.posFromIndex(p),
      cm.posFromIndex(cur.length - s),
      "collab",
    );
  }

  return {
    getValue: () => cm.getValue(),
    setValue: (text) => { clearHighlight(); clearNameHighlight(); cm.setValue(text); },
    applyRemote,
    // Fires on user edits (not on setValue or applyRemote) — collab echo guard.
    onLocalChange: (fn) => cm.on("change", (_cm, ch) => {
      if (ch.origin !== "setValue" && ch.origin !== "collab") fn();
    }),
    highlightLine,
    clearHighlight,
    highlightName,
    clearNameHighlight,
    refresh: () => cm.refresh(),
  };
}
