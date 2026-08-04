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
      <button type="button" data-role="pr-notes" title="Scratch notes">📝</button>
      <button type="button" data-role="pr-exit-lesson" hidden>✕ End round</button>
    </div>
    <div class="pr-body" data-role="pr-body"></div>
    <div class="pr-controls" data-role="pr-controls"></div>
    <div class="pr-notes-drawer" data-role="pr-notes-drawer" hidden>
      <div class="pr-notes-head">Scratch notes <span class="hint">— saved automatically</span></div>
      <textarea data-role="pr-notes-text" placeholder="work things out here…"></textarea>
    </div>`;
  document.body.appendChild(root);
  const body = root.querySelector("[data-role=pr-body]");
  const controlsHost = root.querySelector("[data-role=pr-controls]");
  const titleEl = root.querySelector("[data-role=pr-title]");
  const dotsEl = root.querySelector("[data-role=pr-dots]");
  const exitBtn = root.querySelector("[data-role=pr-exit-lesson]");

  // Scratch notes: pure presentation state, one pad for all rounds. The
  // learner's thinking space — nothing in the app ever reads it.
  const NOTES_KEY = "plp.notes.v1";
  const notesDrawer = root.querySelector("[data-role=pr-notes-drawer]");
  const notesText = root.querySelector("[data-role=pr-notes-text]");
  const notesBtn = root.querySelector("[data-role=pr-notes]");
  try { notesText.value = localStorage.getItem(NOTES_KEY) ?? ""; } catch { /* ephemeral */ }
  notesText.addEventListener("input", () => {
    try { localStorage.setItem(NOTES_KEY, notesText.value); } catch { /* ephemeral */ }
  });
  function toggleNotes(open = notesDrawer.hidden) {
    notesDrawer.hidden = !open;
    notesBtn.classList.toggle("on", open);
    if (open) notesText.focus();
  }
  notesBtn.addEventListener("click", () => toggleNotes());

  root.querySelector("[data-role=pr-leave]").addEventListener("click", () => hide());
  exitBtn.addEventListener("click", () => onExit?.());
  // Esc leaves practice back to the IDE (symmetric with the 🎓 toggle);
  // the round stays resumable from the persisted store.
  document.addEventListener("keydown", (e) => {
    if (!document.body.classList.contains("practice")) return;
    if (e.key === "Escape") {
      // Progressive dismissal: notes drawer, then a review, then the surface.
      if (!notesDrawer.hidden) { toggleNotes(false); return; }
      if (reviewState) { closeReview(); return; }
      hide();
      return;
    }
    // Drill cadence: after grading the card freezes and its input goes
    // readOnly, so Enter bubbles here — let it press the primary control
    // ("Continue →") without reaching for the mouse. Never while typing
    // notes or inside a review (the retry input has its own Enter).
    if (e.key === "Enter" && !reviewState && !notesDrawer.contains(e.target)
        && current?.type === "question" && current.handle.el.classList.contains("frozen")) {
      controlsHost.querySelector("button.primary")?.click();
    }
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

  // Spot-the-difference context: program A with its real output, above the
  // changed program (shared by the live card and its review rebuild).
  function buildContextBlock(context) {
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
    return ctx;
  }

  // The proof block: what the program really did (live reveals and reviews).
  function buildRevealBlock({ kind, text, correct }) {
    const block = document.createElement("div");
    block.className = `pr-reveal ${correct ? "good" : "open"}`;
    const label = document.createElement("span");
    label.className = "pr-reveal-label";
    label.textContent = kind === "predict-state" ? "it really holds"
      : kind === "trace-table" ? "your table, graded" : "it printed";
    const pre = document.createElement("pre");
    pre.textContent = text ?? "";
    block.append(label, pre);
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
    "trace-table": "fill every box, then check — the trace grades each step",
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
    if (context?.code) el.appendChild(buildContextBlock(context));

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

    // Verdict above the reveal: the first thing the eye lands on after
    // grading is "did I get it?", then the proof right under it.
    const verdictSlot = document.createElement("div");
    verdictSlot.className = "pr-verdict-slot";
    el.appendChild(verdictSlot);

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
        verdictSlot.textContent = "";
        verdictSlot.appendChild(verdictSpan(ok, text));
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
        const block = buildRevealBlock({ kind, text, correct });
        // Reflect on it: the graded run's trace is already in the memory
        // model, so the IDE is one tap from scrubbing what really happened —
        // always for predict-state (the state IS the answer), and on any
        // miss (the learner just found out their model was wrong).
        if (kind === "predict-state" || !correct) {
          const link = document.createElement("button");
          link.type = "button";
          link.className = "pr-quiet pr-see-memory";
          link.textContent = kind === "predict-state"
            ? "🔬 see it in the memory model"
            : "🔬 step through this run";
          link.addEventListener("click", () => hide());
          block.appendChild(link);
        }
        revealSlot.appendChild(block);
      },
    };
    handle.setActions([]);
    return handle;
  }

  // ---- review: go back to an answered question -----------------------------
  // Reviewing swaps the surface to a rebuilt snapshot card; the live view
  // (an in-flight ask, the summary, the menu) is stashed as DOM and comes
  // back untouched on close. New runtime content supersedes a review.
  let reviewState = null; // { saved: Node[], savedControls: Node[] }
  let onReview = null;

  function discardReview() {
    if (!reviewState) return;
    reviewState = null;
    root.classList.remove("reviewing");
  }
  function showReview(desc) {
    if (!reviewState) reviewState = { saved: [...body.children], savedControls: [...controlsHost.children] };
    body.textContent = "";
    controlsHost.textContent = "";
    root.classList.add("reviewing");
    body.appendChild(buildReviewCard(desc));
    body.scrollTop = 0;
  }
  function closeReview() {
    if (!reviewState) return;
    const { saved, savedControls } = reviewState;
    reviewState = null;
    root.classList.remove("reviewing");
    body.textContent = "";
    for (const el of saved) body.appendChild(el);
    controlsHost.textContent = "";
    for (const el of savedControls) controlsHost.appendChild(el);
    body.querySelectorAll(".CodeMirror").forEach((el) => el.CodeMirror?.refresh());
  }

  // A trace-table review: the completed table read-only — the learner's
  // answer vs the truth per blank cell, ✓/✗ from the recorded grading.
  function buildReviewTable(table, answersById = {}) {
    const t = document.createElement("table");
    t.className = "mem-table quiz-mem tutor-trace-table";
    const first = table.rows.find((r) => !r.elided);
    const names = first ? first.cells.map((c) => c.name) : [];
    const head = document.createElement("tr");
    for (const h of ["step", "line", "code", ...names]) {
      const th = document.createElement("th");
      th.textContent = h;
      head.appendChild(th);
    }
    t.appendChild(head);
    for (const r of table.rows) {
      const tr = document.createElement("tr");
      if (r.elided) {
        const td = document.createElement("td");
        td.colSpan = 3 + names.length;
        td.className = "hint";
        td.textContent = "⋯ some steps skipped ⋯";
        tr.appendChild(td);
        t.appendChild(tr);
        continue;
      }
      const step = document.createElement("td");
      step.className = "uid";
      step.textContent = String(r.step);
      const line = document.createElement("td");
      line.className = "uid";
      line.textContent = String(r.line);
      const codeTd = document.createElement("td");
      const codeEl = document.createElement("code");
      codeEl.textContent = r.codeText;
      codeTd.appendChild(codeEl);
      tr.append(step, line, codeTd);
      for (const c of r.cells) {
        const td = document.createElement("td");
        if (c.blankId && answersById[c.blankId] !== undefined) {
          const ok = table.perBlank?.[c.blankId] === true;
          const yours = document.createElement("code");
          yours.className = ok ? "ok" : "bad";
          yours.textContent = `${answersById[c.blankId]} ${ok ? "✓" : "✗"}`;
          td.appendChild(yours);
          if (!ok) {
            const truth = document.createElement("span");
            truth.className = "hint";
            truth.textContent = ` → ${table.expectedById?.[c.blankId] ?? ""}`;
            td.appendChild(truth);
          }
        } else if (c.blankId) {
          // Skipped question: no answers recorded — show the truth plainly.
          td.textContent = table.expectedById?.[c.blankId] ?? c.value;
        } else {
          td.textContent = c.value;
        }
        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    return t;
  }

  function buildReviewCard(desc) {
    const el = document.createElement("div");
    el.className = "pr-question pr-review";

    const head = document.createElement("p");
    head.className = "pr-review-head";
    head.textContent = `Question ${desc.index + 1} — looking back`;
    el.appendChild(head);

    if (desc.context?.code) el.appendChild(buildContextBlock(desc.context));
    if (desc.code) mountProgram(el, desc.code);
    if (desc.table?.rows) el.appendChild(buildReviewTable(desc.table, desc.answersById ?? {}));
    if (desc.prompt) {
      const p = document.createElement("p");
      p.className = "pr-prompt";
      renderInline(p, desc.prompt);
      el.appendChild(p);
    }

    const you = document.createElement("p");
    you.className = "pr-review-answer";
    if (desc.answerText !== undefined) {
      you.append("you answered ");
      const c = document.createElement("code");
      c.textContent = desc.answerText;
      you.appendChild(c);
      you.append(" ");
    }
    you.appendChild(verdictSpan(desc.ok, desc.verdict ?? (desc.ok ? "✓" : "✗")));
    if (desc.retry?.ok && !desc.ok) {
      const badge = document.createElement("span");
      badge.className = "pr-retry-badge";
      badge.textContent = "solved on retry ✓";
      you.appendChild(badge);
    }
    el.appendChild(you);

    const revealSlot = document.createElement("div");
    revealSlot.className = "pr-reveal-slot";
    el.appendChild(revealSlot);
    if (desc.expectedText !== undefined) {
      revealSlot.appendChild(buildRevealBlock({ kind: desc.kind, text: desc.expectedText, correct: desc.ok }));
    }

    if (desc.onRetry) {
      const wrap = document.createElement("div");
      wrap.className = "pr-retry";
      const input = document.createElement("input");
      input.className = "tutor-output-input";
      input.placeholder = "have another go…";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary";
      btn.textContent = "Try it again ▶";
      const verdictOut = document.createElement("p");
      verdictOut.className = "pr-retry-verdict";
      const note = document.createElement("p");
      note.className = "hint pr-retry-note";
      note.textContent = "retries are for you — your score keeps the first try";
      const go = async () => {
        if (!input.value.trim() || btn.disabled) return;
        btn.disabled = true;
        input.readOnly = true;
        verdictOut.textContent = "running it for real…";
        const res = await desc.onRetry(input.value);
        btn.disabled = false;
        input.readOnly = false;
        verdictOut.textContent = "";
        if (!res) { verdictOut.textContent = "couldn't run just now — try again in a moment"; return; }
        verdictOut.appendChild(verdictSpan(res.ok, res.ok ? "✓ that's it!" : "✗ not yet — the real answer is above"));
        if (res.expectedText !== undefined) {
          revealSlot.textContent = "";
          revealSlot.appendChild(buildRevealBlock({ kind: desc.kind, text: res.expectedText, correct: res.ok }));
        }
      };
      btn.addEventListener("click", go);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !input.readOnly) go(); });
      wrap.append(input, btn, verdictOut, note);
      el.appendChild(wrap);
    }

    const actionRow = document.createElement("div");
    actionRow.className = "pr-actions";
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "↩ Back to the round";
    back.addEventListener("click", () => desc.onBack?.());
    actionRow.appendChild(back);
    el.appendChild(actionRow);
    return el;
  }

  // ---- beat interpretation -------------------------------------------------
  function renderStatics(descs) {
    discardReview();
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
      discardReview();
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
      discardReview();
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
      discardReview();
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
      if (!q?.qTotal) return;
      // Answered dots read their outcome (green hit / red miss, a green
      // ring for missed-then-solved-on-retry) and click back into a review
      // of that question. Unanswered dots are inert; the next one is live.
      const results = q.results ?? [];
      for (let i = 0; i < q.qTotal; i++) {
        const r = results[i];
        if (r) {
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className = "pr-dot " + (r.ok ? "hit" : "miss") + (!r.ok && r.retryOk ? " retried" : "");
          dot.title = (r.ok ? "right" : r.retryOk ? "missed, then solved on retry" : "missed")
            + ` — look back at question ${i + 1}`;
          dot.addEventListener("click", () => onReview?.(i));
          dotsEl.appendChild(dot);
        } else {
          const dot = document.createElement("span");
          dot.className = "pr-dot" + (i === results.length ? " active" : "");
          dotsEl.appendChild(dot);
        }
      }
    },
    setExitVisible(v) { exitBtn.hidden = !v; },
    setOnExit(fn) { onExit = fn; },
    setOnTryIt(fn) { onTryIt = fn; },
    setOnReview(fn) { onReview = fn; },
    showReview,
    closeReview,
    setReviewContext() {}, // no history UI in practice
    setStageMemory() {},
    scrollToEnd() { body.scrollTop = body.scrollHeight; },
    beginReveal() {
      if (current?.type === "question") current.handle.el.classList.add("is-running");
    },
  };
}
