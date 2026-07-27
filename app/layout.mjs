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
  // an explicit saved visibility wins.
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
    layout.style.setProperty("--row-console", `${px}px`);
  });
  drag(gutterT, (ev) => {
    const rect = layout.getBoundingClientRect();
    const px = Math.min(Math.max(ev.clientX - rect.left, 240), rect.width - 380);
    layout.style.setProperty("--col-tutor", `${px}px`);
  });

  // Tutor column visibility (the pane itself is owned by tutor-ui.mjs).
  function setTutorVisible(visible) {
    layout.classList.toggle("tutor-hidden", !visible);
    persist();
    onResize?.();
  }

  // Maximize toggles.
  let maximized = null;
  function toggleMax(id) {
    const pane = document.getElementById(id);
    if (maximized && maximized !== pane) maximized.classList.remove("maximized");
    const on = !pane.classList.contains("maximized");
    pane.classList.toggle("maximized", on);
    maximized = on ? pane : null;
    onResize?.();
  }
  for (const btn of document.querySelectorAll(".max-btn")) {
    btn.addEventListener("click", () => toggleMax(btn.dataset.max));
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && maximized) {
      maximized.classList.remove("maximized");
      maximized = null;
      onResize?.();
    }
  });

  return {
    toggleMax,
    setTutorVisible,
    isTutorVisible: () => !layout.classList.contains("tutor-hidden"),
    // For grid children that appear/disappear outside this module's own
    // controls (the exercise beat panel): let them trigger pane refits.
    notifyResize: () => onResize?.(),
  };
}
