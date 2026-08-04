// The practice card surface: a full-viewport, one-card-at-a-time view that
// owns the screen during KB practice rounds. Program, question, input,
// proof — and nothing else. The IDE (header + #layout) hides under
// `body.practice`; the engine keeps running underneath (xterm buffers its
// chunks; CodeMirror gets a refresh when the IDE returns).
//
// Implements the same ui duck-type the lesson runtime consumes (see
// tutor.mjs's surface router), so the runtime's sequencing, grading,
// persistence, and met-granting run verbatim — only the presentation
// differs from the stage. Guided lessons keep the stage; this surface
// serves the menu, the concept map, drills, and round summaries.

import { buildStaticCard, buildControlButton, renderInline, verdictSpan } from "./tutor-widgets.mjs";

export function createPracticeUI({ layout, getCode }) {
  let onExit = null;
  let onTryIt = null;

  const root = document.createElement("div");
  root.id = "practice";
  root.hidden = true;
  root.innerHTML = `
    <div class="pr-top">
      <button type="button" data-role="pr-leave" title="Back to the editor (your round is saved)">←</button>
      <span class="pr-title" data-role="pr-title">Exercises</span>
      <span class="pr-dots" data-role="pr-dots"></span>
      <span class="spacer"></span>
      <button type="button" data-role="pr-exit-lesson" hidden>✕ End round</button>
    </div>
    <div class="pr-body" data-role="pr-body"></div>
    <div class="pr-controls" data-role="pr-controls"></div>`;
  document.body.appendChild(root);
  const body = root.querySelector("[data-role=pr-body]");
  const controlsHost = root.querySelector("[data-role=pr-controls]");
  const titleEl = root.querySelector("[data-role=pr-title]");
  const dotsEl = root.querySelector("[data-role=pr-dots]");
  const exitBtn = root.querySelector("[data-role=pr-exit-lesson]");

  root.querySelector("[data-role=pr-leave]").addEventListener("click", () => hide());
  exitBtn.addEventListener("click", () => onExit?.());
  // Esc leaves practice back to the IDE (symmetric with the 🎓 toggle);
  // the round stays resumable from the persisted store.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("practice")) hide();
  });

  // current = { type: "question", handle } | { type: "static" } | null
  let current = null;
  const handleMeta = new WeakMap(); // card el → { capturedCode }

  function show() {
    document.body.classList.add("practice");
    root.hidden = false;
    layout.setExercisesVisible?.(true);
    // Coming back from the editor with the program changed? Offer to put
    // the question's program back (never silently — the learner may want
    // to grade their edited version; the interpreter judges what runs).
    const meta = current?.type === "question" ? handleMeta.get(current.handle.el) : null;
    const cardEl = current?.handle?.el;
    cardEl?.querySelector(".pr-restore-chip")?.remove();
    if (meta && getCode() !== meta.capturedCode && !cardEl.classList.contains("frozen")) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "pr-restore-chip";
      chip.textContent = "↩ put the question's program back";
      chip.addEventListener("click", () => { onTryIt?.(meta.capturedCode); chip.remove(); });
      cardEl.querySelector(".pr-program")?.insertAdjacentElement("afterend", chip);
    }
  }
  function hide() {
    document.body.classList.remove("practice");
    root.hidden = true;
    layout.setExercisesVisible?.(false);
    layout.notifyResize?.(); // the IDE is back: CM refresh + xterm fit
  }

  // ---- the question card ---------------------------------------------------
  function mountProgram(host, code) {
    const block = document.createElement("div");
    block.className = "pr-program";
    if (window.CodeMirror && code.trim()) {
      const cm = window.CodeMirror(block, {
        mode: "python",
        readOnly: "nocursor",
        lineNumbers: false,
        viewportMargin: Infinity,
        value: code.replace(/\n$/, ""),
      });
      requestAnimationFrame(() => cm.refresh());
    } else {
      const pre = document.createElement("pre");
      pre.textContent = code;
      block.appendChild(pre);
    }
    host.appendChild(block);
    return block;
  }

  // First-time mechanics: one quiet line under the input, shown once per
  // form ever (presentation state, not pedagogy — lives in plp.practice.v1).
  const MECHANICS = {
    "predict-exact-output": "type your answer, press Enter — the program really runs",
    "predict-output": "type your answer, press Enter — the program really runs",
    "predict-state": "type the value it holds, like 7 or [1, 2]",
    "fill-one-blank": "type just the missing piece — it runs with your fill",
    "spot-the-difference": "type what the changed program prints",
  };
  function mechanicsLineFor(form) {
    let seen;
    try { seen = JSON.parse(localStorage.getItem("plp.practice.v1")) ?? {}; } catch { seen = {}; }
    seen.forms ??= {};
    if (!form || seen.forms[form]) return null;
    seen.forms[form] = true;
    try { localStorage.setItem("plp.practice.v1", JSON.stringify(seen)); } catch { /* ephemeral */ }
    return MECHANICS[form] ?? null;
  }

  function addInteractiveCard({ prompt, render, teach, context, form }) {
    const el = document.createElement("div");
    el.className = "pr-question tutor-question";
    const code = getCode();

    const intro = document.createElement("div");
    intro.className = "pr-intro";
    el.appendChild(intro);

    // Spot-the-difference: program A with its real output, above program B.
    if (context?.code) {
      const ctx = document.createElement("div");
      ctx.className = "pr-context";
      const label = document.createElement("p");
      label.className = "pr-reveal-label";
      label.textContent = "this program";
      ctx.appendChild(label);
      mountProgram(ctx, context.code);
      const out = document.createElement("p");
      out.className = "pr-out";
      out.append("prints ");
      const codeEl = document.createElement("code");
      codeEl.textContent = context.output ?? "";
      out.appendChild(codeEl);
      ctx.appendChild(out);
      const divider = document.createElement("p");
      divider.className = "pr-divider hint";
      divider.textContent = "one line changed ↓";
      ctx.appendChild(divider);
      el.appendChild(ctx);
    }

    const programBlock = mountProgram(el, code);
    // Escape hatch: the real IDE is one tap away, program loaded. If the
    // learner edits it there and comes back, a chip offers to restore the
    // question's program (grade-what-runs stays the philosophy either way).
    const openLink = document.createElement("button");
    openLink.type = "button";
    openLink.className = "pr-quiet pr-open-editor";
    openLink.textContent = "open in editor";
    openLink.addEventListener("click", () => hide());
    programBlock.insertAdjacentElement("afterend", openLink);
    handleMeta.set(el, { capturedCode: code });

    const teachSlot = document.createElement("div");
    teachSlot.className = "pr-teach-slot";
    el.appendChild(teachSlot);
    // First encounter of a new concept: the one-sentence rule right above
    // the question; the worked example is a tap away, never imposed.
    if (teach?.statement) {
      const t = document.createElement("div");
      t.className = "pr-teach";
      const line = document.createElement("p");
      line.className = "pr-teach-line";
      line.append("🌱 ");
      const strong = document.createElement("strong");
      strong.textContent = "New: ";
      line.appendChild(strong);
      renderInline(line, teach.statement);
      t.appendChild(line);
      if (teach.card) {
        const details = document.createElement("details");
        details.className = "pr-teach-example";
        const summaryEl = document.createElement("summary");
        summaryEl.textContent = "show me an example";
        details.appendChild(summaryEl);
        const cardBody = document.createElement("div");
        cardBody.className = "tutor-card tutor-say";
        details.appendChild(cardBody);
        details.addEventListener("toggle", () => {
          if (details.open && !cardBody.childElementCount) {
            const built = buildStaticCard({ type: "say", md: teach.card }, { onTryIt: onTryIt ?? undefined });
            cardBody.replaceChildren(...built.childNodes);
          }
        });
        t.appendChild(details);
      }
      teachSlot.appendChild(t);
    }

    const p = document.createElement("p");
    p.className = "pr-prompt";
    renderInline(p, prompt ?? "");
    el.appendChild(p);

    const hints = document.createElement("div");
    hints.className = "pr-hints";
    el.appendChild(hints);

    const answer = document.createElement("div");
    answer.className = "pr-answer tutor-q-body";
    el.appendChild(answer);
    // The runtime renders its own input (and binds its Enter handler) into
    // the body we provide — same contract as the stage.
    const view = render?.(answer) ?? null;
    const mech = mechanicsLineFor(form);
    if (mech) {
      const m = document.createElement("p");
      m.className = "pr-mechanics hint";
      m.textContent = mech;
      el.appendChild(m);
    }

    const revealSlot = document.createElement("div");
    revealSlot.className = "pr-reveal-slot";
    el.appendChild(revealSlot);

    const explain = document.createElement("div");
    explain.className = "pr-explain";
    el.appendChild(explain);

    const note = document.createElement("div");
    note.className = "pr-note hint";
    el.appendChild(note);

    const actionRow = document.createElement("div");
    actionRow.className = "pr-actions tutor-q-actions";
    el.appendChild(actionRow);

    const handle = {
      el,
      body: answer,
      view,
      bubble: el, // inert parity with the stage handle shape
      desc: null,
      teachSlot,
      hints,
      explain,
      intro,
      setNote(text) { note.textContent = text ?? ""; },
      setActions(actions) {
        actionRow.textContent = "";
        for (const a of actions) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = a.label;
          // Check stays a real button; hint/skip become quiet links.
          if (a.primary) btn.classList.add("primary");
          else btn.classList.add("pr-quiet");
          btn.addEventListener("click", () => a.onClick(handle));
          actionRow.appendChild(btn);
        }
      },
      verdict(ok, text) {
        el.appendChild(verdictSpan(ok, text));
        if (ok) {
          el.classList.add("t-bloom");
          el.addEventListener("animationend", () => el.classList.remove("t-bloom"), { once: true });
        }
      },
      freeze() { el.classList.add("frozen"); },
      // The in-card reveal: what the program REALLY did, right under it.
      reveal({ text, correct, kind }) {
        el.classList.remove("is-running");
        revealSlot.textContent = "";
        const block = document.createElement("div");
        block.className = `pr-reveal ${correct ? "good" : "open"}`;
        const label = document.createElement("span");
        label.className = "pr-reveal-label";
        label.textContent = kind === "predict-state" ? "it really holds" : "it printed";
        const pre = document.createElement("pre");
        pre.textContent = text ?? "";
        block.append(label, pre);
        if (kind === "predict-state") {
          const link = document.createElement("button");
          link.type = "button";
          link.className = "pr-quiet pr-see-memory";
          link.textContent = "🔬 see it in the memory model";
          link.addEventListener("click", () => hide());
          block.appendChild(link);
        }
        revealSlot.appendChild(block);
      },
    };
    handle.setActions([]);
    return handle;
  }

  // ---- beat interpretation -------------------------------------------------
  function renderStatics(descs) {
    body.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "pr-static";
    for (const desc of descs) wrap.appendChild(buildStaticCard(desc, { onTryIt: onTryIt ?? undefined }));
    body.appendChild(wrap);
    current = { type: "static" };
  }

  function popBatch(descs = [], liveHandle = null) {
    if (liveHandle) {
      // A new question takes the whole surface.
      body.textContent = "";
      for (const d of descs) {
        if (d.type === "sys") continue; // plumbing, never shown here
        liveHandle.intro.appendChild(buildStaticCard(d, { onTryIt: onTryIt ?? undefined }));
      }
      body.appendChild(liveHandle.el);
      current = { type: "question", handle: liveHandle };
      return;
    }
    if (!descs.length) return; // empty beat: keep whatever is up (menu/summary)
    if (descs.some((d) => d.type === "summary")) {
      // Round end: the summary replaces the surface.
      renderStatics(descs);
      return;
    }
    if (current?.type === "question") {
      // Explain face: appended INTO the frozen card — the reveal stays
      // visible while the learner reads why.
      for (const d of descs) {
        if (d.type === "sys") continue;
        current.handle.explain.appendChild(buildStaticCard(d, { onTryIt: onTryIt ?? undefined }));
      }
      return;
    }
    renderStatics(descs.filter((d) => d.type !== "sys"));
  }

  return {
    show,
    hide,
    isVisible: () => !root.hidden,
    clear() {
      body.textContent = "";
      current = null;
    },
    addCard(desc) {
      // Recording lives in the runtime; the surface renders nothing from
      // addCard EXCEPT a summary (so reloading a finished round restores
      // the summary screen — finish() then pops an empty batch).
      if (desc?.type === "summary") renderStatics([desc]);
      return { markDone() {}, el: null };
    },
    addInteractiveCard,
    popBatch,
    appendToPopup(desc) {
      if (current?.type === "question") {
        current.handle.hints.appendChild(buildStaticCard(desc, { onTryIt: onTryIt ?? undefined }));
      }
    },
    showCustom(el) {
      body.textContent = "";
      body.appendChild(el);
      current = { type: "static" };
    },
    setControls(list) {
      controlsHost.textContent = "";
      for (const a of list) controlsHost.appendChild(buildControlButton(a));
    },
    setProgress(text, q) {
      titleEl.textContent = text ? String(text).split(" · ")[0] : "Exercises";
      dotsEl.textContent = "";
      if (q?.qTotal) {
        for (let i = 0; i < q.qTotal; i++) {
          const dot = document.createElement("span");
          dot.className = "pr-dot" + (i < q.qDone ? " done" : "");
          dotsEl.appendChild(dot);
        }
      }
    },
    setExitVisible(v) { exitBtn.hidden = !v; },
    setOnExit(fn) { onExit = fn; },
    setOnTryIt(fn) { onTryIt = fn; },
    setReviewContext() {}, // no history UI in practice
    setStageMemory() {},
    scrollToEnd() { body.scrollTop = body.scrollHeight; },
    beginReveal() {
      if (current?.type === "question") current.handle.el.classList.add("is-running");
    },
  };
}
