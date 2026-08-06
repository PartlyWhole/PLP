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

import { generateQuestion, questionGenerators, normalizeAnswer, normalizeOutput } from "./questions.mjs";
import { renderQuestionBody, renderTraceTable, renderTraceSimulation, renderOrderLines, renderErrorPicker, renderLinePicker, createAnswerInput, createLinesInput, createGoneChip, appendExpected } from "./question-ui.mjs";
import { buildKBSession, kbTopics, migrateStats, spliceBlank, lineBlank, lintLessonConcepts, frontierTags, drillTopicFor, topicProgress, conceptTopics } from "./kb-session.mjs";
import { summarizeRound } from "./progress.mjs";
import { mapModel, renderConceptMap } from "./concept-map.mjs";
import { events } from "./events.mjs";

const STORE_KEY = "plp.tutor.v1";
const PRACTICE_COUNT_KEY = "plp.practice-count.v1";
// Drill/practice mastery is keyed by concept TAG (design §6). One-time
// migration carries forward the legacy drill-template store.
const KB_STATS_KEY = "plp.kb.v1";
const LEGACY_DRILL_STATS_KEY = "plp.drills.v1";
// The shared met map (design/lesson-kb-binding.md §5): tag → {at, source}.
// Lessons and drills both write through grantMet; the KB never reads it —
// the met SET (the keys) is passed into KB queries (frontierTags).
const KB_MET_KEY = "plp.kb.met.v1";

const KNOWN_EVENTS = new Set([
  "run-started", "run-ended", "run-rejected", "input-requested", "input-answered",
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

export function createTutor({ editor, memory, consoleUI, ui: stageUI, practiceUI, actions, curriculum, isCollabActive, nav }) {
  // History routing is optional wiring (main.mjs owns the hash): a no-op
  // nav keeps every other construction path working unchanged.
  nav ??= { go() {}, parse: () => "code" };
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
    "setLeaveLabel", "setRoundCountPicker", "setRoundNotice",
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
  // Which VIEW the practice surface currently shows ("menu" | "map" |
  // "round"; a summary counts as round). Drives the unified ← ("one level
  // up") and the hash route.
  let practiceView = "menu";
  const currentRoute = () => (!layoutVisible() ? "code"
    : surface === "stage" ? "lesson"
      : practiceView === "map" ? "learn/map"
        : practiceView === "round" ? "learn/round"
          : "learn");

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
    catch { /* private mode / quota: the session still works, just won't survive reload */ }
  }
  function loadPracticeCount() {
    try {
      const n = Number.parseInt(localStorage.getItem(PRACTICE_COUNT_KEY) ?? "10", 10);
      return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 10;
    } catch { return 10; }
  }
  function savePracticeCount(count) {
    const n = Number.parseInt(count, 10);
    if (!Number.isInteger(n) || n < 1 || n > 50) return;
    try { localStorage.setItem(PRACTICE_COUNT_KEY, String(n)); } catch { /* ephemeral */ }
  }
  function record(desc) {
    // Stamp each card with the program it was about (index into the
    // deduplicated store.programs), so reviewing an old bubble can show
    // that program when the editor has since moved on.
    if (store.currentProg != null && desc.prog === undefined) desc.prog = store.currentProg;
    const index = (store.cards ??= []).push(desc) - 1;
    persist();
    return index;
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
    // The console transcript as PURE DATA (questions.mjs never touches the
    // DOM): `consoleText` is the whole transcript — prompts, the single-path
    // echo of what was typed, and the program's own output — and
    // `consoleTextNoEcho` is exactly what the engine wrote. The predict-io
    // form (expansion ladder §R4a) is graded against these.
    consoleText: consoleUI.text(),
    consoleTextNoEcho: consoleUI.engineText(),
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

  // ---- misconception map (expansion ladder R1.1) -------------------------
  // tag → {hits, at}: recorded when a WRONG answer matches the exercise's
  // designed misconception for that instance (same normalization as
  // grading). The compiler reserves a follow-up slot for the most-hit tag;
  // a resolved follow-up ask (any outcome) decrements it back down.
  const KB_MC_KEY = "plp.kb.mc.v1";
  function loadMcStore() {
    try { return JSON.parse(localStorage.getItem(KB_MC_KEY)) ?? {}; } catch { return {}; }
  }
  function saveMcStore(mc) {
    try { localStorage.setItem(KB_MC_KEY, JSON.stringify(mc)); } catch { /* ephemeral */ }
  }
  function bumpMisconception(tag) {
    const mc = loadMcStore();
    const e = mc[tag] ??= { hits: 0, at: 0 };
    e.hits += 1;
    e.at = Date.now();
    saveMcStore(mc);
  }
  function settleFollowUp(tag) {
    const mc = loadMcStore();
    if (!mc[tag]) return;
    mc[tag].hits -= 1;
    if (mc[tag].hits <= 0) delete mc[tag];
    saveMcStore(mc);
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
    practiceView = "menu";
    ui.clear();
    ui.setLeaveLabel("Back to code", "Leave exercises and return to your code");
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
    ui.setRoundCountPicker({
      value: loadPracticeCount(),
      onChange: savePracticeCount,
    });
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
      // A stashed live round (← stepped up to the menu) resumes first.
      ...(practiceUI?.hasRoundStash?.() ? [{
        label: "▶ Continue your round",
        primary: true,
        onClick: resumeRound,
      }] : []),
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
    if (layoutVisible()) nav.go("learn");
  }

  // Resume a round the ← stepped aside from: the practice surface restores
  // the stashed DOM verbatim; state never left the runtime.
  function resumeRound() {
    if (!practiceUI?.hasRoundStash?.()) return false;
    setSurface("practice");
    practiceUI.unstashRound();
    practiceView = "round";
    ui.setLeaveLabel("Topics", "Save this round and return to practice topics");
    ui.setRoundNotice(store.roundNotice ?? "");
    ui.setExitVisible(true);
    pushProgress();
    nav.go("learn/round");
    return true;
  }

  // "One level up" (the surface's ← and Esc, after its own progressive
  // dismissal): round/summary → menu (round stays resumable via the DOM
  // stash), map → menu, menu → the IDE.
  function goUp() {
    if (practiceView === "map") { showMenu(); return; }
    if (practiceView === "round") {
      if (lesson && store.drillLesson) practiceUI?.stashRound?.();
      showMenu();
      return;
    }
    cur().hide?.();
    nav.go("code");
  }

  // popstate (and boot reconciliation) lands here: route the VIEW through
  // the same handlers the buttons use — no parallel navigation machinery.
  function applyRoute(route) {
    if (isCollabActive?.()) return;
    if (route === "code") {
      if (layoutVisible()) cur().hide?.();
      return;
    }
    if (route === "lesson") {
      if (lesson && !store.drillLesson) {
        setSurface("stage");
        cur().show?.();
        actions.enterFocus?.();
      } else if (layoutVisible()) cur().hide?.();
      return;
    }
    if (route === "learn/map") { showMap(); return; }
    if (route === "learn/round") {
      if (practiceView === "round" && lesson && store.drillLesson) {
        setSurface("practice");
        cur().show?.();
        return;
      }
      if (resumeRound()) { cur().show?.(); return; }
      // Nothing to resume (round ended / fresh load without one): the menu.
      showMenu();
      cur().show?.();
      return;
    }
    // "learn": the menu. A live round on screen steps aside resumably.
    if (practiceView === "round" && lesson && store.drillLesson) practiceUI?.stashRound?.();
    showMenu();
    cur().show?.();
  }

  // The concept map view: the whole DAG as topic lanes with met/frontier/
  // locked chips; a frontier chip's "Practice this ▶" starts a targeted
  // round on that one concept.
  function showMap() {
    setSurface("practice");
    // Stepping onto the map over a live round keeps the round resumable.
    if (practiceView === "round" && lesson && store.drillLesson) practiceUI?.stashRound?.();
    practiceView = "map";
    ui.show(); // callable from anywhere (debug API included) — the map implies visibility
    ui.clear();
    ui.setLeaveLabel("Back to topics", "Return to practice topics");
    ui.setProgress("My map");
    ui.setExitVisible(false);
    const host = document.createElement("div");
    renderConceptMap(host, mapModel(Object.keys(loadMetStore())), {
      // Map-launched rounds remember their origin: ending one returns HERE.
      onPractice: (tag) => startDrill(conceptTopics().get(tag) ?? "all", { focus: tag, origin: "map" }),
    });
    ui.showCustom(host);
    ui.setControls([{ label: "← Back to topics", onClick: showMenu }]);
    nav.go("learn/map");
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
      {
        qDone, qTotal, results: all.slice(store.chunkBase ?? 0),
        reviewIndices: all.map((r) => r.index),
      },
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
      // A first-attempt miss is already scored, but deliberately remains on
      // this ask until the learner retries, reveals, or moves on. Reloading
      // must rebuild that correction state instead of grading the ask again.
      if (store.pendingCorrection?.stepIndex === stepIndex) {
        return restorePendingCorrection();
      }
      store.resumeIndex = stepIndex; // re-ask on reload
      persist();
      // predict-output and predict-state share the predict-then-verify path:
      // a real trace, then grading against what the engine actually did.
      if (step.ask.kind === "predict-output" || step.ask.kind === "predict-state") return execPredictOutput(step.ask);
      if (step.ask.kind === "fill-one-blank") return execFillBlank(step.ask);
      if (step.ask.kind === "trace-table") return execTraceTable(step.ask);
      if (step.ask.kind === "trace-simulation") return execTraceSimulation(step.ask);
      if (step.ask.kind === "order-the-lines") return execOrderLines(step.ask);
      if (step.ask.kind === "predict-the-error") return execPredictError(step.ask);
      if (step.ask.kind === "predict-io") return execPredictIO(step.ask);
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
  function countAskOutcome({ ok, lastAnswer, template, concept, kind, misconceptionMatched = false }) {
    if (concept) bumpDrillStats(concept, lastAnswer === "correct");
    if (template) bumpTemplateStats(template, ok);
    // The score tracker (drills only): session right-count and streak on a
    // first-attempt basis - the same basis as everything else. The all-time
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
    events.emit("quiz-graded", {
      kind, correct: ok, template, concept, misconception: misconceptionMatched,
    });
  }

  function resolveAsk(card, { prompt, ok, verdict, answerText, lastAnswer, kind, template, concept, review, misconception, misconceptionOf, followUp, settled = false, retry, outcomeCounted = false }) {
    const correction = Boolean(store.drillLesson && lastAnswer === "wrong" && review?.code && !settled);
    const shownVerdict = correction
      ? "✗ Not yet - your first try is recorded"
      : verdict;
    card.freeze();
    card.setNote("");
    card.verdict(ok, shownVerdict);
    // Misconception match (R1.1): a WRONG answer equal (under the grading
    // normalization) to the instance's designed wrong answer is evidence of
    // that specific confusion — record it against the tag it belongs to.
    // A resolved follow-up ask settles its tag's entry either way.
    const mcTag = misconceptionOf ?? concept;
    const matchedMc = lastAnswer === "wrong" && misconception != null && answerText != null
      && normalizeAnswer(answerText) === normalizeAnswer(misconception);
    if (matchedMc && mcTag) bumpMisconception(mcTag);
    if (followUp && mcTag) settleFollowUp(mcTag);
    // `review` is the reviewable snapshot (program, kind, opts, expected):
    // enough to rebuild this question later from the store alone — the dot
    // bar's "go back to it" and the retry flow both feed on it.
    const rec = {
      type: "question-frozen", prompt, ok, verdict: shownVerdict, answerText, concept,
      ...(review ? { review } : {}),
      ...(retry ? { retry } : {}),
      // Legacy records have no disclosure field and remain revealed. Every
      // newly recorded miss starts hidden; correct answers already proved the
      // truth themselves and keep the familiar visible review.
      disclosure: correction ? "hidden" : "revealed",
    };
    const cardIndex = record(rec);
    store.lastAnswer = lastAnswer;
    if (!outcomeCounted) countAskOutcome({
      ok, lastAnswer, template, concept, kind, misconceptionMatched: matchedMc,
    });
    if (correction) {
      store.pendingCorrection = { cardIndex, stepIndex };
      persist();
      pushProgress();
      return showPendingCorrection(rec);
    }
    resume();
  }

  // Per-template (exercise-id) results: selection uses these to RETIRE the
  // exact questions the learner already answered right — fresh templates on
  // the same concept win. Separate store; the tag-keyed kb stats shape is
  // pinned (K-series migrations).
  const KB_TMPL_KEY = "plp.kb.tmpl.v1";
  function loadTemplateStats() {
    try { return JSON.parse(localStorage.getItem(KB_TMPL_KEY)) ?? {}; } catch { return {}; }
  }
  function bumpTemplateStats(template, ok) {
    const t = loadTemplateStats();
    const s = t[template] ??= { seen: 0, right: 0 };
    s.seen += 1;
    if (ok) s.right += 1;
    try { localStorage.setItem(KB_TMPL_KEY, JSON.stringify(t)); } catch { /* ephemeral */ }
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

  // The one answer-surface builder for free-text predictions. A ONE-line ask
  // keeps the plain input (Enter submits — drill cadence, unchanged); a
  // SEVERAL-line ask gets the growing one-line-box widget, whose Enter builds
  // line structure and whose empty-Enter submits (question-ui.createLinesInput).
  // Both are handed back behind the same tiny surface so the lock/grade path
  // below reads the same either way.
  const makeAnswerSurface = ({ multi, placeholder, onSubmit }) => {
    if (multi) {
      const w = createLinesInput({ placeholder, onSubmit });
      return {
        el: w.el, multi: true, input: null,
        get text() { return w.getValue(); },
        setText: (t) => w.setValue(t),
        setReadOnly: (v) => w.setReadOnly(v),
        mark: (ok) => w.applyResult({ correct: ok }),
        focus: () => w.focus(),
      };
    }
    const el = createAnswerInput({ singleLine: true, placeholder });
    return {
      el, multi: false, input: el,
      get text() { return el.value; },
      setText: (t) => { el.value = t; },
      setReadOnly: (v) => { el.readOnly = v; },
      mark: (ok) => { el.classList.toggle("ok", ok); el.classList.toggle("bad", !ok); },
      focus: () => el.focus(),
    };
  };

  function execPredictOutput(ask) {
    events.emit("quiz-question", { kind: ask.kind });
    const isState = ask.kind === "predict-state";
    const hints = [...(ask.hints ?? [])];
    const totalHints = hints.length;
    // A predict-state answer is ONE value (and its "gone" chip fills one box),
    // so it is single-line whatever the ask says; only free output prediction
    // grows boxes.
    const multi = !ask.singleLine && !isState;
    let ans = null;
    const card = ui.addInteractiveCard({
      teach: ask.teach, context: ask.context, form: ask.form ?? ask.kind,
      multiline: multi,
      prompt: ask.prompt
        ?? "Before you run it: what will this program print? Type the exact output.",
      render: (body) => {
        // One-thing-at-a-time asks (drills, single-print programs) get a
        // single-line input; a several-line prediction gets the line boxes,
        // where Enter on an empty last box submits.
        ans = makeAnswerSurface({
          multi,
          placeholder: isState ? "the value it holds…" : multi ? "one printed line…" : "what this prints…",
          onSubmit: () => doLock(),
        });
        body.appendChild(ans.el);
        // predict-state only: the "gone" token has to be discoverable, not
        // guessed (ladder §R4b W4). Typing any accepted alias still works.
        if (isState) body.appendChild(createGoneChip(ans.input));
        return null;
      },
      actions: [],
      prog: store.currentProg,
    });
    ui.popBatch(batch, card);
    batch = [];

    const doLock = async () => {
      const text = ans.text;
      if (!text.trim()) { card.setNote("Type what you think it prints first"); return; }
      const ranCode = editor.getValue(); // grade-what-runs: snapshot for review/retry
      ans.setReadOnly(true);
      card.setActions([]);
      card.setNote("Running it for real…");
      // The reveal: the console grows NOW, so the eye lands on the real run
      // (predict-state also opens the memory pane — the state IS the answer).
      ui.beginReveal?.({ memory: isState });
      const summary = await actions.trace();
      if (!summary) {
        ans.setReadOnly(false);
        card.setNote("The run couldn't start (is another one going?) — try again");
        armLockActions();
        return;
      }
      const q = generateQuestion(ask.kind, ctx(), ask.opts ?? {});
      if (!q) {
        resolveAsk(card, {
          prompt: ask.prompt, ok: false, verdict: "couldn't grade this run",
          answerText: text, lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: ask.kind,
        misconception: ask.misconception, misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
        });
        return;
      }
      const result = q.grade({ text });
      ans.mark(result.correct);
      // The in-card reveal (practice surface): the grade's expected text IS
      // the real run's output (predict-output) / the probed value
      // (predict-state). Stage handles have no reveal method — they keep the
      // classic wrong-only expected block below, byte-identical.
      const goneTruth = isState && result.expected.gone === true;
      if (result.correct || !store.drillLesson) card.reveal?.({
        text: result.expected.text, correct: result.correct, kind: ask.kind, gone: goneTruth,
      });
      if (!result.correct && !store.drillLesson && !card.reveal) {
        appendExpected(card.body, {
          label: goneTruth ? "It holds nothing:"
            : isState ? "What it really held:" : "What it really printed:",
          text: goneTruth ? "that name is gone" : result.expected.text,
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
        misconception: ask.misconception, misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
        review: {
          kind: ask.kind, form: ask.form, opts: ask.opts, code: ranCode,
          expectedText: result.expected.text, expectedGone: goneTruth,
          // The retry widget must match the live one (several-line answers get
          // the line boxes, not a textarea) — the ask's shape rides along.
          multiline: multi,
          teach: ask.teach, context: ask.context,
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
        misconception: ask.misconception, misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
        review: { kind: ask.kind, form: ask.form, opts: ask.opts, code: editor.getValue(), multiline: multi, teach: ask.teach, context: ask.context },
      }) },
    ]);
    // Enter submits on single-line asks — drill cadence. Several-line asks
    // submit through the widget's own empty-Enter gesture (wired as onSubmit).
    if (!multi) {
      ans.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !ans.input.readOnly) doLock();
      });
    }
    armLockActions();
    setWaiting({
      type: "ask",
      kind: ask.kind,
      // Driver API (plp.tutor.lockPrediction): a "\n"-joined string fills the
      // line boxes one line per box — every existing caller keeps working.
      lock: (text) => { if (text != null) ans.setText(text); return doLock(); },
      skip: () => resolveAsk(card, {
        prompt: ask.prompt, ok: false, verdict: "skipped",
        lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: ask.kind,
        misconception: ask.misconception, misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
        review: { kind: ask.kind, form: ask.form, opts: ask.opts, code: editor.getValue(), multiline: multi, teach: ask.teach, context: ask.context },
      }),
    });
    return true;
  }

  // predict-io (expansion ladder §R4a): the program calls input(), the card
  // SHOWS the lines "someone types", and the graded answer is the whole
  // console transcript — prompt text, the typed lines where they land, and
  // the program's own output.
  //
  // EXECUTION: the ask's `stdinScript` answers each live rendezvous in order
  // (runner.traceWithScript, driven by the `input-requested` event). If the
  // program asks for more lines than the script holds, that run is
  // INTERRUPTED and the question is skipped — never left waiting (invariant
  // 2: every run must reach a terminal state).
  //
  // GRADING: the full transcript, OR the echo-stripped variant. A learner who
  // predicts only what the PROGRAM emits (prompts + output, no typed lines)
  // has understood the same thing; failing that reading would be grading a
  // presentation choice, not the concept.
  function execPredictIO(ask) {
    events.emit("quiz-question", { kind: "predict-io" });
    const script = [...(ask.stdinScript ?? [])];
    const hints = [...(ask.hints ?? [])];
    const totalHints = hints.length;
    let ans = null;
    const card = ui.addInteractiveCard({
      teach: ask.teach, context: ask.context, form: ask.form ?? ask.kind,
      stdinScript: script,
      multiline: true,
      prompt: ask.prompt
        ?? "Someone types the answers shown. What does the whole console show?",
      render: (body) => {
        // A transcript is several lines by construction — line boxes, one per
        // console line, with the empty-Enter submit.
        ans = makeAnswerSurface({
          multi: true,
          placeholder: "one console line…",
          onSubmit: () => doLock(),
        });
        body.appendChild(ans.el);
        return null;
      },
      actions: [],
      prog: store.currentProg,
    });
    ui.popBatch(batch, card);
    batch = [];

    const skipDesc = (verdict, answerText) => ({
      prompt: ask.prompt, ok: false, verdict,
      answerText, lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: "predict-io",
      misconception: ask.misconception, misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
      review: {
        kind: "predict-io", form: ask.form, code: editor.getValue(),
        stdinScript: script, teach: ask.teach, context: ask.context,
      },
    });

    const doLock = async () => {
      const text = ans.text;
      if (!text.trim()) { card.setNote("Type what you think the console shows first"); return; }
      const ranCode = editor.getValue(); // grade-what-runs: snapshot for review/retry
      ans.setReadOnly(true);
      card.setActions([]);
      card.setNote("Running it for real…");
      ui.beginReveal?.({ memory: false });
      const res = await actions.traceWithScript?.(script);
      if (!res?.summary) {
        ans.setReadOnly(false);
        card.setNote("The run couldn't start (is another one going?) — try again");
        armLockActions();
        return;
      }
      // The two ways a scripted run yields nothing gradable: the program
      // out-asked its script (interrupted by design), or it ended some other
      // way than completing. Both skip; neither hangs.
      if (res.exhausted || res.summary.terminal_reason !== "completed") {
        resolveAsk(card, skipDesc("couldn't grade this run", text));
        return;
      }
      const c = ctx();
      const full = c.consoleText;
      const noEcho = c.consoleTextNoEcho;
      const got = normalizeOutput(text);
      const correct = got === normalizeOutput(full) || got === normalizeOutput(noEcho);
      ans.mark(correct);
      if (correct || !store.drillLesson) card.reveal?.({ text: full, correct, kind: "predict-io" });
      if (!correct && !store.drillLesson && !card.reveal) {
        appendExpected(card.body, { label: "What the console really showed:", text: full });
      }
      // MET GRANT (lesson-kb-binding §4): predicting the transcript of a
      // program that PAUSES for the outside world is a prediction of its
      // observable effect — the same §2.8 evidence class as predict-output.
      // Same discipline: first attempt (this kind has no retries) and before
      // the final hint.
      const metTag = ask.focus ?? ask.concept;
      const beforeFinalHint = totalHints === 0 || hints.length > 0;
      if (correct && metTag && beforeFinalHint) {
        if (grantMet(metTag, ask.focus ? "lesson" : "drill")) {
          (store.roundMet ??= []).push(metTag);
          persist();
        }
      }
      resolveAsk(card, {
        prompt: ask.prompt, ok: correct,
        verdict: correct ? "✓ Exactly right!" : "✗ Not quite — compare with what really happened",
        answerText: text,
        lastAnswer: correct ? "correct" : "wrong",
        template: ask.template, concept: ask.concept, kind: "predict-io",
        misconception: ask.misconception, misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
        review: {
          kind: "predict-io", form: ask.form, code: ranCode, stdinScript: script,
          expectedText: full, teach: ask.teach, context: ask.context,
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
      { label: "Skip this one", onClick: () => resolveAsk(card, skipDesc("skipped")) },
    ]);
    armLockActions();
    setWaiting({
      type: "ask",
      kind: "predict-io",
      // Driver API: "\n"-joined text fills one box per line (see above).
      lock: (text) => { if (text != null) ans.setText(text); return doLock(); },
      skip: () => resolveAsk(card, skipDesc("skipped")),
    });
    return true;
  }

  // fill-one-blank (design §5.2): the program is shown with one hole and a
  // target output; the learner types the missing token. Grading substitutes
  // the token, runs the filled program for real, and accepts ANY fill whose
  // real output equals the target — the interpreter is the only judge. A
  // non-parsing fill just grades wrong (no traceback shown).
  // Mobile keyboards silently substitute typographic quotes, which Python
  // rejects with a syntax error the learner cannot see the cause of. The
  // typed text is normalized BEFORE splicing — so the program that runs (and
  // the console reveal, which shows exactly what ran) holds straight quotes.
  const normalizeTypedCode = (text) => String(text).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

  function execFillBlank(ask) {
    events.emit("quiz-question", { kind: "fill-one-blank" });
    // fix-the-bug (expansion ladder §R5's composition) is the one member of
    // this kind whose splice target is chosen at ANSWER time: the learner
    // taps the line they think is wrong (predict-the-error's picker) and then
    // writes its replacement (write-the-line's box). Rather than fork a third
    // exec path, this path accepts a runtime-chosen blank — everything after
    // the splice (run, compare with the target, reveal, review, retry) is
    // byte-for-byte the same code the other two forms already use.
    const isFix = ask.form === "fix-the-bug";
    const fillReview = (extra = {}) => ({
      kind: "fill-one-blank", form: ask.form, code: ask.code, blank: ask.blank,
      targetOutput: ask.targetOutput, teach: ask.teach, context: ask.context,
      ...(isFix ? { pickerCode: ask.code } : {}),
      ...extra,
    });
    const hints = [...(ask.hints ?? [])];
    let input = null;
    let picker = null;
    const card = ui.addInteractiveCard({
      teach: ask.teach, context: ask.context, form: ask.form ?? "fill-one-blank",
      prompt: ask.prompt ?? "Fill in the blank so the program prints the target.",
      // fix-the-bug's picker rows ARE the program, numbered — a second copy
      // above them would be the same lines twice (as in predict-the-error).
      ...(isFix ? { program: false } : {}),
      render: (body) => {
        if (isFix) picker = renderLinePicker(body, { code: ask.code });
        input = createAnswerInput({
          singleLine: true,
          // write-the-line asks for a WHOLE line (ladder §R5), so the
          // placeholder names the job; the fill placeholder names a token.
          // fix-the-bug's box starts EMPTY and never pre-filled with the
          // buggy line — seeing it would anchor the repair (quality bar E5).
          placeholder: isFix ? "what that line should be…"
            : ask.form === "write-the-line" ? "the missing line…" : "the missing piece…",
        });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !input.readOnly) doFill(); });
        if (isFix) {
          // The box appears once a line is picked: FIND, then FIX.
          input.hidden = true;
          picker.onPick(() => { input.hidden = false; input.focus(); });
        }
        body.appendChild(input);
        return null;
      },
      actions: [],
      prog: store.currentProg,
    });
    ui.popBatch(batch, card);
    batch = [];

    const doFill = async (provided) => {
      if (provided && typeof provided === "object") {
        // Driver API (plp.tutor.submit): fix-the-bug answers as
        // { line, text } — the pick and the replacement, in one gesture.
        if (provided.line != null) picker?.buttons[provided.line - 1]?.click();
        if (provided.text != null) input.value = provided.text;
      }
      const pickedLine = isFix ? picker?.picked() : null;
      if (isFix && !pickedLine) {
        card.setNote("Tap the line you think is wrong first");
        return;
      }
      const token = normalizeTypedCode(input.value);
      if (!token.trim()) {
        card.setNote(isFix ? "Now write what that line should be"
          : ask.form === "write-the-line" ? "Type the missing line first" : "Type the missing piece first");
        return;
      }
      input.readOnly = true;
      picker?.freeze();
      card.setActions([]);
      card.setNote("Filling it in and running it for real…");
      // THE runtime-chosen blank: the picked line's content, indentation kept.
      const blank = isFix ? lineBlank(ask.code, pickedLine) : ask.blank;
      const filled = spliceBlank(ask.code, blank, token);
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
      if (q && (correct || !store.drillLesson)) {
        card.reveal?.({ text: q.grade({ text: "" }).expected.text, correct, kind: "fill-one-blank" });
      }
      if (correct || !store.drillLesson) picker?.mark({ ok: correct });
      if (!correct && !store.drillLesson) {
        appendExpected(card.body, {
          label: isFix ? `A fix that works — line ${ask.blank.line}:` : "A fill that works:",
          text: ask.blank.target,
        });
      }
      // THE HONEST INTERPRETER-FIRST CASE: a learner who repaired a DIFFERENT
      // line, and whose program nonetheless prints the intended output, is
      // right — the interpreter is the only answer key, so the verdict says
      // so warmly instead of quietly grading the pick.
      const otherLine = isFix && correct && pickedLine !== ask.blank.line;
      resolveAsk(card, {
        prompt: ask.prompt, ok: correct,
        verdict: otherLine ? "✓ Not the line I'd have changed, but it works!"
          : correct ? "✓ That prints the target!" : "✗ Not quite — that doesn't produce the target",
        answerText: isFix ? `line ${pickedLine} → ${token}` : token,
        lastAnswer: correct ? "correct" : "wrong",
        template: ask.template, concept: ask.concept, kind: "fill-one-blank",
        misconception: ask.misconception, misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
        review: fillReview({
          expectedText: q ? q.grade({ text: "" }).expected.text : undefined,
          ...(isFix ? { picked: { line: pickedLine, text: token } } : {}),
        }),
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
        misconception: ask.misconception, misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
        review: fillReview(),
      }) },
    ]);
    armActions();
    setWaiting({
      type: "ask",
      kind: "fill-one-blank",
      lock: (text) => { if (text != null) input.value = text; return doFill(); },
      // fix-the-bug's answer is a PAIR — { line, text } — so it arrives
      // through submit (the same door order-the-lines and the error picker
      // use for their non-text answers).
      submit: (answer) => doFill(answer),
      skip: () => resolveAsk(card, {
        prompt: ask.prompt, ok: false, verdict: "skipped",
        lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: "fill-one-blank",
        misconception: ask.misconception, misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
        review: fillReview(),
      }),
    });
    return true;
  }

  // order-the-lines (Parsons, expansion ladder §R2): the dealt lines are
  // shuffled at COMPILE time; the learner rearranges them with ↑/↓ and the
  // grade is what their arrangement REALLY prints — join, load, run, compare
  // with the target. Any order that prints the target is right (positional
  // grading would contradict interpreter-first); an arrangement that raises
  // never completes and grades wrong.
  //
  // NO met grant here (v1): an arrangement is production evidence, weaker
  // than the prediction classes lesson-kb-binding §4 admits as met-granting.
  // Everything else resolveAsk does — kb stats, template retirement, score
  // and streak, events — still runs. Revisit with data (ladder §R2).
  function execOrderLines(ask) {
    events.emit("quiz-question", { kind: "order-the-lines" });
    const byId = new Map(ask.items.map((it) => [it.id, it.text]));
    const codeFor = (orderIds) => orderIds.map((id) => byId.get(id) ?? "").join("\n") + "\n";
    const baseReview = (extra = {}) => ({
      kind: "order-the-lines", form: ask.form,
      items: ask.items, canonical: ask.lines, targetOutput: ask.targetOutput,
      teach: ask.teach, context: ask.context,
      ...extra,
    });
    let view = null;
    const card = ui.addInteractiveCard({
      teach: ask.teach, context: ask.context, form: ask.form ?? "order-the-lines",
      prompt: ask.prompt ?? "Put the lines in order.",
      // The widget IS the program — a second, uneditable copy above it would
      // only be the same lines twice.
      program: false,
      render: (body) => { view = renderOrderLines(body, ask); return view; },
      actions: [],
      prog: store.currentProg,
    });
    ui.popBatch(batch, card);
    batch = [];

    const doCheck = async (provided) => {
      const orderIds = provided ?? view.collect();
      const arranged = codeFor(orderIds);
      view.freeze();
      card.setActions([]);
      card.setNote("Running your order for real…");
      editor.setValue(arranged);
      store.lastLoadedCode = arranged; // the reveal run is now the lesson's code
      registerProgram(arranged);
      persist();
      ui.beginReveal?.();
      const summary = await actions.trace();
      // A non-completing arrangement (the classic use-before-bind) has no
      // gradable output — it simply is not the target.
      const q = summary?.terminal_reason === "completed" ? generateQuestion("predict-output", ctx(), {}) : null;
      const correct = Boolean(q && q.grade({ text: ask.targetOutput }).correct);
      const expectedText = q ? q.grade({ text: "" }).expected.text : "";
      view.applyResult({ correct });
      if (correct || !store.drillLesson) card.reveal?.({ text: expectedText, correct, kind: "order-the-lines" });
      if (!correct && !store.drillLesson && !card.reveal) {
        appendExpected(card.body, { label: "What your order really printed:", text: expectedText });
      }
      resolveAsk(card, {
        prompt: ask.prompt, ok: correct,
        verdict: correct ? "✓ That prints the target!" : "✗ Not quite — that order prints something else",
        lastAnswer: correct ? "correct" : "wrong",
        template: ask.template, concept: ask.concept, kind: "order-the-lines",
        misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
        review: baseReview({ code: arranged, answerOrder: orderIds, expectedText }),
      });
    };
    const doSkip = () => resolveAsk(card, {
      prompt: ask.prompt, ok: false, verdict: "skipped",
      lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: "order-the-lines",
      misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
      review: baseReview({ code: codeFor(ask.items.map((it) => it.id)) }),
    });
    card.setActions([
      { label: "Check my order ▶", primary: true, onClick: () => doCheck() },
      { label: "Skip this one", onClick: doSkip },
    ]);
    setWaiting({
      type: "ask",
      kind: "order-the-lines",
      submit: (orderIds) => doCheck(orderIds),
      skip: doSkip,
    });
    return true;
  }

  // The learner-facing reveal for a real crash: type, message when the engine
  // gives one (PyTrace 0.1.0 exposes none), and the line — never a bare colon
  // with nothing after it.
  const revealTextFor = (actual) =>
    `${actual.type}${actual.message ? `: ${actual.message}` : ""} — line ${actual.line}`;

  // predict-the-error (expansion ladder §R3): the program stops, and the
  // learner taps the line it stops on and picks the kind from a FIXED
  // four-name palette (all four, always — a palette pruned to the plausible
  // options would become a meta-pattern, quality bar E6).
  //
  // Graded against the REAL terminal exception, never against authored
  // provenance: run it, require terminal_reason "uncaught_exception", then
  // read actions.lastException() for type_name and location.line. Correct iff
  // BOTH halves match; the verdict may acknowledge a half-right pick, but the
  // score stays all-or-nothing (a crash site is one prediction, not two).
  //
  // MET GRANT (lesson-kb-binding §4): a first-attempt both-right answer before
  // the final hint evidences the focused concept — an unaided, engine-verified
  // prediction of the program's observable effect, which here is where and how
  // it crashes.
  function execPredictError(ask) {
    events.emit("quiz-question", { kind: "predict-the-error" });
    const hints = [...(ask.hints ?? [])];
    const totalHints = hints.length;
    const askCode = () => editor.getValue();
    const baseReview = (extra = {}) => ({
      kind: "predict-the-error", form: ask.form,
      code: askCode(), teach: ask.teach, context: ask.context,
      ...extra,
    });
    let view = null;
    const card = ui.addInteractiveCard({
      teach: ask.teach, context: ask.context, form: ask.form ?? "predict-the-error",
      prompt: ask.prompt ?? "This program stops with an error. Tap the line it stops on, and pick what kind.",
      // The picker rows ARE the program, numbered — a second copy above them
      // would be the same lines twice (same call as order-the-lines).
      program: false,
      render: (body) => { view = renderErrorPicker(body, { code: askCode() }); return view; },
      actions: [],
      prog: store.currentProg,
    });
    ui.popBatch(batch, card);
    batch = [];

    const doCheck = async (provided) => {
      const picked = provided ?? view.collect();
      if (!picked?.line) { card.setNote("Tap the line you think it stops on first"); return; }
      if (!picked?.type) { card.setNote("Now pick which kind of error it is"); return; }
      const ranCode = askCode(); // grade-what-runs: snapshot for review/retry
      view.freeze();
      card.setActions([]);
      card.setNote("Running it for real…");
      ui.beginReveal?.();
      const summary = await actions.trace();
      const ex = summary?.terminal_reason === "uncaught_exception" ? actions.lastException?.() : null;
      if (!ex || !ex.location) {
        // The run never reached an uncaught exception (or came back without a
        // location): there is no ground truth, so this is the existing
        // ungradable path — never a guess, never a wrong mark.
        resolveAsk(card, {
          prompt: ask.prompt, ok: false, verdict: "couldn't grade this run",
          lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: "predict-the-error",
          misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
          review: baseReview({ code: ranCode, picked }),
        });
        return;
      }
      const actual = { type: ex.type_name, line: ex.location.line, message: ex.safe_message ?? "" };
      const lineOk = picked.line === actual.line;
      const typeOk = picked.type === actual.type;
      const correct = lineOk && typeOk;
      const revealText = revealTextFor(actual);
      if (correct || !store.drillLesson) view.applyResult({ lineOk, typeOk, actual });
      if (correct || !store.drillLesson) card.reveal?.({ text: revealText, correct, kind: "predict-the-error" });
      if (!correct && !store.drillLesson && !card.reveal) {
        appendExpected(card.body, { label: "Where it really stopped:", text: revealText });
      }
      const metTag = ask.focus ?? ask.concept;
      const beforeFinalHint = totalHints === 0 || hints.length > 0;
      if (correct && metTag && beforeFinalHint) {
        if (grantMet(metTag, ask.focus ? "lesson" : "drill")) {
          (store.roundMet ??= []).push(metTag);
          persist();
        }
      }
      resolveAsk(card, {
        prompt: ask.prompt, ok: correct,
        verdict: correct ? "✓ Right line, right kind!"
          : lineOk ? "✗ Right line, wrong kind — see what it really raised"
            : typeOk ? "✗ Right kind, wrong line — see where it really stopped"
              : "✗ Not quite — see where it really stopped, and with what",
        answerText: `line ${picked.line} · ${picked.type}`,
        lastAnswer: correct ? "correct" : "wrong",
        template: ask.template, concept: ask.concept, kind: "predict-the-error",
        misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
        review: baseReview({ code: ranCode, picked, actual, expectedText: revealText }),
      });
    };
    const doSkip = () => resolveAsk(card, {
      prompt: ask.prompt, ok: false, verdict: "skipped",
      lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: "predict-the-error",
      misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
      review: baseReview(),
    });
    const armActions = () => card.setActions([
      { label: "Check my answer \u25b6", primary: true, onClick: () => doCheck() },
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
      kind: "predict-the-error",
      submit: (pickedIn) => doCheck(pickedIn),
      skip: doSkip,
    });
    return true;
  }

  // Progressive trace simulation: the runtime traces silently to obtain the
  // answer key, then exposes exactly one raw executed-line occurrence at a
  // time. A miss never discloses the next line or an effect field; the learner
  // may retry indefinitely or explicitly reveal only the current phase.
  function execTraceSimulation(ask) {
    events.emit("quiz-question", { kind: "trace-simulation" });
    const oracleLesson = lesson;
    const oracleStore = store;
    const oracleStepIndex = stepIndex;
    const ranCode = editor.getValue();
    const traceOptions = { maxEvents: ask.maxEvents ?? null };
    (async () => {
      const summary = await actions.trace();
      // Finish/replacement can happen while the private trace is running.
      // Its continuation no longer owns tutor state, so remove only the
      // completed oracle it created and never resurrect the old question.
      const roundChanged = lesson !== oracleLesson
        || store !== oracleStore
        || stepIndex !== oracleStepIndex;
      if (roundChanged) {
        if (actions.discardCompletedTrace?.()) {
          memory.reset();
          await consoleUI.reset();
        }
        return;
      }
      const q = summary?.terminal_reason === "completed"
        ? generateQuestion("trace-simulation", ctx(), {
          names: ask.probeNames, maxEvents: ask.maxEvents,
        })
        : null;
      if (!q) {
        delete store.activeTrace;
        const desc = {
          type: "sys",
          text: summary
            ? "(couldn't build a progressive trace here - moving on)"
            : "(the run couldn't start - moving on)",
        };
        record(desc);
        ui.addCard(desc);
        batch.push(desc);
        store.lastAnswer = "skipped";
        resume();
        return;
      }

      // The silent trace is an answer key, not learner-visible state. If the
      // learner steps back to Code while this resumable question is active,
      // neither debug records, the memory scrubber, nor console may disclose
      // the future trace. The pure question has captured the oracle it needs.
      actions.discardCompletedTrace?.();
      memory.reset();
      await consoleUI.reset();

      let progress = store.activeTrace;
      const endCursor = q.stepCount - 1;
      const progressInBounds = Number.isInteger(progress?.cursor)
        && progress.cursor >= 0
        && progress.cursor <= endCursor
        && (progress.phase === "next-line" || progress.phase === "effects")
        && !(progress.phase === "effects" && progress.cursor === endCursor)
        && Array.isArray(progress.committed)
        && progress.committed.length === progress.cursor;
      const reusable = progress?.version === 2
        && progress.stepIndex === oracleStepIndex
        && progress.code === ranCode
        && JSON.stringify(progress.names) === JSON.stringify(q.names)
        && JSON.stringify(progress.options) === JSON.stringify(traceOptions)
        && progressInBounds;
      if (!reusable) {
        // Changed inputs or invalid bounds discard derived trace truth, but
        // cannot undo or re-count a first-attempt miss on this ask. Carry only
        // scoring history; rebuild all cursor/ledger state from the new oracle.
        const sameStep = progress?.stepIndex === oracleStepIndex;
        const carriedMiss = sameStep && (progress?.pristine === false || progress?.outcomeCounted === true);
        const carriedOutcome = sameStep && progress?.outcomeCounted === true;
        progress = {
          version: 2, stepIndex: oracleStepIndex, code: ranCode,
          names: q.names, options: traceOptions,
          cursor: 0, phase: "next-line",
          committed: [], pristine: !carriedMiss,
          usedReveal: carriedMiss && progress?.usedReveal === true,
          outcomeCounted: carriedOutcome,
          lineMisses: carriedMiss ? (progress?.lineMisses ?? 0) : 0,
          effectMisses: carriedMiss ? (progress?.effectMisses ?? 0) : 0,
          currentLineMisses: 0, currentEffectMisses: 0,
          currentRevealed: false,
          draftNext: null, draftEffects: null,
        };
        store.activeTrace = progress;
        persist();
      }

      let view = null;
      const card = ui.addInteractiveCard({
        teach: ask.teach, context: ask.context, form: ask.form ?? "trace-table",
        prompt: ask.prompt ?? q.prompt,
        program: false,
        render: (body) => { view = renderTraceSimulation(body, q); return view; },
        actions: [],
        prog: store.currentProg,
      });
      ui.popBatch(batch, card);
      batch = [];

      const save = () => { store.activeTrace = progress; persist(); };
      const countFirstMiss = () => {
        if (progress.outcomeCounted) return;
        progress.outcomeCounted = true;
        store.lastAnswer = "wrong";
        countAskOutcome({
          ok: false, lastAnswer: "wrong",
          template: ask.template, concept: ask.concept,
          kind: "trace-simulation",
        });
      };
      const showPhase = () => {
        view.setCommitted(progress.committed);
        if (progress.phase === "effects") view.showEffects(progress.cursor, progress.draftEffects);
        else view.showNext(progress.cursor, progress.draftNext);
      };
      const answerMissing = (answer) => {
        for (const value of Object.values(answer?.bindings?.changed ?? {})) {
          if (!String(value ?? "").trim()) return "Give every changed name its new value";
        }
        if (answer?.output?.writes && !String(answer.output.text ?? "").length) {
          return "Type the exact output from this line";
        }
        if (Object.hasOwn(answer ?? {}, "returnValue") && !String(answer.returnValue ?? "").trim()) {
          return "Give the value this line returns";
        }
        return null;
      };
      const finishTrace = ({ terminalRevealed = false } = {}) => {
        const terminal = q.revealNext(progress.cursor);
        progress.committed.push({
          next: terminal, effects: null,
          revealed: terminalRevealed,
          corrected: progress.currentLineMisses > 0 && !terminalRevealed,
        });
        const ok = progress.pristine;
        const independentlySolved = !ok && !progress.usedReveal;
        const tries = progress.lineMisses + progress.effectMisses;
        view.setCommitted(progress.committed);
        view.freeze();
        delete store.activeTrace;
        persist();
        const metTag = ask.focus ?? ask.concept;
        if (ok && metTag) {
          if (grantMet(metTag, ask.focus ? "lesson" : "drill")) {
            (store.roundMet ??= []).push(metTag);
            persist();
          }
        }
        resolveAsk(card, {
          prompt: ask.prompt ?? q.prompt,
          ok,
          verdict: ok
            ? "✓ You built the whole trace!"
            : progress.usedReveal
              ? "Trace complete - your first miss still counts"
              : "✓ Trace complete after retry - your first miss still counts",
          answerText: `${progress.committed.length - 1} executed lines`,
          lastAnswer: ok ? "correct" : "wrong",
          template: ask.template, concept: ask.concept, kind: "trace-simulation",
          misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
          settled: true,
          outcomeCounted: progress.outcomeCounted === true,
          ...(independentlySolved ? { retry: { ok: true, tries, answer: "completed trace" } } : {}),
          review: {
            kind: "trace-simulation", form: ask.form, code: ranCode,
            opts: { names: ask.probeNames, maxEvents: ask.maxEvents },
            trace: { committed: progress.committed, names: q.names },
            teach: ask.teach, context: ask.context,
          },
        });
      };
      const commitEffects = ({ revealed = false } = {}) => {
        const next = q.revealNext(progress.cursor);
        const effects = q.revealEffects(progress.cursor);
        const stepRevealed = revealed || progress.currentRevealed === true;
        progress.committed.push({
          next, effects, revealed: stepRevealed,
          corrected: (progress.currentLineMisses + progress.currentEffectMisses) > 0 && !stepRevealed,
        });
        progress.cursor += 1;
        progress.phase = "next-line";
        progress.draftNext = null;
        progress.draftEffects = null;
        progress.currentLineMisses = 0;
        progress.currentEffectMisses = 0;
        progress.currentRevealed = false;
        card.setNote("");
        save();
        showPhase();
        arm();
      };
      const checkNext = (provided) => {
        const answer = provided ?? view.collectNext();
        if (!answer) { card.setNote("Choose the line that executes next"); return; }
        progress.draftNext = answer;
        const result = q.gradeNext(progress.cursor, answer);
        if (!result.correct) {
          progress.pristine = false;
          progress.lineMisses += 1;
          progress.currentLineMisses += 1;
          countFirstMiss();
          save();
          card.setNote("That line does not execute next - try again or reveal this phase");
          return;
        }
        if (answer.kind === "end") { finishTrace(); return; }
        progress.phase = "effects";
        progress.draftNext = result.expected;
        progress.draftEffects = null;
        card.setNote("");
        save();
        showPhase();
        arm();
      };
      const checkEffects = (provided) => {
        const answer = provided ?? view.collectEffects();
        const missing = answerMissing(answer);
        if (missing) { card.setNote(missing); return; }
        progress.draftEffects = answer;
        const result = q.gradeEffects(progress.cursor, answer);
        if (!result.correct) {
          progress.pristine = false;
          progress.effectMisses += 1;
          progress.currentEffectMisses += 1;
          countFirstMiss();
          save();
          card.setNote("Something in this step's effects is not right - try again or reveal this phase");
          return;
        }
        commitEffects();
      };
      const revealPhase = () => {
        progress.pristine = false;
        progress.usedReveal = true;
        progress.currentRevealed = true;
        countFirstMiss();
        card.setNote("");
        if (progress.phase === "next-line") {
          const expected = q.revealNext(progress.cursor);
          progress.draftNext = expected;
          if (expected.kind === "end") { finishTrace({ terminalRevealed: true }); return; }
          progress.phase = "effects";
          progress.draftEffects = null;
          save();
          showPhase();
          arm();
          return;
        }
        progress.draftEffects = q.revealEffects(progress.cursor);
        save();
        commitEffects({ revealed: true });
      };
      const skip = () => {
        const partial = [...progress.committed];
        delete store.activeTrace;
        persist();
        resolveAsk(card, {
          prompt: ask.prompt ?? q.prompt, ok: false, verdict: "skipped",
          answerText: `${partial.length} trace steps completed`,
          lastAnswer: "skipped", template: ask.template, concept: ask.concept,
          kind: "trace-simulation", settled: true,
          outcomeCounted: progress.outcomeCounted === true,
          misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
          review: {
            kind: "trace-simulation", form: ask.form, code: ranCode,
            opts: { names: ask.probeNames, maxEvents: ask.maxEvents },
            trace: { committed: partial, names: q.names },
            teach: ask.teach, context: ask.context,
          },
        });
      };
      function arm() {
        const effects = progress.phase === "effects";
        card.setActions([
          {
            label: effects ? "Check this step ▶" : "Check next line ▶",
            primary: true,
            onClick: () => effects ? checkEffects() : checkNext(),
          },
          { label: effects ? "Reveal effects" : "Reveal next line", onClick: revealPhase },
          { label: "Skip this exercise", onClick: skip },
        ]);
        setWaiting({
          type: "ask", kind: "trace-simulation",
          submit: (answer) => progress.phase === "effects" ? checkEffects(answer) : checkNext(answer),
          reveal: revealPhase, skip,
        });
      }

      showPhase();
      arm();
    })();
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
        ? generateQuestion("trace-table", ctx(), {
          names: ask.probeNames, maxBlanks: ask.maxBlanks, frames: ask.frames === true,
        })
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
        opts: { names: ask.probeNames, maxBlanks: ask.maxBlanks, frames: ask.frames === true },
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
        if (result.correct || !store.drillLesson) view.applyResult(result);
        const nTotal = q.blanks.length;
        const nRight = q.blanks.filter((b) => result.perBlank[b.id]).length;
        if (result.correct || !store.drillLesson) {
          card.reveal?.({ text: `${nRight} of ${nTotal} steps right`, correct: result.correct, kind: "trace-table" });
        }
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
          misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
          review: { ...baseReview(), table: { rows: q.rows, expectedById, perBlank: result.perBlank }, answersById: answers },
        });
      };
      const doSkip = () => resolveAsk(card, {
        prompt: ask.prompt ?? q.prompt, ok: false, verdict: "skipped",
        lastAnswer: "skipped", template: ask.template, concept: ask.concept, kind: "trace-table",
          misconceptionOf: ask.misconceptionOf, followUp: ask.followUp,
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
    const origin = store.origin; // map-launched rounds return to the map
    waiting?.off?.();
    waiting = null;
    restoreLearnerCode();
    events.emit("lesson-ended", { lessonId: lesson?.id, reason });
    lesson = null;
    stepIndex = -1;
    batch = [];
    store = {};
    persist();
    practiceUI?.discardRoundStash?.(); // the old round can no longer resume
    // A replacement start renders its own view next — no menu flash, and
    // no stray history entry between the old round and the new one.
    if (reason === "replaced") return;
    if (endlessSummary) {
      setSurface("practice");
      practiceView = "round"; // the run summary still belongs to the round
      ui.clear();
      ui.setLeaveLabel("Topics", "Return to practice topics");
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
    if (origin === "map") { showMap(); return; }
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
        templateStats: loadTemplateStats(),
        misconceptions: loadMcStore(), // reserved follow-up slot (R1.1)
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
    practiceUI?.discardRoundStash?.();
    lesson = unit.lesson;
    stepIndex = -1;
    batch = [];
    store = { lessonId: unitId, resumeIndex: 0, cards: [] };
    persist();
    ui.clear();
    ui.setControls([]);
    ui.setExitVisible(true);
    ui.show();
    nav.go("lesson");
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
    const requestedCount = opts.count ?? loadPracticeCount();
    const built = buildKBSession(topic, {
      seed: opts.seed ?? (Date.now() >>> 0),
      count: requestedCount,
      stats: loadDrillStats(),
      met: Object.keys(loadMetStore()), // feeds the cold-start frontier bias
      templateStats: loadTemplateStats(), // retires already-solved templates
      misconceptions: loadMcStore(), // reserved follow-up slot (R1.1)
      focus: opts.focus, // targeted practice: one concept's own exercises
    });
    if (!built) throw new Error(`unknown drill topic: ${topic}`);
    const errors = lintLesson(built);
    if (errors.length) throw new Error(`drill ${topic} failed lint:\n${errors.join("\n")}`);
    if (lesson) endLesson("replaced");
    practiceUI?.discardRoundStash?.();
    lesson = built;
    stepIndex = -1;
    batch = [];
    practiceView = "round";
    const actualCount = built.steps.filter((s) => s.ask).length;
    const roundNotice = opts.focus && actualCount < requestedCount
      ? `This concept currently has ${actualCount} varied practice ${actualCount === 1 ? "problem" : "problems"}, so this round is shorter than your ${requestedCount}-problem preference.`
      : "";
    store = {
      lessonId: built.id, drillLesson: built, resumeIndex: 0, cards: [],
      score: { answered: 0, right: 0, streak: 0, best: 0 },
      ...(roundNotice ? { roundNotice } : {}),
      ...(opts.endless ? { endless: true, drillTopic: topic, endlessCount: requestedCount, chunkBase: 0 } : {}),
      ...(opts.origin ? { origin: opts.origin } : {}),
    };
    persist();
    ui.clear();
    ui.setLeaveLabel("Topics", "Save this round and return to practice topics");
    ui.setRoundNotice(roundNotice);
    ui.setControls([]);
    ui.setExitVisible(true);
    ui.show();
    nav.go("learn/round");
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
    if (store.drillLesson) practiceView = "round";
    showIfVisible();
    lesson = restored;
    batch = [];
    ui.clear();
    if (store.drillLesson) {
      ui.setLeaveLabel("Topics", "Save this round and return to practice topics");
      ui.setRoundNotice(store.roundNotice ?? "");
    }
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
  function reviewQuestion(i, { correction = false } = {}) {
    const rec = frozenRecords()[i];
    if (!rec) return null;
    const r = rec.review ?? {};
    // Old records predate learner-controlled disclosure and keep their
    // historical revealed review. New misses opt in to the hidden state.
    const revealed = rec.disclosure !== "hidden";
    // fix-the-bug shows the BUGGY program in its line picker (with the picked
    // line marked), so it wants no separate program block and no "___" — the
    // program was never holed.
    const displayCode = r.form === "fix-the-bug" ? null
      : r.kind === "fill-one-blank" && r.blank
        ? spliceBlank(r.code, r.blank, "___")
      // order-the-lines shows the ARRANGEMENT widget instead of a program
      // block — the arrangement is the answer, and the code is the same lines.
      // predict-the-error shows the numbered line picker instead of a plain
      // program block — same reason: the widget IS the program.
      : ["order-the-lines", "predict-the-error"].includes(r.kind) ? null : r.code;
    const table = r.table?.rows ? {
      rows: r.table.rows,
      ...(revealed ? {
        expectedById: r.table.expectedById,
        perBlank: r.table.perBlank,
      } : {}),
    } : undefined;
    let answerReveal = null;
    if (revealed && r.kind === "fill-one-blank" && r.blank?.target != null) {
      answerReveal = {
        label: r.form === "fix-the-bug"
          ? `One fix that works - line ${r.blank.line}`
          : "One answer that works",
        text: r.blank.target,
      };
    } else if (revealed && r.kind === "order-the-lines" && r.canonical?.length) {
      answerReveal = { label: "One order that works", text: r.canonical.join("\n") };
    }
    practiceUI.showReview?.({
      index: i,
      prompt: rec.prompt, ok: rec.ok, verdict: rec.verdict,
      answerText: rec.answerText, retry: rec.retry,
      kind: r.kind, form: r.form, code: displayCode,
      expectedText: revealed ? r.expectedText : undefined,
      expectedGone: revealed ? r.expectedGone : undefined,
      answerReveal,
      table, answersById: r.answersById, revealed,
      trace: r.trace,
      items: r.items, answerOrder: r.answerOrder, canonical: r.canonical,
      picked: r.picked, actual: revealed ? r.actual : undefined,
      pickerCode: r.kind === "predict-the-error" || r.form === "fix-the-bug" ? r.code : undefined,
      teach: r.teach, context: r.context, stdinScript: r.stdinScript,
      multiline: r.multiline === true, // retry widget matches the live one
      // Single-answer kinds get the single-input widget; trace-table gets
      // a fresh blank table (the UI branches on kind — retryAnswer takes a
      // text string or an answersById map accordingly).
      // Revealed and legacy records may still be retried for practice, but
      // the first-attempt score remains immutable.
      onRetry: r.code && r.kind !== "trace-simulation" && !rec.retry?.ok
        ? (answer) => retryAndRefresh(rec, answer, { correction })
        : null,
      onReveal: !revealed && !rec.retry?.ok ? () => revealRecord(rec, { correction }) : null,
      onNext: correction ? () => finishCorrection(rec) : null,
      correction,
      onBack: () => practiceUI.closeReview?.(),
    });
    return rec;
  }

  function showPendingCorrection(rec) {
    const i = frozenRecords().indexOf(rec);
    if (i < 0) return false;
    setWaiting({
      type: "correction",
      kind: rec.review?.kind,
      retry: (answer) => retryAndRefresh(rec, answer, { correction: true }),
      reveal: () => revealRecord(rec, { correction: true }),
      next: () => finishCorrection(rec),
    });
    reviewQuestion(i, { correction: true });
    return true;
  }

  async function retryAndRefresh(rec, answer, { correction = false } = {}) {
    const result = await retryAnswer(rec, answer);
    if (result?.ok && correction) {
      const i = frozenRecords().indexOf(rec);
      if (i >= 0) reviewQuestion(i, { correction });
    }
    return result;
  }

  function restorePendingCorrection() {
    const pending = store.pendingCorrection;
    const rec = (store.cards ?? [])[pending?.cardIndex];
    if (rec?.type === "question-frozen") return showPendingCorrection(rec);
    // Corrupt or partial old state must never disclose an answer or re-score
    // the ask. Move on as an unrevealed miss instead of trapping the round.
    delete store.pendingCorrection;
    store.lastAnswer = "wrong-unrevealed";
    store.resumeIndex = stepIndex + 1;
    persist();
    return false;
  }

  function revealRecord(rec, { correction = false } = {}) {
    if (!rec || rec.disclosure !== "hidden") return rec;
    rec.disclosure = "revealed";
    persist();
    const i = frozenRecords().indexOf(rec);
    if (i >= 0) reviewQuestion(i, { correction });
    return rec;
  }

  function finishCorrection(rec) {
    const pending = store.pendingCorrection;
    if (!pending || (store.cards ?? [])[pending.cardIndex] !== rec) return false;
    const understood = rec.disclosure === "revealed" || rec.retry?.ok === true;
    delete store.pendingCorrection;
    // `wrong-unrevealed` intentionally does not match the compiled
    // variant-card condition. A solved or explicitly revealed miss may show
    // that explanation safely, while an unrevealed Next goes straight on.
    store.lastAnswer = understood ? "wrong" : "wrong-unrevealed";
    persist();
    practiceUI.closeReview?.();
    resume();
    return true;
  }

  function saveRetry(rec, answer, ok) {
    rec.retry = { ok, tries: (rec.retry?.tries ?? 0) + 1, answer };
    persist();
    pushProgress();
    return { ok };
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
        return saveRetry(rec, text, res.correct);
      } finally {
        editor.setValue(before);
      }
    }
    if (r.kind === "predict-the-error") {
      // `text` is a { line, type } pick here (the retry widget's collect()).
      // The same program is re-run — deterministic, so the crash site is the
      // same — and re-graded against the real terminal exception.
      if (!text || typeof text !== "object" || !text.line || !text.type) return null;
      const before = editor.getValue();
      try {
        editor.setValue(r.code);
        const summary = await actions.trace();
        if (!summary) return null; // a run is live — the retry never happened
        const ex = summary.terminal_reason === "uncaught_exception" ? actions.lastException?.() : null;
        if (!ex || !ex.location) return null;
        const actual = { type: ex.type_name, line: ex.location.line, message: ex.safe_message ?? "" };
        const lineOk = text.line === actual.line;
        const typeOk = text.type === actual.type;
        const ok = lineOk && typeOk;
        return saveRetry(rec, text, ok);
      } finally {
        editor.setValue(before);
      }
    }
    // predict-io: the SAME script re-answers the SAME program, so the retry
    // is deterministic — and the escape hatch is the same one the first
    // attempt had (an out-asked script interrupts and grades nothing).
    if (r.kind === "predict-io") {
      if (typeof text !== "string" || !text.trim()) return null;
      const before = editor.getValue();
      try {
        editor.setValue(r.code);
        const res = await actions.traceWithScript?.(r.stdinScript ?? []);
        if (!res?.summary) return null; // a run is live — the retry never happened
        if (res.exhausted || res.summary.terminal_reason !== "completed") return null;
        const c = ctx();
        const expectedText = c.consoleText;
        const got = normalizeOutput(text);
        const ok = got === normalizeOutput(expectedText) || got === normalizeOutput(c.consoleTextNoEcho);
        if (r.expectedText === undefined) r.expectedText = expectedText;
        return saveRetry(rec, text, ok);
      } finally {
        editor.setValue(before);
      }
    }
    if (r.kind === "order-the-lines") {
      // `text` is an ARRAY of item ids here (the retry widget's collect()),
      // mirroring the trace-table branch's answersById map: the arrangement
      // is joined and executed, exactly like the first attempt.
      if (!Array.isArray(text) || !text.length) return null;
      const byId = new Map((r.items ?? []).map((it) => [it.id, it.text]));
      const arranged = text.map((id) => byId.get(id) ?? "").join("\n") + "\n";
      const before = editor.getValue();
      try {
        editor.setValue(arranged);
        const summary = await actions.trace();
        if (!summary) return null; // a run is live — the retry never happened
        const q = summary.terminal_reason === "completed" ? generateQuestion("predict-output", ctx(), {}) : null;
        const ok = Boolean(q && q.grade({ text: r.targetOutput }).correct);
        const expectedText = q ? q.grade({ text: "" }).expected.text : "";
        return saveRetry(rec, text, ok);
      } finally {
        editor.setValue(before);
      }
    }
    // fix-the-bug retries as a PAIR — { line, text } — re-picking the line and
    // re-writing the fix, then re-running exactly like the first attempt.
    const fixRetry = r.form === "fix-the-bug" && text && typeof text === "object";
    if (fixRetry && (!text.line || !String(text.text ?? "").trim())) return null;
    if (!fixRetry && !text?.trim()) return null;
    const before = editor.getValue(); // the live round's program — must survive
    try {
      let ok, expectedText;
      if (r.kind === "fill-one-blank") {
        const blank = fixRetry ? lineBlank(r.code, text.line) : r.blank;
        editor.setValue(spliceBlank(r.code, blank, fixRetry ? text.text : text));
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
      // A skipped question never ran, so its record had no answer to show —
      // the retry's real run fills it in for future reviews.
      if (r.expectedText === undefined && expectedText !== undefined) r.expectedText = expectedText;
      return saveRetry(rec, text, ok);
    } finally {
      editor.setValue(before);
    }
  }

  // Config hooks register on BOTH surfaces (whichever is active later must
  // have its exit/try-it/review wiring in place).
  for (const s of new Set(Object.values(surfaces))) {
    s.setOnExit(() => endLesson("exited"));
    s.setOnReview?.((i) => reviewQuestion(i));
    s.setOnBack?.(() => goUp());
    // World-switch links (open in editor / see it in the memory model)
    // already hid the surface; recording the hop makes Back return to the card.
    s.setOnLeaveToIDE?.(() => nav.go("code"));
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
    mcStats: loadMcStore,        // tag → {hits, at} (misconception follow-ups, R1.1)
    met: loadMetStore,           // tag → {at, source} (lesson-kb-binding §5)
    frontier: () => frontierTags(Object.keys(loadMetStore())),
    progress: () => topicProgress(Object.keys(loadMetStore())),
    mapModel: () => mapModel(Object.keys(loadMetStore())),
    showMap,
    exit: () => { if (lesson) endLesson("exited"); },
    // Surface visibility (the header world switch and the collab go-live
    // hook). Hiding never ends a round — it stays resumable from the store.
    hideSurface: () => { cur().hide?.(); nav.go("code"); },
    toggleSurface() {
      if (layoutVisible()) { cur().hide?.(); nav.go("code"); return false; }
      cur().show?.();
      // Re-entering the stage surface must restore its focus layout.
      if (surface === "stage") actions.enterFocus?.();
      nav.go(currentRoute());
      return true;
    },
    // Hash-route plumbing (main.mjs): popstate application + route readout.
    applyRoute,
    currentRoute,
    isGuidedActive: () => Boolean(lesson && !store.drillLesson),
    resumeRound,
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
    correction: () => (waiting?.type === "correction"
      ? { kind: waiting.kind, revealed: store.pendingCorrection
        ? (store.cards ?? [])[store.pendingCorrection.cardIndex]?.disclosure === "revealed"
        : false }
      : null),
    review: (i) => reviewQuestion(i),
    retry: (i, text) => { const rec = frozenRecords()[i]; return rec ? retryAnswer(rec, text) : null; },
    retryCurrent: (answer) => waiting?.retry?.(answer),
    revealAnswer: () => waiting?.reveal?.(),
    next: () => waiting?.next?.(),
    closeReview: () => practiceUI.closeReview?.(),
    submit: (answers) => waiting?.submit?.(answers),
    lockPrediction: (text) => waiting?.lock?.(text),
    skip: () => waiting?.skip?.(),
    lintLesson,
  };
}
