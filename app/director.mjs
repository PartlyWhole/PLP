// The director: a lesson runtime over the stage, the event bus, and the
// condition library. It arranges each beat, waits for LEARNER-driven
// triggers, schedules behavior-triggered hints, tracks fluency signals,
// and branches. It contains no pedagogy: pacing, wording, and structure
// live in human-authored lesson data (see app/DIRECTOR.md for the
// authoring grammar; design/director-plan.md for principles P1–P9).
//
// Safety contract (P9): skip/exit always available; any internal error
// tears down to free play; stage.reset() runs on every exit path.

import { events } from "./events.mjs";
import { CUE_MOTIONS, isValidTargetSpec } from "./stage.mjs";
import { isValidCheck, evaluateCheck } from "./conditions.mjs";

const ACTION_KEYS = new Set(["set", "gate", "veil", "unveil", "spotlight", "cue", "pulse", "popover", "say", "quiz", "clear"]);
const LEARNER_EVENTS = new Set([
  "run-started", "run-ended", "run-rejected", "input-answered", "interrupt-requested",
  "edited", "scrubbed", "hover-name", "chip-clicked", "mode-changed",
  "quiz-question", "quiz-graded",
]);
const SIGNALS = new Set(["attempts", "hintsShown", "quizTries", "elapsedMs"]);
const STORE_KEY = "plp.director";

// ---- lesson linting (load-time; unknown vocabulary fails loudly) ----------
export function lintLesson(lesson) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!lesson?.id) err("lesson.id required");
  if (!Array.isArray(lesson?.beats) || !lesson.beats.length) { err("beats[] required"); return errors; }
  const ids = new Set();
  for (const b of lesson.beats) {
    if (!b.id) { err("every beat needs an id"); continue; }
    if (ids.has(b.id)) err(`duplicate beat id: ${b.id}`);
    ids.add(b.id);
  }
  const checkTargetish = (spec, where) => {
    if (!isValidTargetSpec(spec)) err(`${where}: invalid target ${JSON.stringify(spec)}`);
  };
  const checkAvoid = (specs, where) => {
    if (specs === undefined) return;
    if (!Array.isArray(specs)) { err(`${where}: avoid must be an array`); return; }
    specs.forEach((spec, i) => checkTargetish(spec, `${where}[${i}]`));
  };
  const checkTrigger = (spec, where, allowIdle, allowDwell = false) => {
    if (!spec || typeof spec !== "object") { err(`${where}: trigger must be an object`); return; }
    if (spec.all) { spec.all.forEach((s, i) => checkTrigger(s, `${where}.all[${i}]`, allowIdle, allowDwell)); return; }
    if (spec.any) { spec.any.forEach((s, i) => checkTrigger(s, `${where}.any[${i}]`, allowIdle, allowDwell)); return; }
    if (spec.event !== undefined) {
      if (!LEARNER_EVENTS.has(spec.event)) err(`${where}: unknown/non-learner event "${spec.event}"`);
      if (spec.dwellMs !== undefined) {
        if (!allowDwell) err(`${where}: dwellMs is until-only`);
        if (spec.event !== "hover-name") err(`${where}: dwellMs requires event "hover-name"`);
        if (!Number.isFinite(spec.dwellMs) || spec.dwellMs <= 0) err(`${where}: dwellMs must be positive`);
      }
      return;
    }
    if (spec.check !== undefined) {
      if (!isValidCheck(spec.check)) err(`${where}: unknown condition "${spec.check}"`);
      return;
    }
    if (spec.signal !== undefined) {
      if (!SIGNALS.has(spec.signal)) err(`${where}: unknown signal "${spec.signal}"`);
      if (spec.gte === undefined && spec.lte === undefined) err(`${where}: signal needs gte/lte`);
      return;
    }
    if (spec.idleMs !== undefined) {
      if (!allowIdle) err(`${where}: idleMs is hint-only (until must be learner-driven)`);
      return;
    }
    err(`${where}: unrecognized trigger ${JSON.stringify(spec)}`);
  };
  lesson.beats.forEach((b, bi) => {
    const w = `beat "${b.id ?? bi}"`;
    for (const a of b.do ?? []) {
      const keys = Object.keys(a).filter((k) => k !== "dim" && k !== "value");
      if (!keys.some((k) => ACTION_KEYS.has(k))) err(`${w}: unknown action ${JSON.stringify(a)}`);
      if (a.spotlight) checkTargetish(a.spotlight, `${w}.spotlight`);
      if (a.pulse) checkTargetish(a.pulse, `${w}.pulse`);
      if (a.cue) {
        checkTargetish(a.cue.at, `${w}.cue.at`);
        if (a.cue.motion !== undefined && !CUE_MOTIONS.includes(a.cue.motion)) {
          err(`${w}.cue.motion: unknown motion ${JSON.stringify(a.cue.motion)}`);
        }
      }
      if (a.veil) checkTargetish(a.veil, `${w}.veil`);
      if (a.unveil) checkTargetish(a.unveil, `${w}.unveil`);
      if (a.popover) {
        checkTargetish(a.popover.at, `${w}.popover.at`);
        checkAvoid(a.popover.avoid, `${w}.popover.avoid`);
      }
      if (a.say) {
        checkTargetish(a.say.at, `${w}.say.at`);
        checkAvoid(a.say.avoid, `${w}.say.avoid`);
        if (!a.say.md) err(`${w}.say.md required`);
      }
      if (a.set && a.set !== "code") err(`${w}: unknown set "${a.set}"`);
    }
    if (b.until) checkTrigger(b.until, `${w}.until`, false, true);
    else if (bi < lesson.beats.length - 1) err(`${w}: only the final beat may omit "until"`);
    for (const [hi, h] of (b.hints ?? []).entries()) {
      checkTrigger(h.when, `${w}.hints[${hi}].when`, true);
      if (!h.say && !h.popover?.md) err(`${w}.hints[${hi}]: popover.md required`);
      if (h.say && !h.say.md) err(`${w}.hints[${hi}]: say.md required`);
      if (h.popover) {
        checkTargetish(h.popover.at, `${w}.hints[${hi}].popover.at`);
        checkAvoid(h.popover.avoid, `${w}.hints[${hi}].popover.avoid`);
      }
      if (h.say) {
        checkTargetish(h.say.at, `${w}.hints[${hi}].say.at`);
        checkAvoid(h.say.avoid, `${w}.hints[${hi}].say.avoid`);
      }
    }
    const nexts = Array.isArray(b.next) ? b.next : b.next ? [b.next] : [];
    for (const n of nexts) {
      const ref = typeof n === "string" ? n : n.then;
      if (ref && !ids.has(ref)) err(`${w}: next -> unknown beat "${ref}"`);
      if (typeof n === "object" && n.if) checkTrigger(n.if, `${w}.next.if`, false);
    }
  });
  return errors;
}

export function createDirector({ stage, app, timers = {} }) {
  const T = {
    set: timers.set ?? ((fn, ms) => setTimeout(fn, ms)),
    clear: timers.clear ?? ((id) => clearTimeout(id)),
    now: timers.now ?? (() => performance.now()),
  };

  let lesson = null;
  let beatIndex = -1;
  let beat = null;
  let signals = null;
  let beatEnteredAt = 0;
  let matched = null; // Set of event-pattern leaves matched during this beat
  let hintState = null; // per-hint { shown, timerId }
  const dwellTimers = new Map(); // trigger leaf -> timerId
  let unsub = null;
  let advancing = false;
  const telemetry = loadStore().telemetry ?? [];

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
  }
  function saveStore(patch) {
    try {
      const s = { ...loadStore(), ...patch };
      s.telemetry = telemetry.slice(-500);
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch { /* private mode */ }
  }

  // ---- lesson strip UI (dots + skip/exit; always visible during a lesson) --
  const strip = document.createElement("div");
  strip.className = "director-strip";
  strip.hidden = true;
  strip.innerHTML = `<span class="title"></span><span class="dots"></span>
    <button data-role="dir-skip" type="button" title="Skip this step">skip</button>
    <button data-role="dir-exit" type="button" title="Leave the lesson">exit</button>`;
  document.body.appendChild(strip);
  strip.querySelector("[data-role=dir-skip]").addEventListener("click", () => skip());
  strip.querySelector("[data-role=dir-exit]").addEventListener("click", () => exit("user"));

  function renderStrip() {
    strip.hidden = !lesson;
    if (!lesson) return;
    strip.querySelector(".title").textContent = lesson.title ?? lesson.id;
    const dots = strip.querySelector(".dots");
    dots.textContent = "";
    lesson.beats.forEach((_, i) => {
      const d = document.createElement("span");
      d.className = "dot" + (i < beatIndex ? " done" : i === beatIndex ? " now" : "");
      dots.appendChild(d);
    });
  }

  // ---- trigger evaluation --------------------------------------------------
  function matchEvent(pattern, e) {
    if (!e || pattern.event !== e.type) return false;
    for (const [k, v] of Object.entries(pattern)) {
      if (k === "event" || k === "dwellMs") continue;
      if (e[k] !== v) return false;
    }
    return true;
  }

  function signalSatisfied(spec) {
    const v = spec.signal === "elapsedMs" ? T.now() - beatEnteredAt : signals[spec.signal];
    if (spec.gte !== undefined && !(v >= spec.gte)) return false;
    if (spec.lte !== undefined && !(v <= spec.lte)) return false;
    return true;
  }

  function satisfied(spec, e) {
    if (spec.all) return spec.all.every((s) => satisfied(s, e));
    if (spec.any) return spec.any.some((s) => satisfied(s, e));
    if (spec.event !== undefined) {
      if (spec.dwellMs !== undefined) return matched.has(spec);
      if (matchEvent(spec, e)) { matched.add(spec); return true; }
      return matched.has(spec);
    }
    if (spec.check !== undefined) return evaluateCheck(spec, app);
    if (spec.signal !== undefined) return signalSatisfied(spec);
    return false;
  }

  function updateDwellTriggers(spec, e) {
    if (!spec) return;
    if (spec.all) { spec.all.forEach((s) => updateDwellTriggers(s, e)); return; }
    if (spec.any) { spec.any.forEach((s) => updateDwellTriggers(s, e)); return; }
    if (spec.event !== "hover-name" || spec.dwellMs === undefined || !matchEvent(spec, e)) return;
    const existing = dwellTimers.get(spec);
    if (e.active === false) {
      if (existing) T.clear(existing);
      dwellTimers.delete(spec);
      return;
    }
    if (existing || matched.has(spec)) return;
    const scheduledBeat = beat;
    const timerId = T.set(() => {
      dwellTimers.delete(spec);
      if (!lesson || beat !== scheduledBeat) return;
      matched.add(spec);
      try {
        if (beat.until && satisfied(beat.until, null)) advance("trigger");
      } catch (err) {
        console.error("director: dwell trigger evaluation failed:", err);
        exit("error");
      }
    }, spec.dwellMs);
    dwellTimers.set(spec, timerId);
  }

  // ---- hints (P4: responses to behavior, never a schedule) -----------------
  function armHints() {
    hintState = (beat.hints ?? []).map(() => ({ shown: 0, timerId: null }));
    resetIdleTimers();
  }

  function resetIdleTimers() {
    (beat.hints ?? []).forEach((h, i) => {
      const st = hintState[i];
      if (h.when?.idleMs === undefined) return;
      if (st.timerId) T.clear(st.timerId);
      if (h.once !== false && st.shown) return;
      st.timerId = T.set(() => showHint(h, i), h.when.idleMs);
    });
  }

  function showHint(h, i) {
    const st = hintState[i];
    if (h.once !== false && st.shown) return;
    st.shown += 1;
    signals.hintsShown += 1;
    if (h.say) stage.say(h.say.at ?? "memory", h.say.md, { kind: "hint", avoid: h.say.avoid ?? [] });
    else stage.popover(h.popover.at ?? "memory", h.popover.md, { kind: "hint", avoid: h.popover.avoid ?? [] });
    events.emit("lesson-hint", { lesson: lesson.id, beat: beat.id, hint: i });
  }

  function checkEventHints(e) {
    (beat.hints ?? []).forEach((h, i) => {
      if (h.when?.idleMs !== undefined) return;
      const w = h.when ?? {};
      const hit = w.event !== undefined ? matchEvent(w, e)
        : w.signal !== undefined ? signalSatisfied(w)
        : w.check !== undefined ? evaluateCheck(w, app)
        : false;
      if (hit) showHint(h, i);
    });
  }

  // ---- beat lifecycle ------------------------------------------------------
  function applyAction(a) {
    if (a.set === "code") { app.editor.setValue(a.value); return; }
    if (a.gate) { stage.gate(a.gate); return; }
    if (a.veil) { stage.veil(a.veil); return; }
    if (a.unveil) { stage.unveil(a.unveil); return; }
    if (a.spotlight) { stage.spotlight(a.spotlight, { dim: a.dim ?? true }); return; }
    if (a.cue) { stage.cue(a.cue.at, { motion: a.cue.motion ?? "pulse" }); return; }
    if (a.pulse) { stage.pulse(a.pulse); return; }
    if (a.popover) {
      stage.popover(a.popover.at, a.popover.md, {
        sticky: a.popover.sticky ?? true,
        onWhy: beat.why ? () => beat.why : null,
        avoid: a.popover.avoid ?? [],
      });
      return;
    }
    if (a.say) {
      stage.say(a.say.at, a.say.md, {
        sticky: a.say.sticky ?? true,
        onWhy: beat.why ? () => beat.why : null,
        avoid: a.say.avoid ?? [],
      });
      return;
    }
    if (a.quiz) { app.quiz.open(); app.quiz.newQuestion(a.quiz.kind, a.quiz.opts ?? {}); return; }
    if (a.clear === "effects") { stage.clearEffects(); return; }
    throw new Error(`unknown action ${JSON.stringify(a)}`);
  }

  function enterBeat(i) {
    beatIndex = i;
    beat = lesson.beats[i];
    signals = { attempts: 0, hintsShown: 0, quizTries: 0 };
    matched = new Set();
    beatEnteredAt = T.now();
    stage.clearEffects();
    try {
      for (const a of beat.do ?? []) applyAction(a);
    } catch (err) {
      console.error(`director: beat "${beat.id}" failed to stage:`, err);
      exit("error");
      return;
    }
    armHints();
    renderStrip();
    events.emit("lesson-beat", { lesson: lesson.id, beat: beat.id, index: i });
  }

  function recordTelemetry(how) {
    telemetry.push({
      lesson: lesson.id, beat: beat.id, how,
      elapsedMs: Math.round(T.now() - beatEnteredAt),
      attempts: signals.attempts, hintsShown: signals.hintsShown, quizTries: signals.quizTries,
    });
    saveStore({});
  }

  function resolveNext() {
    const nexts = Array.isArray(beat.next) ? beat.next : beat.next ? [beat.next] : [];
    for (const n of nexts) {
      if (typeof n === "string") return n;
      if (n.if && satisfied(n.if, null)) return n.then;
      if (!n.if) return n.then;
    }
    return lesson.beats[beatIndex + 1]?.id ?? null;
  }

  function advance(how = "trigger") {
    if (advancing) return;
    advancing = true;
    try {
      recordTelemetry(how);
      clearHintTimers();
      clearDwellTimers();
      const nextId = resolveNext();
      if (nextId === null) { complete(); return; }
      const idx = lesson.beats.findIndex((b) => b.id === nextId);
      if (idx === -1) { console.error(`director: unknown next beat ${nextId}`); exit("error"); return; }
      enterBeat(idx);
    } finally {
      advancing = false;
    }
  }

  function clearHintTimers() {
    for (const st of hintState ?? []) if (st.timerId) T.clear(st.timerId);
  }

  function clearDwellTimers() {
    for (const timerId of dwellTimers.values()) T.clear(timerId);
    dwellTimers.clear();
  }

  function onEvent(e) {
    if (!lesson || !beat || !LEARNER_EVENTS.has(e.type)) return;
    if (e.type === "run-ended") signals.attempts += 1;
    if (e.type === "quiz-graded") signals.quizTries += 1;
    resetIdleTimers();
    checkEventHints(e);
    try {
      updateDwellTriggers(beat.until, e);
      if (beat.until && satisfied(beat.until, e)) advance("trigger");
    } catch (err) {
      console.error("director: trigger evaluation failed:", err);
      exit("error");
    }
  }

  // ---- public lifecycle ----------------------------------------------------
  function start(l) {
    const errors = lintLesson(l);
    if (errors.length) throw new Error(`lesson "${l?.id}" failed lint:\n- ${errors.join("\n- ")}`);
    if (lesson) exit("restart");
    lesson = l;
    if (lesson.code !== undefined) app.editor.setValue(lesson.code);
    unsub = events.on(onEvent);
    events.emit("lesson-started", { lesson: lesson.id });
    enterBeat(0);
  }

  function complete() {
    const id = lesson.id;
    saveStore({ progress: { ...(loadStore().progress ?? {}), [id]: { done: true, at: Date.now() } } });
    teardown();
    events.emit("lesson-completed", { lesson: id });
  }

  function exit(how = "user") {
    if (!lesson) return;
    const id = lesson.id;
    if (beat) recordTelemetry(`exit:${how}`);
    teardown();
    events.emit("lesson-exited", { lesson: id, how });
  }

  function teardown() {
    clearHintTimers();
    clearDwellTimers();
    unsub?.();
    unsub = null;
    lesson = null;
    beat = null;
    beatIndex = -1;
    try { stage.reset(); } finally { renderStrip(); }
  }

  function skip() {
    if (!lesson) return;
    if (beatIndex >= lesson.beats.length - 1 && !beat.until) { complete(); return; }
    advance("skip");
  }

  return {
    start,
    skip,
    exit,
    isActive: () => Boolean(lesson),
    state: () => lesson ? {
      lesson: lesson.id, beat: beat?.id, index: beatIndex,
      signals: { ...signals, elapsedMs: Math.round(T.now() - beatEnteredAt) },
    } : null,
    telemetry: () => telemetry.slice(),
    progress: () => loadStore().progress ?? {},
  };
}
