// Tutor pane presentation: the transcript feed (chat-history bubbles), the
// current-beat POPUP, and the controls strip. Owns DOM only — sequencing,
// grading, and persistence live in tutor.mjs.
//
// Two reading surfaces, one history:
//  - The FEED is the complete chat history. Every card lives there as a
//    clickable bubble.
//  - The POPUP is the roomy reading surface for the current "beat" (the
//    lead-in prose plus the blocking question/action). It is NON-MODAL —
//    no backdrop, the app stays fully usable — and draggable, so it can
//    never permanently cover the pane a task is pointing at. Closing it
//    changes nothing about the lesson; the pane alone remains sufficient.
//  - Clicking any bubble (re)opens that card in the popup. Static cards
//    are rebuilt from their descriptors; live interactive cards (question
//    inputs, construction workspaces) are REPARENTED so typed answers and
//    workspace state survive, leaving a "current step" stub in the feed.
//
// Cards come in two families:
//  - static cards (addCard): serializable descriptors the runtime persists
//    and replays on restore — say / learner / action / hint / system, plus
//    the frozen summary form of an answered question;
//  - interactive cards (addInteractiveCard): a live answer surface with an
//    actions row. Never persisted as-is; the runtime freezes them into a
//    static descriptor once resolved.
//
// Safety rule (invariant 8 spirit): card text arrives from lesson authors
// and from LEARNER ANSWERS; everything renders via textContent — the only
// innerHTML in this file is static chrome with no interpolation.

import { renderInline, verdictSpan, buildStaticCard, buildControlButton } from "./tutor-widgets.mjs";

// Markdown-lite rendering, static cards, and control buttons live in
// tutor-widgets.mjs — shared with the practice card surface so the two
// learner surfaces render identically.

export function createTutorUI({ root, layout }) {
  const el = (r) => root.querySelector(`[data-role=${r}]`);
  const feed = el("tutor-feed");
  const controls = el("tutor-controls");
  const progressEl = el("tutor-progress");
  const exitBtn = el("tutor-exit");
  const collapseBtn = el("tutor-collapse");

  let onExit = null;
  let onTryIt = null; // set by the runtime; applies to every say card
  let reviewContext = null; // runtime hook: descs -> context desc | null

  exitBtn.addEventListener("click", () => onExit?.());
  collapseBtn.addEventListener("click", () => { closePopup(); layout.setTutorVisible(false); });

  // ---- the stage (promoted beat panel) -----------------------------------
  // In FOCUS mode the stage fills the code column full-height — the question
  // takes center stage while the editor recedes to the right column. Outside
  // focus it falls back to the classic docked beat panel under the code pane
  // (style.css `#layout > .tutor-popup`). Either way it never floats and
  // never occludes. The head's "Back to editor" drops focus to the classic
  // layout; 📜 toggles the transcript rail; clicking any feed bubble
  // (re)opens the current beat.
  const popup = document.createElement("div");
  popup.className = "tutor-popup tutor-stage";
  popup.hidden = true;
  popup.innerHTML = `
    <div class="tutor-popup-head" data-role="popup-head">
      <span class="tutor-popup-title" data-role="popup-title">Exercises</span>
      <span class="tutor-stage-progress" data-role="stage-progress"></span>
      <span class="spacer"></span>
      <button data-role="stage-history" type="button" title="Show or hide the transcript">📜 History</button>
      <button data-role="popup-close" type="button" title="Back to the editor layout (Exercises stays open in the corner)">⇱ Back to editor</button>
      <button data-role="stage-exit" type="button" hidden title="End the lesson">✕ End lesson</button>
    </div>
    <div class="tutor-popup-body" data-role="popup-body"></div>
    <div class="tutor-popup-foot" data-role="popup-foot"></div>`;
  const layoutEl = document.getElementById("layout");
  layoutEl.appendChild(popup);
  const popupBody = popup.querySelector("[data-role=popup-body]");
  const popupFoot = popup.querySelector("[data-role=popup-foot]");
  popup.querySelector("[data-role=popup-close]").addEventListener("click", () => {
    if (layout.isFocused?.()) layout.exitFocus({ pane: true }); // classic dock, transcript back
    else closePopup();
  });
  const stageExitBtn = popup.querySelector("[data-role=stage-exit]");
  stageExitBtn.addEventListener("click", () => onExit?.());
  popup.querySelector("[data-role=stage-history]").addEventListener("click", () => {
    layout.setFocusFlags?.({ history: !layoutEl.classList.contains("focus-history") });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || popup.hidden) return;
    if (layout.isFocused?.()) layout.exitFocus({ pane: true });
    else closePopup();
  });

  let livePopped = null; // interactive/live handle currently reparented

  // Return a reparented live card to its feed bubble.
  function returnLive() {
    if (!livePopped) return;
    const { bubble, el: cardEl } = livePopped;
    bubble.querySelector(".tutor-bubble-stub")?.remove();
    bubble.appendChild(cardEl);
    livePopped = null;
  }

  function closePopup() {
    returnLive();
    popupBody.textContent = "";
    popup.hidden = true;
    layout.notifyResize?.(); // the editor gets its row back
  }

  // Show a beat: rebuilt static descriptors + at most one live card.
  // review=true marks a bubble reopened from history — the runtime may
  // prepend a program-context card when the editor has changed since.
  function popBatch(descs = [], liveHandle = null, { review = false } = {}) {
    returnLive();
    popupBody.textContent = "";
    // A NEW live question resets the reveal choreography: the console
    // shrinks back to its strip and the memory pane tucks away. Static
    // beats (explain cards, pauses) deliberately keep the grown console —
    // the learner reads the card with the real output still on screen.
    if (liveHandle) layout.setFocusFlags?.({ reveal: false, memory: false });
    if (review && reviewContext) {
      // A live handle carries its own program stamp via handle.desc.
      const all = liveHandle?.desc ? [...descs, liveHandle.desc] : descs;
      const extra = reviewContext(all);
      if (extra) descs = [extra, ...descs];
    }
    for (const desc of descs) popupBody.appendChild(buildStatic(desc));
    if (liveHandle) {
      const stub = document.createElement("button");
      stub.type = "button";
      stub.className = "tutor-bubble-stub";
      stub.textContent = "⧉ This question is open — click to bring it back";
      stub.title = "Reopen this question";
      stub.addEventListener("click", () => popBatch([], liveHandle));
      liveHandle.bubble.appendChild(stub);
      popupBody.appendChild(liveHandle.el);
      livePopped = liveHandle;
    }
    // In focus mode the stage IS the center surface: an empty beat keeps it
    // up (the foot's Continue/menu controls remain actionable). Outside
    // focus, an empty beat panel closes as before.
    if (!popupBody.childElementCount && !layout.isFocused?.()) { closePopup(); return; }
    const wasHidden = popup.hidden;
    popup.hidden = false;
    popupBody.scrollTop = 0;
    if (wasHidden) layout.notifyResize?.(); // the editor row shrank
  }

  // Append a late arrival (e.g. a hint during an ask) to the open popup.
  function appendToPopup(desc) {
    if (popup.hidden) return;
    popupBody.appendChild(buildStatic(desc));
    popupBody.scrollTop = popupBody.scrollHeight;
  }

  function scrollToEnd() {
    feed.scrollTop = feed.scrollHeight;
  }

  // Static cards build in tutor-widgets.mjs; onTryIt is bound late (set
  // by the runtime), so the wrapper reads the current value per call.
  const buildStatic = (desc) => buildStaticCard(desc, { onTryIt: onTryIt ?? undefined });

  // Wrap a card element in a feed bubble. Clicking the bubble pops the
  // card (rebuild for statics, reparent for live handles); clicks on the
  // card's own interactive elements never trigger the pop.
  function addBubble(cardEl, onOpen) {
    const bubble = document.createElement("div");
    bubble.className = "tutor-bubble";
    bubble.appendChild(cardEl);
    if (onOpen) {
      bubble.addEventListener("click", (e) => {
        if (e.target.closest("button, input, textarea, select, a")) return;
        onOpen();
      });
      cardEl.classList.add("openable");
    }
    feed.appendChild(bubble);
    scrollToEnd();
    return bubble;
  }

  // ---- static, serializable cards ---------------------------------------
  function addCard(desc) {
    const card = buildStatic(desc);
    const handle = {
      el: card,
      bubble: null,
      desc,
      markDone() { card.classList.add("done"); },
    };
    // Live action cards ({type:"action", done:false}) reparent so markDone
    // reaches the popped copy; everything else rebuilds from the descriptor.
    // A COMPLETED action reopens in review mode — it may describe a program
    // the editor no longer holds.
    const isLiveAction = desc.type === "action" && desc.done === false;
    handle.bubble = addBubble(card, () => {
      if (isLiveAction) popBatch([], handle, { review: card.classList.contains("done") });
      else popBatch([desc], null, { review: true });
    });
    return handle;
  }

  // ---- interactive cards (live answer surfaces) --------------------------
  // render(bodyEl) builds the answer surface and may return a view object
  // (question-ui's { collect, applyResult, … }); actions = [{ label,
  // primary, onClick }]. onClick receives the card handle.
  function addInteractiveCard({ className = "", prompt, render, actions = [], prog }) {
    const card = document.createElement("div");
    card.className = `tutor-card tutor-question ${className}`;
    if (prompt) {
      const p = document.createElement("p");
      renderInline(p, prompt);
      card.appendChild(p);
    }
    const body = document.createElement("div");
    body.className = "tutor-q-body";
    card.appendChild(body);
    const view = render?.(body) ?? null;

    const actionRow = document.createElement("div");
    actionRow.className = "tutor-q-actions";
    card.appendChild(actionRow);
    const note = document.createElement("span");
    note.className = "hint";

    const handle = {
      el: card,
      bubble: null,
      body,
      view,
      desc: prog === undefined ? null : { prog },
      setNote(text) { note.textContent = text ?? ""; },
      setActions(list) {
        actionRow.textContent = "";
        for (const a of list) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = a.label;
          if (a.primary) btn.classList.add("primary");
          btn.addEventListener("click", () => a.onClick(handle));
          actionRow.appendChild(btn);
        }
        actionRow.appendChild(note);
      },
      verdict(ok, text) {
        card.appendChild(verdictSpan(ok, text));
        // One-shot success bloom (CSS keyframe; removed on animation end so
        // a reopened card can bloom again if re-answered).
        if (ok) {
          card.classList.add("t-bloom");
          card.addEventListener("animationend", () => card.classList.remove("t-bloom"), { once: true });
        }
      },
      freeze() {
        card.classList.add("frozen");
      },
    };
    handle.setActions(actions);
    // A FROZEN question reopens in review mode (its program may be gone).
    handle.bubble = addBubble(card, () => popBatch([], handle, { review: card.classList.contains("frozen") }));
    return handle;
  }

  return {
    addCard,
    addInteractiveCard,
    popBatch,
    appendToPopup,
    closePopup,
    isPopupOpen: () => !popup.hidden,
    clear() {
      layout.setFocusFlags?.({ reveal: false, memory: false });
      closePopup();
      feed.textContent = "";
    },
    // Reveal choreography (focus mode): called right before the real run —
    // the console strip growing IS the "now watch it run" cue; predict-state
    // reveals also open the memory pane so the state is inspectable.
    beginReveal({ memory = false } = {}) {
      layout.setFocusFlags?.({ reveal: true, ...(memory ? { memory: true } : {}) });
    },
    // A custom stage view (the concept map): replaces the beat content with
    // an arbitrary element; the next popBatch/beat reclaims the stage.
    showCustom(el) {
      returnLive();
      popupBody.textContent = "";
      layout.setFocusFlags?.({ reveal: false, memory: false });
      popupBody.appendChild(el);
      const wasHidden = popup.hidden;
      popup.hidden = false;
      popupBody.scrollTop = 0;
      if (wasHidden) layout.notifyResize?.();
    },
    // Beats that USE the IDE (scrub actions, memory questions) need the
    // memory pane even in focus mode.
    setStageMemory(on) { layout.setFocusFlags?.({ memory: Boolean(on) }); },
    setControls(list) {
      // Mirrored: the pane strip stays authoritative; the popup foot lets
      // the learner act (Continue, Back to units) without leaving the popup.
      for (const host of [controls, popupFoot]) {
        host.textContent = "";
        for (const a of list) host.appendChild(buildControlButton(a));
      }
    },
    setProgress(text) {
      progressEl.textContent = text ?? "";
      popup.querySelector("[data-role=popup-title]").textContent = text ? `Exercises — ${text}` : "Exercises";
    },
    // Both exits mirror: the transcript pane's button and the stage
    // header's visible "✕ End lesson" (the stage is where the learner is).
    setExitVisible(v) { exitBtn.hidden = !v; stageExitBtn.hidden = !v; },
    setOnExit(fn) { onExit = fn; },
    setOnTryIt(fn) { onTryIt = fn; },
    setReviewContext(fn) { reviewContext = fn; },
    scrollToEnd,
    show() { layout.setTutorVisible(true); },
    hide() { layout.setTutorVisible(false); },
  };
}
