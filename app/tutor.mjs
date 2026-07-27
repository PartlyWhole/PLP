// Tutor lesson runtime: interprets curriculum scripts (curriculum/*.mjs)
// into the transcript feed, and connects asks/actions to the live app.
//
// Step vocabulary (linted by lintLesson at start):
//   { say: md, pocket?, pause? }        prose card; pause gates on Continue
//   { loadCode: source }                stash learner code once, set editor
//   { action: md, await: {event, count?} }  learner performs; events bus completes
//   { ask: { kind, opts?, hints?: [md], attempts? } }  question card
//   { done: md }                        closing card (implicit at array end)
// Any step may carry { if: { lastAnswer: value | [values] } }.
//
// Sequencing is deliberately simpler than the removed director's beat
// grammar: strictly ordered steps with one-shot `if` detours. A lesson is
// a conversation, and the framework only grows when a lesson being written
// demands it (design/tutor-plan.md §7.1, §9 "content risk").
//
// The learner's own program is stashed before the first loadCode and
// restored on exit — unless the learner has edited past the lesson's code,
// in which case their work stays (the tutor must never destroy student
// work; lesson code is reproducible by restarting the lesson).
//
// predict-then-verify (predict-output asks): the learner commits a
// prediction BEFORE ground truth exists, the lock button triggers a real,
// visible Trace, and grading compares against what the engine actually
// printed. The run IS the reveal.

import { generateQuestion, questionGenerators } from "./questions.mjs";
import { renderQuestionBody } from "./question-ui.mjs";
import { buildDrillLesson, drillTopics } from "./drills.mjs";
import { events } from "./events.mjs";

const STORE_KEY = "plp.tutor.v1";
const DRILL_STATS_KEY = "plp.drills.v1";

const KNOWN_EVENTS = new Set([
  "run-started", "run-ended", "run-rejected", "input-answered",
  "interrupt-requested", "edited", "scrubbed", "hover-name", "chip-clicked",
  "mode-changed", "memory-rendered", "quiz-question", "quiz-graded",
]);

export function lintLesson(lesson) {
  const errors = [];
  if (!lesson?.id) errors.push("lesson has no id");
  if (!Array.isArray(lesson?.steps) || !lesson.steps.length) errors.push("lesson has no steps");
  for (const [i, step] of (lesson?.steps ?? []).entries()) {
    const keys = ["say", "loadCode", "action", "ask", "done"].filter((k) => step[k] !== undefined);
    if (keys.length !== 1) errors.push(`step ${i}: needs exactly one of say/loadCode/action/ask/done`);
    if (step.action !== undefined) {
      const ev = step.await?.event;
      if (!ev) errors.push(`step ${i}: action needs await.event`);
      else if (!KNOWN_EVENTS.has(ev)) errors.push(`step ${i}: unknown event "${ev}"`);
    }
    if (step.ask !== undefined && !questionGenerators[step.ask.kind]) {
      errors.push(`step ${i}: unknown question kind "${step.ask.kind}"`);
    }
    if (step.if !== undefined && step.if.lastAnswer === undefined) {
      errors.push(`step ${i}: "if" supports { lastAnswer } only`);
    }
  }
  return errors;
}

export function createTutor({ editor, memory, consoleUI, ui, actions, curriculum, isCollabActive }) {
  let lesson = null;
  let stepIndex = -1;
  let waiting = null;   // { type: "pause"|"action"|"ask", off? }
  let batch = [];       // static descs of the current beat, shown together
                        // in the popup when a blocking step arrives
  let store = loadStore();

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
    catch { /* private mode / quota: the session still works, just won't survive reload */ }
  }
  function record(desc) {
    // Stamp each card with the program it was about (index into the
    // deduplicated store.programs), so reviewing an old bubble can show
    // that program when the editor has since moved on.
    if (store.currentProg != null && desc.prog === undefined) desc.prog = store.currentProg;
    (store.cards ??= []).push(desc);
    persist();
  }

  // Register the program a beat is about; dedupe exact repeats.
  function registerProgram(code) {
    store.programs ??= [];
    let i = store.programs.indexOf(code);
    if (i === -1) i = store.programs.push(code) - 1;
    store.currentProg = i;
  }

  const ctx = () => ({
    source: editor.getValue(),
    steps: memory.steps(),
    positions: memory.linePositions(),
  });

  // ---- drill stats (per-template seen/missed; weights future selection) --
  function loadDrillStats() {
    try { return JSON.parse(localStorage.getItem(DRILL_STATS_KEY)) ?? {}; } catch { return {}; }
  }
  function bumpDrillStats(template, ok) {
    const stats = loadDrillStats();
    const s = stats[template] ??= { seen: 0, missed: 0 };
    s.seen += 1;
    if (!ok) s.missed += 1;
    try { localStorage.setItem(DRILL_STATS_KEY, JSON.stringify(stats)); } catch { /* ephemeral */ }
  }

  // ---- idle state: unit menu ---------------------------------------------
  function showMenu() {
    ui.clear();
    ui.setProgress("");
    ui.setExitVisible(false);
    ui.addCard({
      type: "say",
      md: "Welcome! Pick a **unit** for a guided lesson, or a **drill** for "
        + "rapid-fire corner-case questions (fresh variations every round; "
        + "the ones you miss come back more often). You can stop at any "
        + "time — your own code is kept safe.",
    });
    ui.setControls([
      ...curriculum.units.map((u) => ({ label: u.title, onClick: () => start(u.id) })),
      { label: "⚡ Drill: everything", onClick: () => startDrill("all") },
      ...drillTopics.map((t) => ({ label: `⚡ ${t.title}`, onClick: () => startDrill(t.id) })),
    ]);
  }

  // ---- sequencing ---------------------------------------------------------
  function condMatches(cond) {
    if (!cond) return true;
    const want = cond.lastAnswer;
    const got = store.lastAnswer ?? null;
    return Array.isArray(want) ? want.includes(got) : want === got;
  }

  function setWaiting(w) {
    waiting = w;
    persist();
  }

  function advance() {
    while (lesson) {
      stepIndex += 1;
      const step = lesson.steps[stepIndex];
      if (!step) return finish();
      events.emit("lesson-step", { lessonId: lesson.id, index: stepIndex });
      ui.setProgress(`${lesson.title} · ${Math.min(stepIndex + 1, lesson.steps.length)}/${lesson.steps.length}`);
      if (!condMatches(step.if)) { store.resumeIndex = stepIndex + 1; continue; }
      if (execStep(step)) return; // blocked; resume via callbacks
      store.resumeIndex = stepIndex + 1;
      persist();
    }
  }

  function resume() {
    setWaiting(null);
    ui.setControls([]);
    advance();
  }

  function execStep(step) {
    if (step.say !== undefined) {
      const desc = { type: "say", md: step.say, pocket: step.pocket };
      record(desc);
      ui.addCard(desc);
      if (step.pause) {
        // Reload during a pause resumes past it — the reload is the click.
        store.resumeIndex = stepIndex + 1;
        setWaiting({ type: "pause" });
        ui.setControls([{ label: "Continue →", primary: true, onClick: resume }]);
        ui.popBatch([...batch, desc]);
        batch = [];
        return true;
      }
      batch.push(desc);
      return false;
    }

    if (step.loadCode !== undefined) {
      if (store.stash === undefined) store.stash = editor.getValue();
      editor.setValue(step.loadCode);
      // A fresh program deserves fresh panes: stale state/output from the
      // previous program reads as if it belonged to this one.
      memory.reset();
      consoleUI.reset();
      store.lastLoadedCode = step.loadCode;
      registerProgram(step.loadCode);
      const desc = { type: "sys", text: "— loaded a program into the editor —" };
      record(desc);
      ui.addCard(desc);
      batch.push(desc);
      return false;
    }

    if (step.action !== undefined) {
      store.resumeIndex = stepIndex; // re-arm this step on reload
      // Rendered live but recorded only on completion, so a reload during
      // the wait re-creates the card instead of duplicating it.
      const card = ui.addCard({ type: "action", md: step.action, done: false, prog: store.currentProg });
      ui.popBatch(batch, card);
      batch = [];
      let seen = 0;
      const need = step.await.count ?? 1;
      const off = events.on((e) => {
        if (e.type !== step.await.event) return;
        seen += 1;
        if (seen < need) return;
        off();
        card.markDone();
        record({ type: "action", md: step.action, done: true });
        resume();
      });
      setWaiting({ type: "action", off });
      return true;
    }

    if (step.ask !== undefined) {
      store.resumeIndex = stepIndex; // re-ask on reload
      persist();
      if (step.ask.kind === "predict-output") return execPredictOutput(step.ask);
      return execGeneratedAsk(step.ask);
    }

    if (step.done !== undefined) {
      const desc = { type: "say", md: step.done || "That's the end of this lesson — nice work." };
      record(desc);
      ui.addCard(desc);
      batch.push(desc);
      return false;
    }

    return false; // unknown step (lint catches this at start)
  }

  // ---- asks ---------------------------------------------------------------
  function resolveAsk(card, { prompt, ok, verdict, answerText, lastAnswer, kind, template }) {
    card.freeze();
    card.setNote("");
    card.verdict(ok, verdict);
    record({ type: "question-frozen", prompt, ok, verdict, answerText });
    store.lastAnswer = lastAnswer;
    if (template) bumpDrillStats(template, lastAnswer === "correct");
    events.emit("quiz-graded", { kind, correct: ok, template });
    resume();
  }

  function execGeneratedAsk(ask) {
    const q = generateQuestion(ask.kind, ctx(), ask.opts ?? {});
    if (!q) {
      const desc = { type: "sys", text: `(couldn't build a ${ask.kind} question here — moving on)` };
      record(desc);
      ui.addCard(desc);
      batch.push(desc);
      store.lastAnswer = "skipped";
      return false;
    }
    events.emit("quiz-question", { kind: q.kind });
    const hints = [...(ask.hints ?? [])];
    const maxAttempts = ask.attempts ?? 2;
    let attempts = 0;
    let view = null;
    const card = ui.addInteractiveCard({
      prompt: q.prompt,
      render: (body) => { view = renderQuestionBody(body, q); return view; },
      actions: [],
      prog: store.currentProg,
    });
    ui.popBatch(batch, card);
    batch = [];
    if (view.line != null) editor.highlightLine(view.line);

    const doCheck = (provided) => {
      const answers = provided ?? view.collect();
      const result = q.grade(answers);
      attempts += 1;
      if (result.correct) {
        view.applyResult(result);
        resolveAsk(card, {
          prompt: q.prompt, ok: true, verdict: "✓ correct",
          answerText: typeof answers?.text === "string" ? answers.text : undefined,
          lastAnswer: "correct", template: ask.template, kind: q.kind,
        });
      } else if (attempts < maxAttempts) {
        view.applyResult(result, { reveal: false });
        if (hints.length) {
          const h = { type: "hint", md: hints.shift() };
          record(h);
          ui.addCard(h);
          ui.appendToPopup(h);
        }
        card.setNote(`not yet — look again (${maxAttempts - attempts} ${maxAttempts - attempts === 1 ? "try" : "tries"} left)`);
        ui.scrollToEnd();
      } else {
        view.applyResult(result);
        resolveAsk(card, {
          prompt: q.prompt, ok: false, verdict: "✗ — the expected answer is marked above",
          answerText: typeof answers?.text === "string" ? answers.text : undefined,
          lastAnswer: "wrong", template: ask.template, kind: q.kind,
        });
      }
    };
    const doSkip = () => resolveAsk(card, {
      prompt: q.prompt, ok: false, verdict: "skipped",
      lastAnswer: "skipped", template: ask.template, kind: q.kind,
    });

    card.setActions([
      { label: "Check", primary: true, onClick: () => doCheck() },
      { label: "Skip", onClick: doSkip },
    ]);
    setWaiting({ type: "ask", kind: q.kind, submit: doCheck, skip: doSkip });
    return true;
  }

  function execPredictOutput(ask) {
    events.emit("quiz-question", { kind: "predict-output" });
    const hints = [...(ask.hints ?? [])];
    let ta = null;
    const card = ui.addInteractiveCard({
      prompt: ask.prompt
        ?? "Before running: what will this program print? Type the exact output, then lock it in.",
      render: (body) => {
        ta = document.createElement("textarea");
        ta.className = "tutor-output-input";
        ta.placeholder = "type your predicted output…";
        ta.spellcheck = false;
        body.appendChild(ta);
        return null;
      },
      actions: [],
      prog: store.currentProg,
    });
    ui.popBatch(batch, card);
    batch = [];

    const doLock = async () => {
      const text = ta.value;
      if (!text.trim()) { card.setNote("type a prediction first"); return; }
      ta.readOnly = true;
      card.setActions([]);
      card.setNote("running your program…");
      const summary = await actions.trace();
      if (!summary) {
        ta.readOnly = false;
        card.setNote("the run didn't start (is another run active?) — try again");
        armLockActions();
        return;
      }
      const q = generateQuestion("predict-output", ctx(), ask.opts ?? {});
      if (!q) {
        resolveAsk(card, {
          prompt: "Predict the output", ok: false, verdict: "couldn't grade this run",
          answerText: text, lastAnswer: "skipped", template: ask.template, kind: "predict-output",
        });
        return;
      }
      const result = q.grade({ text });
      ta.classList.toggle("ok", result.correct);
      ta.classList.toggle("bad", !result.correct);
      if (!result.correct) {
        const div = document.createElement("div");
        div.className = "tutor-expected";
        const label = document.createElement("span");
        label.className = "hint";
        label.textContent = "what it actually printed:";
        const pre = document.createElement("pre");
        pre.textContent = result.expected.text;
        div.append(label, pre);
        card.body.appendChild(div);
      }
      resolveAsk(card, {
        prompt: "Predict the output", ok: result.correct,
        verdict: result.correct ? "✓ predicted exactly right" : "✗ — compare with the console",
        answerText: text,
        lastAnswer: result.correct ? "correct" : "wrong",
        template: ask.template, kind: "predict-output",
      });
    };
    const armLockActions = () => card.setActions([
      { label: "Lock in & run ▶", primary: true, onClick: () => doLock() },
      ...(hints.length ? [{
        label: "Hint",
        onClick: () => {
          const h = { type: "hint", md: hints.shift() };
          record(h);
          ui.addCard(h);
          ui.appendToPopup(h);
          if (!hints.length) armLockActions();
        },
      }] : []),
      { label: "Skip", onClick: () => resolveAsk(card, {
        prompt: "Predict the output", ok: false, verdict: "skipped",
        lastAnswer: "skipped", template: ask.template, kind: "predict-output",
      }) },
    ]);
    armLockActions();
    setWaiting({
      type: "ask",
      kind: "predict-output",
      lock: (text) => { if (text != null) ta.value = text; return doLock(); },
      skip: () => resolveAsk(card, {
        prompt: "Predict the output", ok: false, verdict: "skipped",
        lastAnswer: "skipped", template: ask.template, kind: "predict-output",
      }),
    });
    return true;
  }

  // ---- lifecycle ----------------------------------------------------------
  function restoreLearnerCode() {
    if (store.stash === undefined) return;
    // Only restore over code the LESSON put there; edits beyond that are
    // the learner's work and stay.
    if (store.lastLoadedCode !== undefined && editor.getValue() === store.lastLoadedCode) {
      editor.setValue(store.stash);
    }
  }

  function endLesson(reason) {
    waiting?.off?.();
    waiting = null;
    restoreLearnerCode();
    events.emit("lesson-ended", { lessonId: lesson?.id, reason });
    lesson = null;
    stepIndex = -1;
    batch = [];
    store = {};
    persist();
    showMenu();
  }

  function finish() {
    ui.setControls([{ label: "Back to units", onClick: () => endLesson("completed") }]);
    ui.setExitVisible(false);
    setWaiting(null);
    ui.popBatch(batch); // the closing beat (empty on a resumed finish → no-op)
    batch = [];
  }

  function start(unitId) {
    if (isCollabActive?.()) return null; // v1 is solo-only (tutor-plan §9)
    const unit = curriculum.units.find((u) => u.id === unitId);
    if (!unit) throw new Error(`unknown unit: ${unitId}`);
    const errors = lintLesson(unit.lesson);
    if (errors.length) throw new Error(`lesson ${unitId} failed lint:\n${errors.join("\n")}`);
    if (lesson) endLesson("replaced");
    lesson = unit.lesson;
    stepIndex = -1;
    batch = [];
    store = { lessonId: unitId, resumeIndex: 0, cards: [] };
    persist();
    ui.clear();
    ui.setControls([]);
    ui.setExitVisible(true);
    ui.show();
    events.emit("lesson-started", { lessonId: unit.lesson.id });
    advance();
    return unit.lesson.id;
  }

  // A drill round is a compiled, seeded lesson (app/drills.mjs) — it runs
  // on the ordinary lesson machinery. The compiled script is persisted
  // verbatim so a reload resumes the identical round.
  function startDrill(topic = "all", opts = {}) {
    if (isCollabActive?.()) return null;
    const built = buildDrillLesson(topic, {
      seed: opts.seed ?? (Date.now() >>> 0),
      count: opts.count ?? 8,
      stats: loadDrillStats(),
    });
    if (!built) throw new Error(`unknown drill topic: ${topic}`);
    const errors = lintLesson(built);
    if (errors.length) throw new Error(`drill ${topic} failed lint:\n${errors.join("\n")}`);
    if (lesson) endLesson("replaced");
    lesson = built;
    stepIndex = -1;
    batch = [];
    store = { lessonId: built.id, drillLesson: built, resumeIndex: 0, cards: [] };
    persist();
    ui.clear();
    ui.setControls([]);
    ui.setExitVisible(true);
    ui.show();
    events.emit("lesson-started", { lessonId: built.id });
    advance();
    return built.id;
  }

  // Resume a persisted session (page reload mid-lesson).
  function restore() {
    if (!store.lessonId) { showMenu(); return false; }
    const restored = store.drillLesson
      ?? curriculum.units.find((u) => u.id === store.lessonId)?.lesson;
    if (!restored || lintLesson(restored).length) { store = {}; persist(); showMenu(); return false; }
    lesson = restored;
    batch = [];
    ui.clear();
    ui.setExitVisible(true);
    for (const desc of store.cards ?? []) ui.addCard(desc);
    stepIndex = (store.resumeIndex ?? 0) - 1;
    advance();
    return true;
  }

  ui.setOnExit(() => endLesson("exited"));
  ui.setOnTryIt((code) => {
    if (store.stash === undefined) store.stash = editor.getValue();
    editor.setValue(code);
    store.lastLoadedCode = code;
    registerProgram(code);
    persist();
  });

  // Reviewing an old bubble: if it was about a different program than the
  // editor currently holds, the popup gets a context card first — the
  // student may not notice the code has changed since (and line numbers or
  // names in the card would silently mislead).
  ui.setReviewContext((descs) => {
    const prog = descs.find((d) => d.prog !== undefined)?.prog;
    if (prog == null) return null;
    const code = (store.programs ?? [])[prog];
    if (code == null || code === editor.getValue()) return null;
    return { type: "context", code };
  });

  restore();

  return {
    start,
    startDrill, // (topic?, {seed?, count?}) — deterministic under a seed
    drillStats: loadDrillStats,
    exit: () => { if (lesson) endLesson("exited"); },
    state: () => ({
      lessonId: lesson?.id ?? null,
      stepIndex,
      waiting: waiting?.type ?? null,
      lastAnswer: store.lastAnswer ?? null,
    }),
    feed: () => (store.cards ?? []).slice(),
    // Test/debug drivers (invariant 9: tests assert through window.plp).
    continue: () => { if (waiting?.type === "pause") resume(); },
    ask: () => (waiting?.type === "ask" ? { kind: waiting.kind } : null),
    submit: (answers) => waiting?.submit?.(answers),
    lockPrediction: (text) => waiting?.lock?.(text),
    skip: () => waiting?.skip?.(),
    lintLesson,
  };
}
