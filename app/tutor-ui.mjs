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

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

function renderInline(el, text) {
  for (const part of String(text).split(INLINE_RE)) {
    if (!part) continue;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const code = document.createElement("code");
      code.textContent = part.slice(1, -1);
      el.appendChild(code);
    } else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      const b = document.createElement("strong");
      b.textContent = part.slice(2, -2);
      el.appendChild(b);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  }
}

// Markdown subset: blank-line paragraphs, ``` fences, `code`, **bold**.
// onTryIt (optional) adds a "↪ try it" button to ```py/```python fences.
export function renderMd(container, md, { onTryIt } = {}) {
  const lines = String(md ?? "").split("\n");
  let para = [];
  let fence = null; // collecting fenced lines when non-null
  let fenceLang = "";
  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement("p");
    renderInline(p, para.join(" "));
    container.appendChild(p);
    para = [];
  };
  for (const line of lines) {
    if (fence !== null) {
      if (line.trimEnd() === "```") {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        const text = fence.join("\n");
        code.textContent = text;
        pre.appendChild(code);
        // "try it" only on runnable fences, never on ASCII diagrams.
        if (onTryIt && fenceLang.startsWith("py")) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "tutor-tryit";
          btn.textContent = "↪ try it";
          btn.title = "Load this code into the editor";
          btn.addEventListener("click", () => onTryIt(text));
          pre.appendChild(btn);
        }
        container.appendChild(pre);
        fence = null;
      } else {
        fence.push(line);
      }
    } else if (line.trimStart().startsWith("```")) {
      flushPara();
      fence = [];
      fenceLang = line.trim().slice(3).trim().toLowerCase();
    } else if (line.trim() === "") {
      flushPara();
    } else {
      para.push(line);
    }
  }
  if (fence !== null) { // unterminated fence: render what we have
    const pre = document.createElement("pre");
    pre.textContent = fence.join("\n");
    container.appendChild(pre);
  }
  flushPara();
}

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

  // ---- popup chrome ------------------------------------------------------
  const popup = document.createElement("div");
  popup.className = "tutor-popup";
  popup.hidden = true;
  popup.innerHTML = `
    <div class="tutor-popup-head" data-role="popup-head">
      <span class="tutor-popup-title" data-role="popup-title">Exercises</span>
      <span class="spacer"></span>
      <button data-role="popup-close" type="button" title="Close (the lesson continues in the side pane)">✕</button>
    </div>
    <div class="tutor-popup-body" data-role="popup-body"></div>
    <div class="tutor-popup-foot" data-role="popup-foot"></div>`;
  document.body.appendChild(popup);
  const popupBody = popup.querySelector("[data-role=popup-body]");
  const popupFoot = popup.querySelector("[data-role=popup-foot]");
  popup.querySelector("[data-role=popup-close]").addEventListener("click", () => closePopup());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popup.hidden) closePopup();
  });

  // Drag by the header (the popup must never be an immovable occluder).
  {
    const head = popup.querySelector("[data-role=popup-head]");
    head.addEventListener("pointerdown", (down) => {
      if (down.target.closest("button")) return;
      down.preventDefault();
      head.setPointerCapture(down.pointerId);
      const rect = popup.getBoundingClientRect();
      const dx = down.clientX - rect.left;
      const dy = down.clientY - rect.top;
      const move = (ev) => {
        popup.style.left = `${Math.max(0, Math.min(ev.clientX - dx, innerWidth - 80))}px`;
        popup.style.top = `${Math.max(0, Math.min(ev.clientY - dy, innerHeight - 48))}px`;
        popup.style.bottom = "auto";
      };
      const up = () => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
    });
  }

  let livePopped = null; // interactive/live handle currently reparented

  function placePopup() {
    if (popup.style.top) return; // user has dragged it; respect that
    const paneRect = root.getBoundingClientRect();
    const width = popup.getBoundingClientRect().width || 560;
    let left = layout.isTutorVisible() ? paneRect.right + 12 : 16;
    left = Math.max(8, Math.min(left, innerWidth - width - 8)); // stay on-screen
    popup.style.left = `${left}px`;
    popup.style.bottom = "16px";
  }

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
  }

  // Show a beat: rebuilt static descriptors + at most one live card.
  // review=true marks a bubble reopened from history — the runtime may
  // prepend a program-context card when the editor has changed since.
  function popBatch(descs = [], liveHandle = null, { review = false } = {}) {
    returnLive();
    popupBody.textContent = "";
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
    if (!popupBody.childElementCount) { closePopup(); return; }
    popup.hidden = false; // unhide first so placePopup can measure width
    placePopup();
    popupBody.scrollTop = 0;
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

  function verdictSpan(ok, text) {
    const span = document.createElement("span");
    span.className = `tutor-verdict ${ok ? "good" : "bad"}`;
    span.textContent = text;
    return span;
  }

  // ---- static card builder (used by the feed AND popup rebuilds) ---------
  function buildStatic(desc) {
    let card;
    const make = (cls) => {
      const div = document.createElement("div");
      div.className = `tutor-card ${cls}`;
      return div;
    };
    if (desc.type === "say") {
      card = make(desc.pocket ? "tutor-say tutor-pocket" : "tutor-say");
      if (desc.pocket) {
        const t = document.createElement("div");
        t.className = "tutor-pocket-title";
        t.textContent = typeof desc.pocket === "string" ? desc.pocket : "Pocket of knowledge";
        card.appendChild(t);
      }
      renderMd(card, desc.md, { onTryIt: onTryIt ?? undefined });
    } else if (desc.type === "learner") {
      card = make("tutor-learner");
      if (desc.pre) {
        const pre = document.createElement("pre");
        pre.textContent = desc.text;
        card.appendChild(pre);
      } else {
        const p = document.createElement("p");
        p.textContent = desc.text;
        card.appendChild(p);
      }
      if (desc.verdict) {
        card.appendChild(verdictSpan(desc.verdict === "correct", desc.verdict === "correct" ? "✓" : "✗"));
      }
    } else if (desc.type === "action") {
      card = make(desc.done ? "tutor-action done" : "tutor-action");
      const goal = document.createElement("div");
      goal.className = "tutor-action-goal";
      renderInline(goal, desc.md);
      card.appendChild(goal);
    } else if (desc.type === "hint") {
      card = make("tutor-say tutor-hint-card");
      renderMd(card, desc.md, { onTryIt: onTryIt ?? undefined });
    } else if (desc.type === "context") {
      // Review aid, never persisted: the program an old step was about,
      // shown when the editor has changed since.
      card = make("tutor-context");
      const label = document.createElement("p");
      label.className = "hint";
      label.textContent = "The editor has changed since this step. It was about this program:";
      card.appendChild(label);
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = desc.code;
      pre.appendChild(code);
      if (onTryIt) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tutor-tryit";
        btn.textContent = "↪ load this program";
        btn.title = "Put this program back in the editor";
        btn.addEventListener("click", () => onTryIt(desc.code));
        pre.appendChild(btn);
      }
      card.appendChild(pre);
    } else if (desc.type === "question-frozen") {
      card = make("tutor-question frozen");
      const p = document.createElement("p");
      renderInline(p, desc.prompt ?? "");
      card.appendChild(p);
      if (desc.answerText) {
        const pre = document.createElement("pre");
        pre.textContent = desc.answerText;
        card.appendChild(pre);
      }
      card.appendChild(verdictSpan(desc.ok, desc.verdict ?? (desc.ok ? "✓ correct" : "✗")));
    } else {
      card = make("tutor-sys");
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = String(desc.text ?? "");
      card.appendChild(p);
    }
    return card;
  }

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
    clear() { closePopup(); feed.textContent = ""; },
    setControls(list) {
      // Mirrored: the pane strip stays authoritative; the popup foot lets
      // the learner act (Continue, Back to units) without leaving the popup.
      for (const host of [controls, popupFoot]) {
        host.textContent = "";
        for (const a of list) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = a.label;
          if (a.primary) btn.classList.add("primary");
          btn.addEventListener("click", a.onClick);
          host.appendChild(btn);
        }
      }
    },
    setProgress(text) {
      progressEl.textContent = text ?? "";
      popup.querySelector("[data-role=popup-title]").textContent = text ? `Exercises — ${text}` : "Exercises";
    },
    setExitVisible(v) { exitBtn.hidden = !v; },
    setOnExit(fn) { onExit = fn; },
    setOnTryIt(fn) { onTryIt = fn; },
    setReviewContext(fn) { reviewContext = fn; },
    scrollToEnd,
    show() { layout.setTutorVisible(true); },
    hide() { layout.setTutorVisible(false); },
  };
}
