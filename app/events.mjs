// Semantic event bus: modules emit small, stable, learner-action events;
// the director (and tests) subscribe. Purely additive — nothing in the app
// depends on having listeners.
//
// Event vocabulary (type → payload):
//   run-started        { runId }
//   run-ended          { reason, trace_complete }
//   run-rejected       { message }          (pre-stream rejection)
//   input-answered     { line }
//   interrupt-requested {}
//   edited             {}                   (user edits only, not setValue)
//   scrubbed           { position, line, stateIndex }  (user scrub only)
//   hover-name         { scope, name, active }         (enter/leave phase)
//   chip-clicked       { uid }
//   mode-changed       { lineMode }
//   memory-rendered    { position }         (view redraw; stage re-anchors)
//   quiz-question      { kind }
//   quiz-graded        { kind, correct }
//   lesson-*           (emitted by the director itself)

const listeners = new Set();
const log = [];
const MAX_LOG = 5000;

export const events = {
  emit(type, data = {}) {
    const e = { type, ...data, t: Math.round(performance.now()) };
    log.push(e);
    if (log.length > MAX_LOG) log.shift();
    for (const fn of [...listeners]) {
      try { fn(e); } catch (err) { console.error("event listener failed:", err); }
    }
    return e;
  },
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  log: () => log.slice(),
  clearLog: () => { log.length = 0; },
};
