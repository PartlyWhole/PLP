// Terminal-style console: interleaved stdout/stderr in arrival order, dim
// system lines for run boundaries, and an inline input row that appears when
// the program is waiting at input(). The engine echoes accepted input
// (echo_stdin default), so nothing is echoed locally.
//
// Live output appends incrementally (capped DOM); scrubbing the memory model
// re-renders output reconstructed up to the selected step.

const MAX_DOM_CHUNKS = 2000;

export function createConsole({ root, onInput }) {
  const out = root.querySelector("[data-role=console-out]");
  const inputRow = root.querySelector("[data-role=input-row]");
  const inputLine = root.querySelector("[data-role=input-line]");

  // Full live transcript stays in memory; only the first MAX_DOM_CHUNKS
  // chunks render as DOM nodes.
  let chunks = []; // { stream: "stdout"|"stderr"|"sys", text }
  let scrubbed = false; // true while showing a reconstructed (≤ step) view

  function appendNode(stream, text) {
    const span = document.createElement("span");
    if (stream !== "stdout") span.className = stream;
    span.textContent = text;
    out.appendChild(span);
  }

  function renderLive() {
    out.textContent = "";
    for (const c of chunks.slice(0, MAX_DOM_CHUNKS)) appendNode(c.stream, c.text);
    if (chunks.length > MAX_DOM_CHUNKS) {
      appendNode("sys", `\n… display capped at ${MAX_DOM_CHUNKS} output chunks (full output kept in memory)\n`);
    }
    out.scrollTop = out.scrollHeight;
  }

  function append(stream, text) {
    if (!text) return;
    chunks.push({ stream, text });
    if (scrubbed) return; // live buffer keeps accumulating; view is elsewhere
    if (chunks.length <= MAX_DOM_CHUNKS) {
      appendNode(stream, text);
      out.scrollTop = out.scrollHeight;
    } else if (chunks.length === MAX_DOM_CHUNKS + 1) {
      appendNode("sys", `\n… display capped at ${MAX_DOM_CHUNKS} output chunks (full output kept in memory)\n`);
    }
  }

  // Reconstructed view for step scrubbing: program output up to and
  // including steps[index].
  function showUpTo(steps, index) {
    scrubbed = index < steps.length - 1;
    if (!scrubbed) { renderLive(); return; }
    let stdout = "", stderr = "";
    for (let j = 0; j <= index && j < steps.length; j++) {
      stdout += steps[j].output?.stdout_delta ?? "";
      stderr += steps[j].output?.stderr_delta ?? "";
    }
    out.textContent = "";
    appendNode("sys", `⟨output up to step ${index + 1} — move the slider to the end to return to live view⟩\n`);
    appendNode("stdout", stdout);
    if (stderr) appendNode("stderr", stderr);
  }

  function showInput(prompt) {
    inputRow.classList.add("active");
    inputLine.placeholder = prompt
      ? `waiting for input — ${prompt}` : "program is waiting for input — type a line and press Enter";
    inputLine.focus();
  }

  function hideInput() {
    inputRow.classList.remove("active");
    inputLine.value = "";
  }

  inputLine.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const line = inputLine.value;
    hideInput();
    try {
      onInput(line);
    } catch (err) {
      append("sys", `input rejected: ${err.message ?? err}\n`);
    }
  });

  return {
    reset() { chunks = []; scrubbed = false; hideInput(); out.textContent = ""; },
    append,
    system: (text) => append("sys", text.endsWith("\n") ? text : text + "\n"),
    showUpTo,
    showInput,
    hideInput,
    text: () => chunks.filter((c) => c.stream !== "sys").map((c) => c.text).join(""),
  };
}
