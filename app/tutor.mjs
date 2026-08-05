// Tutor lesson runtime: interprets curriculum scripts (curriculum/*.mjs)
// into the transcript feed, and connects asks/actions to the live app.
//
// Step vocabulary (linted by lintLesson at start):
//   { say: md, pocket?, pause? }        prose card; pause gates on Continue
//   { loadCode: source }                stash learner code once, set editor
//   { action: md, await: {event, count?} }  learner performs; events bus completes
//   { ask: { kind, opts?, hints?: [md], attempts? } }  question card
//   { pause: true }                     bare beat: hold the surface on Continue
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
import { renderQuestionBody, renderTraceTable, createAnswerInput, appendExpected } from "./question-ui.mjs";
import { buildKBSession, kbTopics, migrateStats, spliceBlank, lintLessonConcepts, frontierTags, drillTopicFor, topicProgress, conceptTopics } from "./kb-session.mjs";
import { summarizeRound } from "./progress.mjs";
import { mapModel, renderConceptMap } from "./concept-map.mjs";
import { events } from "./events.mjs";

const STORE_KEY = "plp.tutor.v1";
// Drill/practice mastery is keyed by concept TAG (design §6). One-time
// migration carries forward the legacy drill-template store.
const KB_STATS_KEY = "plp.kb.v1";
const LEGACY_DRILL_STATS_KEY = "plp.drills.v1";
// The shared met map (design/lesson-kb-binding.md §5): tag → {at, source}.
// Lessons and drills both write through grantMet; the KB never reads it —
// the met SET (the keys) is passed into KB queries (frontierTags).
const KB_MET_KEY = "plp.kb.met.v1";

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
    if (keys.length !== 1 && !(keys.length === 0 && step.pause === true)) {
      errors.push(`step ${i}: needs exactly one of say/loadCode/action/ask/done (or a bare pause)`);
    }
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
  // KB concept binding (design/lesson-kb-binding.md §2): unit `concepts`
  // tags and ask-step `focus` tags must be real, non-structural, and every
  // focus must be inside the unit's declared set.
  errors.push(...lintLessonConcepts(lesson ?? {}));
  return errors;
}

export function createTutor({ editor, memory, consoleUI, ui: stageUI, practiceUI, actions, curriculum, isCollabActive }) {
  let lesson = null;
  let stepIndex = -1;
  let waiting = null;   // { type: "pause"|"action"|"ask", off? }
  let batch = [];       // static descs of the current beat, shown together
                        // in the popup when a blocking step arrives
  let store = loadStore();

  // ---- surface router ------------------------------------------------------
  // Two presentation surfaces, one runtime: guided lessons render on the
  // STAGE (the IDE-centric focus layout — the IDE is their content);
  // drills, the menu, the map, and summaries render on the PRACTICE card
  // surface (full-viewport, no IDE chrome). Every ui.* call dispatches to
  // the active surface at call time; switching tears the outgoing surface
  // down first so no stale popup/focus classes survive.
  let surface = "practice";
  const surfaces = practiceUI ? { stage: stageUI, practice: practiceUI } : { stage: stageUI, practice: stageUI };
  const cur = () => surfaces[surface];
  const UI_METHODS = [
    "clear", "setProgress", "setExitVisible", "addCard", "addInteractiveCard",
    "popBatch", "appendToPopup", "showCustom", "setControls", "scrollToEnd",
    "show", "hide", "beginReveal", "setStageMemory", "setScore",
  ];
  const ui = Object.fromEntries(UI_METHODS.map((m) => [m, (...a) => cur()[m]?.(...a)]));
  function setSurface(next) {
    if (next === surface || surfaces[next] === surfaces[surface]) { surface = next; return; }
    const wasVisible = layoutVisible();
    cur().clear();
    cur().hide?.();
    surface = next;
    if (wasVisible) cur().show?.();
  }
  const layoutVisible = () => Boolean(actions.isExercisesVisible?.());

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

  // ---- practice stats (per-concept-TAG seen/missed; weights selection) ---
  // One-time migration: if the tag-keyed store is absent but the legacy
  // template-keyed store exists, fold it in (design §2.5 — tags are
  // permanent, so mastery survives the exercise-source change).
  function migrateLegacyStatsOnce() {
    try {
      if (localStorage.getItem(KB_STATS_KEY) != null) return;
      const legacy = JSON.parse(localStorage.getItem(LEGACY_DRILL_STATS_KEY) ?? "null");
      if (legacy) localStorage.setItem(KB_STATS_KEY, JSON.stringify(migrateStats(legacy)));
    } catch { /* ephemeral */ }
  }
  migrateLegacyStatsOnce();

  function loadDrillStats() {
    try { return JSON.parse(localStorage.getItem(KB_STATS_KEY)) ?? {}; } catch { return {}; }
  }
  function bumpDrillStats(concept, ok) {
    const stats = loadDrillStats();
    const s = stats[concept] ??= { seen: 0, missed: 0 };
    s.seen += 1;
    if (!ok) s.missed += 1;
    try { localStorage.setItem(KB_STATS_KEY, JSON.stringify(stats)); } catch { /* ephemeral */ }
  }

  // ---- met map (lesson-kb-binding §4–§5) ---------------------------------
  // met(C) = at least one clean first-attempt correct prediction focused on
  // C (design §2.8). grantMet is idempotent: the first grant wins at/source.
  function loadMetStore() {
    try { return JSON.parse(localStorage.getItem(KB_MET_KEY)) ?? {}; } catch { return {}; }
  }
  // Returns true only when this call actually wrote the grant — the round
  // summary uses that to list "new ideas you nailed" exactly.
  function grantMet(tag, source) {
    const met = loadMetStore();
    if (met[tag]) return false; // permanent once earned; first grant wins
    met[tag] = { at: Date.now(), source };
    try { localStorage.setItem(KB_MET_KEY, JSON.stringify(met)); } catch { /* ephemeral */ }
    return true;
  }

  // ---- idle state: unit menu ---------------------------------------------
  function showMenu() {
    setSurface("practice");
    ui.clear();
    ui.setProgress("");
    ui.setExitVisible(false);
    ui.setScore(null);
    const met = Object.keys(loadMetStore());
    const progress = topicProgress(met);
    const known = progress.reduce((a, r) => a + r.met, 0);
    const totalAll = progress.reduce((a, r) => a + r.total, 0);
    // Lifetime score line: derived from the same seen/missed stats that
    // weight selection; the all-time best streak is the one extra number.
    const stats = Object.values(loadDrillStats());
    const answeredEver = stats.reduce((a, s) => a + s.seen, 0);
    const rightEver = stats.reduce((a, s) => a + (s.seen - s.missed), 0);
    const bestEver = loadLifetimeScore().bestStreak ?? 0;
    const welcome = {
      type: "say",
      md: "Pick a topic and try some questions. You'll read a tiny "
        + "program and predict what it does — then it really runs, so "
        + "you see the true answer right away.\n\n"
        + "Getting one wrong is part of the plan: you'll see **why**, and "
        + "that idea will come back until it's easy. Every round has fresh "
        + "questions. Your own code is kept safe."
        + (known > 0 ? `\n\nYou know **${known}** of ${totalAll} ideas so far.` : "")
        + (answeredEver > 0 ? `\n\nAll time: **${answeredEver}** answered, **${rightEver}** right${bestEver >= 3 ? `, best streak **${bestEver}**` : ""}.` : ""),
    };
    ui.addCard(welcome);
    // The menu is a beat too: in focus mode it renders on the stage (the
    // roomy center surface), with the topic buttons mirrored in its foot.
    ui.popBatch([welcome]);
    // Exercises only: guided units stay available to tests/debug via
    // plp.tutor.start(unitId), but the learner-facing menu is drills.
    // When mastery exists, the frontier (unmet concepts whose parents are
    // all met — lesson-kb-binding §5) adds a "drill what you just learned"
    // entry pointing at the topic with the most newly-unlocked intros.
    // Topic buttons carry their mastery meter (met/total per topic).
    const byId = new Map(progress.map((r) => [r.id, r]));
    const frontier = met.length ? frontierTags(met) : [];
    // Brand-new learners get an on-ramp FIRST: the guided unit is the
    // gentlest entry, and a fresh profile (nothing met, nothing answered)
    // is exactly when the topic grid reads as a wall of unknowns.
    const brandNew = met.length === 0 && answeredEver === 0;
    ui.setControls([
      ...(brandNew ? [{
        label: "🌱 Start here — your first lesson",
        primary: true,
        onClick: () => start("u1-state-io"),
      }] : []),
      ...(frontier.length ? [{
        label: "⭐ Drill what you just learned",
        onClick: () => startDrill(drillTopicFor(frontier)),
      }] : []),
      { label: "⚡ Everything", onClick: () => startDrill("all") },
      { label: "∞ Endless practice", onClick: () => startDrill("all", { endless: true }) },
      { label: "🗺 My map", onClick: showMap },
      ...kbTopics.map((t) => ({
        label: t.title,
        progress: { met: byId.get(t.id)?.met ?? 0, total: byId.get(t.id)?.total ?? 0 },
        onClick: () => startDrill(t.id),
        onEndless: () => startDrill(t.id, { endless: true }),
      })),
    ]);
  }

  // The concept map view: the whole DAG as topic lanes with met/frontier/
  // locked chips; a frontier chip's "Practice this ▶" starts a targeted
  // round on that one concept.
  function showMap() {
    setSurface("practice");
    ui.show(); // callable from anywhere (debug API included) — the map implies visibility
    ui.clear();
    ui.setProgress("My map");
    ui.setExitVisible(false);
    const host = document.createElement("div");
    renderConceptMap(host, mapModel(Object.keys(loadMetStore())), {
      onPractice: (tag) => startDrill(conceptTopics().get(tag) ?? "all", { focus: tag }),
    });
    ui.showCustom(host);
    ui.setControls([{ label: "← Back to topics", onClick: showMenu }]);
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

  // Per-question results for the dot bar: first-attempt ok is the score of
  // record; a later retry only decorates the dot (rec.retry), never edits it.
  const frozenRecords = () => (store.cards ?? []).filter((c) => c.type === "question-frozen");
  function pushProgress() {
    if (!lesson) return;
    // The second argument carries QUESTION progress for the practice
    // surface's dot bar (stage ignores it): questions completed / total,
    // plus per-question outcomes so the dots read right/wrong at a glance.
    // Endless runs chain chunks in ONE store: the dots show the current
    // chunk (results sliced from chunkBase) but each carries its ABSOLUTE
    // record index so reviews reach back across the whole run.
    const qTotal = lesson.steps.filter((s) => s.ask).length;
    const qDone = lesson.steps.slice(0, Math.max(stepIndex, 0)).filter((s) => s.ask).length;
    const all = frozenRecords().map((c, i) => ({ ok: c.ok, retryOk: c.retry?.ok, index: i }));
    ui.setProgress(
      `${lesson.title} · ${Math.min(stepIndex + 1, lesson.steps.length)}/${lesson.steps.length}`,
      { qDone, qTotal, results: all.slice(store.chunkBase ?? 0) },
    );
    ui.setScore(store.drillLesson ? (store.score ?? null) : null);
  }

  function advance() {
    while (lesson) {
      stepIndex += 1;
      const step = lesson.steps[stepIndex];
      if (!step) return finish();
      events.emit("lesson-step", { lessonId: lesson.id, index: stepIndex });
      pushProgress();
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
      // Action beats USE the IDE: trace/scrub/input beats need the memory
      // pane visible even in focus mode (the memory model is the lesson).
      ui.setStageMemory?.(["scrubbed", "run-ended", "input-answered"].includes(step.await.event));
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
      // predict-output and predict-state share the predict-then-verify path:
      // a real trace, then grading against what the engine actually did.
      if (step.ask.kind === "predict-output" || step.ask.kind === "predict-state") return execPredictOutput(step.ask);
      if (step.ask.kind === "fill-one-blank") return execFillBlank(step.ask);
      if (step.ask.kind === "trace-table") return execTraceTable(step.ask);
      return execGeneratedAsk(step.ask);
    }

    if (step.done !== undefined) {
      // Endless runs never see a chunk's closing beat: no summary card, no
      // done card — finish() deals the next chunk instead. The run's real
      // summary renders when the learner ends it (endLesson).
      if (store.endless) return false;
      // Practice rounds get a session summary first: per-question results,
      // newly-met concepts, and the next-step suggestion (pure over the
      // transcript store — reload rebuilds it like any recorded card).
      if (store.drillLesson) {
        const summary = {
          type: "summary",
          ...summarizeRound(store.cards ?? [], store.roundMet ?? [], Object.keys(loadMetStore())),
        };
        record(summary);
        ui.addCard(summary);
        batch.push(summary);
      }
      const desc = { type: "say", md: step.done || "That's the end of this lesson — nice work." };
      record(desc);
      ui.addCard(desc);
      batch.push(desc);
      return false;
    }

    if (step.pause === true) {
      // Bare beat: nothing new to say — hold whatever the surface shows
      // (a just-graded card with its verdict and reveal) until the learner
      // continues. Reload during it resumes past it, same as a say-pause.
      store.resumeIndex = stepIndex + 1;
      persist();
      setWaiting({ type: "pause" });
      ui.setControls([{ label: "Continue →", primary: true, onClick: resume }]);
      if (batch.length) { ui.popBatch([...batch]); batch = []; }
      return true;
    }

    return false; // unknown step (lint catches this at start)
  }

  // ---- asks ---------------------------------------------------------------
  function resolveAsk(card, { prompt, ok, verdict, answerText, lastAnswer, kind, template, concept, review }) {
    card.freeze();
    card.setNote("");
    card.verdict(ok, verdict);
    // `review` is the reviewable snapshot (program, kind, opts, expected):
    // enough to rebuild this question later from the store alone — the dot
    // bar's "go back to it" and the retry flow both feed on it.
    record({ type: "question-frozen", prompt, ok, verdict, answerText, concept, ...(review ? { review } : {}) });
    store.lastAnswer = lastAnswer;
    if (concept) bumpDrillStats(concept, lastAnswer === "correct");
    // The score tracker (drills only): session right-count and streak on a
    // first-attempt basis — the same basis as everything else. The all-time
    // best streak persists separately (plp.score.v1).
    if (store.drillLesson) {
      const s = store.score ??= { answered: 0, right: 0, streak: 0, best: 0 };
      s.answered += 1;
      if (ok) {
        s.right += 1;
        s.streak += 1;
        s.best = Math.max(s.best, s.streak);
        bumpLifetimeBest(s.streak);
      } else {
        s.streak = 0;
      }
      ui.setScore(s);
    }
    events.emit("quiz-graded", { kind, correct: ok, template, concept });
    resume();
  }

  function loadLifetimeScore() {
    try { return JSON.parse(localStorage.getItem("plp.score.v1")) ?? {}; } catch { return {}; }
  }
  function bumpLifetimeBest(streak) {
    const lt = loadLifetimeScore();
    if (streak > (lt.bestStreak ?? 0)) {
      lt.bestStreak = streak;
      try { localStorage.setItem("plp.score.v1", JSON.stringify(lt)); } catch { /* ephemeral */ }
    }
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
      // The card chrome renders the prompt; omitPrompt stops the question
      // body from printing it a second time.
      render: (body) => { view = renderQuestionBody(body, q, { omitPrompt: true }); return view; },
      actions: [],
      prog: store.currentProg,
    });
    ui.popBatch(batch, card);
    batch = [];
    // Memory-model questions need the memory pane on stage in focus mode.
    ui.setStageMemory?.(q.kind.startsWith("memory-") || Boolean(q.construction) || q.kind === "expression-sequence");
    if (view.line != null) editor.highlightLine(view.line);

    const doCheck = (provided) => {
      const answers = provided ?? view.collect();
      const result = q.grade(answers);
      attempts += 1;
      if (result.correct) {
        view.applyResult(result);
        resolveAsk(card, {
          prompt: q.prompt, ok: true, verdict: "✓ Exactly right!",
          answerText: typeof answers?.text === "string" ? answers.text : undefined,
          lastAnswer: "correct", template: ask.template, concept: ask.concept, kind: q.kind,
        });
      } else if (attempts < maxAttempts) {
        view.applyResult(result, { reveal: false });
        if (hints.length) {
          const h = { type: "hint", md: hints.shift() };
          record(h);
          ui.addCard(h);
          ui.appendToPopup(h);
        }
        card.setNote(`Not yet — take another look (${maxAttempts - attempts} ${maxAttempts - attempts === 1 ? "try" : "tries"} left)`);
        ui.scrollToEnd();
      } else {
        view.applyResult(result);
        resolveAsk(card, {
          prompt: q.prompt, ok: false, verdict: "✗ Not this time — the right answer is marked above",
          answerText: typeof answers?.text === "string" ? answers.text : undefined,
          lastAnswer: "wrong", template: ask.template, concept: ask.concept, kind: q.kind,
        });
      }
    };
    const doSkip = () => resolveAsk(card, {
      prompt: q.prompt, ok: false, verdict: "skipped",
      lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: q.kind,
    });

    card.setActions([
      { label: "Check my answer", primary: true, onClick: () => doCheck() },
      { label: "Skip this one", onClick: doSkip },
    ]);
    setWaiting({ type: "ask", kind: q.kind, submit: doCheck, skip: doSkip });
    return true;
  }

  function execPredictOutput(ask) {
    events.emit("quiz-question", { kind: ask.kind });
    const isState = ask.kind === "predict-state";
    const hints = [...(ask.hints ?? [])];
    const totalHints = hints.length;
    let ta = null;
    const card = ui.addInteractiveCard({
      teach: ask.teach, context: ask.context, form: ask.form ?? ask.kind,
      prompt: ask.prompt
        ?? "Before you run it: what will this program print? Type the exact output.",
      render: (body) => {
        // One-thing-at-a-time asks (drills, single-print programs) get a
        // single-line input; free prediction keeps the textarea.
        ta = createAnswerInput({
          singleLine: ask.singleLine,
          placeholder: isState ? "the value it holds…" : ask.singleLine ? "what this prints…" : "type your predicted output…",
        });
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
      if (!text.trim()) { card.setNote("Type what you think it prints first"); return; }
      const ranCode = editor.getValue(); // grade-what-runs: snapshot for review/retry
      ta.readOnly = true;
      card.setActions([]);
      card.setNote("Running it for real…");
      // The reveal: the console grows NOW, so the eye lands on the real run
      // (predict-state also opens the memory pane — the state IS the answer).
      ui.beginReveal?.({ memory: isState });
      const summary = await actions.trace();
      if (!summary) {
        ta.readOnly = false;
        card.setNote("The run couldn't start (is another one going?) — try again");
        armLockActions();
        return;
      }
      const q = generateQuestion(ask.kind, ctx(), ask.opts ?? {});
      if (!q) {
        resolveAsk(card, {
          prompt: ask.prompt, ok: false, verdict: "couldn't grade this run",
          answerText: text, lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: ask.kind,
        });
        return;
      }
      const result = q.grade({ text });
      ta.classList.toggle("ok", result.correct);
      ta.classList.toggle("bad", !result.correct);
      // The in-card reveal (practice surface): the grade's expected text IS
      // the real run's output (predict-output) / the probed value
      // (predict-state). Stage handles have no reveal method — they keep the
      // classic wrong-only expected block below, byte-identical.
      card.reveal?.({ text: result.expected.text, correct: result.correct, kind: ask.kind });
      if (!result.correct && !card.reveal) {
        appendExpected(card.body, {
          label: isState ? "What it really held:" : "What it really printed:",
          text: result.expected.text,
        });
      }
      // Met grant (lesson-kb-binding §4): a clean first-attempt correct
      // predict-output OR predict-state — before the final hint was revealed
      // — evidences the focused concept (a clean state prediction is the same
      // §2.8 evidence class: the learner predicted what really happened
      // unaided). These kinds have no retries, so the attempt is first by
      // construction; a hint that states the output is a shown answer, so an
      // answer after the last hint grants nothing. Lesson asks carry `focus`;
      // practice-round asks carry `concept`.
      const metTag = ask.focus ?? ask.concept;
      const beforeFinalHint = totalHints === 0 || hints.length > 0;
      if (result.correct && metTag && beforeFinalHint) {
        if (grantMet(metTag, ask.focus ? "lesson" : "drill")) {
          (store.roundMet ??= []).push(metTag); // exact newly-met list for the summary
          persist();
        }
      }
      resolveAsk(card, {
        prompt: ask.prompt, ok: result.correct,
        verdict: result.correct ? "✓ Exactly right!" : "✗ Not quite — compare with what really happened",
        answerText: text,
        lastAnswer: result.correct ? "correct" : "wrong",
        template: ask.template, concept: ask.concept, kind: ask.kind,
        review: {
          kind: ask.kind, form: ask.form, opts: ask.opts, code: ranCode,
          expectedText: result.expected.text, teach: ask.teach, context: ask.context,
        },
      });
    };
    const armLockActions = () => card.setActions([
      { label: "Check my answer ▶", primary: true, onClick: () => doLock() },
      ...(hints.length ? [{
        label: "Give me a hint",
        onClick: () => {
          const h = { type: "hint", md: hints.shift() };
          record(h);
          ui.addCard(h);
          ui.appendToPopup(h);
          if (!hints.length) armLockActions();
        },
      }] : []),
      { label: "Skip this one", onClick: () => resolveAsk(card, {
        prompt: ask.prompt, ok: false, verdict: "skipped",
        lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: ask.kind,
        review: { kind: ask.kind, form: ask.form, opts: ask.opts, code: editor.getValue(), teach: ask.teach, context: ask.context },
      }) },
    ]);
    // Enter submits on single-line asks — drill cadence.
    if (ask.singleLine) {
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !ta.readOnly) doLock();
      });
    }
    armLockActions();
    setWaiting({
      type: "ask",
      kind: ask.kind,
      lock: (text) => { if (text != null) ta.value = text; return doLock(); },
      skip: () => resolveAsk(card, {
        prompt: ask.prompt, ok: false, verdict: "skipped",
        lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: ask.kind,
        review: { kind: ask.kind, form: ask.form, opts: ask.opts, code: editor.getValue(), teach: ask.teach, context: ask.context },
      }),
    });
    return true;
  }

  // fill-one-blank (design §5.2): the program is shown with one hole and a
  // target output; the learner types the missing token. Grading substitutes
  // the token, runs the filled program for real, and accepts ANY fill whose
  // real output equals the target — the interpreter is the only judge. A
  // non-parsing fill just grades wrong (no traceback shown).
  function execFillBlank(ask) {
    events.emit("quiz-question", { kind: "fill-one-blank" });
    const fillReview = () => ({
      kind: "fill-one-blank", form: ask.form, code: ask.code, blank: ask.blank,
      targetOutput: ask.targetOutput, teach: ask.teach, context: ask.context,
    });
    const hints = [...(ask.hints ?? [])];
    let input = null;
    const card = ui.addInteractiveCard({
      teach: ask.teach, context: ask.context, form: ask.form ?? "fill-one-blank",
      prompt: ask.prompt ?? "Fill in the blank so the program prints the target.",
      render: (body) => {
        input = createAnswerInput({ singleLine: true, placeholder: "the missing piece…" });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !input.readOnly) doFill(); });
        body.appendChild(input);
        return null;
      },
      actions: [],
      prog: store.currentProg,
    });
    ui.popBatch(batch, card);
    batch = [];

    const doFill = async () => {
      const token = input.value;
      if (!token.trim()) { card.setNote("Type the missing piece first"); return; }
      input.readOnly = true;
      card.setActions([]);
      card.setNote("Filling it in and running it for real…");
      const filled = spliceBlank(ask.code, ask.blank, token);
      editor.setValue(filled);
      store.lastLoadedCode = filled; // the reveal run is now the lesson's code
      registerProgram(filled);
      persist();
      ui.beginReveal?.();
      const summary = await actions.trace();
      const q = summary?.terminal_reason === "completed" ? generateQuestion("predict-output", ctx(), {}) : null;
      const correct = Boolean(q && q.grade({ text: ask.targetOutput }).correct);
      input.classList.toggle("ok", correct);
      input.classList.toggle("bad", !correct);
      // In-card reveal: what the FILLED program really printed. The
      // "fill that works" block below is the answer token, not a duplicate —
      // it renders on every surface.
      if (q) card.reveal?.({ text: q.grade({ text: "" }).expected.text, correct, kind: "fill-one-blank" });
      if (!correct) {
        appendExpected(card.body, { label: "A fill that works:", text: ask.blank.target });
      }
      resolveAsk(card, {
        prompt: ask.prompt, ok: correct,
        verdict: correct ? "✓ That prints the target!" : "✗ Not quite — that doesn't produce the target",
        answerText: token,
        lastAnswer: correct ? "correct" : "wrong",
        template: ask.template, concept: ask.concept, kind: "fill-one-blank",
        review: {
          kind: "fill-one-blank", form: ask.form, code: ask.code, blank: ask.blank,
          targetOutput: ask.targetOutput,
          expectedText: q ? q.grade({ text: "" }).expected.text : undefined,
          teach: ask.teach, context: ask.context,
        },
      });
    };
    const armActions = () => card.setActions([
      { label: "Check my answer ▶", primary: true, onClick: () => doFill() },
      ...(hints.length ? [{
        label: "Give me a hint",
        onClick: () => {
          const h = { type: "hint", md: hints.shift() };
          record(h); ui.addCard(h); ui.appendToPopup(h);
          if (!hints.length) armActions();
        },
      }] : []),
      { label: "Skip this one", onClick: () => resolveAsk(card, {
        prompt: ask.prompt, ok: false, verdict: "skipped",
        lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: "fill-one-blank",
        review: fillReview(),
      }) },
    ]);
    armActions();
    setWaiting({
      type: "ask",
      kind: "fill-one-blank",
      lock: (text) => { if (text != null) input.value = text; return doFill(); },
      skip: () => resolveAsk(card, {
        prompt: ask.prompt, ok: false, verdict: "skipped",
        lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: "fill-one-blank",
        review: fillReview(),
      }),
    });
    return true;
  }

  // trace-table: walk the program's execution step by step, filling in what
  // each watched name holds after each line. The trace runs SILENTLY first —
  // ground truth must exist before the table can even be built — then every
  // blank is graded against the real trace. One shot (no retries): the table
  // itself is the reveal, marked per cell.
  function execTraceTable(ask) {
    events.emit("quiz-question", { kind: "trace-table" });
    const hints = [...(ask.hints ?? [])];
    const totalHints = hints.length;
    (async () => {
      const ranCode = editor.getValue(); // grade-what-runs: snapshot for review
      const summary = await actions.trace();
      const q = summary
        ? generateQuestion("trace-table", ctx(), { names: ask.probeNames, maxBlanks: ask.maxBlanks })
        : null;
      if (!q) {
        const desc = {
          type: "sys",
          text: summary
            ? "(couldn't build a trace-table question here — moving on)"
            : "(the run couldn't start — moving on)",
        };
        record(desc);
        ui.addCard(desc);
        batch.push(desc);
        store.lastAnswer = "skipped";
        resume();
        return;
      }
      const expectedById = Object.fromEntries(q.blanks.map((b) => [b.id, b.expected]));
      const baseReview = () => ({
        kind: "trace-table", form: ask.form,
        opts: { names: ask.probeNames, maxBlanks: ask.maxBlanks },
        code: ranCode,
        table: { rows: q.rows, expectedById },
        teach: ask.teach, context: ask.context,
      });
      let view = null;
      const card = ui.addInteractiveCard({
        teach: ask.teach, context: ask.context, form: ask.form ?? "trace-table",
        prompt: ask.prompt ?? q.prompt,
        render: (body) => { view = renderTraceTable(body, q); return view; },
        actions: [],
        prog: store.currentProg,
      });
      ui.popBatch(batch, card);
      batch = [];
      const doLock = (provided) => {
        const answers = provided ?? view.collect();
        if (q.blanks.some((b) => !String(answers[b.id] ?? "").trim())) {
          card.setNote("Fill every box first");
          return;
        }
        view.freeze?.();
        card.setActions([]);
        const result = q.grade(answers);
        view.applyResult(result);
        const nTotal = q.blanks.length;
        const nRight = q.blanks.filter((b) => result.perBlank[b.id]).length;
        card.reveal?.({ text: `${nRight} of ${nTotal} steps right`, correct: result.correct, kind: "trace-table" });
        // Met grant (lesson-kb-binding §4): a clean first-attempt all-correct
        // table — before the final hint — evidences the focused concept.
        // trace-table has no retries, so the attempt is first by construction.
        const metTag = ask.focus ?? ask.concept;
        const beforeFinalHint = totalHints === 0 || hints.length > 0;
        if (result.correct && metTag && beforeFinalHint) {
          if (grantMet(metTag, ask.focus ? "lesson" : "drill")) {
            (store.roundMet ??= []).push(metTag);
            persist();
          }
        }
        resolveAsk(card, {
          prompt: ask.prompt ?? q.prompt, ok: result.correct,
          verdict: result.correct
            ? "✓ Every step right!"
            : `✗ ${nRight} of ${nTotal} — check the marked steps`,
          lastAnswer: result.correct ? "correct" : "wrong",
          template: ask.template, concept: ask.concept, kind: "trace-table",
          review: { ...baseReview(), table: { rows: q.rows, expectedById, perBlank: result.perBlank }, answersById: answers },
        });
      };
      const doSkip = () => resolveAsk(card, {
        prompt: ask.prompt ?? q.prompt, ok: false, verdict: "skipped",
        lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: "trace-table",
        review: baseReview(),
      });
      const armActions = () => card.setActions([
        { label: "Check my answers ▶", primary: true, onClick: () => doLock() },
        ...(hints.length ? [{
          label: "Give me a hint",
          onClick: () => {
            const h = { type: "hint", md: hints.shift() };
            record(h); ui.addCard(h); ui.appendToPopup(h);
            if (!hints.length) armActions();
          },
        }] : []),
        { label: "Skip this one", onClick: doSkip },
      ]);
      armActions();
      setWaiting({
        type: "ask",
        kind: "trace-table",
        submit: (answers) => doLock(answers),
        skip: doSkip,
      });
    })();
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
    // Ending an endless run earns its summary: the whole run's records in
    // one card (dots, newly-met, misses), computed before the store resets.
    const endlessSummary = reason === "exited" && store.endless && frozenRecords().length
      ? {
        desc: {
          type: "summary",
          ...summarizeRound(store.cards ?? [], store.roundMet ?? [], Object.keys(loadMetStore())),
        },
        topic: store.drillTopic ?? "all",
        score: store.score,
      }
      : null;
    waiting?.off?.();
    waiting = null;
    restoreLearnerCode();
    events.emit("lesson-ended", { lessonId: lesson?.id, reason });
    lesson = null;
    stepIndex = -1;
    batch = [];
    store = {};
    persist();
    if (endlessSummary) {
      setSurface("practice");
      ui.clear();
      ui.setProgress("Endless run");
      ui.setExitVisible(false);
      ui.setScore(endlessSummary.score ?? null);
      ui.addCard(endlessSummary.desc); // the practice surface renders summary descs
      ui.setControls([
        { label: "∞ Go again", primary: true, onClick: () => startDrill(endlessSummary.topic, { endless: true }) },
        { label: "← Back to topics", onClick: showMenu },
      ]);
      return;
    }
    showMenu();
  }

  function finish() {
    // Endless mode: a finished chunk deals the next one in the SAME store —
    // score, records (review dots), roundMet, and the code stash all carry;
    // only the compiled lesson and the dot-bar window (chunkBase) reset.
    if (store.endless && store.drillLesson) {
      // The outgoing chunk's last-dealt key carries into the next compile so
      // the no-repeat guard holds across the chunk boundary.
      const lastAsk = store.drillLesson.steps?.findLast?.((s) => s.ask)?.ask;
      const built = buildKBSession(store.drillTopic ?? "all", {
        seed: Date.now() >>> 0,
        count: store.endlessCount,
        stats: loadDrillStats(),
        met: Object.keys(loadMetStore()),
        prevKey: lastAsk ? `${lastAsk.form}|${lastAsk.shape}|${lastAsk.concept}` : null,
      });
      if (built && !lintLesson(built).length) {
        lesson = built;
        stepIndex = -1;
        batch = [];
        store.lessonId = built.id;
        store.drillLesson = built;
        store.resumeIndex = 0;
        store.chunkBase = frozenRecords().length;
        persist();
        events.emit("lesson-started", { lessonId: built.id });
        return advance();
      }
    }
    // Practice rounds end with a next-step suggestion drawn from the round's
    // recorded summary (the frontier-thickest topic).
    const next = (store.cards ?? []).findLast?.((c) => c.type === "summary")?.next;
    ui.setControls([
      ...(next ? [{
        label: `Keep going: ${next.title} ▶`,
        primary: true,
        onClick: () => startDrill(next.topic),
      }] : []),
      { label: "Back to units", onClick: () => endLesson("completed") },
    ]);
    ui.setExitVisible(false);
    setWaiting(null);
    ui.popBatch(batch); // the closing beat (empty on a resumed finish → no-op)
    batch = [];
  }

  function start(unitId) {
    if (isCollabActive?.()) return null;
    setSurface("stage"); // v1 is solo-only (tutor-plan §9)
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

  // A practice round is a compiled, seeded lesson (app/kb-session.mjs,
  // sourced from the concept-DAG KB) — it runs on the ordinary lesson
  // machinery. The compiled script is persisted verbatim so a reload
  // resumes the identical round.
  function startDrill(topic = "all", opts = {}) {
    if (isCollabActive?.()) return null;
    setSurface("practice");
    const built = buildKBSession(topic, {
      seed: opts.seed ?? (Date.now() >>> 0),
      count: opts.count, // unset lets the compiler pick (8, or 4 for a focus round)
      stats: loadDrillStats(),
      met: Object.keys(loadMetStore()), // feeds the cold-start frontier bias
      focus: opts.focus, // targeted practice: one concept's own exercises
    });
    if (!built) throw new Error(`unknown drill topic: ${topic}`);
    const errors = lintLesson(built);
    if (errors.length) throw new Error(`drill ${topic} failed lint:\n${errors.join("\n")}`);
    if (lesson) endLesson("replaced");
    lesson = built;
    stepIndex = -1;
    batch = [];
    store = {
      lessonId: built.id, drillLesson: built, resumeIndex: 0, cards: [],
      score: { answered: 0, right: 0, streak: 0, best: 0 },
      ...(opts.endless ? { endless: true, drillTopic: topic, endlessCount: opts.count, chunkBase: 0 } : {}),
    };
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
    // Boot re-show: the layout persists only the "Exercises visible" bit;
    // WHICH surface comes up is this routing decision (practice for drills
    // and the menu, the focus stage for a mid-guided-lesson resume).
    const showIfVisible = () => { if (layoutVisible()) cur().show?.(); };
    if (!store.lessonId) { showMenu(); showIfVisible(); return false; }
    const restored = store.drillLesson
      ?? curriculum.units.find((u) => u.id === store.lessonId)?.lesson;
    if (!restored || lintLesson(restored).length) { store = {}; persist(); showMenu(); showIfVisible(); return false; }
    setSurface(store.drillLesson ? "practice" : "stage");
    showIfVisible();
    lesson = restored;
    batch = [];
    ui.clear();
    ui.setExitVisible(true);
    for (const desc of store.cards ?? []) ui.addCard(desc);
    stepIndex = (store.resumeIndex ?? 0) - 1;
    advance();
    return true;
  }

  // ---- review & retry (practice surface) ----------------------------------
  // Going back to an answered question: the dot bar hands an index here and
  // the practice surface renders the recorded snapshot. A retry re-runs and
  // re-grades for real, but NEVER touches the score of record: rec.ok, the
  // kb seen/missed stats, and met grants all keep the first attempt — the
  // retry outcome only decorates the record (rec.retry) and its dot.
  function reviewQuestion(i) {
    const rec = frozenRecords()[i];
    if (!rec) return null;
    const r = rec.review ?? {};
    const displayCode = r.kind === "fill-one-blank" && r.blank
      ? spliceBlank(r.code, r.blank, "___") : r.code;
    practiceUI.showReview?.({
      index: i,
      prompt: rec.prompt, ok: rec.ok, verdict: rec.verdict,
      answerText: rec.answerText, retry: rec.retry,
      kind: r.kind, code: displayCode, expectedText: r.expectedText,
      table: r.table, answersById: r.answersById,
      teach: r.teach, context: r.context,
      // Single-answer kinds get the single-input widget; trace-table gets
      // a fresh blank table (the UI branches on kind — retryAnswer takes a
      // text string or an answersById map accordingly).
      onRetry: r.code ? (answer) => retryAnswer(rec, answer) : null,
      onBack: () => practiceUI.closeReview?.(),
    });
    return rec;
  }

  async function retryAnswer(rec, text) {
    const r = rec.review;
    if (!r?.code) return null;
    if (r.kind === "trace-table") {
      // `text` is an answersById map here. Blank ids are index-based
      // (b0, b1, …) and the trace of the same program is deterministic, so
      // the stored review ids line up with the regenerated question's.
      if (!text || typeof text !== "object") return null;
      const before = editor.getValue();
      try {
        editor.setValue(r.code);
        const summary = await actions.trace();
        if (!summary) return null; // a run is live — the retry never happened
        const q = generateQuestion("trace-table", ctx(), r.opts ?? {});
        if (!q) return null;
        const res = q.grade(text);
        rec.retry = { ok: res.correct, tries: (rec.retry?.tries ?? 0) + 1 };
        persist();
        pushProgress(); // the dot picks up its missed-then-solved state
        return {
          ok: res.correct,
          perBlank: res.perBlank,
          expectedById: Object.fromEntries(q.blanks.map((b) => [b.id, b.expected])),
        };
      } finally {
        editor.setValue(before);
      }
    }
    if (!text?.trim()) return null;
    const before = editor.getValue(); // the live round's program — must survive
    try {
      let ok, expectedText;
      if (r.kind === "fill-one-blank") {
        editor.setValue(spliceBlank(r.code, r.blank, text));
        const summary = await actions.trace();
        if (!summary) return null; // a run is live — the retry never happened
        const q = summary.terminal_reason === "completed" ? generateQuestion("predict-output", ctx(), {}) : null;
        ok = Boolean(q && q.grade({ text: r.targetOutput }).correct);
        expectedText = q ? q.grade({ text: "" }).expected.text : r.expectedText;
      } else {
        editor.setValue(r.code);
        const summary = await actions.trace();
        if (!summary) return null;
        const q = generateQuestion(r.kind, ctx(), r.opts ?? {});
        if (!q) return null;
        const res = q.grade({ text });
        ok = res.correct;
        expectedText = res.expected.text;
      }
      rec.retry = { ok, tries: (rec.retry?.tries ?? 0) + 1 };
      // A skipped question never ran, so its record had no answer to show —
      // the retry's real run fills it in for future reviews.
      if (r.expectedText === undefined && expectedText !== undefined) r.expectedText = expectedText;
      persist();
      pushProgress(); // the dot picks up its missed-then-solved state
      return { ok, expectedText };
    } finally {
      editor.setValue(before);
    }
  }

  // Config hooks register on BOTH surfaces (whichever is active later must
  // have its exit/try-it/review wiring in place).
  for (const s of new Set(Object.values(surfaces))) {
    s.setOnExit(() => endLesson("exited"));
    s.setOnReview?.((i) => reviewQuestion(i));
    s.setOnTryIt((code) => {
      if (store.stash === undefined) store.stash = editor.getValue();
      editor.setValue(code);
      store.lastLoadedCode = code;
      registerProgram(code);
      persist();
    });
    // Reviewing an old bubble: if it was about a different program than the
    // editor currently holds, the popup gets a context card first — the
    // student may not notice the code has changed since (and line numbers
    // or names in the card would silently mislead). (Stage only; practice
    // has no history UI and registers a no-op.)
    s.setReviewContext((descs) => {
      const prog = descs.find((d) => d.prog !== undefined)?.prog;
      if (prog == null) return null;
      const code = (store.programs ?? [])[prog];
      if (code == null || code === editor.getValue()) return null;
      return { type: "context", code };
    });
  }

  restore();

  return {
    start,
    startDrill, // (topic?, {seed?, count?}) — deterministic under a seed
    drillStats: loadDrillStats,
    met: loadMetStore,           // tag → {at, source} (lesson-kb-binding §5)
    frontier: () => frontierTags(Object.keys(loadMetStore())),
    progress: () => topicProgress(Object.keys(loadMetStore())),
    mapModel: () => mapModel(Object.keys(loadMetStore())),
    showMap,
    exit: () => { if (lesson) endLesson("exited"); },
    // Surface visibility (the header 🎓 toggle and the collab go-live hook).
    // Hiding never ends a round — it stays resumable from the store.
    hideSurface: () => cur().hide?.(),
    toggleSurface() {
      if (layoutVisible()) { cur().hide?.(); return false; }
      cur().show?.();
      // Re-entering the stage surface must restore its focus layout.
      if (surface === "stage") actions.enterFocus?.();
      return true;
    },
    state: () => ({
      lessonId: lesson?.id ?? null,
      stepIndex,
      waiting: waiting?.type ?? null,
      lastAnswer: store.lastAnswer ?? null,
    }),
    feed: () => (store.cards ?? []).slice(),
    score: () => (store.score ? { ...store.score } : null),
    // Test/debug drivers (invariant 9: tests assert through window.plp).
    continue: () => { if (waiting?.type === "pause") resume(); },
    ask: () => (waiting?.type === "ask" ? { kind: waiting.kind } : null),
    review: (i) => reviewQuestion(i),
    retry: (i, text) => { const rec = frozenRecords()[i]; return rec ? retryAnswer(rec, text) : null; },
    closeReview: () => practiceUI.closeReview?.(),
    submit: (answers) => waiting?.submit?.(answers),
    lockPrediction: (text) => waiting?.lock?.(text),
    skip: () => waiting?.skip?.(),
    lintLesson,
  };
}
