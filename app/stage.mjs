// The stage: the app-surface abstraction the director works through.
// Three responsibilities, all reversible and crash-safe:
//   - TARGETS: stable semantic names -> live DOM anchors (never raw
//     selectors in lessons, never per-run uids).
//   - GATES: capability deny/allow (denied = inert + dimmed). resetGates()
//     restores everything; the director calls it in a finally.
//   - EFFECTS: spotlight (+backdrop dim), animated cues, one anchored
//     non-modal popover, veil (progressive disclosure). Active effects re-anchor on
//     every memory re-render (the tables redraw per animation frame).
// Principle P1: the stage arranges; it never performs — no method here
// runs code, presses buttons, or answers input.

import { events } from "./events.mjs";

const TUTOR_IMAGE_URL = new URL("../assets/director-tutor.png", import.meta.url).href;
export const CUE_MOTIONS = ["pulse", "bounce", "wiggle"];
const CUE_DURATIONS = { pulse: 1600, bounce: 850, wiggle: 750 };

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
  "share": () => document.getElementById("btn-share"),
  "editor": () => document.getElementById("editor-pane"),
  "console": () => document.getElementById("console-pane"),
  "memory": () => document.getElementById("memory-pane"),
  "memory-names": () => document.querySelector("[data-role=names-table]"),
  "memory-objects": () => document.querySelector("[data-role=objects-table]"),
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
      const cells = [...document.querySelectorAll("[data-role=names-table] .mm-name-box.name")];
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
  // spotlight: {spec, dim}; cues are fire-and-forget; popover: single.
  let spotlights = [];
  let veiled = [];
  let popoverState = null; // { spec, text, sticky, avoid, avatar }
  let backdrop = null;
  const cueTimers = new Map();

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

  function clearCueElement(el) {
    const timerId = cueTimers.get(el);
    if (timerId) clearTimeout(timerId);
    cueTimers.delete(el);
    el.classList.remove("stage-cue", "stage-cue-pulse", "stage-cue-bounce", "stage-cue-wiggle", "stage-pulse");
  }

  function cue(spec, { motion = "pulse" } = {}) {
    if (!CUE_MOTIONS.includes(motion)) throw new Error(`unknown cue motion: ${motion}`);
    const el = resolveTarget(spec, { editor });
    if (!el) return;
    clearCueElement(el);
    void el.offsetWidth; // restart animation
    el.classList.add("stage-cue", `stage-cue-${motion}`);
    if (motion === "pulse") el.classList.add("stage-pulse"); // legacy debug/test hook
    cueTimers.set(el, setTimeout(() => clearCueElement(el), CUE_DURATIONS[motion]));
  }

  function pulse(spec) {
    cue(spec, { motion: "pulse" });
  }

  // Minimal safe rich text: **bold** and `code`, everything else literal.
  function richParts(text) {
    return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return { kind: "bold", text: part.slice(2, -2) };
      if (/^`[^`]+`$/.test(part)) return { kind: "code", text: part.slice(1, -1) };
      return { kind: "text", text: part };
    });
  }

  function richText(container, text) {
    for (const part of richParts(text)) {
      if (part.kind === "bold") {
        const b = document.createElement("b");
        b.textContent = part.text;
        container.appendChild(b);
      } else if (part.kind === "code") {
        const c = document.createElement("code");
        c.textContent = part.text;
        container.appendChild(c);
      } else {
        container.appendChild(document.createTextNode(part.text));
      }
    }
  }

  // Tutor speech types by default. A click reveals the rest immediately;
  // reduced-motion users receive the complete message without animation.
  function typeRichText(container, text, { speedMs = 28, onDone = null } = {}) {
    const parts = richParts(text).map((part) => ({ ...part, chars: Array.from(part.text) }));
    const fullText = parts.map((part) => part.text).join("");
    container.setAttribute("aria-label", fullText);
    if (matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || speedMs <= 0) {
      richText(container, text);
      onDone?.();
      return null;
    }

    let timerId = null;
    let partIndex = 0;
    let charIndex = 0;
    let node = null;
    let ended = false;
    container.classList.add("is-typing");
    container.setAttribute("aria-busy", "true");

    const complete = () => {
      if (ended) return;
      ended = true;
      if (timerId) clearTimeout(timerId);
      container.classList.remove("is-typing");
      container.setAttribute("aria-busy", "false");
      onDone?.();
    };
    const appendNode = (part) => {
      if (part.kind === "bold") node = document.createElement("b");
      else if (part.kind === "code") node = document.createElement("code");
      else node = document.createTextNode("");
      container.appendChild(node);
    };
    const tick = () => {
      if (ended) return;
      const part = parts[partIndex];
      if (!part) { complete(); return; }
      if (!node) appendNode(part);
      const char = part.chars[charIndex];
      node.textContent += char;
      charIndex += 1;
      if (charIndex >= part.chars.length) {
        partIndex += 1;
        charIndex = 0;
        node = null;
      }
      const delay = /[.!?]/.test(char) ? 140 : /[,;:]/.test(char) ? 75 : char === " " ? 12 : speedMs;
      timerId = setTimeout(tick, delay);
    };
    timerId = setTimeout(tick, 120);

    return {
      cancel() { complete(); },
      finish() {
        if (ended) return;
        if (timerId) clearTimeout(timerId);
        container.textContent = "";
        richText(container, text);
        complete();
      },
    };
  }

  let popoverEl = null;
  let textAnimation = null;

  function elementRect(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }

  function overlapArea(a, b) {
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  }

  function paddedRect(r, amount) {
    return {
      left: r.left - amount, top: r.top - amount,
      right: r.right + amount, bottom: r.bottom + amount,
      width: r.width + amount * 2, height: r.height + amount * 2,
    };
  }

  // Tutor speech protects the pane being taught, plus author-supplied
  // `avoid` targets. Candidate placement then chooses the nearest region
  // with the least protected-area overlap. This keeps lesson content visible
  // while remaining viewport-safe on smaller layouts.
  function positionPopover() {
    if (!popoverEl || !popoverState) return;
    const anchor = resolveTarget(popoverState.spec, { editor });
    if (!anchor) { popoverEl.style.visibility = "hidden"; return; }
    popoverEl.style.visibility = "";
    const r = anchor.getBoundingClientRect();
    const pw = popoverEl.offsetWidth, ph = popoverEl.offsetHeight;
    const margin = 8;
    const gap = 12;
    const maxLeft = Math.max(margin, innerWidth - pw - margin);
    const maxTop = Math.max(margin, innerHeight - ph - margin);
    const candidates = [];
    const seen = new Set();
    const add = (left, top, name) => {
      left = Math.min(Math.max(margin, left), maxLeft);
      top = Math.min(Math.max(margin, top), maxTop);
      const key = `${Math.round(left)}:${Math.round(top)}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ left, top, name });
    };

    add(r.left, r.bottom + gap, "below");
    add(r.left + r.width / 2 - pw / 2, r.bottom + gap, "below-center");
    add(r.left, r.top - ph - gap, "above");
    add(r.left + r.width / 2 - pw / 2, r.top - ph - gap, "above-center");
    add(r.right + gap, r.top + r.height / 2 - ph / 2, "right");
    add(r.left - pw - gap, r.top + r.height / 2 - ph / 2, "left");
    add(margin, margin, "viewport-top-left");
    add(innerWidth - pw - margin, margin, "viewport-top-right");
    add(margin, innerHeight - ph - margin, "viewport-bottom-left");
    add(innerWidth - pw - margin, innerHeight - ph - margin, "viewport-bottom-right");

    const panes = [...document.querySelectorAll("#editor-pane, #memory-pane, #console-pane")];
    for (const pane of panes) {
      const pr = elementRect(pane);
      if (!pr || pr.width < pw || pr.height < ph) continue;
      add(pr.left + (pr.width - pw) / 2, pr.top + (pr.height - ph) / 2, `pane-${pane.id}`);
    }

    const protectedElements = new Set([anchor]);
    if (popoverState.avatar) {
      const ownerPane = anchor.closest("#editor-pane, #memory-pane, #console-pane");
      if (ownerPane) protectedElements.add(ownerPane);
      for (const spotlightState of spotlights) {
        const spotlightEl = resolveTarget(spotlightState.spec, { editor });
        if (!spotlightEl) continue;
        protectedElements.add(spotlightEl);
        const spotlightPane = spotlightEl.closest("#editor-pane, #memory-pane, #console-pane");
        if (spotlightPane) protectedElements.add(spotlightPane);
      }
    }
    for (const avoidSpec of popoverState.avoid) {
      const avoidEl = resolveTarget(avoidSpec, { editor });
      if (avoidEl) protectedElements.add(avoidEl);
    }
    const protectedRects = [...protectedElements].map(elementRect).filter(Boolean);
    const anchorRect = paddedRect(elementRect(anchor), gap);
    const chromeRects = [document.querySelector("header"), document.querySelector(".director-strip")]
      .map(elementRect).filter(Boolean);
    const anchorX = r.left + r.width / 2;
    const anchorY = r.top + r.height / 2;

    const scored = candidates.map((candidate) => {
      const cr = { left: candidate.left, top: candidate.top, right: candidate.left + pw, bottom: candidate.top + ph };
      const protectedOverlap = protectedRects.reduce((sum, pr) => sum + overlapArea(cr, pr), 0);
      const anchorOverlap = overlapArea(cr, anchorRect);
      const chromeOverlap = chromeRects.reduce((sum, hr) => sum + overlapArea(cr, hr), 0);
      const distance = Math.hypot(candidate.left + pw / 2 - anchorX, candidate.top + ph / 2 - anchorY);
      const paneBonus = candidate.name.startsWith("pane-") ? -200 : 0;
      return {
        ...candidate,
        score: protectedOverlap * 10_000 + anchorOverlap * 20_000 + chromeOverlap * 5_000 + distance + paneBonus,
      };
    }).sort((a, b) => a.score - b.score);

    const best = scored[0];
    popoverEl.style.top = `${best.top}px`;
    popoverEl.style.left = `${best.left}px`;
    popoverEl.dataset.placement = best.name;
  }

  // One popover at a time (P2). Non-modal; Esc or ✕ dismisses (the director
  // may also clear/replace it). onWhy adds a learner-invoked "why?" (P5).
  function popover(spec, text, {
    sticky = false, onWhy = null, kind = "guide", avatar = false,
    typing = avatar, typingSpeedMs = 28, avoid = [],
  } = {}) {
    dismissPopover();
    popoverState = { spec, text, sticky, avoid, avatar };
    popoverEl = document.createElement("div");
    popoverEl.className = `stage-popover ${kind}`;
    popoverEl.classList.toggle("teacher", avatar);
    popoverEl.setAttribute("role", "note");
    if (avatar) {
      const art = document.createElement("img");
      art.className = "stage-teacher-art";
      art.src = TUTOR_IMAGE_URL;
      art.alt = "";
      art.setAttribute("aria-hidden", "true");
      art.addEventListener("load", positionPopover, { once: true });
      popoverEl.appendChild(art);
    }
    const body = document.createElement("div");
    body.className = "stage-popover-body";
    popoverEl.appendChild(body);
    const renderMessage = (message) => {
      textAnimation?.cancel();
      textAnimation = null;
      body.textContent = "";
      body.removeAttribute("aria-label");
      popoverEl?.classList.toggle("is-typing", Boolean(typing));
      if (typing) {
        textAnimation = typeRichText(body, message, {
          speedMs: typingSpeedMs,
          onDone: () => popoverEl?.classList.remove("is-typing"),
        });
      } else {
        richText(body, message);
      }
    };
    body.addEventListener("click", () => textAnimation?.finish());
    renderMessage(text);
    const row = document.createElement("div");
    row.className = "stage-popover-actions";
    if (onWhy) {
      const why = document.createElement("button");
      why.type = "button";
      why.textContent = "why?";
      why.addEventListener("click", () => {
        renderMessage(onWhy());
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
    events.emit("popover-shown", { text: String(text).slice(0, 80), avatar });
  }

  // Director grammar's character-speaking primitive. The stage still owns
  // the concrete artwork and bubble layout; lessons only provide the target
  // and words through `{ say: { at, md, sticky? } }`.
  function say(spec, text, options = {}) {
    popover(spec, text, { ...options, avatar: true });
  }

  function dismissPopover() {
    textAnimation?.cancel();
    textAnimation = null;
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
    for (const el of [...cueTimers.keys()]) clearCueElement(el);
    for (const el of document.querySelectorAll(".stage-cue, .stage-pulse")) clearCueElement(el);
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
    cue,
    pulse,
    popover,
    say,
    dismissPopover,
    veil,
    unveil,
    clearEffects,
    resolveTarget: (spec) => resolveTarget(spec, { editor }),
    // Full teardown (director exit / crash path).
    reset() { clearEffects(); resetGates(); },
  };
}
