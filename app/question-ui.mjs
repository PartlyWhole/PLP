// Shared question renderers: one payload-shape router used by both the
// floating quiz panel (quiz.mjs) and tutor transcript cards (tutor-ui.mjs).
// Renders a Question object (questions.mjs contract) into a container and
// returns the answer surface:
//
//   renderQuestionBody(container, q) -> {
//     collect(),            // -> answers in the shape q.grade() expects
//     applyResult(result),  // mark inputs/rows/graph after grading
//     line,                 // suggested editor line to highlight (or null)
//     wide,                 // construction payloads want a wider surface
//   }
//
// All DOM is built with createElement/textContent — question payloads carry
// program text and traced values, and nothing here may interpolate them
// into markup (the collab XSS rule: gate or build, never innerHTML).

import { createEvaluationConstruction, createMemoryConstruction } from "./construction-ui.mjs";

function renderMemoryTable(container, snapshot, withBlanks) {
  const table = document.createElement("table");
  table.className = "mem-table quiz-mem";
  table.innerHTML = "<tr><th>Scope</th><th>Name</th><th>Value</th></tr>";
  for (const e of snapshot.entries) {
    const tr = document.createElement("tr");
    const val = document.createElement("td");
    if (withBlanks && e.blankId) {
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.blank = e.blankId;
      input.placeholder = "?";
      val.appendChild(input);
    } else {
      val.textContent = e.value;
    }
    const scope = document.createElement("td");
    scope.className = "uid";
    scope.textContent = e.scope;
    const name = document.createElement("td");
    name.className = "name";
    name.textContent = e.name;
    tr.append(scope, name, val);
    table.appendChild(tr);
  }
  container.appendChild(table);
}

// The one answer-input builder for free-text predictions (single-line for
// one-thing-at-a-time asks, textarea for free prediction). Shared by the
// quiz panel renderer below and the tutor's predict/fill paths.
export function createAnswerInput({ singleLine = false, placeholder = "" } = {}) {
  let el;
  if (singleLine) {
    el = document.createElement("input");
    el.type = "text";
    el.className = "tutor-output-input tutor-output-line";
  } else {
    el = document.createElement("textarea");
    el.className = "tutor-output-input";
  }
  el.placeholder = placeholder;
  el.spellcheck = false;
  // Answer boxes hold CODE or exact output, never prose: mobile keyboards
  // that auto-capitalize, auto-correct or smart-quote break Python (and exact
  // output comparison) silently, so every affordance is turned off here —
  // required by write-the-line (ladder §R5), harmless everywhere else.
  el.setAttribute("autocapitalize", "off");
  el.setAttribute("autocorrect", "off");
  el.setAttribute("autocomplete", "off");
  return el;
}

// The growing one-line-box widget: the answer surface for every ask whose
// answer is SEVERAL printed lines (predict-output with ask.multiline,
// predict-io, and their retries).
//
// Why not a textarea: in a textarea Enter means "newline", so there was no
// keyboard way to SUBMIT a multi-line answer at all (the Enter-submits binding
// only ever existed on single-line asks). Here Enter is a line-structure key
// and the "I'm done" gesture is a second Enter on an empty last box.
//
// CRITICAL: exactly ONE box is rendered to start, always. The number of boxes
// must never hint at how many lines the program prints — the learner adds them.
//
// Key map (per box):
//   Enter, last box, non-empty   → append a box below and focus it
//   Enter, non-last box          → focus the next box (never adds)
//   Enter, last box, empty, ≥2   → drop that box and SUBMIT
//   Enter, last box, empty, only → nothing (an empty answer is rejected anyway)
//   Backspace, empty non-first box, caret at 0 → drop it, caret at end of prev
//   ArrowUp / ArrowDown          → previous / next box (caret start / end)
//   paste containing newlines    → split across boxes from the caret out
//
// View contract matches the other renderers: collect() → { text } with the
// boxes joined by "\n" (trailing empties dropped) — byte-identical to what the
// textarea produced, so GRADING IS UNCHANGED.
export function createLinesInput({
  placeholder = "",
  onSubmit = null,
  label = "your answer — one box per printed line",
} = {}) {
  const wrap = document.createElement("div");
  wrap.className = "tutor-lines";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", label);
  const rowsEl = document.createElement("div");
  rowsEl.className = "tutor-lines-rows";
  wrap.appendChild(rowsEl);
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "tutor-lines-add";
  addBtn.textContent = "+ another line";
  wrap.appendChild(addBtn);

  let frozen = false;
  let readOnly = false;
  const boxes = () => [...rowsEl.querySelectorAll("input.tutor-lines-input")];
  const locked = (input) => frozen || readOnly || input.readOnly || input.disabled;
  const caretTo = (input, where) => {
    input.focus();
    const pos = where === "start" ? 0 : input.value.length;
    try { input.setSelectionRange(pos, pos); } catch { /* not selectable */ }
  };
  const relabel = () => {
    const list = boxes();
    list.forEach((input, i) => {
      input.setAttribute("aria-label", `output line ${i + 1}`);
      const del = input.parentElement.querySelector(".tutor-lines-del");
      if (del) del.hidden = i === 0; // ✕ on every box after the first
      const num = input.parentElement.querySelector(".tutor-lines-num");
      if (num) num.textContent = `line ${i + 1}`;
      // Only the LAST box advertises Enter — that is the box the gesture
      // acts on, and repeating it on every row would be noise.
      input.placeholder = i === list.length - 1 && list.length === 1
        ? (placeholder || "the first line it prints…")
        : i === list.length - 1 ? "…and this line" : "";
    });
    const last = list[list.length - 1];
    if (last) last.title = "press Enter to start the next line";
  };

  function removeRow(input) {
    const list = boxes();
    if (list.length <= 1) return;
    input.parentElement.remove();
    relabel();
  }

  function makeRow(value = "", after = null) {
    const row = document.createElement("div");
    row.className = "tutor-lines-row";
    // A visible "line N" gutter: the widget must read as a LIST OF LINES on
    // sight. Reported defect — a learner who does not already know the
    // box-per-line mechanic sees only an input and has no way to guess that
    // Enter builds the next one.
    const num = document.createElement("span");
    num.className = "tutor-lines-num";
    num.setAttribute("aria-hidden", "true");
    row.appendChild(num);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tutor-output-input tutor-output-line tutor-lines-input";
    input.value = value;
    input.placeholder = placeholder;
    // Same code-not-prose mobile hardening createAnswerInput applies: exact
    // output comparison dies quietly under autocapitalize/autocorrect.
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocomplete", "off");
    const del = document.createElement("button");
    del.type = "button";
    del.className = "tutor-lines-del";
    del.textContent = "✕";
    del.title = "remove this line";
    del.setAttribute("aria-label", "remove this line");
    del.addEventListener("click", () => {
      if (frozen || readOnly) return;
      const list = boxes();
      const i = list.indexOf(input);
      removeRow(input);
      const next = boxes();
      caretTo(next[Math.min(i, next.length - 1)], "end");
    });
    row.append(input, del);

    input.addEventListener("keydown", (e) => {
      if (locked(input)) return;
      const list = boxes();
      const i = list.indexOf(input);
      const isLast = i === list.length - 1;
      if (e.key === "Enter") {
        e.preventDefault();
        if (!isLast) { caretTo(list[i + 1], "end"); return; }
        if (input.value !== "") { caretTo(makeRow("", row), "start"); return; }
        if (list.length >= 2) { removeRow(input); onSubmit?.(); }
        return; // one empty box: an empty answer, nothing to submit
      }
      if (e.key === "Backspace" && input.value === "" && i > 0 && (input.selectionStart ?? 0) === 0) {
        e.preventDefault();
        removeRow(input);
        caretTo(boxes()[i - 1], "end");
        return;
      }
      if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); caretTo(list[i - 1], "start"); return; }
      if (e.key === "ArrowDown" && !isLast) { e.preventDefault(); caretTo(list[i + 1], "end"); }
    });

    // Paste is how a learner who copied output from elsewhere answers: the
    // newlines become boxes rather than vanishing into one.
    input.addEventListener("paste", (e) => {
      if (locked(input)) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (!text.includes("\n") && !text.includes("\r")) return; // let the browser paste
      e.preventDefault();
      const parts = text.replace(/\r\n?/g, "\n").split("\n");
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const tail = input.value.slice(end);
      input.value = input.value.slice(0, start) + parts[0];
      let cur = input;
      for (let k = 1; k < parts.length; k++) cur = makeRow(parts[k], cur.parentElement);
      const caret = cur.value.length;
      cur.value += tail;
      caretTo(cur, "end");
      try { cur.setSelectionRange(caret, caret); } catch { /* not selectable */ }
    });

    if (after) after.insertAdjacentElement("afterend", row);
    else rowsEl.appendChild(row);
    relabel();
    return input;
  }

  addBtn.addEventListener("click", () => {
    if (frozen || readOnly) return;
    caretTo(makeRow("", rowsEl.lastElementChild), "start");
  });

  makeRow(); // exactly one box, always

  const values = () => boxes().map((input) => input.value);
  const trimmed = () => {
    const list = values();
    while (list.length && list[list.length - 1] === "") list.pop();
    return list;
  };
  const setValue = (text) => {
    rowsEl.textContent = "";
    const parts = String(text ?? "").split("\n");
    for (const p of parts) makeRow(p);
    if (!boxes().length) makeRow();
  };

  return {
    el: wrap,
    focus: () => boxes()[0]?.focus(),
    getValue: () => trimmed().join("\n"),
    setValue,
    setReadOnly(v) {
      readOnly = Boolean(v);
      for (const input of boxes()) input.readOnly = readOnly;
      addBtn.disabled = readOnly || frozen;
      for (const b of wrap.querySelectorAll(".tutor-lines-del")) b.disabled = readOnly || frozen;
    },
    get readOnly() { return readOnly; },
    collect: () => ({ text: trimmed().join("\n") }),
    applyResult(result, { reveal = true } = {}) {
      void reveal; // the caller owns the reveal block (tutor card / quiz panel)
      const ok = result?.correct === true;
      const bad = result?.correct === false;
      wrap.classList.toggle("ok", ok);
      wrap.classList.toggle("bad", bad);
      for (const input of boxes()) {
        input.classList.toggle("ok", ok);
        input.classList.toggle("bad", bad);
      }
    },
    freeze() {
      frozen = true;
      for (const input of boxes()) input.disabled = true;
      for (const b of wrap.querySelectorAll("button")) b.disabled = true;
    },
    line: null,
    wide: false,
  };
}

// The "gone" affordance for predict-state asks (ladder §R4b W4): a child
// should never have to GUESS the magic word for "there is no such name", so
// a quiet chip fills the box with the canonical token. Rendered only for
// predict-state — every accepted alias still grades right if typed by hand.
export function createGoneChip(input) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "tutor-gone-chip";
  chip.textContent = "the name is gone";
  chip.addEventListener("click", () => {
    if (input.readOnly || input.disabled) return;
    input.value = "gone";
    input.focus();
  });
  return chip;
}

// The one "what it really printed" reveal block. Idempotent per container.
export function appendExpected(container, { label = "actual output:", text } = {}) {
  if (text == null || container.querySelector(".tutor-expected")) return;
  const div = document.createElement("div");
  div.className = "tutor-expected";
  const span = document.createElement("span");
  span.className = "hint";
  span.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = text;
  div.append(span, pre);
  container.appendChild(div);
}

// Progressive trace simulation. Unlike the legacy trace table, this surface
// never receives or renders future rows: the tutor supplies only verified
// `committed` entries and asks this view to render the current phase.
export function renderTraceSimulation(body, q) {
  body.closest(".pr-question")?.classList.add("pr-trace-question");

  const wrap = document.createElement("div");
  wrap.className = "trace-sim";

  const head = document.createElement("div");
  head.className = "trace-sim-head";
  const title = document.createElement("div");
  title.className = "trace-sim-title";
  const eyebrow = document.createElement("span");
  eyebrow.textContent = "Trace";
  const objective = document.createElement("strong");
  objective.textContent = "Build the execution path";
  title.append(eyebrow, objective);
  const status = document.createElement("span");
  status.className = "trace-sim-status";
  status.textContent = "No steps built yet";
  head.append(title, status);

  const board = document.createElement("div");
  board.className = "trace-sim-board";
  const programPane = document.createElement("section");
  programPane.className = "trace-sim-program";
  const programHead = document.createElement("div");
  programHead.className = "trace-sim-pane-head";
  programHead.textContent = "Program";
  const source = document.createElement("div");
  source.className = "trace-sim-source";
  source.setAttribute("role", "group");
  source.setAttribute("aria-label", "Choose the next line to execute");

  const currentPane = document.createElement("section");
  currentPane.className = "trace-sim-current";
  const currentHead = document.createElement("div");
  currentHead.className = "trace-sim-pane-head trace-sim-current-head";
  const currentLabel = document.createElement("span");
  currentLabel.textContent = "Current step";
  const context = document.createElement("span");
  context.className = "trace-sim-context";
  context.textContent = "Context: module";
  currentHead.append(currentLabel, context);
  const ledger = document.createElement("ol");
  ledger.className = "trace-sim-ledger";
  const state = document.createElement("div");
  state.className = "trace-sim-state";
  const phaseHost = document.createElement("div");
  phaseHost.className = "trace-sim-phase";
  phaseHost.setAttribute("aria-live", "polite");
  const chrome = document.createElement("div");
  chrome.className = "trace-sim-controls";

  const completePanel = document.createElement("div");
  completePanel.className = "trace-sim-complete";
  completePanel.hidden = true;
  const completeTitle = document.createElement("strong");
  completeTitle.textContent = "Trace complete";
  const completeRoute = document.createElement("code");
  completeRoute.className = "trace-sim-route";
  const completeNote = document.createElement("p");
  completePanel.append(completeTitle, completeRoute, completeNote);

  const history = document.createElement("details");
  history.className = "trace-sim-history";
  history.hidden = true;
  const historySummary = document.createElement("summary");
  historySummary.textContent = "Execution history";
  history.append(historySummary, ledger);

  programPane.append(programHead, source);
  currentPane.append(currentHead, state, phaseHost, chrome, completePanel);
  board.append(programPane, currentPane);
  wrap.append(head, board, history);
  body.appendChild(wrap);

  let nextAnswer = null;
  let changedInputs = new Map();
  let outputCheck = null;
  let outputInput = null;
  let returnInput = null;
  let noEffectButton = null;
  let noEffectChosen = false;
  let activePhase = "next-line";
  let committedHistory = [];
  let renderedCommitted = false;
  const lineChoices = new Map();
  const choices = [];

  const choiceAnswer = (choice) => choice.classList.contains("trace-sim-end")
    ? { kind: "end" }
    : { kind: "line", line: Number(choice.dataset.line) };

  function applyChoice(answer) {
    nextAnswer = answer;
    for (const choice of choices) {
      const candidate = choiceAnswer(choice);
      const picked = answer?.kind === candidate.kind
        && (candidate.kind === "end" || Number(answer.line) === candidate.line);
      choice.classList.toggle("picked", picked);
      choice.setAttribute("aria-pressed", String(picked));
    }
  }

  for (const sourceLine of q.sourceLines) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "trace-sim-line";
    btn.dataset.line = String(sourceLine.line);
    btn.dataset.selectable = String(sourceLine.selectable);
    const mark = document.createElement("span");
    mark.className = "trace-sim-line-mark";
    mark.setAttribute("aria-hidden", "true");
    const num = document.createElement("span");
    num.className = "uid trace-sim-line-num";
    num.textContent = String(sourceLine.line);
    const code = document.createElement("code");
    code.textContent = sourceLine.text || " ";
    btn.append(mark, num, code);
    btn.setAttribute("aria-pressed", "false");
    btn.disabled = true;
    if (sourceLine.selectable) {
      btn.addEventListener("click", () => {
        if (activePhase === "next-line") applyChoice({ kind: "line", line: sourceLine.line });
      });
    }
    lineChoices.set(sourceLine.line, btn);
    choices.push(btn);
    source.appendChild(btn);
  }
  const endChoice = document.createElement("button");
  endChoice.type = "button";
  endChoice.className = "trace-sim-end";
  const endIcon = document.createElement("span");
  endIcon.setAttribute("aria-hidden", "true");
  endIcon.textContent = "■";
  const endLabel = document.createElement("span");
  endLabel.textContent = "Program ends";
  endChoice.append(endIcon, endLabel);
  endChoice.setAttribute("aria-pressed", "false");
  endChoice.disabled = true;
  endChoice.addEventListener("click", () => {
    if (activePhase === "next-line") applyChoice({ kind: "end" });
  });
  choices.push(endChoice);
  source.appendChild(endChoice);

  source.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const enabled = choices.filter((choice) => !choice.disabled);
    if (!enabled.length) return;
    const current = enabled.indexOf(document.activeElement);
    let index = current;
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = enabled.length - 1;
    else if (event.key === "ArrowDown") index = current < 0 ? 0 : (current + 1) % enabled.length;
    else index = current < 0 ? enabled.length - 1 : (current - 1 + enabled.length) % enabled.length;
    event.preventDefault();
    enabled[index].focus();
  });

  function setSourceEnabled(enabled) {
    for (const sourceLine of q.sourceLines) {
      lineChoices.get(sourceLine.line).disabled = !enabled || !sourceLine.selectable;
    }
    endChoice.disabled = !enabled;
    source.classList.toggle("is-locked", !enabled);
  }

  function functionLabel(name) {
    return !name || name === "<module>" ? "module" : `${name}()`;
  }

  function contextAfter(committed) {
    const latest = committed.at(-1);
    if (!latest || latest.next?.kind !== "line") return "<module>";
    let name = latest.next.function ?? "<module>";
    for (const transition of latest.effects?.transitions ?? []) {
      if (transition.kind === "call") name = transition.function;
      if (transition.kind === "return") name = transition.callerFunction ?? "<module>";
    }
    return name;
  }

  function setContext(name) {
    context.textContent = `Context: ${functionLabel(name)}`;
  }

  function renderState(cursor) {
    state.textContent = "";
    const label = document.createElement("span");
    label.className = "trace-sim-state-label";
    label.textContent = cursor === 0 ? "Before the program" : "State so far";
    state.appendChild(label);
    const bindings = q.step(cursor).before;
    for (const name of q.names) {
      const chip = document.createElement("span");
      chip.className = "trace-sim-state-chip";
      const code = document.createElement("code");
      code.textContent = bindings[name] == null ? `${name}: unbound` : `${name} = ${bindings[name]}`;
      chip.appendChild(code);
      state.appendChild(chip);
    }
  }

  function factsFor(entry) {
    const facts = [];
    const effects = entry.effects;
    if (!effects) return facts;
    for (const [name, value] of Object.entries(effects.bindings?.changed ?? {})) {
      const at = effects.attribution?.[name];
      facts.push(at?.kind === "caller-resume"
        ? `resume line ${at.line}: ${name} = ${value}`
        : `${name} = ${value}`);
    }
    for (const name of effects.bindings?.gone ?? []) facts.push(`${name} is gone`);
    if (Object.hasOwn(effects, "returnValue")) facts.push(`returns ${effects.returnValue}`);
    if (effects.output?.writes) facts.push(`prints ${JSON.stringify(effects.output.text)}`);
    for (const transition of effects.transitions ?? []) {
      if (transition.kind === "call") facts.push(`calls ${transition.function}()`);
      if (transition.kind === "return") {
        facts.push(transition.callerLine == null
          ? `returns from ${transition.function}()`
          : `returns to line ${transition.callerLine}`);
      }
    }
    if (!facts.length) facts.push("no watched value or output changes");
    return facts;
  }

  function setCommitted(committed = []) {
    committedHistory = committed;
    ledger.textContent = "";
    for (const entry of committed) {
      const li = document.createElement("li");
      li.className = "trace-sim-ledger-row";
      if (entry.revealed) li.classList.add("revealed");
      const head = document.createElement("div");
      head.className = "trace-sim-ledger-head";
      const line = document.createElement("strong");
      line.textContent = entry.next.kind === "end"
        ? "Program ends"
        : `Line ${entry.next.line}${entry.next.function !== "<module>" ? ` in ${entry.next.function}()` : ""}`;
      head.appendChild(line);
      if (entry.revealed) {
        const badge = document.createElement("span");
        badge.className = "trace-sim-revealed";
        badge.textContent = "revealed";
        head.appendChild(badge);
      } else if (entry.corrected) {
        const badge = document.createElement("span");
        badge.className = "trace-sim-corrected";
        badge.textContent = "solved after retry";
        head.appendChild(badge);
      }
      li.appendChild(head);
      if (entry.next.kind === "line") {
        const code = document.createElement("code");
        code.className = "trace-sim-code";
        code.textContent = entry.next.codeText;
        li.appendChild(code);
      }
      const effects = entry.effects;
      if (effects) {
        const facts = document.createElement("ul");
        facts.className = "trace-sim-facts";
        for (const text of factsFor(entry)) {
          const fact = document.createElement("li");
          fact.textContent = text;
          facts.appendChild(fact);
        }
        li.appendChild(facts);
      }
      ledger.appendChild(li);
    }

    const built = committed.filter((entry) => entry.next?.kind === "line");
    status.textContent = built.length === 0
      ? "No steps built yet"
      : `${built.length} ${built.length === 1 ? "step" : "steps"} built`;
    const occurrences = new Map();
    for (const entry of built) {
      occurrences.set(entry.next.line, (occurrences.get(entry.next.line) ?? 0) + 1);
    }
    for (const [line, choice] of lineChoices) {
      const count = occurrences.get(line) ?? 0;
      const previousCount = Number(choice.dataset.executions ?? 0);
      const mark = choice.querySelector(".trace-sim-line-mark");
      mark.textContent = count > 1 ? `×${count}` : count === 1 ? "✓" : "";
      choice.classList.toggle("executed", count > 0);
      choice.dataset.executions = String(count);
      if (renderedCommitted && count > previousCount) {
        choice.classList.remove("just-committed");
        requestAnimationFrame(() => {
          choice.classList.add("just-committed");
          choice.addEventListener("animationend", () => {
            choice.classList.remove("just-committed");
          }, { once: true });
        });
      }
      const sourceLine = q.sourceLines.find((item) => item.line === line);
      choice.setAttribute("aria-label", count > 0
        ? `Line ${line}, executed ${count} ${count === 1 ? "time" : "times"}: ${sourceLine?.text ?? ""}`
        : `Line ${line}: ${sourceLine?.text ?? ""}`);
    }
    history.hidden = committed.length === 0;
    if (committed.length) {
      const latest = committed.at(-1);
      const where = latest.next?.kind === "end" ? "Program ended" : `Last step: line ${latest.next.line}`;
      const fact = factsFor(latest)[0];
      historySummary.textContent = fact ? `${where} · ${fact}` : where;
    }
    renderedCommitted = true;
  }

  function showNext(cursor, draft = null) {
    activePhase = "next-line";
    renderState(cursor);
    setContext(contextAfter(committedHistory));
    phaseHost.textContent = "";
    phaseHost.dataset.phase = "next-line";
    completePanel.hidden = true;
    setSourceEnabled(true);
    applyChoice(draft);
    const phaseLabel = document.createElement("span");
    phaseLabel.className = "trace-sim-phase-label";
    phaseLabel.textContent = "Choose control";
    const prompt = document.createElement("h3");
    prompt.textContent = cursor === 0 ? "Which line executes first?" : "Which line executes next?";
    const instruction = document.createElement("p");
    instruction.className = "trace-sim-instruction";
    instruction.textContent = "Select a line in the program, then check your choice.";
    phaseHost.append(phaseLabel, prompt, instruction);
  }

  function showEffects(cursor, draft = null) {
    activePhase = "effects";
    renderState(cursor);
    phaseHost.textContent = "";
    phaseHost.dataset.phase = "effects";
    completePanel.hidden = true;
    changedInputs = new Map();
    const info = q.effectPrompt(cursor);
    setContext(info.function);
    applyChoice({ kind: "line", line: info.line });
    setSourceEnabled(false);
    const phaseLabel = document.createElement("span");
    phaseLabel.className = "trace-sim-phase-label";
    phaseLabel.textContent = "Record effects";
    const prompt = document.createElement("h3");
    prompt.textContent = `What does line ${info.line} produce?`;
    const code = document.createElement("code");
    code.className = "trace-sim-current-code";
    code.textContent = info.codeText;
    const names = document.createElement("div");
    names.className = "trace-sim-effects";
    const label = document.createElement("p");
    label.className = "hint";
    label.textContent = "Mark every visible change made by this execution.";
    names.appendChild(label);
    for (const name of q.names) {
      const row = document.createElement("div");
      row.className = "trace-sim-effect-row";
      const nameLabel = document.createElement("code");
      nameLabel.className = "trace-sim-effect-name";
      nameLabel.textContent = name;
      const before = document.createElement("code");
      before.className = "trace-sim-effect-before";
      before.textContent = info.before[name] == null ? "unbound" : info.before[name];
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "trace-sim-name-toggle";
      toggle.textContent = "Unchanged";
      const input = createAnswerInput({ singleLine: true, placeholder: `${name}'s new value` });
      const initial = draft?.bindings?.changed?.[name];
      input.hidden = initial === undefined;
      if (initial !== undefined) {
        toggle.classList.add("picked");
        toggle.setAttribute("aria-pressed", "true");
        toggle.textContent = "Changes to";
        input.value = initial;
        changedInputs.set(name, input);
      } else toggle.setAttribute("aria-pressed", "false");
      toggle.addEventListener("click", () => {
        const on = !changedInputs.has(name);
        toggle.classList.toggle("picked", on);
        toggle.setAttribute("aria-pressed", String(on));
        toggle.textContent = on ? "Changes to" : "Unchanged";
        input.hidden = !on;
        if (on) {
          setNoEffect(false);
          changedInputs.set(name, input);
          input.focus();
        } else changedInputs.delete(name);
      });
      input.addEventListener("input", () => setNoEffect(false));
      row.append(nameLabel, before, toggle, input);
      names.appendChild(row);
    }
    const outputRow = document.createElement("label");
    outputRow.className = "trace-sim-output-row";
    outputCheck = document.createElement("input");
    outputCheck.type = "checkbox";
    outputCheck.checked = draft?.output?.writes === true;
    outputRow.append(outputCheck, " This line prints output");
    outputInput = createAnswerInput({ placeholder: "exact output from this line" });
    outputInput.hidden = !outputCheck.checked;
    outputInput.value = draft?.output?.text ?? "";
    outputCheck.addEventListener("change", () => {
      outputInput.hidden = !outputCheck.checked;
      if (outputCheck.checked) {
        setNoEffect(false);
        outputInput.focus();
      }
    });
    outputInput.addEventListener("input", () => setNoEffect(false));
    names.append(outputRow, outputInput);
    returnInput = null;
    if (info.hasReturn) {
      const returnRow = document.createElement("label");
      returnRow.className = "trace-sim-return-row";
      returnRow.append("Return value");
      returnInput = createAnswerInput({ singleLine: true, placeholder: "value returned" });
      returnInput.value = draft?.returnValue ?? "";
      returnInput.addEventListener("input", () => setNoEffect(false));
      returnRow.appendChild(returnInput);
      names.appendChild(returnRow);
    }
    noEffectButton = document.createElement("button");
    noEffectButton.type = "button";
    noEffectButton.className = "trace-sim-no-effect";
    noEffectButton.textContent = "No visible effect";
    noEffectButton.addEventListener("click", () => setNoEffect(!noEffectChosen));
    names.appendChild(noEffectButton);
    setNoEffect(draft?.noVisibleEffect === true);
    phaseHost.append(phaseLabel, prompt, code, names);
  }

  function setNoEffect(on) {
    noEffectChosen = Boolean(on);
    if (!noEffectButton) return;
    noEffectButton.classList.toggle("picked", noEffectChosen);
    noEffectButton.setAttribute("aria-pressed", String(noEffectChosen));
    if (!noEffectChosen) return;
    for (const [name, input] of changedInputs) {
      const row = input.closest(".trace-sim-effect-row");
      const toggle = row?.querySelector(".trace-sim-name-toggle");
      if (toggle) {
        toggle.classList.remove("picked");
        toggle.setAttribute("aria-pressed", "false");
        toggle.textContent = "Unchanged";
      }
      input.hidden = true;
      changedInputs.delete(name);
    }
    if (outputCheck) outputCheck.checked = false;
    if (outputInput) {
      outputInput.value = "";
      outputInput.hidden = true;
    }
    if (returnInput) returnInput.value = "";
  }

  return {
    setCommitted,
    showNext,
    showEffects,
    collectNext: () => nextAnswer,
    collectEffects() {
      return {
        bindings: {
          changed: Object.fromEntries([...changedInputs].map(([name, input]) => [name, input.value])),
          gone: [],
        },
        output: outputCheck?.checked
          ? { writes: true, text: outputInput?.value ?? "" }
          : { writes: false },
        ...(returnInput ? { returnValue: returnInput.value } : {}),
        ...(noEffectChosen ? { noVisibleEffect: true } : {}),
      };
    },
    validateEffects() {
      const hasReturn = returnInput && String(returnInput.value ?? "").trim();
      if (changedInputs.size || outputCheck?.checked || hasReturn || noEffectChosen) return null;
      return "Choose what changes, or select No visible effect";
    },
    mountChrome({ actions, note } = {}) {
      if (note) chrome.appendChild(note);
      if (actions) chrome.appendChild(actions);
    },
    complete({ ok = false, usedReveal = false } = {}) {
      activePhase = "complete";
      wrap.classList.add("is-complete");
      phaseHost.hidden = true;
      state.hidden = true;
      chrome.hidden = true;
      completePanel.hidden = false;
      setSourceEnabled(false);
      const route = committedHistory.map((entry) => entry.next?.kind === "end"
        ? "END"
        : `L${entry.next?.line}`).join(" › ");
      completeRoute.textContent = route;
      completeNote.textContent = ok
        ? "Built cleanly from start to finish."
        : usedReveal
          ? "Completed with revealed help."
          : "Completed after correcting a step.";
    },
    freeze() {
      for (const control of wrap.querySelectorAll("button, input, textarea")) control.disabled = true;
    },
    line: null,
    wide: true,
    hideMechanics: true,
  };
}

// The trace-table renderer: one row per kept execution step, one column per
// watched name; changed cells are inputs (data-blank-id), givens are text.
// Returns the standard view surface plus freeze() (used by the tutor's lock).
export function renderTraceTable(body, q) {
  const table = document.createElement("table");
  table.className = "mem-table quiz-mem tutor-trace-table";
  const head = document.createElement("tr");
  for (const h of ["step", "line", "code", ...q.names]) {
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const r of q.rows) {
    const tr = document.createElement("tr");
    if (r.elided) {
      const td = document.createElement("td");
      td.colSpan = 3 + q.names.length;
      td.className = "hint";
      td.textContent = "⋯ some steps skipped ⋯";
      tr.appendChild(td);
      table.appendChild(tr);
      continue;
    }
    const step = document.createElement("td");
    step.className = "uid";
    step.textContent = String(r.step);
    const line = document.createElement("td");
    line.className = "uid";
    line.textContent = String(r.line);
    const codeTd = document.createElement("td");
    // Frame rows (opt-in `frames: true`) read as a step taken INSIDE a call:
    // indented, with the frame named before the code.
    if (r.frame) {
      tr.classList.add("trace-frame-row");
      const tag = document.createElement("span");
      tag.className = "trace-frame-label";
      tag.textContent = r.frame;
      codeTd.appendChild(tag);
    }
    const codeEl = document.createElement("code");
    codeEl.textContent = r.codeText;
    codeTd.appendChild(codeEl);
    tr.append(step, line, codeTd);
    for (const c of r.cells) {
      const td = document.createElement("td");
      if (c.blank) {
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
    table.appendChild(tr);
  }
  body.appendChild(table);
  const inputs = () => table.querySelectorAll("input[data-blank-id]");
  return {
    collect() {
      const answers = {};
      for (const inp of inputs()) answers[inp.dataset.blankId] = inp.value;
      return answers;
    },
    applyResult(result) {
      for (const inp of inputs()) {
        const ok = result.perBlank?.[inp.dataset.blankId];
        inp.classList.toggle("ok", ok === true);
        inp.classList.toggle("bad", ok === false);
        inp.parentElement.querySelector(".tutor-cell-truth")?.remove();
        if (ok === false) {
          const span = document.createElement("span");
          span.className = "hint tutor-cell-truth";
          span.textContent = ` → ${result.expected?.[inp.dataset.blankId] ?? ""}`;
          inp.parentElement.appendChild(span);
        }
      }
    },
    freeze() { for (const inp of inputs()) inp.readOnly = true; },
    line: null,
    wide: true,
  };
}

// The Parsons renderer (expansion ladder §R2): one row per dealt item, each
// with ↑/↓ buttons — touch-first, no drag dependency, so it works the same on
// a phone and a laptop. `q.items` arrives in the DEALT (shuffled) order and
// carries program text: every row is built with textContent (invariant 8).
// collect() returns the ids top-to-bottom; the tutor joins their text and
// RUNS it (any order that really prints the target is right).
export function renderOrderLines(body, q) {
  const list = document.createElement("div");
  list.className = "quiz-order pr-order";
  const rowFor = (item) => {
    const row = document.createElement("div");
    row.className = "quiz-order-row pr-order-row";
    row.dataset.item = item.id;
    const up = document.createElement("button");
    up.type = "button";
    up.className = "pr-order-move";
    up.textContent = "↑";
    up.title = "move this line up";
    const down = document.createElement("button");
    down.type = "button";
    down.className = "pr-order-move";
    down.textContent = "↓";
    down.title = "move this line down";
    const code = document.createElement("code");
    code.textContent = item.text;
    const move = (dir) => {
      if (list.classList.contains("frozen")) return;
      const rows = [...list.children];
      const i = rows.indexOf(row);
      const j = i + dir;
      if (j < 0 || j >= rows.length) return;
      if (dir < 0) list.insertBefore(row, rows[j]);
      else list.insertBefore(rows[j], row);
    };
    up.addEventListener("click", () => move(-1));
    down.addEventListener("click", () => move(1));
    row.append(up, down, code);
    return row;
  };
  for (const item of q.items) list.appendChild(rowFor(item));
  body.appendChild(list);
  return {
    collect: () => [...list.children].map((row) => row.dataset.item),
    applyResult(result) {
      list.classList.toggle("ok", result.correct === true);
      list.classList.toggle("bad", result.correct === false);
    },
    freeze() {
      list.classList.add("frozen");
      for (const b of list.querySelectorAll("button")) b.disabled = true;
    },
    line: null,
    wide: false,
  };
}

// The FIXED error palette (expansion ladder §R3). All four names are shown on
// every question, from day one — a palette that shrank to the plausible ones
// would turn "always the only TypeError-ish option" into a meta-pattern (E6).
export const ERROR_NAMES = ["NameError", "TypeError", "IndexError", "KeyError"];

// THE LINE PICKER: the numbered, tappable program. One button per line, one
// pick at a time. It is the shared half of two forms — predict-the-error
// (which adds the error palette below) and fix-the-bug (ladder §R5's
// composition, which adds a single-line answer box) — so it lives here once
// rather than in two near-copies. Program text is set with textContent
// (invariant 8). The returned handle is deliberately low-level: the owning
// renderer decides what "result" means.
export function renderLinePicker(body, { code, lines } = {}) {
  const texts = lines ?? String(code ?? "").replace(/\n$/, "").split("\n");
  let pickedLine = null;
  let onPick = null;

  const linesEl = document.createElement("div");
  linesEl.className = "quiz-errlines pr-errlines";
  const lineBtns = texts.map((text, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pr-errline";
    btn.dataset.line = String(i + 1);
    const num = document.createElement("span");
    num.className = "uid pr-errline-num";
    num.textContent = String(i + 1);
    const codeEl = document.createElement("code");
    codeEl.textContent = text;
    btn.append(num, codeEl);
    btn.addEventListener("click", () => {
      if (linesEl.classList.contains("frozen")) return;
      pickedLine = i + 1;
      for (const b of lineBtns) b.classList.toggle("picked", b === btn);
      onPick?.(pickedLine);
    });
    linesEl.appendChild(btn);
    return btn;
  });
  body.appendChild(linesEl);

  return {
    el: linesEl,
    buttons: lineBtns,
    picked: () => pickedLine,
    // Called whenever the learner taps a line (fix-the-bug reveals its answer
    // box on the first pick).
    onPick(fn) { onPick = fn; },
    // ok === true/false marks the learner's pick; `truthLine` marks the line
    // the truth points at when it differs (predict-the-error's crash site).
    mark({ ok, truthLine = null } = {}) {
      for (const b of lineBtns) {
        const n = Number(b.dataset.line);
        b.classList.toggle("ok", ok === true && n === pickedLine);
        b.classList.toggle("bad", ok === false && n === pickedLine);
        b.classList.toggle("truth", truthLine != null && n === truthLine && n !== pickedLine);
      }
    },
    freeze() {
      linesEl.classList.add("frozen");
      for (const b of lineBtns) b.disabled = true;
    },
  };
}

// The predict-the-error renderer: the shared line picker plus the four-name
// palette. Both are single-choice; the tutor's lock reads collect() →
// { line, type } (either may be null until the learner has picked).
export function renderErrorPicker(body, q) {
  const picker = renderLinePicker(body, { code: q.code });
  let pickedType = null;

  const palette = document.createElement("div");
  palette.className = "quiz-errkinds pr-errkinds";
  const kindBtns = ERROR_NAMES.map((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pr-errkind";
    btn.dataset.errorName = name;
    btn.textContent = name;
    btn.addEventListener("click", () => {
      if (palette.classList.contains("frozen")) return;
      pickedType = name;
      for (const b of kindBtns) b.classList.toggle("picked", b === btn);
    });
    palette.appendChild(btn);
    return btn;
  });
  body.appendChild(palette);

  return {
    collect: () => ({ line: picker.picked(), type: pickedType }),
    // Marking is per-half so a half-right answer READS as half right: the
    // picked buttons go ok/bad individually, and the truth is marked too.
    applyResult(result) {
      const { lineOk, typeOk, actual } = result;
      picker.mark({ ok: lineOk, truthLine: lineOk === false && actual != null ? actual.line : null });
      for (const b of kindBtns) {
        const name = b.dataset.errorName;
        b.classList.toggle("ok", typeOk === true && name === pickedType);
        b.classList.toggle("bad", typeOk === false && name === pickedType);
        b.classList.toggle("truth", typeOk === false && actual != null && name === actual.type);
      }
    },
    freeze() {
      picker.freeze();
      palette.classList.add("frozen");
      for (const b of kindBtns) b.disabled = true;
    },
    line: null,
    wide: false,
  };
}

export function renderQuestionBody(body, q, { omitPrompt = false } = {}) {
  if (!omitPrompt) {
    const prompt = document.createElement("p");
    prompt.textContent = q.prompt;
    body.appendChild(prompt);
  }

  const collectBlankInputs = () => {
    const answers = {};
    for (const inp of body.querySelectorAll("input[data-blank]")) {
      answers[inp.dataset.blank] = inp.value;
    }
    return answers;
  };

  // Mark every blank input from result.perBlank (shared by several kinds).
  const markBlanks = (result) => {
    for (const inp of body.querySelectorAll("input[data-blank]")) {
      const ok = result.perBlank?.[inp.dataset.blank];
      inp.classList.toggle("ok", ok === true);
      inp.classList.toggle("bad", ok === false);
      if (ok === false) inp.title = `expected: ${result.expected[inp.dataset.blank]}`;
    }
  };

  if (q.construction?.type === "memory-graph") {
    const context = document.createElement("p");
    context.className = "construction-context";
    context.textContent = q.construction.mode === "transform"
      ? `Start with the state after line ${q.fromLine}, then update it for line ${q.toLine}.`
      : q.construction.mode === "partial"
        ? "Some pieces are already present. Complete every name, value, data pill, and connection."
        : "Start from the blank scopes and construct the complete state.";
    body.appendChild(context);
    const construction = createMemoryConstruction(body, q.construction);
    return {
      collect: construction.getAnswer,
      applyResult: (result) => construction.mark?.(result),
      line: q.toLine ?? q.line,
      wide: true,
    };
  }

  if (q.kind === "memory-next-line" || q.kind === "memory-line-to-line") {
    const h1 = document.createElement("h4");
    h1.textContent = `Given — after line ${q.fromLine}`;
    body.appendChild(h1);
    renderMemoryTable(body, q.given, false);
    const h2 = document.createElement("h4");
    h2.textContent = `Predict — after line ${q.toLine}`;
    body.appendChild(h2);
    renderMemoryTable(body, q.target, true);
    return { collect: collectBlankInputs, applyResult: markBlanks, line: q.fromLine, wide: false };
  }

  if (q.kind === "expression-sequence") {
    const construction = createEvaluationConstruction(body, q.evaluation);
    return {
      collect: construction.getAnswer,
      applyResult: (result) => construction.mark?.(result),
      line: q.line,
      wide: true,
    };
  }

  if (q.kind === "predict-output") {
    const ta = createAnswerInput({ placeholder: "type the program's output…" });
    body.appendChild(ta);
    return {
      collect: () => ({ text: ta.value }),
      // opts.reveal=false lets a caller mark wrong without showing the
      // answer yet (the tutor's retry ladder); default matches the quiz
      // panel's reveal-on-wrong behavior.
      applyResult(result, { reveal = true } = {}) {
        ta.classList.toggle("ok", result.correct === true);
        ta.classList.toggle("bad", result.correct === false);
        if (reveal && !result.correct) {
          appendExpected(body, { text: result.expected?.text });
        }
      },
      line: q.wholeProgram ? null : q.line,
      wide: false,
    };
  }

  if (q.kind === "trace-table") {
    return renderTraceTable(body, q);
  }

  if (q.kind === "code-order") {
    const list = document.createElement("div");
    list.className = "quiz-order";
    q.items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "quiz-order-row";
      const num = document.createElement("input");
      num.type = "number";
      num.min = "1";
      num.max = String(q.items.length);
      num.dataset.item = it.id;
      const code = document.createElement("code");
      code.textContent = it.text;
      row.append(num, code);
      list.appendChild(row);
    });
    body.appendChild(list);
    const collect = () => [...list.querySelectorAll("input[data-item]")]
      .map((inp) => ({ id: inp.dataset.item, pos: Number(inp.value) || Infinity }))
      .sort((a, b) => a.pos - b.pos)
      .map((x) => x.id);
    return {
      collect,
      applyResult(result) {
        if (!result.perIndex) return;
        const orderIds = collect();
        // color each row by whether its line sits at the right final position
        const posOf = new Map(orderIds.map((id, i) => [id, i]));
        for (const inp of list.querySelectorAll(".quiz-order-row input")) {
          const finalPos = posOf.get(inp.dataset.item);
          const ok = result.perIndex[finalPos] === true
            && q.items.find((it) => it.id === inp.dataset.item)?.text === result.expected[finalPos];
          inp.classList.toggle("ok", ok);
          inp.classList.toggle("bad", !ok);
        }
      },
      line: null,
      wide: false,
    };
  }

  if (q.kind === "code-structure") {
    const pre = document.createElement("div");
    pre.className = "quiz-code";
    for (const line of q.lines) {
      const row = document.createElement("div");
      if (line.blankId) {
        row.append(line.indent ?? "");
        const input = document.createElement("input");
        input.type = "text";
        input.dataset.blank = line.blankId;
        input.placeholder = "…";
        input.className = "quiz-line-input";
        row.appendChild(input);
      } else {
        row.textContent = line.text === "" ? " " : line.text;
      }
      pre.appendChild(row);
    }
    body.appendChild(pre);
    return { collect: collectBlankInputs, applyResult: markBlanks, line: null, wide: false };
  }

  if (q.kind === "code-args") {
    const row = document.createElement("div");
    row.className = "quiz-code";
    row.append(q.before);
    q.blanks.forEach((b, i) => {
      if (i > 0) row.append(", ");
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.blank = b.id;
      input.placeholder = "?";
      row.appendChild(input);
    });
    row.append(q.after);
    body.appendChild(row);
    return { collect: collectBlankInputs, applyResult: markBlanks, line: null, wide: false };
  }

  body.append(`(no renderer for kind ${q.kind} — see question-ui.mjs)`);
  return { collect: () => ({}), applyResult: () => {}, line: null, wide: false };
}
