// Shared learner-surface widgets: the markdown-lite renderer, the static
// card builder, and the control-button builder. Used by BOTH the stage
// (tutor-ui.mjs, guided lessons) and the practice card surface
// (practice-ui.mjs, drills) so cards, summaries, and mastery meters look
// and test identically everywhere. DOM only — no sequencing, no state.

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

export function renderInline(el, text) {
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

export function verdictSpan(ok, text) {
  const span = document.createElement("span");
  span.className = `tutor-verdict ${ok ? "good" : "bad"}`;
  span.textContent = text;
  return span;
}

// Build a static card element from a serializable descriptor. Shared by
// the stage's feed/popup rebuilds and the practice surface's summary and
// explain faces.
export function buildStaticCard(desc, { onTryIt } = {}) {
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
    renderMd(card, desc.md, { onTryIt });
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
    renderMd(card, desc.md, { onTryIt });
  } else if (desc.type === "summary") {
    // Round summary: headline, per-question dot row (filled = right, open
    // amber ring = still open — growth framing, never red), newly-met
    // chips, and the concepts coming back. Buttons live in the controls
    // strip, not here — recorded cards stay static.
    card = make("tutor-summary");
    const head = document.createElement("p");
    head.className = "t-summary-head";
    head.innerHTML = `Round complete — <strong>${desc.correct} of ${desc.asked}</strong> right.`;
    card.appendChild(head);
    const dots = document.createElement("div");
    dots.className = "t-summary-dots";
    for (const q of desc.perQuestion ?? []) {
      const dot = document.createElement("span");
      dot.className = `t-dot ${q.ok ? "hit" : "open"}`;
      const outcome = q.ok ? "right" : "still open";
      dot.title = q.label ? `${q.label} — ${outcome}` : outcome;
      dot.setAttribute("aria-label", dot.title);
      dots.appendChild(dot);
    }
    card.appendChild(dots);
    if (desc.newlyMet?.length) {
      const p = document.createElement("p");
      p.className = "t-summary-new";
      p.textContent = "🌱 New ideas you nailed: ";
      for (const m of desc.newlyMet) {
        const chip = document.createElement("span");
        chip.className = "t-chip met";
        chip.textContent = m.label;
        p.appendChild(chip);
      }
      card.appendChild(p);
    }
    if (desc.missed?.length) {
      const p = document.createElement("p");
      p.className = "t-summary-missed hint";
      p.textContent = `Coming back for you: ${desc.missed.map((m) => m.label).join(", ")}.`;
      card.appendChild(p);
    }
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

// Build one controls-strip button from a descriptor {label, primary?,
// onClick, progress?: {met, total}} — the progress form renders a mastery
// meter (met 0 shows a calm empty track; met === total swaps the count
// for a single ✓).
export function buildControlButton(a) {
  const btn = document.createElement("button");
  btn.type = "button";
  if (a.progress) {
    btn.classList.add("has-meter");
    const { met, total } = a.progress;
    const label = document.createElement("span");
    label.className = "t-btn-label";
    label.textContent = a.label;
    const meter = document.createElement("span");
    meter.className = "t-meter";
    meter.setAttribute("role", "progressbar");
    meter.setAttribute("aria-valuenow", String(met));
    meter.setAttribute("aria-valuemax", String(total));
    const fill = document.createElement("span");
    fill.className = "t-meter-fill" + (met === total && total > 0 ? " full" : "");
    fill.style.width = total ? `${Math.round((met / total) * 100)}%` : "0%";
    meter.appendChild(fill);
    btn.append(label, meter);
    if (met > 0) {
      const count = document.createElement("span");
      count.className = "t-meter-count";
      count.textContent = met === total ? "✓" : `${met}/${total}`;
      btn.appendChild(count);
    }
  } else {
    btn.textContent = a.label;
  }
  if (a.primary) btn.classList.add("primary");
  btn.addEventListener("click", a.onClick);
  return btn;
}
