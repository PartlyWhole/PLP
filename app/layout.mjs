// Pane layout: two draggable gutters (vertical editor|memory split,
// horizontal console split) writing CSS variables on #layout, persisted to
// localStorage; plus per-pane maximize toggles (in-page fixed overlay, Esc
// restores).

const STORE_KEY = "plp.layout";

export function initLayout({ onResize }) {
  const layout = document.getElementById("layout");
  const gutterV = document.getElementById("gutter-v");
  const gutterH = document.getElementById("gutter-h");
  const gutterT = document.getElementById("gutter-t");

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
  })();
  if (saved.colLeft) layout.style.setProperty("--col-left", saved.colLeft);
  if (saved.rowConsole) layout.style.setProperty("--row-console", saved.rowConsole);
  if (saved.colTutor) layout.style.setProperty("--col-tutor", saved.colTutor);
  // The tutor column starts hidden (index.html ships class="tutor-hidden");
  // an explicit saved visibility wins. Which SURFACE Exercises opens on
  // (the practice card view for drills/menu, the focus stage for guided
  // lessons) is the tutor runtime's restore() decision — only the
  // visibility bit persists here; no mode class is applied at boot.
  if (saved.tutorVisible) layout.classList.remove("tutor-hidden");

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        colLeft: layout.style.getPropertyValue("--col-left") || undefined,
        rowConsole: layout.style.getPropertyValue("--row-console") || undefined,
        colTutor: layout.style.getPropertyValue("--col-tutor") || undefined,
        tutorVisible: !layout.classList.contains("tutor-hidden") || undefined,
      }));
    } catch { /* private mode etc. — sizes just don't persist */ }
  }

  function drag(gutter, apply) {
    gutter.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      gutter.setPointerCapture(down.pointerId);
      gutter.classList.add("dragging");
      const move = (ev) => { apply(ev); onResize?.(); };
      const up = () => {
        gutter.classList.remove("dragging");
        gutter.removeEventListener("pointermove", move);
        gutter.removeEventListener("pointerup", up);
        persist();
        onResize?.();
      };
      gutter.addEventListener("pointermove", move);
      gutter.addEventListener("pointerup", up);
    });
  }

  drag(gutterV, (ev) => {
    const rect = layout.getBoundingClientRect();
    const px = Math.min(Math.max(ev.clientX - rect.left, 180), rect.width - 186);
    layout.style.setProperty("--col-left", `${px}px`);
  });
  drag(gutterH, (ev) => {
    const rect = layout.getBoundingClientRect();
    const px = Math.min(Math.max(rect.bottom - ev.clientY, 60), rect.height - 106);
    // Focus mode sizes the console with its own variable (the reveal grows
    // it); dragging adjusts whichever mode is live.
    layout.style.setProperty(isFocused() ? "--row-console-f" : "--row-console", `${px}px`);
  });
  drag(gutterT, (ev) => {
    const rect = layout.getBoundingClientRect();
    const px = Math.min(Math.max(ev.clientX - rect.left, 240), rect.width - 380);
    layout.style.setProperty("--col-tutor", `${px}px`);
  });

  // ---- focus mode (the Exercises "stage" layout) --------------------------
  // focus       — stage fills the code column; editor recedes to the right
  //               column; memory hides; console stays as a slim strip.
  // focus-reveal — the console strip grows: the "now watch it run" cue.
  // focus-memory — the beat needs the memory pane (predict-state, scrubs).
  // focus-history — the transcript pane (feed) shows alongside the stage.
  // None of these persist; plp.layout keeps only tutorVisible.
  const FOCUS_FLAGS = ["focus-reveal", "focus-memory", "focus-history"];
  function isFocused() { return layout.classList.contains("focus"); }
  function enterFocus() {
    layout.classList.add("focus");
    layout.classList.remove("tutor-hidden");
    layout.style.removeProperty("--row-console-f");
    onResize?.();
  }
  // exitFocus({pane:true}) falls back to the CLASSIC layout with the
  // transcript pane visible (non-modal escape hatch: "Back to editor");
  // plain exitFocus() leaves Exercises entirely (pane hidden too).
  function exitFocus({ pane = false } = {}) {
    layout.classList.remove("focus", ...FOCUS_FLAGS);
    layout.classList.toggle("tutor-hidden", !pane);
    layout.style.removeProperty("--row-console-f");
    persist();
    onResize?.();
  }
  function setFocusFlags(flags = {}) {
    if (!isFocused()) return;
    for (const [key, cls] of [["reveal", "focus-reveal"], ["memory", "focus-memory"], ["history", "focus-history"]]) {
      if (flags[key] !== undefined) layout.classList.toggle(cls, Boolean(flags[key]));
    }
    onResize?.();
  }

  // Tutor visibility for the STAGE surface (guided lessons): showing
  // Exercises there IS entering focus mode; hiding leaves it entirely.
  function setTutorVisible(visible) {
    if (visible) enterFocus(); else exitFocus();
    persist();
    onResize?.();
  }

  // Visibility bookkeeping for the PRACTICE surface: it owns its own DOM
  // (body.practice) — this only records the shared "Exercises visible" bit
  // so persistence and isTutorVisible() stay truthful across surfaces.
  function setExercisesVisible(visible) {
    layout.classList.toggle("tutor-hidden", !visible);
    layout.classList.remove("focus", ...FOCUS_FLAGS);
    persist();
  }

  // Maximize toggles. While a pane is maximized its button reads ⤡ /
  // "Restore (Esc)" so the way back is visible, not remembered.
  let maximized = null;
  function refreshMaxButtons() {
    for (const btn of document.querySelectorAll(".max-btn")) {
      const on = Boolean(maximized) && btn.dataset.max === maximized.id;
      btn.textContent = on ? "⤡" : "⤢";
      btn.title = on ? "Restore (Esc)" : "Maximize pane";
    }
  }
  function toggleMax(id) {
    const pane = document.getElementById(id);
    if (maximized && maximized !== pane) maximized.classList.remove("maximized");
    const on = !pane.classList.contains("maximized");
    pane.classList.toggle("maximized", on);
    maximized = on ? pane : null;
    refreshMaxButtons();
    onResize?.();
  }
  for (const btn of document.querySelectorAll(".max-btn")) {
    btn.addEventListener("click", () => toggleMax(btn.dataset.max));
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && maximized) {
      maximized.classList.remove("maximized");
      maximized = null;
      refreshMaxButtons();
      onResize?.();
    }
  });

  return {
    toggleMax,
    setTutorVisible,
    setExercisesVisible,
    isTutorVisible: () => !layout.classList.contains("tutor-hidden"),
    enterFocus,
    exitFocus,
    setFocusFlags,
    isFocused,
    // For grid children that appear/disappear outside this module's own
    // controls (the exercise beat panel): let them trigger pane refits.
    notifyResize: () => onResize?.(),
  };
}
