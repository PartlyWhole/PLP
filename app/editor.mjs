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

  return {
    getValue: () => cm.getValue(),
    setValue: (text) => { clearHighlight(); cm.setValue(text); },
    highlightLine,
    clearHighlight,
    refresh: () => cm.refresh(),
  };
}
