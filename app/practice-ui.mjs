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
import { renderOrderLines, renderErrorPicker, renderLinePicker, createAnswerInput, createLinesInput } from "./question-ui.mjs";

export function createPracticeUI({ layout, getCode }) {
  let onExit = null;
  let onTryIt = null;
  let onBack = null;      // "one level up" (← / Esc); falls back to hide()
  let onLeaveToIDE = null; // world-switch links (open in editor / see memory)

  const root = document.createElement("div");
  root.id = "practice";
  root.hidden = true;
  root.innerHTML = `
    <div class="pr-top">
      <button type="button" data-role="pr-leave">Back to code</button>
      <span class="pr-title" data-role="pr-title">Exercises</span>
      <span class="pr-question-position" data-role="pr-question-position" hidden></span>
      <span class="pr-dots" data-role="pr-dots"></span>
      <span class="pr-score" data-role="pr-score" hidden></span>
      <span class="spacer"></span>
      <button type="button" data-role="pr-previous" hidden>← Previous</button>
      <button type="button" data-role="pr-next" hidden>Next →</button>
      <button type="button" data-role="pr-notes" title="Scratch notes">📝</button>
      <span class="pr-finish-separator" aria-hidden="true" hidden></span>
      <button type="button" class="pr-finish" data-role="pr-exit-lesson" hidden>Finish round</button>
    </div>
    <div class="pr-round-notice" data-role="pr-round-notice" hidden></div>
    <div class="pr-body" data-role="pr-body"></div>
    <div class="pr-round-count" data-role="pr-round-count" hidden>
      <label>
        Problems this round
        <select data-role="pr-round-count-select">
          <option value="5">5</option>
          <option value="10">10</option>
          <option value="15">15</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label data-role="pr-round-count-custom" hidden>
        Custom count
        <input type="number" min="1" max="50" inputmode="numeric" data-role="pr-round-count-input">
      </label>
    </div>
    <div class="pr-controls" data-role="pr-controls"></div>
    <div class="pr-notes-drawer" data-role="pr-notes-drawer" hidden>
      <div class="pr-notes-head">
        <span>Scratch notes <span class="hint">- saved automatically</span></span>
        <button type="button" data-role="pr-notes-collapse">Collapse notes</button>
      </div>
      <textarea data-role="pr-notes-text" placeholder="work things out here…"></textarea>
    </div>`;
  document.body.appendChild(root);
  const body = root.querySelector("[data-role=pr-body]");
  const controlsHost = root.querySelector("[data-role=pr-controls]");
  const titleEl = root.querySelector("[data-role=pr-title]");
  const questionPosition = root.querySelector("[data-role=pr-question-position]");
  const dotsEl = root.querySelector("[data-role=pr-dots]");
  const exitBtn = root.querySelector("[data-role=pr-exit-lesson]");
  const finishSeparator = root.querySelector(".pr-finish-separator");
  const leaveBtn = root.querySelector("[data-role=pr-leave]");
  const previousBtn = root.querySelector("[data-role=pr-previous]");
  const nextBtn = root.querySelector("[data-role=pr-next]");
  const roundNotice = root.querySelector("[data-role=pr-round-notice]");
  const countPicker = root.querySelector("[data-role=pr-round-count]");
  const countSelect = root.querySelector("[data-role=pr-round-count-select]");
  const customCountLabel = root.querySelector("[data-role=pr-round-count-custom]");
  const customCountInput = root.querySelector("[data-role=pr-round-count-input]");
  let onRoundCountChange = null;
  let reviewIndices = [];
  let liveNextAction = null;
  let progressState = null;
  let roundCountValue = 10;

  function selectedRoundCount() {
    const raw = countSelect.value === "custom" ? customCountInput.value : countSelect.value;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n >= 1 && n <= 50 ? n : null;
  }
  function emitRoundCount() {
    const n = selectedRoundCount();
    if (n != null) {
      roundCountValue = n;
      onRoundCountChange?.(n);
    }
  }
  countSelect.addEventListener("change", () => {
    const custom = countSelect.value === "custom";
    customCountLabel.hidden = !custom;
    if (custom) {
      if (!customCountInput.value) customCountInput.value = String(roundCountValue);
      customCountInput.focus();
    }
    else emitRoundCount();
  });
  customCountInput.addEventListener("input", emitRoundCount);
  customCountInput.addEventListener("change", emitRoundCount);

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
  root.querySelector("[data-role=pr-notes-collapse]").addEventListener("click", () => {
    toggleNotes(false);
    notesBtn.focus();
  });

  // Esc progressively dismisses the notes drawer, then a review, before
  // moving one level up. The labeled leave button is deliberately direct:
  // "Topics" always goes to topics, including while a review is open.
  function levelUp() {
    if (!notesDrawer.hidden) { toggleNotes(false); return; }
    if (reviewState) {
      // A correction is the live round state, not a dismissible historical
      // review. Esc leaves the round resumably instead of exposing the frozen
      // first-attempt card underneath.
      if (reviewState.correction) { (onBack ?? hide)(); return; }
      closeReview();
      return;
    }
    (onBack ?? hide)();
  }
  leaveBtn.addEventListener("click", () => {
    if (!notesDrawer.hidden) toggleNotes(false);
    (onBack ?? hide)();
  });
  exitBtn.addEventListener("click", () => {
    if (window.confirm("Finish this round? Your answers so far will still count.")) onExit?.();
  });
  document.addEventListener("keydown", (e) => {
    if (!document.body.classList.contains("practice")) return;
    if (e.key === "Escape") {
      levelUp();
      return;
    }
    // Drill cadence: after grading the card freezes and its input goes
    // readOnly, so Enter bubbles here and presses the canonical header
    // Next control without reaching for the mouse. Never while typing notes
    // or inside a review (the retry input has its own Enter).
    if (e.key === "Enter" && !reviewState && !notesDrawer.contains(e.target)
        && current?.type === "question" && current.handle.el.classList.contains("frozen")) {
      nextBtn.click();
    }
  });

  // current = { type: "question", handle } | { type: "static" } | null
  let current = null;
  const handleMeta = new WeakMap(); // card el → { capturedCode }

  function updateQuestionPosition() {
    if (!progressState?.qTotal) {
      questionPosition.hidden = true;
      questionPosition.textContent = "";
      return;
    }
    const answeredHere = progressState.results?.length ?? 0;
    const unresolvedLive = current?.type === "question"
      && !current.handle.el.classList.contains("frozen");
    const reviewNumber = reviewState ? reviewState.index + 1 : null;
    const total = reviewState
      ? Math.max(progressState.qTotal, (reviewIndices.at(-1) ?? -1) + 1)
      : progressState.qTotal;
    const n = reviewNumber
      ?? Math.min(total, Math.max(1, answeredHere + (unresolvedLive ? 1 : 0)));
    questionPosition.hidden = false;
    questionPosition.textContent = `Question ${n} of ${total}`;
  }

  function updateNavigation() {
    updateQuestionPosition();
    if (reviewState) {
      if (reviewState.correction) {
        previousBtn.hidden = true;
        nextBtn.hidden = false;
        nextBtn.disabled = false;
        nextBtn.textContent = "Next problem →";
        nextBtn.title = "Continue to the next problem";
        return;
      }
      const pos = reviewIndices.indexOf(reviewState.index);
      previousBtn.hidden = pos <= 0;
      nextBtn.hidden = false;
      nextBtn.disabled = false;
      nextBtn.textContent = "Next →";
      nextBtn.title = pos >= reviewIndices.length - 1
        ? "Return to the current problem"
        : `Review question ${reviewIndices[pos + 1] + 1}`;
      return;
    }
    previousBtn.hidden = reviewIndices.length === 0;
    previousBtn.disabled = false;
    previousBtn.title = reviewIndices.length
      ? `Review question ${reviewIndices.at(-1) + 1}`
      : "";
    nextBtn.hidden = typeof liveNextAction !== "function";
    nextBtn.disabled = typeof liveNextAction !== "function";
    nextBtn.textContent = "Next →";
    nextBtn.title = nextBtn.hidden ? "" : "Continue to the next problem";
  }
  previousBtn.addEventListener("click", () => {
    if (!reviewIndices.length) return;
    if (!reviewState) {
      onReview?.(reviewIndices.at(-1));
      return;
    }
    const pos = reviewIndices.indexOf(reviewState.index);
    if (pos > 0) onReview?.(reviewIndices[pos - 1]);
  });
  nextBtn.addEventListener("click", () => {
    if (reviewState) {
      if (reviewState.correction) {
        reviewState.onNext?.();
        return;
      }
      const pos = reviewIndices.indexOf(reviewState.index);
      if (pos >= 0 && pos < reviewIndices.length - 1) onReview?.(reviewIndices[pos + 1]);
      else closeReview();
      return;
    }
    liveNextAction?.();
  });

  function show() {
    document.body.classList.add("practice");
    root.hidden = false;
    layout.setExercisesVisible?.(true);
    // Cards built while the surface was hidden (reload-resume path) hold
    // CodeMirror instances that measured a display:none layout — refresh
    // them now or the program boxes render as empty strips.
    requestAnimationFrame(() => {
      body.querySelectorAll(".CodeMirror").forEach((el) => el.CodeMirror?.refresh());
    });
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

  // predict-io (expansion ladder §R4a): the stdin script, shown as chips.
  // The typing is deliberately scaffolded — WHERE the typed text lands in the
  // transcript is what the question tests, not what the learner invents. Sits
  // with the program (the spot-the-difference context block is the precedent).
  function buildStdinBlock(script) {
    const wrap = document.createElement("div");
    wrap.className = "pr-stdin";
    const label = document.createElement("span");
    label.className = "pr-reveal-label";
    label.textContent = "someone types:";
    wrap.appendChild(label);
    const row = document.createElement("span");
    row.className = "pr-stdin-row";
    script.forEach((line, i) => {
      if (i) {
        const sep = document.createElement("span");
        sep.className = "pr-stdin-then hint";
        sep.textContent = "then";
        row.appendChild(sep);
      }
      const chip = document.createElement("span");
      chip.className = "pr-stdin-chip";
      const code = document.createElement("code");
      code.textContent = line;
      chip.append(code);
      const enter = document.createElement("span");
      enter.className = "pr-stdin-enter";
      enter.textContent = "\u23ce";
      enter.title = "Enter";
      chip.appendChild(enter);
      row.appendChild(chip);
    });
    wrap.appendChild(row);
    return wrap;
  }

  // The proof block: what the program really did (live reveals and reviews).
  function buildRevealBlock({ kind, text, correct, gone = false }) {
    const block = document.createElement("div");
    block.className = `pr-reveal ${correct ? "good" : "open"}`;
    const label = document.createElement("span");
    label.className = "pr-reveal-label";
    // The "gone" truth is not a value — never print one (ladder §R4b W4).
    label.textContent = gone ? "it holds nothing"
      : kind === "predict-state" ? "it really holds"
      : kind === "trace-table" ? "your table, graded"
        : kind === "predict-the-error" ? "it really stopped with"
          : kind === "predict-io" ? "the console really showed" : "it printed";
    const pre = document.createElement("pre");
    pre.textContent = gone ? "that name is gone" : (text ?? "");
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
    "write-the-line": "type the whole missing line — it runs with your line",
    "fix-the-bug": "tap the wrong line, then write what it should be — it really runs",
    "spot-the-difference": "type what the changed program prints",
    "trace-table": "fill every box, then check — the trace grades each step",
    "order-the-lines": "move the lines with ↑ and ↓, then check — it really runs",
    "predict-the-error": "tap the line it stops on, then the kind — it really runs",
    "predict-io": "type the WHOLE console — prompts, the typed lines, and the output",
  };
  // A form is not enough to key the mechanics line: predict-output is a single
  // box when the program prints one line and the growing line-box widget when
  // it prints several, and the Enter mechanics differ. So the line is keyed off
  // the WIDGET actually built (the `multiline` flag the runtime passes), with
  // the multi-box copy overriding by form. Seen-once state is keyed the same
  // way, so a learner who met the one-box form still gets the boxes explained.
  const MECHANICS_LINES = {
    "predict-exact-output": "one box per printed line — Enter starts the next line, then press Check",
    "predict-output": "one box per printed line — Enter starts the next line, then press Check",
    "spot-the-difference": "one box per printed line — Enter starts the next line, then press Check",
  };
  function mechanicsLineFor(form, multiline = false) {
    // Multi-line asks ALWAYS carry their hint. Everything else is once-ever.
    // Reported defect: a learner who has no idea how to enter several lines
    // gets no cue at all once the flag is set — and the box-per-line mechanic
    // has no visual tell, unlike "type here and press Enter". The line is one
    // short sentence and these asks are rare, so it never becomes noise.
    if (multiline) return MECHANICS_LINES[form] ?? MECHANICS[form] ?? null;
    let seen;
    try { seen = JSON.parse(localStorage.getItem("plp.practice.v1")) ?? {}; } catch { seen = {}; }
    seen.forms ??= {};
    if (!form || seen.forms[form]) return null;
    const text = MECHANICS[form] ?? null;
    if (!text) return null;
    seen.forms[form] = true;
    try { localStorage.setItem("plp.practice.v1", JSON.stringify(seen)); } catch { /* ephemeral */ }
    return text;
  }

  // `program: false` suppresses the program block (and its open-in-editor
  // escape): forms whose widget IS the program — order-the-lines, where the
  // dealt arrangement lives in the rows themselves — would otherwise show the
  // same lines twice, once uneditable.
  function addInteractiveCard({ prompt, render, teach, context, form, stdinScript, multiline = false, program = true }) {
    const el = document.createElement("div");
    el.className = "pr-question tutor-question";
    const code = getCode();

    const intro = document.createElement("div");
    intro.className = "pr-intro";
    el.appendChild(intro);

    // Spot-the-difference: program A with its real output, above program B.
    if (context?.code) el.appendChild(buildContextBlock(context));

    if (program) {
      const programBlock = mountProgram(el, code);
      // Escape hatch: the real IDE is one tap away, program loaded. If the
      // learner edits it there and comes back, a chip offers to restore the
      // question's program (grade-what-runs stays the philosophy either way).
      if (stdinScript?.length) programBlock.insertAdjacentElement("afterend", buildStdinBlock(stdinScript));
      const openLink = document.createElement("button");
      openLink.type = "button";
      openLink.className = "pr-quiet pr-open-editor";
      openLink.textContent = "open in editor";
      openLink.addEventListener("click", () => { hide(); onLeaveToIDE?.(); });
      programBlock.insertAdjacentElement("afterend", openLink);
      handleMeta.set(el, { capturedCode: code });
    }

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
    const mech = mechanicsLineFor(form, multiline);
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
      reveal({ text, correct, kind, gone = false }) {
        el.classList.remove("is-running");
        revealSlot.textContent = "";
        const block = buildRevealBlock({ kind, text, correct, gone });
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
          link.addEventListener("click", () => { hide(); onLeaveToIDE?.(); });
          block.appendChild(link);
        }
        revealSlot.appendChild(block);
      },
    };
    handle.setActions([]);
    return handle;
  }

  // ---- round stash: leave a live round without ending it -------------------
  // Topics from a round steps aside to the menu WITHOUT ending anything: the
  // round's DOM (live card, controls, `current`) is stashed verbatim and
  // restored by unstashRound — the runtime's waiting closures never notice.
  // View-level only: all round STATE stays in the tutor's persisted store.
  // Discarded whenever a new round/lesson claims the surface.
  let roundStash = null;
  function stashRound() {
    if (roundStash) return;
    if (reviewState && !reviewState.correction) closeReview();
    roundStash = {
      saved: [...body.children], savedControls: [...controlsHost.children], current,
      liveNextAction, reviewIndices: [...reviewIndices],
      correctionReview: reviewState?.correction ? reviewState : null,
    };
  }
  function unstashRound() {
    if (!roundStash) return false;
    discardReview();
    const {
      saved, savedControls, current: cur, liveNextAction: nextAction,
      reviewIndices: savedReviewIndices, correctionReview,
    } = roundStash;
    roundStash = null;
    body.textContent = "";
    for (const el of saved) body.appendChild(el);
    controlsHost.textContent = "";
    for (const el of savedControls) controlsHost.appendChild(el);
    current = cur;
    reviewState = correctionReview ?? null;
    root.classList.toggle("reviewing", Boolean(reviewState));
    liveNextAction = nextAction ?? null;
    reviewIndices = savedReviewIndices ?? [];
    updateNavigation();
    requestAnimationFrame(() => {
      body.querySelectorAll(".CodeMirror").forEach((el) => el.CodeMirror?.refresh());
    });
    return true;
  }

  // ---- review: go back to an answered question -----------------------------
  // Reviewing swaps the surface to a rebuilt snapshot card; the live view
  // (an in-flight ask, the summary, the menu) is stashed as DOM and comes
  // back untouched on close. New runtime content supersedes a review.
  let reviewState = null; // { saved, savedControls, index, correction?, onNext? }
  let onReview = null;

  function discardReview() {
    if (!reviewState) return;
    reviewState = null;
    root.classList.remove("reviewing");
    updateNavigation();
  }
  function showReview(desc) {
    if (!reviewState) {
      reviewState = {
        saved: [...body.children], savedControls: [...controlsHost.children], index: desc.index,
        correction: desc.correction === true, onNext: desc.onNext ?? null,
      };
    } else {
      reviewState.index = desc.index;
      reviewState.correction = desc.correction === true;
      reviewState.onNext = desc.onNext ?? null;
    }
    body.textContent = "";
    controlsHost.textContent = "";
    root.classList.add("reviewing");
    body.appendChild(buildReviewCard(desc));
    body.scrollTop = 0;
    updateNavigation();
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
    updateNavigation();
  }

  // A trace-table review: the completed table read-only — the learner's
  // answer vs the truth per blank cell, ✓/✗ from the recorded grading.
  function buildReviewTable(table, answersById = {}, { revealed = true } = {}) {
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
          if (revealed) yours.className = ok ? "ok" : "bad";
          yours.textContent = revealed
            ? `${answersById[c.blankId]} ${ok ? "✓" : "✗"}`
            : String(answersById[c.blankId]);
          td.appendChild(yours);
          if (revealed && !ok) {
            const truth = document.createElement("span");
            truth.className = "hint tutor-cell-truth";
            truth.textContent = ` → ${table.expectedById?.[c.blankId] ?? ""}`;
            td.appendChild(truth);
          }
        } else if (c.blankId && revealed) {
          // Skipped question: no answers recorded — show the truth plainly.
          td.textContent = table.expectedById?.[c.blankId] ?? c.value;
        } else if (c.blankId) {
          td.textContent = "?";
        } else {
          td.textContent = c.value;
        }
        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    return t;
  }

  // A retry attempt: the same table structure, every blank cell a fresh
  // empty input, no truth anywhere (a retry beside the answers would be
  // copying, not tracing).
  function buildRetryTable(rows) {
    const t = document.createElement("table");
    t.className = "mem-table quiz-mem tutor-trace-table";
    const first = rows.find((r) => !r.elided);
    const names = first ? first.cells.map((c) => c.name) : [];
    const head = document.createElement("tr");
    for (const h of ["step", "line", "code", ...names]) {
      const th = document.createElement("th");
      th.textContent = h;
      head.appendChild(th);
    }
    t.appendChild(head);
    for (const r of rows) {
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
        if (c.blankId) {
          const input = document.createElement("input");
          input.type = "text";
          input.className = "tutor-output-input tutor-output-line";
          input.dataset.blankId = c.blankId;
          input.placeholder = "?";
          input.spellcheck = false;
          td.appendChild(input);
        } else {
          td.textContent = c.value;
        }
        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    return {
      el: t,
      inputs: () => [...t.querySelectorAll("input[data-blank-id]")],
      collect() {
        const answers = {};
        for (const inp of t.querySelectorAll("input[data-blank-id]")) {
          answers[inp.dataset.blankId] = inp.value;
        }
        return answers;
      },
    };
  }

  // An order-the-lines arrangement, read-only: the lines as the learner left
  // them, in their order. Text only (invariant 8).
  function buildArrangement(texts, { label } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "pr-order-arrangement";
    if (label) {
      const p = document.createElement("p");
      p.className = "pr-reveal-label";
      p.textContent = label;
      wrap.appendChild(p);
    }
    const pre = document.createElement("pre");
    pre.textContent = texts.join("\n");
    wrap.appendChild(pre);
    return wrap;
  }

  // A picked-line answer, read-only: the numbered program with the picked
  // line marked (and, for predict-the-error, the real one when they differ),
  // plus the picked error kind beside the real one. fix-the-bug (ladder §R5's
  // composition) reuses it for its FIND half — there the mark is simply
  // whether the REPAIR worked, because the pick itself is never graded.
  // Text only (invariant 8).
  function buildPickedError(desc, { revealed = true } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "pr-errreview";
    const lines = String(desc.pickerCode).replace(/\n$/, "").split("\n");
    const list = document.createElement("div");
    list.className = "pr-errlines frozen";
    lines.forEach((text, i) => {
      const n = i + 1;
      const row = document.createElement("div");
      row.className = "pr-errline";
      const fix = desc.form === "fix-the-bug";
      if (revealed && desc.picked?.line === n) {
        row.classList.add(fix ? (desc.ok ? "ok" : "bad") : desc.actual && desc.actual.line === n ? "ok" : "bad");
      }
      if (revealed && !fix && desc.actual && desc.actual.line === n && desc.picked?.line !== n) row.classList.add("truth");
      const num = document.createElement("span");
      num.className = "uid pr-errline-num";
      num.textContent = String(n);
      const code = document.createElement("code");
      code.textContent = text;
      row.append(num, code);
      list.appendChild(row);
    });
    wrap.appendChild(list);
    if (desc.picked?.type) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = revealed && desc.actual
        ? `you picked ${desc.picked.type} · it raised ${desc.actual.type}`
        : `you picked ${desc.picked.type}`;
      wrap.appendChild(p);
    }
    return wrap;
  }

  function buildReviewCard(desc) {
    const el = document.createElement("div");
    el.className = "pr-question pr-review";

    const head = document.createElement("p");
    head.className = "pr-review-head";
    head.textContent = desc.correction
      ? `Question ${desc.index + 1} - try again or move on`
      : `Question ${desc.index + 1} - looking back`;
    el.appendChild(head);

    if (desc.context?.code) el.appendChild(buildContextBlock(desc.context));
    if (desc.code) {
      const block = mountProgram(el, desc.code);
      if (desc.stdinScript?.length) block.insertAdjacentElement("afterend", buildStdinBlock(desc.stdinScript));
    }
    // The table lives in a slot so a retry can swap it out (blank attempt)
    // and back (graded view) without touching the rest of the card.
    let tableSlot = null;
    if (desc.table?.rows) {
      tableSlot = document.createElement("div");
      tableSlot.className = "pr-table-slot";
      tableSlot.appendChild(buildReviewTable(desc.table, desc.answersById ?? {}, { revealed: desc.revealed }));
      el.appendChild(tableSlot);
    }
    // order-the-lines: the arrangement the learner submitted, in a slot a
    // retry can swap for a fresh widget (and back).
    let orderSlot = null;
    if (desc.kind === "order-the-lines" && desc.items) {
      orderSlot = document.createElement("div");
      orderSlot.className = "pr-order-slot";
      const byId = new Map(desc.items.map((it) => [it.id, it.text]));
      const texts = (desc.answerOrder ?? desc.items.map((it) => it.id)).map((id) => byId.get(id) ?? "");
      orderSlot.appendChild(buildArrangement(texts, {
        label: desc.answerOrder ? "you arranged it like this" : "the lines, as they were dealt",
      }));
      el.appendChild(orderSlot);
    }
    // predict-the-error: the numbered lines with the learner's pick marked,
    // in a slot a retry can swap for a fresh picker (and back).
    // (fix-the-bug rides the same slot: its recorded answer is a picked line
    // plus the line the learner wrote, and its retry swaps in a live picker.)
    let pickerSlot = null;
    if ((desc.kind === "predict-the-error" || desc.form === "fix-the-bug") && desc.pickerCode) {
      pickerSlot = document.createElement("div");
      pickerSlot.className = "pr-picker-slot";
      pickerSlot.appendChild(buildPickedError(desc, { revealed: desc.revealed }));
      el.appendChild(pickerSlot);
    }
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
      revealSlot.appendChild(buildRevealBlock({ kind: desc.kind, text: desc.expectedText, correct: desc.ok, gone: desc.expectedGone === true }));
    }
    if (desc.answerReveal) {
      const block = document.createElement("div");
      block.className = "pr-reveal open pr-answer-reveal";
      const label = document.createElement("span");
      label.className = "pr-reveal-label";
      label.textContent = desc.answerReveal.label;
      const pre = document.createElement("pre");
      pre.textContent = desc.answerReveal.text;
      block.append(label, pre);
      revealSlot.appendChild(block);
    }

    if (desc.onRetry && desc.kind === "order-the-lines" && orderSlot) {
      // A Parsons retry is a genuine second arrangement: the recorded one
      // leaves the screen, the DEALT items come back in their dealt order,
      // and the new arrangement is executed for real.
      const wrap = document.createElement("div");
      wrap.className = "pr-retry pr-retry-order";
      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.className = "primary";
      startBtn.textContent = "Try it again ▶";
      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = "primary";
      checkBtn.textContent = "Check my order ▶";
      checkBtn.hidden = true;
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "pr-quiet pr-retry-cancel";
      cancelBtn.textContent = "never mind, show what I answered";
      cancelBtn.hidden = true;
      const verdictOut = document.createElement("p");
      verdictOut.className = "pr-retry-verdict";
      const note = document.createElement("p");
      note.className = "hint pr-retry-note";
      note.textContent = "retries are for you — your score keeps the first try";
      const recordedEl = orderSlot.firstChild;
      let view = null;
      const showRecorded = () => {
        orderSlot.replaceChildren(recordedEl);
        view = null;
        verdictOut.textContent = "";
        startBtn.hidden = false;
        checkBtn.hidden = true;
        cancelBtn.hidden = true;
      };
      startBtn.addEventListener("click", () => {
        const host = document.createElement("div");
        view = renderOrderLines(host, { items: desc.items });
        orderSlot.replaceChildren(host);
        verdictOut.textContent = "";
        startBtn.hidden = true;
        checkBtn.hidden = false;
        cancelBtn.hidden = false;
      });
      checkBtn.addEventListener("click", async () => {
        if (!view || checkBtn.disabled) return;
        checkBtn.disabled = true;
        verdictOut.textContent = "running it for real…";
        const res = await desc.onRetry(view.collect());
        checkBtn.disabled = false;
        verdictOut.textContent = "";
        if (!res) { verdictOut.textContent = "couldn't run just now — try again in a moment"; return; }
        if (!res.ok) {
          verdictOut.appendChild(verdictSpan(false, "✗ Not yet - try another order"));
          return;
        }
        view.freeze();
        view.applyResult({ correct: true });
        verdictOut.appendChild(verdictSpan(true, "✓ that prints it!"));
        checkBtn.hidden = true;
        cancelBtn.hidden = true;
        startBtn.hidden = true;
      });
      cancelBtn.addEventListener("click", showRecorded);
      wrap.append(startBtn, checkBtn, cancelBtn, verdictOut, note);
      el.appendChild(wrap);
    } else if (desc.onRetry && desc.form === "fix-the-bug" && pickerSlot) {
      // A fix-the-bug retry is a genuine second repair: the marked answer
      // leaves the screen, a fresh picker + empty box take its place (never
      // pre-filled — E5 again), and the chosen line is spliced and run for
      // real, exactly as on the first attempt.
      const wrap = document.createElement("div");
      wrap.className = "pr-retry pr-retry-fix";
      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.className = "primary";
      startBtn.textContent = "Try it again ▶";
      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = "primary";
      checkBtn.textContent = "Check my fix ▶";
      checkBtn.hidden = true;
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "pr-quiet pr-retry-cancel";
      cancelBtn.textContent = "never mind, show what I answered";
      cancelBtn.hidden = true;
      const verdictOut = document.createElement("p");
      verdictOut.className = "pr-retry-verdict";
      const note = document.createElement("p");
      note.className = "hint pr-retry-note";
      note.textContent = "retries are for you — your score keeps the first try";
      const recordedEl = pickerSlot.firstChild;
      let view = null;
      let box = null;
      const showRecorded = () => {
        pickerSlot.replaceChildren(recordedEl);
        view = null;
        box = null;
        verdictOut.textContent = "";
        startBtn.hidden = false;
        checkBtn.hidden = true;
        cancelBtn.hidden = true;
      };
      startBtn.addEventListener("click", () => {
        const host = document.createElement("div");
        view = renderLinePicker(host, { code: desc.pickerCode });
        box = createAnswerInput({ singleLine: true, placeholder: "what that line should be…" });
        box.hidden = true;
        view.onPick(() => { box.hidden = false; box.focus(); });
        host.appendChild(box);
        pickerSlot.replaceChildren(host);
        verdictOut.textContent = "";
        startBtn.hidden = true;
        checkBtn.hidden = false;
        cancelBtn.hidden = false;
      });
      checkBtn.addEventListener("click", async () => {
        if (!view || checkBtn.disabled) return;
        const line = view.picked();
        if (!line) { verdictOut.textContent = "tap the line you'd change first"; return; }
        if (!box.value.trim()) { verdictOut.textContent = "now write what that line should be"; return; }
        checkBtn.disabled = true;
        verdictOut.textContent = "running it for real…";
        const res = await desc.onRetry({ line, text: box.value });
        checkBtn.disabled = false;
        verdictOut.textContent = "";
        if (!res) { verdictOut.textContent = "couldn't run just now — try again in a moment"; return; }
        if (!res.ok) {
          verdictOut.appendChild(verdictSpan(false, "✗ Not yet - try another fix"));
          return;
        }
        view.freeze();
        view.mark({ ok: true });
        box.readOnly = true;
        box.classList.add("ok");
        verdictOut.appendChild(verdictSpan(true, "✓ that prints it!"));
        checkBtn.hidden = true;
        cancelBtn.hidden = true;
        startBtn.hidden = true;
      });
      cancelBtn.addEventListener("click", showRecorded);
      wrap.append(startBtn, checkBtn, cancelBtn, verdictOut, note);
      el.appendChild(wrap);
    } else if (desc.onRetry && desc.kind === "predict-the-error" && pickerSlot) {
      // A predict-the-error retry is a genuine second prediction: the marked
      // answer leaves the screen, a fresh picker takes its place, and the same
      // (deterministic) program is run and graded again for real.
      const wrap = document.createElement("div");
      wrap.className = "pr-retry pr-retry-error";
      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.className = "primary";
      startBtn.textContent = "Try it again ▶";
      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = "primary";
      checkBtn.textContent = "Check my answer ▶";
      checkBtn.hidden = true;
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "pr-quiet pr-retry-cancel";
      cancelBtn.textContent = "never mind, show what I answered";
      cancelBtn.hidden = true;
      const verdictOut = document.createElement("p");
      verdictOut.className = "pr-retry-verdict";
      const note = document.createElement("p");
      note.className = "hint pr-retry-note";
      note.textContent = "retries are for you — your score keeps the first try";
      const recordedEl = pickerSlot.firstChild;
      let view = null;
      const showRecorded = () => {
        pickerSlot.replaceChildren(recordedEl);
        view = null;
        verdictOut.textContent = "";
        startBtn.hidden = false;
        checkBtn.hidden = true;
        cancelBtn.hidden = true;
      };
      startBtn.addEventListener("click", () => {
        const host = document.createElement("div");
        view = renderErrorPicker(host, { code: desc.pickerCode });
        pickerSlot.replaceChildren(host);
        verdictOut.textContent = "";
        startBtn.hidden = true;
        checkBtn.hidden = false;
        cancelBtn.hidden = false;
      });
      checkBtn.addEventListener("click", async () => {
        if (!view || checkBtn.disabled) return;
        const pick = view.collect();
        if (!pick.line || !pick.type) { verdictOut.textContent = "pick a line and a kind first"; return; }
        checkBtn.disabled = true;
        verdictOut.textContent = "running it for real…";
        const res = await desc.onRetry(pick);
        checkBtn.disabled = false;
        verdictOut.textContent = "";
        if (!res) { verdictOut.textContent = "couldn't run just now — try again in a moment"; return; }
        if (!res.ok) {
          verdictOut.appendChild(verdictSpan(false, "✗ Not yet - try again"));
          return;
        }
        view.freeze();
        view.applyResult({ lineOk: true, typeOk: true, actual: null });
        verdictOut.appendChild(verdictSpan(true, "✓ right line, right kind!"));
        checkBtn.hidden = true;
        cancelBtn.hidden = true;
        startBtn.hidden = true;
      });
      cancelBtn.addEventListener("click", showRecorded);
      wrap.append(startBtn, checkBtn, cancelBtn, verdictOut, note);
      el.appendChild(wrap);
    } else if (desc.onRetry && desc.kind === "trace-table" && tableSlot) {
      // A trace-table retry is a genuine second walk: the recorded table
      // leaves the screen, a fresh blank table takes its place, and the
      // answers grade privately against a re-run of the program.
      const wrap = document.createElement("div");
      wrap.className = "pr-retry pr-retry-table";
      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.className = "primary";
      startBtn.textContent = "Try it again ▶";
      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = "primary";
      checkBtn.textContent = "Check my answers ▶";
      checkBtn.hidden = true;
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "pr-quiet pr-retry-cancel";
      cancelBtn.textContent = "never mind, show what I answered";
      cancelBtn.hidden = true;
      const verdictOut = document.createElement("p");
      verdictOut.className = "pr-retry-verdict";
      const note = document.createElement("p");
      note.className = "hint pr-retry-note";
      note.textContent = "retries are for you — your score keeps the first try";
      const recordedEl = tableSlot.firstChild;
      let attempt = null;
      const showGraded = () => {
        tableSlot.replaceChildren(recordedEl);
        attempt = null;
        verdictOut.textContent = "";
        startBtn.hidden = false;
        checkBtn.hidden = true;
        cancelBtn.hidden = true;
      };
      const start = () => {
        attempt = buildRetryTable(desc.table.rows);
        for (const inp of attempt.inputs()) {
          inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !inp.readOnly) check(); });
        }
        tableSlot.replaceChildren(attempt.el);
        verdictOut.textContent = "";
        startBtn.hidden = true;
        checkBtn.hidden = false;
        cancelBtn.hidden = false;
        attempt.inputs()[0]?.focus();
      };
      const check = async () => {
        if (!attempt || checkBtn.disabled) return;
        const answers = attempt.collect();
        if (Object.values(answers).some((v) => !String(v ?? "").trim())) {
          verdictOut.textContent = "Fill every box first";
          return;
        }
        checkBtn.disabled = true;
        for (const inp of attempt.inputs()) inp.readOnly = true;
        verdictOut.textContent = "running it for real…";
        const res = await desc.onRetry(answers);
        checkBtn.disabled = false;
        verdictOut.textContent = "";
        if (!res) {
          for (const inp of attempt.inputs()) inp.readOnly = false;
          verdictOut.textContent = "couldn't run just now — try again in a moment";
          return;
        }
        if (!res.ok) {
          for (const inp of attempt.inputs()) inp.readOnly = false;
          verdictOut.appendChild(verdictSpan(false, "✗ Not yet - revise any steps you want"));
          return;
        }
        for (const inp of attempt.inputs()) inp.classList.add("ok");
        verdictOut.appendChild(verdictSpan(true, "✓ every step!"));
        startBtn.hidden = true;
        checkBtn.hidden = true;
        cancelBtn.hidden = true;
      };
      startBtn.addEventListener("click", start);
      checkBtn.addEventListener("click", check);
      cancelBtn.addEventListener("click", showGraded);
      wrap.append(startBtn, checkBtn, cancelBtn, verdictOut, note);
      el.appendChild(wrap);
    } else if (desc.onRetry) {
      const wrap = document.createElement("div");
      wrap.className = "pr-retry";
      // Several-line answers (predict-io's transcript; a predict-output ask
      // whose program prints more than one line) retry through the same
      // growing line-box widget as the live card — never a textarea, which has
      // no keyboard submit.
      const multiline = desc.kind === "predict-io" || desc.multiline === true;
      const lines = multiline
        ? createLinesInput({ placeholder: "have another go…", onSubmit: () => go() })
        : null;
      let input;
      if (multiline) {
        input = lines.el;
      } else {
        input = document.createElement("input");
        input.className = "tutor-output-input";
        input.placeholder = "have another go…";
        // Same code-not-prose hardening as createAnswerInput (ladder §R5).
        input.spellcheck = false;
        input.setAttribute("autocapitalize", "off");
        input.setAttribute("autocorrect", "off");
        input.setAttribute("autocomplete", "off");
      }
      const readAnswer = () => (multiline ? lines.getValue() : input.value);
      const setBusy = (busy) => {
        if (multiline) lines.setReadOnly(busy);
        else input.readOnly = busy;
      };
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
        if (!readAnswer().trim() || btn.disabled) return;
        btn.disabled = true;
        setBusy(true);
        verdictOut.textContent = "running it for real…";
        const res = await desc.onRetry(readAnswer());
        btn.disabled = false;
        setBusy(false);
        verdictOut.textContent = "";
        if (!res) { verdictOut.textContent = "couldn't run just now — try again in a moment"; return; }
        if (!res.ok) {
          verdictOut.appendChild(verdictSpan(false, "✗ Not yet - try again"));
          return;
        }
        setBusy(true);
        btn.hidden = true;
        verdictOut.appendChild(verdictSpan(true, "✓ that's it!"));
      };
      btn.addEventListener("click", go);
      // Single-line retries submit on Enter; multi-line ones on the widget's
      // empty-Enter gesture (wired as its onSubmit above).
      if (!multiline) input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !input.readOnly) go(); });
      wrap.append(input, btn, verdictOut, note);
      el.appendChild(wrap);
    }

    if (desc.onReveal) {
      const actions = document.createElement("div");
      actions.className = "pr-actions pr-disclosure-actions";
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.className = "pr-quiet pr-reveal-answer";
      reveal.textContent = "Reveal answer";
      reveal.addEventListener("click", () => desc.onReveal?.());
      actions.appendChild(reveal);
      el.appendChild(actions);
    }

    return el;
  }

  // ---- beat interpretation -------------------------------------------------
  function renderStatics(descs) {
    discardReview();
    body.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "pr-static";
    for (const desc of descs) {
      wrap.appendChild(buildStaticCard(desc, {
        onTryIt: onTryIt ?? undefined,
        onReviewMiss: (i) => onReview?.(i), // summary's "look back" button
      }));
    }
    body.appendChild(wrap);
    current = { type: "static" };
    liveNextAction = null;
    updateNavigation();
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
      liveNextAction = null;
      updateNavigation();
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
      liveNextAction = null;
      reviewIndices = [];
      progressState = null;
      countPicker.hidden = true;
      roundNotice.hidden = true;
      roundNotice.textContent = "";
      updateNavigation();
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
      liveNextAction = null;
      for (const a of list) {
        // Once a live practice answer freezes, header Next is the one clear
        // advancement control. Guided lessons use the separate stage UI.
        if (current?.type === "question"
            && current.handle.el.classList.contains("frozen")
            && /^Continue\b/.test(a.label ?? "")) {
          liveNextAction = a.onClick;
          continue;
        }
        controlsHost.appendChild(buildControlButton(a));
      }
      updateNavigation();
    },
    setProgress(text, q) {
      titleEl.textContent = text ? String(text).split(" · ")[0] : "Exercises";
      dotsEl.textContent = "";
      if (!q?.qTotal) {
        progressState = null;
        reviewIndices = [];
        updateNavigation();
        return;
      }
      // Answered dots read their outcome (green hit / red miss, a green
      // ring for missed-then-solved-on-retry) and click back into a review
      // of that question. Unanswered dots are inert; the next one is live.
      const results = q.results ?? [];
      progressState = q;
      reviewIndices = q.reviewIndices ?? results.map((r, i) => r?.index ?? i).filter(Number.isInteger);
      for (let i = 0; i < q.qTotal; i++) {
        const r = results[i];
        if (r) {
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className = "pr-dot " + (r.ok ? "hit" : "miss") + (!r.ok && r.retryOk ? " retried" : "");
          const abs = r.index ?? i; // endless chunks slice the window; reviews reach the whole run
          dot.title = (r.ok ? "right" : r.retryOk ? "missed, then solved on retry" : "missed")
            + ` — look back at question ${abs + 1}`;
          dot.addEventListener("click", () => onReview?.(abs));
          dotsEl.appendChild(dot);
        } else {
          const dot = document.createElement("span");
          dot.className = "pr-dot" + (i === results.length ? " active" : "");
          dotsEl.appendChild(dot);
        }
      }
      updateNavigation();
    },
    setExitVisible(v) {
      exitBtn.hidden = !v;
      finishSeparator.hidden = !v;
    },
    setLeaveLabel(label, title = label) {
      leaveBtn.textContent = label;
      leaveBtn.title = title;
    },
    setRoundCountPicker({ value, onChange }) {
      const n = Number.isInteger(value) && value >= 1 && value <= 50 ? value : 10;
      roundCountValue = n;
      onRoundCountChange = onChange ?? null;
      countPicker.hidden = false;
      if ([5, 10, 15].includes(n)) {
        countSelect.value = String(n);
        customCountLabel.hidden = true;
      } else {
        countSelect.value = "custom";
        customCountInput.value = String(n);
        customCountLabel.hidden = false;
      }
    },
    setRoundNotice(text = "") {
      roundNotice.textContent = text;
      roundNotice.hidden = !text;
    },
    setScore(s) {
      // Session score chip: right-count plus the streak once it's alive.
      const el = root.querySelector("[data-role=pr-score]");
      if (!s || !s.answered) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = `✓ ${s.right}/${s.answered}` + (s.streak >= 2 ? ` · 🔥 ${s.streak}` : "");
      el.title = `this run: ${s.right} right of ${s.answered} · best streak ${s.best}`;
    },
    setOnExit(fn) { onExit = fn; },
    setOnTryIt(fn) { onTryIt = fn; },
    setOnReview(fn) { onReview = fn; },
    setOnBack(fn) { onBack = fn; },
    setOnLeaveToIDE(fn) { onLeaveToIDE = fn; },
    stashRound,
    unstashRound,
    hasRoundStash: () => Boolean(roundStash),
    discardRoundStash() { roundStash = null; },
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
