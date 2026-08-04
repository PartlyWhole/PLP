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
});
tutorRef = tutor;
document.getElementById("btn-tutor").addEventListener("click", () => {
  if (collab.isActive()) { setStatus("exercises are unavailable in a shared room", ""); return; }
  // The tutor routes to the right surface (practice card view for drills
  // and the menu; the focus stage for a mid-guided-lesson resume).
  tutor.toggleSurface();
  if (layoutApi.isTutorVisible()) { editor.refresh(); consoleUI.fit(); }
});

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
