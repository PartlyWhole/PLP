// PLP shell: wires editor + memory model + console + runner, the isolation
// badge, pane layout, and the window.plp debug API the Playwright suite
// drives (assertions go through it; keeping it in production doubles as a
// console-debugging surface).

import { createEditor } from "./editor.mjs";
import { createMemoryModel } from "./memory.mjs";
import { createConsole } from "./console.mjs";
import { createRunner } from "./runner.mjs";
import { initLayout } from "./layout.mjs";
import { createCollab } from "./collab.mjs";
import { createQuiz } from "./quiz.mjs";
import * as questions from "./questions.mjs";
import { events } from "./events.mjs";
import { createTutorUI } from "./tutor-ui.mjs";
import { createPracticeUI } from "./practice-ui.mjs";
import { createTutor } from "./tutor.mjs";
import { curriculum } from "../curriculum/index.mjs";

const CODE_STORE_KEY = "plp.editor.code.v1";

const SAMPLE = `def total(prices):
    result = 0
    for p in prices:
        result = result + p
    return result

cart = {"apple": 3, "pear": 5, "plum": 2}
prices = list(cart.values())
print("items:", len(prices))
print("total:", total(prices))

name = input("Your name? ")
print("thanks,", name)
`;

function loadCode() {
  try {
    const saved = localStorage.getItem(CODE_STORE_KEY);
    return saved === null ? SAMPLE : saved;
  } catch {
    return SAMPLE;
  }
}

const editor = createEditor({ hostEl: document.getElementById("cm-host") });
editor.setValue(loadCode());
editor.onChange(() => {
  try { localStorage.setItem(CODE_STORE_KEY, editor.getValue()); }
  catch { /* private mode / quota: the current session still works */ }
});

const consoleUI = createConsole({
  root: document.getElementById("console-pane"),
  onInput: (line) => runner.provideInput(line),
  onInterrupt: () => runner.interrupt(), // Ctrl+C in the terminal
});

const memory = createMemoryModel({
  root: document.getElementById("memory-pane"),
  editor,
  onUserScrub: (index, steps) => {
    consoleUI.showUpTo(steps, index);
    collab.notifyUserScrub(); // no-op solo; guarded against remote-apply echo
  },
});

// Layout first: collab (hide-tutor-in-rooms) and the tutor pane need it.
const layoutApi = initLayout({ onResize: () => { editor.refresh(); consoleUI.fit(); } });

// ---- hash routing (#learn / #learn/round / #learn/map / #lesson) ----------
// Browser history mirrors which world the learner is in, so Back walks
// round → menu → IDE instead of destroying the session. The collab room
// link (#room=…, app/collab.mjs) owns the fragment while present — routing
// never reads or writes it. Relative URLs only (invariant 1): route URLs
// are pure fragments or pathname+search, never root-absolute. The COI shim
// reload preserves the hash, so a first visit to #learn still lands there.
const nav = (() => {
  let applying = true; // suppressed until boot reconciliation below
  let onRoute = null;
  const ROUTES = new Set(["code", "learn", "learn/round", "learn/map", "lesson"]);
  const parse = () => {
    const h = location.hash.replace(/^#/, "");
    if (h.startsWith("room=")) return null; // collab owns the hash
    return ROUTES.has(h) ? h : "code";
  };
  const go = (route, { replace = false } = {}) => {
    if (applying) return; // popstate/boot is applying a route right now
    if (location.hash.startsWith("#room=")) return;
    if (parse() === route) return; // never stack duplicate entries
    const url = route === "code" ? location.pathname + location.search : `#${route}`;
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
  };
  addEventListener("popstate", () => {
    const route = parse();
    if (route === null) return; // a room link — collab's hashchange handles it
    applying = true;
    try { onRoute?.(route); } finally { applying = false; }
  });
  return {
    go,
    parse,
    setOnRoute: (fn) => { onRoute = fn; },
    ready: () => { applying = false; },
  };
})();

const statusEl = document.getElementById("run-status");
const coiEl = document.getElementById("coi-badge");
const runBtn = document.getElementById("btn-run");
const stopBtn = document.getElementById("btn-stop");

function setStatus(text, cls = "") {
  statusEl.textContent = text;
  statusEl.className = "badge " + cls;
}

coiEl.textContent = `isolation: ${crossOriginIsolated ? "isolated" : "none (degraded)"}`;
coiEl.className = "badge " + (crossOriginIsolated ? "good" : "bad");
coiEl.title = crossOriginIsolated
  ? "crossOriginIsolated — live input() and cooperative Stop available"
  : "not cross-origin isolated — input() cannot be answered live; Stop hard-kills the run";

// ---- collaboration (lazy: the CRDT bundle loads only when a room starts) --
const shareBtn = document.getElementById("btn-share");
const leaveBtn = document.getElementById("btn-leave");
const collabBadge = document.getElementById("collab-badge");
const collabPeers = document.getElementById("collab-peers");

let tutorRef = null; // assigned after createTutor; collab events fire later
const collab = createCollab({
  editor, memory, consoleUI,
  onUiState(s) {
    if (s.type === "state") {
      const live = s.state === "live";
      // v1 tutoring is solo-only: the transcript is local state, so hide
      // the pane rather than leak a one-sided conversation into a room.
      if (live) tutorRef?.hideSurface();
      shareBtn.textContent = live ? "🔗 Copy link" : s.state === "connecting" ? "⏳ Connecting…" : "Share session";
      shareBtn.disabled = s.state === "connecting";
      leaveBtn.hidden = !live;
      collabBadge.hidden = !live;
      if (s.state === "unreachable") setStatus("room unreachable — solo", "bad");
    } else if (s.type === "peers") {
      collabPeers.textContent = s.count;
    } else if (s.type === "remote-run") {
      setStatus(s.phase === "running" ? "shared run…" : s.reason, s.reason === "completed" ? "good" : "");
    } else if (s.type === "usurped") {
      // Another peer's Run won the shared-run race; stop our session.
      runner.interrupt();
      setStatus("another peer is running", "");
    }
  },
});

shareBtn.addEventListener("click", async () => {
  if (!collab.isActive()) {
    try { await collab.start(); } catch (e) {
      console.error(e);
      setStatus("couldn't create room", "bad");
      shareBtn.textContent = "Share session";
      shareBtn.disabled = false;
      return;
    }
  }
  const url = location.origin + location.pathname + location.search + location.hash;
  navigator.clipboard?.writeText(url).catch(() => {});
  shareBtn.textContent = "✓ link copied";
  setTimeout(() => { shareBtn.textContent = "🔗 Copy link"; }, 1500);
});
leaveBtn.addEventListener("click", () => collab.leave());

const runner = createRunner({
  editor, memory, consoleUI,
  hooks: collab.hooks,
  onStatus(s) {
    if (s.type === "state") setStatus(s.state === "booting" ? "starting Python…" : "running…");
    else if (s.type === "header") {
      const caps = s.host?.capabilities ?? {};
      coiEl.textContent = `isolation: ${caps.cross_origin_isolated ? "isolated" : "none (degraded)"}`;
      coiEl.className = "badge " + (caps.cross_origin_isolated ? "good" : "bad");
    } else if (s.type === "done") {
      setStatus(s.summary.terminal_reason, s.summary.terminal_reason === "completed" ? "good" : "");
      // A finished run that produced no trace steps was the untraced path:
      // tell the empty memory pane why it's empty and what to do instead.
      if (memory.steps().length === 0) {
        memory.setEmptyNote("Run ▶ goes full speed and skips the memory model — press Trace to watch names bind.");
      }
    } else if (s.type === "error") setStatus("run failed", "bad");
  },
});

// Two ways to execute, both learner-facing:
//   Run   — untraced, full speed, always finishes; no memory model.
//   Trace — records every step to drive the memory model, so the engine's
//           step budget stops it early on large programs.
const traceBtn = document.getElementById("btn-trace");

async function start(fn) {
  if (runner.isRunning()) return null;
  if (!collab.canRun()) { setStatus("a peer is running — watch along", ""); return null; }
  runBtn.disabled = traceBtn.disabled = true;
  try {
    return await fn();
  } finally {
    runBtn.disabled = traceBtn.disabled = false;
  }
}

const run = () => start(() => runner.run());
const trace = () => start(() => runner.trace());

runBtn.addEventListener("click", run);
traceBtn.addEventListener("click", trace);
stopBtn.addEventListener("click", () => { runner.interrupt(); setStatus("stopping…"); });

// Dormant generative-question pilot (see app/QUESTIONS.md). The learner-facing
// control is hidden, while the debug API remains.
const quiz = createQuiz({ memory, editor });
document.getElementById("btn-quiz").addEventListener("click", () => quiz.toggle());

// Guided tutor (app/TUTOR.md): transcript pane + lesson runtime.
const tutorUI = createTutorUI({
  root: document.getElementById("tutor-pane"),
  layout: layoutApi,
});
const practiceUI = createPracticeUI({
  layout: layoutApi,
  getCode: () => editor.getValue(),
});
const tutor = createTutor({
  editor, memory, consoleUI,
  ui: tutorUI,
  practiceUI,
  actions: {
    run, trace,
    isExercisesVisible: () => layoutApi.isTutorVisible(),
    enterFocus: () => layoutApi.enterFocus(),
  },
  curriculum,
  isCollabActive: () => collab.isActive(),
  nav,
});
tutorRef = tutor;

// ---- world switch ([⌨ Code] [🌱 Learn] (+ [📖 Lesson])) -------------------
// Segments route through the existing toggle/surface APIs; #btn-tutor keeps
// its id (and its toggle handler) on the Learn segment. The temporary
// Lesson segment appears while a guided lesson is live.
const codeBtn = document.getElementById("btn-code");
const tutorBtn = document.getElementById("btn-tutor");
const lessonBtn = document.getElementById("btn-lesson");
function updateWorldSwitch() {
  const route = tutor.currentRoute();
  codeBtn.setAttribute("aria-pressed", String(route === "code"));
  tutorBtn.setAttribute("aria-pressed", String(route.startsWith("learn")));
  lessonBtn.hidden = !tutor.isGuidedActive();
  lessonBtn.setAttribute("aria-pressed", String(route === "lesson"));
}
tutorBtn.addEventListener("click", () => {
  if (collab.isActive()) { setStatus("exercises are unavailable in a shared room", ""); return; }
  // The tutor routes to the right surface (practice card view for drills
  // and the menu; the focus stage for a mid-guided-lesson resume).
  tutor.toggleSurface();
  if (layoutApi.isTutorVisible()) { editor.refresh(); consoleUI.fit(); }
  updateWorldSwitch();
});
codeBtn.addEventListener("click", () => {
  if (layoutApi.isTutorVisible()) tutor.hideSurface();
  updateWorldSwitch();
});
lessonBtn.addEventListener("click", () => {
  if (collab.isActive()) return;
  if (!layoutApi.isTutorVisible()) tutor.toggleSurface(); // resumes the stage
  updateWorldSwitch();
});
events.on((e) => {
  if (e.type === "lesson-started" || e.type === "lesson-ended") updateWorldSwitch();
});

// ---- boot route reconciliation --------------------------------------------
// The persistence already restored surface STATE; the hash restores the
// VIEW. A non-code hash wins (reload with #learn opens the menu); with no
// hash, the URL is aligned to whatever the persisted state shows.
nav.setOnRoute((r) => { tutor.applyRoute(r); updateWorldSwitch(); });
{
  const hashRoute = nav.parse(); // null inside a collab room link
  if (hashRoute !== null && hashRoute !== "code" && hashRoute !== tutor.currentRoute()) {
    tutor.applyRoute(hashRoute);
  }
  nav.ready();
  const actual = tutor.currentRoute();
  if (hashRoute !== null && actual !== nav.parse()) nav.go(actual, { replace: true });
}
updateWorldSwitch();

// ---- continue signal --------------------------------------------------------
// A persisted mid-round drill greets the returning learner: a small badge
// on the Learn segment plus a one-line chip whose Continue takes the same
// toggle path. Dismissal is session-only (module state, nothing stored).
let continueHint = null;
function clearContinueHint() {
  if (!continueHint) return;
  continueHint.badge.remove();
  continueHint.chip.remove();
  continueHint = null;
}
(function bootContinueHint() {
  if (document.body.classList.contains("practice")) return; // already there
  let s = null;
  try { s = JSON.parse(localStorage.getItem("plp.tutor.v1")); } catch { return; }
  if (!s?.drillLesson) return;
  const badge = document.createElement("span");
  badge.className = "continue-badge";
  badge.textContent = "· continue ▶";
  tutorBtn.appendChild(badge);
  const chip = document.createElement("div");
  chip.id = "continue-chip";
  const label = document.createElement("span");
  label.textContent = `You're mid-round in ${s.drillLesson.title ?? "a practice round"} — `;
  const go = document.createElement("button");
  go.type = "button";
  go.className = "primary";
  go.textContent = "Continue";
  go.addEventListener("click", () => { clearContinueHint(); tutorBtn.click(); });
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "chip-dismiss";
  dismiss.textContent = "✕";
  dismiss.title = "Dismiss for this session";
  dismiss.addEventListener("click", clearContinueHint);
  chip.append(label, go, dismiss);
  document.querySelector("header").after(chip);
  continueHint = { badge, chip };
  // The moment the surface opens by ANY path, the hint has done its job.
  new MutationObserver(() => {
    if (document.body.classList.contains("practice")) clearContinueHint();
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
})();

window.addEventListener("resize", () => consoleUI.fit());

// Auto-join when the URL carries a room link (#room=…). The COI-shim reload
// preserves the hash, so a first visit joins after the isolation reload.
collab.maybeAutoJoin().catch((e) => {
  console.error(e);
  setStatus("room join failed", "bad");
});

// Debug/test API.
window.plp = {
  editor,
  memory,
  console: consoleUI,
  runner,
  run,
  trace,
  interrupt: () => runner.interrupt(),
  provideInput: (line) => runner.provideInput(line),
  records: () => runner.records(),
  checkErrors: () => runner.checkErrors(),
  collab,
  quiz,
  questions, // pure engine module (generateQuestion, snapshotAt, …)
  tutor,
  layout: layoutApi,
  events,
};
