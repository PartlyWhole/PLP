// Pilot quiz UI over the question engine (questions.mjs). Deliberately
// thin: a floating panel that renders whatever payload shape the generator
// produced (memory tables with blank cells, orderable code lines, code with
// blanked lines, a call with blanked arguments) and grades on demand.
// The UI is disposable; the engine is the product.

import { questionGenerators, generateQuestion } from "./questions.mjs";

export function createQuiz({ memory, editor }) {
  const panel = document.createElement("div");
  panel.className = "quiz-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="quiz-head">
      <select data-role="quiz-kind"></select>
      <button data-role="quiz-new" type="button" class="primary">New</button>
      <button data-role="quiz-check" type="button">Check</button>
      <span class="spacer"></span>
      <span class="hint" data-role="quiz-result"></span>
      <button data-role="quiz-close" type="button" title="Close">✕</button>
    </div>
    <div class="quiz-body" data-role="quiz-body"><p class="hint">Press New for a question.
      Memory questions need a completed run.</p></div>`;
  document.body.appendChild(panel);
  const el = (r) => panel.querySelector(`[data-role=${r}]`);

  const kindSel = el("quiz-kind");
  for (const [kind, gen] of Object.entries(questionGenerators)) {
    const o = document.createElement("option");
    o.value = kind;
    o.textContent = gen.label;
    kindSel.appendChild(o);
  }

  let current = null; // { question, collect() -> answers }

  const ctx = () => ({
    source: editor.getValue(),
    steps: memory.steps(),
    positions: memory.linePositions(),
  });

  // ---- per-payload renderers (extensible: add a case per new shape) ------
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

  function renderQuestion(q) {
    const body = el("quiz-body");
    body.textContent = "";
    el("quiz-result").textContent = "";
    const prompt = document.createElement("p");
    prompt.textContent = q.prompt;
    body.appendChild(prompt);

    if (q.kind === "memory-next-line" || q.kind === "memory-line-to-line") {
      const h1 = document.createElement("h4");
      h1.textContent = `Given — after line ${q.fromLine}`;
      body.appendChild(h1);
      renderMemoryTable(body, q.given, false);
      const h2 = document.createElement("h4");
      h2.textContent = `Predict — after line ${q.toLine}`;
      body.appendChild(h2);
      renderMemoryTable(body, q.target, true);
      editor.highlightLine(q.fromLine);
      current = { question: q, collect: collectBlankInputs };
    } else if (q.kind === "code-order") {
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
      current = {
        question: q,
        collect() { // item ids sorted by the student's position numbers
          return [...list.querySelectorAll("input[data-item]")]
            .map((inp) => ({ id: inp.dataset.item, pos: Number(inp.value) || Infinity }))
            .sort((a, b) => a.pos - b.pos)
            .map((x) => x.id);
        },
      };
    } else if (q.kind === "code-structure") {
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
          row.textContent = line.text === "" ? " " : line.text;
        }
        pre.appendChild(row);
      }
      body.appendChild(pre);
      current = { question: q, collect: collectBlankInputs };
    } else if (q.kind === "code-args") {
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
      current = { question: q, collect: collectBlankInputs };
    } else {
      body.append(`(no renderer for kind ${q.kind} — see quiz.mjs)`);
      current = { question: q, collect: () => ({}) };
    }
    panel.querySelector("input")?.focus();
  }

  function collectBlankInputs() {
    const answers = {};
    for (const inp of panel.querySelectorAll("input[data-blank]")) {
      answers[inp.dataset.blank] = inp.value;
    }
    return answers;
  }

  function newQuestion(kind = kindSel.value, opts = {}) {
    const q = generateQuestion(kind, ctx(), opts);
    if (!q) {
      el("quiz-body").innerHTML = `<p class="hint">Couldn't build that question here${
        questionGenerators[kind]?.needsTrace ? " — run the program first" : ""}.</p>`;
      current = null;
      return null;
    }
    renderQuestion(q);
    return q;
  }

  function check() {
    if (!current) return null;
    const answers = current.collect();
    const result = current.question.grade(answers);
    // Mark blanks.
    for (const inp of panel.querySelectorAll("input[data-blank]")) {
      const ok = result.perBlank?.[inp.dataset.blank];
      inp.classList.toggle("ok", ok === true);
      inp.classList.toggle("bad", ok === false);
      if (ok === false) inp.title = `expected: ${result.expected[inp.dataset.blank]}`;
    }
    // Mark ordering rows.
    if (result.perIndex) {
      const rows = panel.querySelectorAll(".quiz-order-row input");
      const orderIds = current.collect();
      // color each row by whether its line sits at the right final position
      const posOf = new Map(orderIds.map((id, i) => [id, i]));
      for (const inp of rows) {
        const finalPos = posOf.get(inp.dataset.item);
        const ok = result.perIndex[finalPos] === true
          && current.question.items.find((it) => it.id === inp.dataset.item)?.text === result.expected[finalPos];
        inp.classList.toggle("ok", ok);
        inp.classList.toggle("bad", !ok);
      }
    }
    el("quiz-result").textContent = result.correct ? "✓ correct" : "not yet — ✗ marked";
    return result;
  }

  el("quiz-new").addEventListener("click", () => newQuestion());
  el("quiz-check").addEventListener("click", check);
  el("quiz-close").addEventListener("click", () => { panel.hidden = true; });

  return {
    open: () => { panel.hidden = false; },
    close: () => { panel.hidden = true; },
    toggle: () => { panel.hidden = !panel.hidden; },
    newQuestion, // (kind?, opts?) — options pass through to the generator
    check,
    current: () => current?.question ?? null,
    setKind: (k) => { kindSel.value = k; },
  };
}
