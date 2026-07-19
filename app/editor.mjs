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
  function highlightName(name) {
    clearNameHighlight();
    if (!name || !/^[A-Za-z_]\w*$/.test(name)) return;
    const re = new RegExp(`\\b${name}\\b`, "g");
    for (let i = 0; i < cm.lineCount(); i++) {
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

  return {
    getValue: () => cm.getValue(),
    setValue: (text) => { clearHighlight(); clearNameHighlight(); cm.setValue(text); },
    highlightLine,
    clearHighlight,
    highlightName,
    clearNameHighlight,
    refresh: () => cm.refresh(),
  };
}
