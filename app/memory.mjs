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

// Heap node -> the "Value" cell of the Objects table.
function heapNodeValue(n) {
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
    case "class":
      return `class ${esc(n.qualname ?? "")}`
        + (n.attributes?.length
          ? ` { ${n.attributes.map((a) => `${esc(a.name)}=${renderValue(a.value)}`).join(", ")} }`
          : "");
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
  let steps = [];
  let index = 0;
  let follow = true; // live mode: keep showing the latest step

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
    index = Math.max(0, Math.min(i, steps.length - 1));
    const s = steps[index];
    els.slider.max = String(steps.length - 1);
    els.slider.value = String(index);
    els.counter.textContent = `step ${index + 1}/${steps.length}`;
    const loc = s.location;
    els.event.innerHTML = `<b>${esc(s.event)}</b> in ${esc(loc.function)} — line ${loc.line}`;

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

    // Objects: one row per heap node.
    els.objects.innerHTML = "<tr><th>Id</th><th>Type</th><th>Value</th></tr>"
      + (s.heap ?? []).map((n) =>
        `<tr data-uid="${n.uid}"><td class="uid">obj ${n.uid}</td><td>${esc(n.type_name ?? n.kind)}</td><td>${heapNodeValue(n)}</td></tr>`,
      ).join("");

    if (editor && loc.module === "__main__") editor.highlightLine(loc.line);
    else editor?.clearHighlight();
  }

  function userShow(i) {
    follow = i >= steps.length - 1; // scrubbing to the end resumes live follow
    show(i);
    onUserScrub?.(index, steps);
  }

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
      if (follow) show(steps.length - 1);
      else show(index); // keep position, but refresh slider max/counter
    });
  }

  return {
    appendRecord(r) {
      if (r.kind === "step") {
        steps.push(r);
        scheduleShowLatest();
      }
    },
    reset() { steps = []; index = 0; follow = true; show(0); },
    goTo: (i) => userShow(i),
    stepCount: () => steps.length,
    stepIndex: () => index,
    steps: () => steps,
    isFollowing: () => follow,
  };
}
