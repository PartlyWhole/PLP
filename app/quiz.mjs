// Pilot quiz UI over the question engine (questions.mjs). Deliberately
// thin: a floating panel that hosts one question at a time, rendered by the
// shared payload router (question-ui.mjs) and graded on demand.
// The UI is disposable; the engine is the product.

import { questionGenerators, generateQuestion } from "./questions.mjs";
import { events } from "./events.mjs";
import { renderQuestionBody } from "./question-ui.mjs";

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

  let current = null; // { question, view: { collect, applyResult, line, wide } }

  const ctx = () => ({
    source: editor.getValue(),
    steps: memory.steps(),
    positions: memory.linePositions(),
  });

  function renderQuestion(q) {
    const body = el("quiz-body");
    body.textContent = "";
    el("quiz-result").textContent = "";
    const view = renderQuestionBody(body, q);
    panel.classList.toggle("construction-open", Boolean(view.wide));
    if (view.line != null) editor.highlightLine(view.line);
    current = { question: q, view };
    panel.querySelector("input, textarea")?.focus();
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
    events.emit("quiz-question", { kind: q.kind });
    return q;
  }

  function check() {
    if (!current) return null;
    const result = current.question.grade(current.view.collect());
    current.view.applyResult(result);
    el("quiz-result").textContent = result.correct ? "✓ correct" : "not yet — ✗ marked";
    events.emit("quiz-graded", { kind: current.question.kind, correct: result.correct });
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
    currentAnswer: () => current?.view.collect() ?? null,
    setKind: (k) => { kindSel.value = k; },
  };
}
