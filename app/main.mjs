// PLP shell: wires editor + memory model + console + runner, the isolation
// badge, pane layout, and the window.plp debug API the Playwright suite
// drives (assertions go through it; keeping it in production doubles as a
// console-debugging surface).

import { createEditor } from "./editor.mjs";
import { createMemoryModel } from "./memory.mjs";
import { createConsole } from "./console.mjs";
import { createRunner } from "./runner.mjs";
import { initLayout } from "./layout.mjs";

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

const editor = createEditor({ hostEl: document.getElementById("cm-host") });
editor.setValue(SAMPLE);

const consoleUI = createConsole({
  root: document.getElementById("console-pane"),
  onInput: (line) => runner.provideInput(line),
});

const memory = createMemoryModel({
  root: document.getElementById("memory-pane"),
  editor,
  onUserScrub: (index, steps) => consoleUI.showUpTo(steps, index),
});

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

const runner = createRunner({
  editor, memory, consoleUI,
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

async function run() {
  if (runner.isRunning()) return null;
  runBtn.disabled = true;
  try {
    return await runner.run();
  } finally {
    runBtn.disabled = false;
  }
}

runBtn.addEventListener("click", run);
stopBtn.addEventListener("click", () => { runner.interrupt(); setStatus("stopping…"); });

initLayout({ onResize: () => editor.refresh() });

// Debug/test API.
window.plp = {
  editor,
  memory,
  console: consoleUI,
  runner,
  run,
  interrupt: () => runner.interrupt(),
  provideInput: (line) => runner.provideInput(line),
  records: () => runner.records(),
  checkErrors: () => runner.checkErrors(),
};
