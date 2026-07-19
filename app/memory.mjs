// Memory model: two tables driven by PyTrace step records.
//   Names   — one section per scope (globals, then each stack frame
//             root → active), rows Name | Value; refs render as clickable
//             chips linking into the Objects table.
//   Objects — one row per heap node in the current step: Id | Type | Value.
// Live renders are throttled to one per animation frame (records can arrive
// at thousands per second); user scrubbing renders immediately.
// Value/heap rendering adapted from the Engine Pilot trace view.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function b64Preview(b64, length) {
  try {
    const raw = atob(b64);
    const printable = [...raw.slice(0, 24)].map((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 32 && c < 127 ? ch : "\\x" + c.toString(16).padStart(2, "0");
    }).join("");
    return `b'${printable}${length > 24 ? "…" : ""}'`;
  } catch {
    return `bytes[${length}]`;
  }
}

// EncodedValue -> inline HTML (closed vocabulary; unknown kinds render as
// raw JSON for forward safety).
export function renderValue(v) {
  if (v === null || v === undefined) return "<i>?</i>";
  switch (v.kind) {
    case "none": return "None";
    case "bool": return v.value ? "True" : "False";
    case "int": return esc(v.decimal);
    case "float": return esc(v.special ?? v.decimal);
    case "str": return `<span class="mm-str">${esc(JSON.stringify(v.value))}</span>`;
    case "bytes": return `<span class="mm-str">${esc(b64Preview(v.base64, v.length))}</span> <small>(${v.length}B)</small>`;
    case "complex": return `complex(${renderValue(v.real)}, ${renderValue(v.imag)})`;
    case "range": return `range(${renderValue(v.start)}, ${renderValue(v.stop)}, ${renderValue(v.step)})`;
    case "slice": return `slice(${renderValue(v.start)}, ${renderValue(v.stop)}, ${renderValue(v.step)})`;
    case "ellipsis": return "...";
    case "not_implemented": return "NotImplemented";
    case "ref": return `<a class="mm-ref" href="#" data-uid="${v.uid}">obj ${v.uid}</a>`;
    case "elided": return `<span class="mm-elided">⟨elided: ${esc(v.reason)}${v.omitted_count ? `, ${v.omitted_count} omitted` : ""}⟩</span>`;
    default: return `<code>${esc(JSON.stringify(v))}</code>`;
  }
}

function bindingRows(bindings) {
  if (!bindings?.length) return `<tr><td class="name" colspan="2"><i class="hint">no names</i></td></tr>`;
  return bindings.map((b) =>
    `<tr><td class="name">${esc(b.name)}</td><td>${renderValue(b.value)}</td></tr>`).join("");
}

// ---------------------------------------------------------------------------
// Objects-table display policy (see README "Memory model display rules"):
//
// The Objects table shows only heap nodes reachable from a visible reference
// chip — starting at the Names table (globals, frame locals, closure cells)
// and following refs through displayed object contents (container items,
// dict keys/values, instance/class attributes, cell contents). The invariant
// this preserves: every rendered `obj N` chip resolves to a rendered row.
//
// Class `bases` are deliberately NOT chips: they render inline by name in
// the class row, so the implicit builtin `object` base (an opaque node the
// engine truthfully declines to inspect) stops appearing as a row in every
// class example. Non-user objects a learner's own names actually reach
// (file handles, imported modules, compiled regexes, …) DO still appear —
// as dimmed `opaque` rows — because hiding them would break chips and turn
// "truthfully not inspected" into "silently doesn't exist".
// ---------------------------------------------------------------------------

// Walk an EncodedValue (or array of them) and yield every ref uid, including
// refs nested inside complex/range/slice payloads.
function* valueRefs(v) {
  if (Array.isArray(v)) {
    for (const item of v) yield* valueRefs(item);
    return;
  }
  if (v && typeof v === "object") {
    if (v.kind === "ref" && typeof v.uid === "number") yield v.uid;
    for (const inner of Object.values(v)) {
      if (inner && typeof inner === "object") yield* valueRefs(inner);
    }
  }
}

// Refs a heap node's *rendered content* exposes as chips (bases excluded —
// they render inline by name).
function* nodeContentRefs(n) {
  switch (n.kind) {
    case "list": case "tuple": case "set": case "frozenset":
      yield* valueRefs(n.items ?? []);
      break;
    case "dict":
      for (const e of n.entries ?? []) { yield* valueRefs(e.key); yield* valueRefs(e.value); }
      break;
    case "instance": case "class":
      yield* valueRefs((n.attributes ?? []).map((a) => a.value));
      break;
    case "cell":
      if (n.state === "value") yield* valueRefs(n.content);
      break;
  }
}

// Uids reachable from the Names table (roots) through displayed contents.
function reachableUids(step, heapByUid) {
  const roots = [
    ...(step.globals ?? []).map((g) => g.bindings),
    ...(step.stack ?? []).map((f) => f.locals),
    ...(step.closure_environments ?? []).map((c) => c.cells),
  ];
  const seen = new Set();
  const queue = [...valueRefs(roots.map((b) => (b ?? []).map((x) => x.value)))];
  while (queue.length) {
    const uid = queue.pop();
    if (seen.has(uid)) continue;
    seen.add(uid);
    const node = heapByUid.get(uid);
    if (node) queue.push(...nodeContentRefs(node));
  }
  return seen;
}

// Heap node -> the "Value" cell of the Objects table.
function heapNodeValue(n, heapByUid) {
  switch (n.kind) {
    case "list": case "tuple": case "set": case "frozenset": {
      const open = n.kind === "list" ? "[" : n.kind === "tuple" ? "(" : "{";
      const close = n.kind === "list" ? "]" : n.kind === "tuple" ? ")" : "}";
      return `${open}${(n.items ?? []).map(renderValue).join(", ")}${close}`
        + (n.ordering === "unordered" ? ` <small class="hint">(unordered)</small>` : "")
        + (n.elided_count ? ` <span class="mm-elided">+${n.elided_count} elided</span>` : "");
    }
    case "dict":
      return `{${(n.entries ?? []).map((e) => `${renderValue(e.key)}: ${renderValue(e.value)}`).join(", ")}}`
        + (n.elided_count ? ` <span class="mm-elided">+${n.elided_count} elided</span>` : "");
    case "instance":
      return `${esc(n.class_qualname ?? "")} { ${(n.attributes ?? []).map((a) =>
        `${esc(a.name)}=${renderValue(a.value)}`).join(", ")} }`;
    case "class": {
      // Bases render inline by name (no ref chip): the implicit `object`
      // base would otherwise drag an opaque builtin row into every class
      // example. Only bases that resolve to a named class in this step's
      // heap are listed; unnameable (opaque/builtin) bases are omitted.
      const baseNames = (n.bases ?? [])
        .map((b) => (b?.kind === "ref" ? heapByUid?.get(b.uid) : null))
        .filter((base) => base?.kind === "class" && base.qualname)
        .map((base) => esc(base.qualname));
      return `class ${esc(n.qualname ?? "")}${baseNames.length ? `(${baseNames.join(", ")})` : ""}`
        + (n.attributes?.length
          ? ` { ${n.attributes.map((a) => `${esc(a.name)}=${renderValue(a.value)}`).join(", ")} }`
          : "");
    }
    case "function":
      return `function ${esc(n.qualname ?? "")}`
        + (n.closure_environment_id != null ? ` <small class="hint">closure env ${n.closure_environment_id}</small>` : "");
    case "generator":
      return `generator (${esc(n.state ?? "?")})`;
    case "cell":
      return n.state === "value" ? `cell → ${renderValue(n.content)}` : "cell (empty)";
    case "module":
      return `module ${esc(n.module ?? "")}`;
    case "opaque":
      return `<span class="mm-elided">opaque (${esc(n.reason)})</span>`;
    case "elided":
      return `<span class="mm-elided">elided (${esc(n.reason ?? "")})</span>`;
    default: {
      const { uid, kind, type_name, ...rest } = n;
      return Object.keys(rest).length ? `<code>${esc(JSON.stringify(rest))}</code>` : "";
    }
  }
}

export function createMemoryModel({ root, editor, onUserScrub }) {
  const els = {
    slider: root.querySelector("[data-role=step-slider]"),
    prev: root.querySelector("[data-role=step-prev]"),
    next: root.querySelector("[data-role=step-next]"),
    counter: root.querySelector("[data-role=step-counter]"),
    event: root.querySelector("[data-role=step-event]"),
    flags: root.querySelector("[data-role=step-flags]"),
    names: root.querySelector("[data-role=names-table]"),
    objects: root.querySelector("[data-role=objects-table]"),
  };
  const modeToggle = root.querySelector("[data-role=step-mode]");
  let steps = [];
  let index = 0; // position index in the CURRENT mode's position space
  let stateIndex = 0; // raw step index whose snapshot is displayed
  let follow = true; // live mode: keep showing the latest position

  // ---- line-step positions -------------------------------------------------
  // The engine emits a snapshot per trace event, and a `line` snapshot shows
  // state BEFORE that line runs — so raw scrubbing highlights line N while
  // displaying the effects of the lines above it, and one source line can
  // span many steps (loop/comprehension iterations, call/return events).
  // Line-step mode regroups this into learner-shaped positions: one position
  // per contiguous run of steps on the same (module, function, line), whose
  // displayed state is the NEXT group's boundary snapshot — i.e. "line N
  // just executed → this is the memory it produced". The final group shows
  // the last snapshot (final state for finished runs; in-progress state for
  // a live run). Raw engine-step mode remains available via the toggle.
  let groups = []; // { start, line, function, module }

  function trackGroup(stepIdx) {
    const loc = steps[stepIdx].location;
    const last = groups[groups.length - 1];
    if (!last || last.line !== loc.line || last.function !== loc.function || last.module !== loc.module) {
      groups.push({ start: stepIdx, line: loc.line, function: loc.function, module: loc.module });
    }
  }

  const lineMode = () => modeToggle?.checked ?? false;
  // Line mode has a synthetic position 0: "before the program runs" (empty
  // memory, no highlight), so scrubbing shows each line's effect as a diff
  // from a visible starting point. Positions 1..N are the executed lines.
  const positionCount = () => (lineMode() ? groups.length + 1 : steps.length);

  function show(i) {
    if (!steps.length) {
      els.counter.textContent = "no steps";
      els.event.textContent = "";
      els.flags.innerHTML = "";
      els.names.innerHTML = "";
      els.objects.innerHTML = "";
      els.slider.max = "0";
      editor?.clearHighlight();
      return;
    }
    index = Math.max(0, Math.min(i, positionCount() - 1));
    let s, hlLine, hlModule;
    if (lineMode() && index === 0) {
      // Synthetic start position: nothing has executed yet.
      stateIndex = -1;
      els.counter.textContent = `line 0/${groups.length}`;
      els.event.innerHTML = "<i>before the program runs</i>";
      els.flags.innerHTML = "";
      els.names.innerHTML = "<tr><th>Name</th><th>Value</th></tr>";
      els.objects.innerHTML = "<tr><th>Id</th><th>Type</th><th>Value</th></tr>";
      els.slider.max = String(positionCount() - 1);
      els.slider.value = "0";
      editor?.clearHighlight();
      return;
    }
    if (lineMode()) {
      const g = groups[index - 1];
      const nextStart = groups[index]?.start;
      stateIndex = nextStart != null ? nextStart : steps.length - 1;
      s = steps[stateIndex];
      const span = (nextStart ?? steps.length) - g.start;
      els.counter.textContent = `line ${index}/${groups.length}`;
      els.event.innerHTML = `<b>line ${g.line}</b>`
        + (g.function !== "<module>" ? ` in ${esc(g.function)}` : "")
        + (span > 1 ? ` <small>(${span} engine steps)</small>` : "");
      hlLine = g.line;
      hlModule = g.module;
    } else {
      stateIndex = index;
      s = steps[index];
      const loc = s.location;
      els.counter.textContent = `step ${index + 1}/${steps.length}`;
      els.event.innerHTML = `<b>${esc(s.event)}</b> in ${esc(loc.function)} — line ${loc.line}`;
      hlLine = loc.line;
      hlModule = loc.module;
    }
    els.slider.max = String(positionCount() - 1);
    els.slider.value = String(index);

    els.flags.innerHTML = Object.entries(s.flags ?? {})
      .filter(([, v]) => v)
      .map(([k]) => `<span class="mm-flag on">${esc(k)}</span>`).join(" ");

    // Names: globals first, then stack frames root → active.
    let names = "<tr><th>Name</th><th>Value</th></tr>";
    for (const g of s.globals ?? []) {
      names += `<tr class="scope"><th colspan="2">globals${g.module === "__main__" ? "" : ` (${esc(g.module)})`}</th></tr>`;
      names += bindingRows(g.bindings);
    }
    (s.stack ?? []).forEach((f, fi, arr) => {
      if (f.function === "<module>") return; // module frame duplicates globals
      const active = fi === arr.length - 1;
      names += `<tr class="scope"><th colspan="2">${esc(f.function)}()${active ? " ← active" : ""}</th></tr>`;
      names += bindingRows(f.locals);
    });
    for (const c of s.closure_environments ?? []) {
      names += `<tr class="scope"><th colspan="2">closure env ${c.environment_id}</th></tr>`;
      names += bindingRows(c.cells);
    }
    els.names.innerHTML = names;

    // Objects: one row per heap node reachable from a visible chip (see the
    // display-policy comment above). Opaque rows render dimmed.
    const heapByUid = new Map((s.heap ?? []).map((n) => [n.uid, n]));
    const visible = reachableUids(s, heapByUid);
    els.objects.innerHTML = "<tr><th>Id</th><th>Type</th><th>Value</th></tr>"
      + (s.heap ?? []).filter((n) => visible.has(n.uid)).map((n) =>
        `<tr data-uid="${n.uid}"${n.kind === "opaque" ? ' class="dim"' : ""}><td class="uid">obj ${n.uid}</td><td>${esc(n.type_name ?? n.kind)}</td><td>${heapNodeValue(n, heapByUid)}</td></tr>`,
      ).join("");

    if (editor && hlModule === "__main__") editor.highlightLine(hlLine);
    else editor?.clearHighlight();
  }

  function userShow(i) {
    follow = i >= positionCount() - 1; // scrubbing to the end resumes live follow
    show(i);
    onUserScrub?.(stateIndex, steps);
  }

  modeToggle?.addEventListener("change", () => {
    show(follow ? positionCount() - 1 : Math.min(index, positionCount() - 1));
  });

  els.slider.addEventListener("input", () => userShow(Number(els.slider.value)));
  els.prev.addEventListener("click", () => userShow(index - 1));
  els.next.addEventListener("click", () => userShow(index + 1));

  // Ref chips (in either table) flash + scroll to the object's row.
  root.addEventListener("click", (ev) => {
    const a = ev.target.closest("a.mm-ref");
    if (!a) return;
    ev.preventDefault();
    const row = els.objects.querySelector(`tr[data-uid="${a.dataset.uid}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    row.classList.add("flash");
    setTimeout(() => row.classList.remove("flash"), 900);
  });

  // Rendering a snapshot is O(step contents); doing it synchronously per
  // record freezes the page on big traces. Appends only schedule a render of
  // the latest step, at most one per animation frame.
  let renderScheduled = false;
  function scheduleShowLatest() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      if (follow) show(positionCount() - 1);
      else show(index); // keep position, but refresh slider max/counter
    });
  }

  return {
    appendRecord(r) {
      if (r.kind === "step") {
        steps.push(r);
        trackGroup(steps.length - 1);
        scheduleShowLatest();
      }
    },
    reset() { steps = []; groups = []; index = 0; follow = true; show(0); },
    // Position-space API (positions = executed lines in line-step mode,
    // raw engine steps otherwise).
    goTo: (i) => userShow(i),
    stepCount: () => positionCount(),
    stepIndex: () => index,
    steps: () => steps, // raw engine step records, always
    isFollowing: () => follow,
    lineMode,
  };
}
