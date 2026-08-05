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
  return el;
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

// The predict-the-error renderer: one button per program line (numbered, with
// the line's text) plus the four-name palette. Both are single-choice; the
// tutor's lock reads collect() → { line, type } (either may be null until the
// learner has picked). Program text is set with textContent (invariant 8).
export function renderErrorPicker(body, q) {
  const lines = String(q.code ?? "").replace(/\n$/, "").split("\n");
  let pickedLine = null;
  let pickedType = null;

  const linesEl = document.createElement("div");
  linesEl.className = "quiz-errlines pr-errlines";
  const lineBtns = lines.map((text, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pr-errline";
    btn.dataset.line = String(i + 1);
    const num = document.createElement("span");
    num.className = "uid pr-errline-num";
    num.textContent = String(i + 1);
    const code = document.createElement("code");
    code.textContent = text;
    btn.append(num, code);
    btn.addEventListener("click", () => {
      if (linesEl.classList.contains("frozen")) return;
      pickedLine = i + 1;
      for (const b of lineBtns) b.classList.toggle("picked", b === btn);
    });
    linesEl.appendChild(btn);
    return btn;
  });
  body.appendChild(linesEl);

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
    collect: () => ({ line: pickedLine, type: pickedType }),
    // Marking is per-half so a half-right answer READS as half right: the
    // picked buttons go ok/bad individually, and the truth is marked too.
    applyResult(result) {
      const { lineOk, typeOk, actual } = result;
      for (const b of lineBtns) {
        const n = Number(b.dataset.line);
        b.classList.toggle("ok", lineOk === true && n === pickedLine);
        b.classList.toggle("bad", lineOk === false && n === pickedLine);
        b.classList.toggle("truth", lineOk === false && actual != null && n === actual.line);
      }
      for (const b of kindBtns) {
        const name = b.dataset.errorName;
        b.classList.toggle("ok", typeOk === true && name === pickedType);
        b.classList.toggle("bad", typeOk === false && name === pickedType);
        b.classList.toggle("truth", typeOk === false && actual != null && name === actual.type);
      }
    },
    freeze() {
      linesEl.classList.add("frozen");
      palette.classList.add("frozen");
      for (const b of [...lineBtns, ...kindBtns]) b.disabled = true;
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
