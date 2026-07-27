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

export function renderQuestionBody(body, q) {
  const prompt = document.createElement("p");
  prompt.textContent = q.prompt;
  body.appendChild(prompt);

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
    const ta = document.createElement("textarea");
    ta.className = "tutor-output-input";
    ta.placeholder = "type the program's output…";
    ta.spellcheck = false;
    body.appendChild(ta);
    return {
      collect: () => ({ text: ta.value }),
      // opts.reveal=false lets a caller mark wrong without showing the
      // answer yet (the tutor's retry ladder); default matches the quiz
      // panel's reveal-on-wrong behavior.
      applyResult(result, { reveal = true } = {}) {
        ta.classList.toggle("ok", result.correct === true);
        ta.classList.toggle("bad", result.correct === false);
        if (reveal && !result.correct && result.expected?.text != null
          && !body.querySelector(".tutor-expected")) {
          const div = document.createElement("div");
          div.className = "tutor-expected";
          const label = document.createElement("span");
          label.className = "hint";
          label.textContent = "actual output:";
          const pre = document.createElement("pre");
          pre.textContent = result.expected.text;
          div.append(label, pre);
          body.appendChild(div);
        }
      },
      line: q.wholeProgram ? null : q.line,
      wide: false,
    };
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
