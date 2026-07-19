// The stage: the app-surface abstraction the director works through.
// Three responsibilities, all reversible and crash-safe:
//   - TARGETS: stable semantic names -> live DOM anchors (never raw
//     selectors in lessons, never per-run uids).
//   - GATES: capability deny/allow (denied = inert + dimmed). resetGates()
//     restores everything; the director calls it in a finally.
//   - EFFECTS: spotlight (+backdrop dim), pulse, one anchored non-modal
//     popover, veil (progressive disclosure). Active effects re-anchor on
//     every memory re-render (the tables redraw per animation frame).
// Principle P1: the stage arranges; it never performs — no method here
// runs code, presses buttons, or answers input.

import { events } from "./events.mjs";

const CAPS = {
  "run": () => [document.getElementById("btn-run")],
  "stop": () => [document.getElementById("btn-stop")],
  "quiz": () => [document.getElementById("btn-quiz")],
  "share": () => [document.getElementById("btn-share")],
  "scrub": () => [...document.querySelectorAll("#memory-pane .step-nav input, #memory-pane .step-nav button")]
    .filter((el) => el.dataset.role !== "step-mode"),
  "step-mode": () => [document.querySelector("[data-role=step-mode]")?.closest("label")].filter(Boolean),
  "maximize": () => [...document.querySelectorAll(".max-btn")],
  // edit + console-input are behavioral gates, applied via module APIs.
  "edit": null,
  "console-input": null,
};

export const CAPABILITIES = Object.keys(CAPS);

const TARGETS = {
  "run": () => document.getElementById("btn-run"),
  "stop": () => document.getElementById("btn-stop"),
  "quiz-btn": () => document.getElementById("btn-quiz"),
  "share": () => document.getElementById("btn-share"),
  "editor": () => document.getElementById("editor-pane"),
  "console": () => document.getElementById("console-pane"),
  "memory": () => document.getElementById("memory-pane"),
  "memory-names": () => document.querySelector("[data-role=names-table]")?.closest(".mem-box"),
  "memory-objects": () => document.querySelector("[data-role=objects-table]")?.closest(".mem-box"),
  "scrubber": () => document.querySelector("#memory-pane .step-nav"),
  "step-mode": () => document.querySelector("[data-role=step-mode]")?.closest("label"),
};

export const TARGET_NAMES = Object.keys(TARGETS);

// Structured targets: { name: "x", scope: "globals" } -> Names cell;
// { line: n } -> editor pane (with the line highlighted by the caller).
function resolveTarget(spec, { editor } = {}) {
  if (typeof spec === "string") {
    const fn = TARGETS[spec];
    return fn ? fn() : null;
  }
  if (spec && typeof spec === "object") {
    if (spec.name !== undefined) {
      const cells = [...document.querySelectorAll("[data-role=names-table] td.name")];
      return cells.find((c) => c.textContent.trim() === spec.name
        && (spec.scope === undefined || c.dataset.scope === spec.scope
          || (spec.scope === "globals" && c.dataset.scope === "global"))) ?? null;
    }
    if (spec.line !== undefined) return document.getElementById("editor-pane");
  }
  return null;
}

// Static (lint-time) validity check — no DOM needed.
export function isValidTargetSpec(spec) {
  if (typeof spec === "string") return spec in TARGETS;
  if (spec && typeof spec === "object") return spec.name !== undefined || spec.line !== undefined;
  return false;
}

export function createStage({ editor, consoleUI }) {
  const gated = new Set();
  // Active visual effects, re-applied after re-renders.
  // spotlight: {spec, dim}; pulses are fire-and-forget; popover: single.
  let spotlights = [];
  let veiled = [];
  let popoverState = null; // { spec, text, sticky }
  let backdrop = null;

  // ---- gates ---------------------------------------------------------------
  function applyGate(cap, deny) {
    if (cap === "edit") { editor?.setReadOnly(deny); return; }
    if (cap === "console-input") { consoleUI?.setInteractive?.(!deny); return; }
    for (const el of CAPS[cap]?.() ?? []) {
      el.classList.toggle("stage-gated", deny);
      if ("disabled" in el) el.disabled = deny;
    }
  }

  function gate({ deny = [], allow = [] } = {}) {
    for (const cap of deny) {
      if (!(cap in CAPS)) throw new Error(`unknown capability: ${cap}`);
      gated.add(cap);
      applyGate(cap, true);
    }
    for (const cap of allow) {
      if (!(cap in CAPS)) throw new Error(`unknown capability: ${cap}`);
      gated.delete(cap);
      applyGate(cap, false);
    }
  }

  function resetGates() {
    for (const cap of [...gated]) { gated.delete(cap); applyGate(cap, false); }
  }

  // ---- effects -------------------------------------------------------------
  function ensureBackdrop() {
    if (backdrop) return backdrop;
    backdrop = document.createElement("div");
    backdrop.className = "stage-backdrop";
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function applySpotlights() {
    for (const el of document.querySelectorAll(".stage-spot")) el.classList.remove("stage-spot");
    let anyDim = false;
    for (const s of spotlights) {
      const el = resolveTarget(s.spec, { editor });
      if (el) el.classList.add("stage-spot");
      if (s.dim) anyDim = true;
      if (s.spec?.line !== undefined) editor?.highlightLine(s.spec.line);
    }
    if (anyDim) ensureBackdrop();
    else { backdrop?.remove(); backdrop = null; }
  }

  function spotlight(spec, { dim = true } = {}) {
    spotlights.push({ spec, dim });
    applySpotlights();
  }

  function pulse(spec) {
    const el = resolveTarget(spec, { editor });
    if (!el) return;
    el.classList.remove("stage-pulse");
    void el.offsetWidth; // restart animation
    el.classList.add("stage-pulse");
    setTimeout(() => el.classList.remove("stage-pulse"), 1600);
  }

  // Minimal safe rich text: **bold** and `code`, everything else literal.
  function richText(container, text) {
    const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    for (const p of parts) {
      if (/^\*\*[^*]+\*\*$/.test(p)) {
        const b = document.createElement("b");
        b.textContent = p.slice(2, -2);
        container.appendChild(b);
      } else if (/^`[^`]+`$/.test(p)) {
        const c = document.createElement("code");
        c.textContent = p.slice(1, -1);
        container.appendChild(c);
      } else if (p) {
        container.appendChild(document.createTextNode(p));
      }
    }
  }

  let popoverEl = null;
  function positionPopover() {
    if (!popoverEl || !popoverState) return;
    const anchor = resolveTarget(popoverState.spec, { editor });
    if (!anchor) { popoverEl.style.visibility = "hidden"; return; }
    popoverEl.style.visibility = "";
    const r = anchor.getBoundingClientRect();
    const pw = popoverEl.offsetWidth, ph = popoverEl.offsetHeight;
    let top = r.bottom + 8;
    if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 8);
    let left = Math.min(Math.max(8, r.left), innerWidth - pw - 8);
    popoverEl.style.top = `${top}px`;
    popoverEl.style.left = `${left}px`;
  }

  // One popover at a time (P2). Non-modal; Esc or ✕ dismisses (the director
  // may also clear/replace it). onWhy adds a learner-invoked "why?" (P5).
  function popover(spec, text, { sticky = false, onWhy = null, kind = "guide" } = {}) {
    dismissPopover();
    popoverState = { spec, text, sticky };
    popoverEl = document.createElement("div");
    popoverEl.className = `stage-popover ${kind}`;
    const body = document.createElement("div");
    body.className = "stage-popover-body";
    richText(body, text);
    popoverEl.appendChild(body);
    const row = document.createElement("div");
    row.className = "stage-popover-actions";
    if (onWhy) {
      const why = document.createElement("button");
      why.type = "button";
      why.textContent = "why?";
      why.addEventListener("click", () => {
        body.textContent = "";
        richText(body, onWhy());
        why.remove();
        positionPopover();
      });
      row.appendChild(why);
    }
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "✕";
    x.title = "dismiss";
    x.addEventListener("click", dismissPopover);
    row.appendChild(x);
    popoverEl.appendChild(row);
    document.body.appendChild(popoverEl);
    positionPopover();
    events.emit("popover-shown", { text: String(text).slice(0, 80) });
  }

  function dismissPopover() {
    popoverEl?.remove();
    popoverEl = null;
    popoverState = null;
  }

  function veil(spec) {
    veiled.push(spec);
    applyVeils();
  }

  function unveil(spec) {
    veiled = veiled.filter((v) => JSON.stringify(v) !== JSON.stringify(spec));
    applyVeils(true);
  }

  function applyVeils(clearFirst = false) {
    if (clearFirst) for (const el of document.querySelectorAll(".stage-veiled")) el.classList.remove("stage-veiled");
    for (const v of veiled) resolveTarget(v, { editor })?.classList.add("stage-veiled");
  }

  function clearEffects() {
    spotlights = [];
    veiled = [];
    applySpotlights();
    applyVeils(true);
    dismissPopover();
    for (const el of document.querySelectorAll(".stage-pulse")) el.classList.remove("stage-pulse");
  }

  // Re-anchor active effects when the memory pane re-renders or the window
  // resizes (table cells are recreated every render).
  events.on((e) => {
    if (e.type === "memory-rendered") {
      if (spotlights.some((s) => typeof s.spec === "object")) applySpotlights();
      applyVeils(true);
      positionPopover();
    }
  });
  window.addEventListener("resize", positionPopover);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popoverState && !popoverState.sticky) dismissPopover();
  });

  return {
    gate,
    resetGates,
    gatedCaps: () => [...gated],
    spotlight,
    pulse,
    popover,
    dismissPopover,
    veil,
    unveil,
    clearEffects,
    resolveTarget: (spec) => resolveTarget(spec, { editor }),
    // Full teardown (director exit / crash path).
    reset() { clearEffects(); resetGates(); },
  };
}
