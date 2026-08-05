// Memory model: a visual binding canvas driven by PyTrace step records.
//   Names   - boxes grouped by scope (globals, frames root to active,
//             closures).
//   Values  - scalar pills and one expandable pill per displayed heap node.
//   Binding - SVG arrows from name boxes to value/object pills; aliases
//             converge on the same object pill.
// Live renders are throttled to one per animation frame (records can arrive
// at thousands per second); user scrubbing renders immediately.
// Value/heap rendering adapted from the Engine Pilot trace view.

import { events } from "./events.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dataIdLabel = (uid) => `data<sub>${esc(uid)}</sub>`;

// Heap uids are integers in every engine-produced record, but this renderer
// also draws records that arrived over collab (another peer's document), so
// nothing here may assume a uid is a number. `uidAttr` makes an attribute
// value injection-proof; `sel` escapes any value spliced into a selector.
// The collab boundary rejects malformed records outright (app/collab.mjs) —
// these are the second layer, so a single missed check is not an XSS.
const uidAttr = (uid) => esc(uid);
const sel = (value) => (window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\\]]/g, "\\$&"));

// ---------------------------------------------------------------------------
// Display filters: the object-list policy as individually toggleable
// constituents (documented in app/MEMORY.md). Flip a flag to false to see
// the unfiltered engine truth for that aspect; the underlying step records
// are never altered. Also exposed as `window.plp.memory.filters` for
// console experimentation.
// ---------------------------------------------------------------------------
export const displayFilters = {
  // Show only heap nodes reachable from visible names through displayed
  // contents. Keeps the invariant that every object target resolves to one
  // pill and every object pill is reachable from a name.
  chipReachableOnly: true,
  // Class `bases` render inline by name (e.g. `class Puppy(Dog)`) instead
  // as object references, so the implicit builtin `object` base does not add
  // an opaque pill to every class example.
  inlineClassBases: true,
  // Hide class-valued name boxes by default. Classes remain in the raw
  // trace and reappear when this is OFF (or when learner data contains one).
  // Instance pills still use the class name as their type label.
  hideClassBindings: true,
  // Plain named functions (resolved provenance, no closure environment)
  // render as `function name` value pills wherever referenced, instead
  // of as identity-bearing object pills; a bare `def` is not an interesting object
  // for learners. Closures keep object pills because their environment matters.
  inlinePlainFunctions: true,
  // Hide plain-function name boxes entirely. A bare
  // `def total(...)` adds no box (`total` still appears as the frame label
  // when called). Closure bindings always stay. Turn OFF to teach that
  // def binds a name like any assignment.
  hideFunctionBindings: true,
  // Module objects (import math -> `math` bound to a module) render as
  // `module math` value pills; an import is not usually an identity story.
  inlineModules: true,
  // Go further: hide module name boxes entirely. `import math` adds no box.
  // Turn OFF to teach that imports bind
  // names like any other assignment.
  hideModuleBindings: true,
  // Opaque nodes (builtins/imported objects the engine truthfully declines
  // to inspect) render dimmed. They are never hidden entirely.
  dimOpaque: true,
};

// Nodes that render as paired values instead of identity-bearing object pills.
// Returns the inline HTML, or null when the node should chip normally.
function inlineRendering(node) {
  if (!node) return null;
  if (displayFilters.inlinePlainFunctions && node.kind === "function" && node.closure_environment_id == null) {
    return `<span class="mm-fn">function ${esc(node.qualname ?? "?")}</span>`;
  }
  if (displayFilters.inlineModules && node.kind === "module") {
    return `<span class="mm-fn">module ${esc(node.module ?? "?")}</span>`;
  }
  return null;
}

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
// raw JSON for forward safety). heapByUid enables filter-aware ref
// rendering (inline plain functions); without it refs always chip.
export function renderValue(v, heapByUid) {
  if (v === null || v === undefined) return "<i>?</i>";
  switch (v.kind) {
    case "none": return "None";
    case "bool": return v.value ? "True" : "False";
    case "int": return esc(v.decimal);
    case "float": return esc(v.special ?? v.decimal);
    case "str": return `<span class="mm-str">${esc(JSON.stringify(v.value))}</span>`;
    case "bytes": return `<span class="mm-str">${esc(b64Preview(v.base64, v.length))}</span> <small>(${v.length}B)</small>`;
    case "complex": return `complex(${renderValue(v.real, heapByUid)}, ${renderValue(v.imag, heapByUid)})`;
    case "range": return `range(${renderValue(v.start, heapByUid)}, ${renderValue(v.stop, heapByUid)}, ${renderValue(v.step, heapByUid)})`;
    case "slice": return `slice(${renderValue(v.start, heapByUid)}, ${renderValue(v.stop, heapByUid)}, ${renderValue(v.step, heapByUid)})`;
    case "ellipsis": return "...";
    case "not_implemented": return "NotImplemented";
    case "ref": {
      const inline = inlineRendering(heapByUid?.get(v.uid));
      if (inline) return inline;
      return `<button class="mm-inner-ref mm-object-id" type="button" data-target="object-${uidAttr(v.uid)}" data-uid="${uidAttr(v.uid)}" aria-label="data ${uidAttr(v.uid)}">${dataIdLabel(v.uid)}</button>`;
    }
    case "elided": return `<span class="mm-elided">⟨elided: ${esc(v.reason)}${v.omitted_count ? `, ${v.omitted_count} omitted` : ""}⟩</span>`;
    default: return `<code>${esc(JSON.stringify(v))}</code>`;
  }
}

function scalarTypeName(v) {
  if (!v?.kind) return "value";
  if (v.kind === "none") return "NoneType";
  if (v.kind === "not_implemented") return "NotImplementedType";
  return v.kind;
}

function renderTypedValue(v, heapByUid) {
  return `<span class="mm-value-type">${esc(scalarTypeName(v))}</span><span class="mm-value-separator" aria-hidden="true">·</span><span class="mm-value-content">${renderValue(v, heapByUid)}</span>`;
}

function isHiddenBinding(b, heapByUid) {
  if (b.value?.kind !== "ref") return false;
  const node = heapByUid?.get(b.value.uid);
  if (displayFilters.hideClassBindings && node?.kind === "class") return true;
  if (displayFilters.hideModuleBindings && node?.kind === "module") return true;
  if (displayFilters.hideFunctionBindings && node?.kind === "function"
    && node.closure_environment_id == null) return true;
  return false;
}

// A class body executes in a temporary namespace that Python seeds with
// implementation names such as __module__, __qualname__, and
// __firstlineno__. The paired __module__ + __qualname__ bindings distinguish
// that namespace from an ordinary function frame. When class definitions are
// filtered, keep all of its dunder machinery out of the learner view too.
function visibleBindings(allBindings, heapByUid, { classBody = false } = {}) {
  const bindings = allBindings ?? [];
  const classNamespace = classBody
    && bindings.some((binding) => binding.name === "__module__")
    && bindings.some((binding) => binding.name === "__qualname__");
  return bindings.filter((binding) => {
    if (isHiddenBinding(binding, heapByUid)) return false;
    return !(displayFilters.hideClassBindings && classNamespace
      && /^__.*__$/.test(binding.name));
  });
}

// Object display policy: implemented by the `displayFilters` flags above;
// full rationale and per-filter documentation in app/MEMORY.md (and README
// "Memory model display rules"). Core invariant regardless of flag state:
// every object target resolves to exactly one object pill.

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

// Refs exposed by a heap node's rendered content (bases excluded because
// they render by name).
function* nodeContentRefs(n) {
  switch (n.kind) {
    case "list": case "tuple": case "set": case "frozenset":
      yield* valueRefs(n.items ?? []);
      break;
    case "dict":
      for (const e of n.entries ?? []) { yield* valueRefs(e.key); yield* valueRefs(e.value); }
      break;
    case "instance":
      yield* valueRefs((n.attributes ?? []).map((a) => a.value));
      break;
    case "class":
      yield* valueRefs((n.attributes ?? []).map((a) => a.value));
      if (!displayFilters.inlineClassBases) yield* valueRefs(n.bases ?? []);
      break;
    case "cell":
      if (n.state === "value") yield* valueRefs(n.content);
      break;
  }
}

// Uids reachable from visible names through displayed contents. Refs that
// render inline (plain functions, modules) are not followed and get no
// identity-bearing pill.
function reachableUids(step, heapByUid) {
  const roots = [
    ...(step.globals ?? []).map((g) => visibleBindings(g.bindings, heapByUid)),
    ...(step.stack ?? []).map((f) => visibleBindings(f.locals, heapByUid, { classBody: true })),
    ...(step.closure_environments ?? []).map((c) => visibleBindings(c.cells, heapByUid)),
  ];
  const seen = new Set();
  const queue = [...valueRefs(roots.map((bindings) => bindings.map((binding) => binding.value)))];
  while (queue.length) {
    const uid = queue.pop();
    if (seen.has(uid)) continue;
    const node = heapByUid.get(uid);
    if (inlineRendering(node)) continue; // rendered as text, not a chip
    seen.add(uid);
    if (node) queue.push(...nodeContentRefs(node));
  }
  return seen;
}

// Heap node fallback/detail rendering for less common engine kinds.
function heapNodeValue(n, heapByUid) {
  switch (n.kind) {
    case "list": case "tuple": case "set": case "frozenset": {
      const open = n.kind === "list" ? "[" : n.kind === "tuple" ? "(" : "{";
      const close = n.kind === "list" ? "]" : n.kind === "tuple" ? ")" : "}";
      return `${open}${(n.items ?? []).map((v) => renderValue(v, heapByUid)).join(", ")}${close}`
        + (n.ordering === "unordered" ? ` <small class="hint">(unordered)</small>` : "")
        + (n.elided_count ? ` <span class="mm-elided">+${n.elided_count} elided</span>` : "");
    }
    case "dict":
      return `{${(n.entries ?? []).map((e) => `${renderValue(e.key, heapByUid)}: ${renderValue(e.value, heapByUid)}`).join(", ")}}`
        + (n.elided_count ? ` <span class="mm-elided">+${n.elided_count} elided</span>` : "");
    case "instance":
      return `${esc(n.class_qualname ?? "")} { ${(n.attributes ?? []).map((a) =>
        `${esc(a.name)}=${renderValue(a.value, heapByUid)}`).join(", ")} }`;
    case "class": {
      // displayFilters.inlineClassBases: bases render by name (no chip) so
      // the implicit builtin `object` base gets no row; unnameable bases
      // are omitted. With the filter off, bases render as ordinary chips.
      let bases = "";
      if (displayFilters.inlineClassBases) {
        const baseNames = (n.bases ?? [])
          .map((b) => (b?.kind === "ref" ? heapByUid?.get(b.uid) : null))
          .filter((base) => base?.kind === "class" && base.qualname)
          .map((base) => esc(base.qualname));
        bases = baseNames.length ? `(${baseNames.join(", ")})` : "";
      } else {
        const chips = (n.bases ?? []).map((b) => renderValue(b, heapByUid)).join(", ");
        bases = chips ? `(${chips})` : "";
      }
      return `class ${esc(n.qualname ?? "")}${bases}`
        + (n.attributes?.length
          ? ` { ${n.attributes.map((a) => `${esc(a.name)}=${renderValue(a.value, heapByUid)}`).join(", ")} }`
          : "");
    }
    case "function":
      return `function ${esc(n.qualname ?? "")}`
        + (n.closure_environment_id != null ? ` <small class="hint">closure env ${n.closure_environment_id}</small>` : "");
    case "generator":
      return `generator (${esc(n.state ?? "?")})`;
    case "cell":
      return n.state === "value" ? `cell → ${renderValue(n.content, heapByUid)}` : "cell (empty)";
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

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function objectPresentation(n, heapByUid) {
  if (!n) return { type: "unknown", description: "data" };
  switch (n.kind) {
    case "list": case "tuple": case "set": case "frozenset":
      return { type: n.kind, description: countLabel((n.items ?? []).length + (n.elided_count ?? 0), "item") };
    case "dict":
      return { type: "dict", description: countLabel((n.entries ?? []).length + (n.elided_count ?? 0), "entry", "entries") };
    case "instance":
      return { type: n.class_qualname ?? n.type_name ?? "object", description: countLabel((n.attributes ?? []).length, "attribute") };
    case "class": {
      let bases = "";
      if (displayFilters.inlineClassBases) {
        const names = (n.bases ?? [])
          .map((base) => base?.kind === "ref" ? heapByUid?.get(base.uid) : null)
          .filter((base) => base?.kind === "class" && base.qualname)
          .map((base) => base.qualname);
        bases = names.length ? `(${names.join(", ")})` : "";
      }
      return { type: "class", description: `${n.qualname ?? "?"}${bases}` };
    }
    case "function": return { type: "function", description: n.qualname ?? "?" };
    case "generator": return { type: "generator", description: n.state ?? "unknown" };
    case "cell": return { type: "closure cell", description: n.state === "value" ? "value" : "empty" };
    case "module": return { type: "module", description: n.module ?? "?" };
    case "opaque": return { type: n.type_name ?? "object", description: "opaque" };
    case "elided": return { type: "elided", description: "object" };
    default: return { type: n.type_name ?? n.kind ?? "object", description: "data" };
  }
}

function objectSummary(n, heapByUid) {
  const { type, description } = objectPresentation(n, heapByUid);
  return `${type} · ${description}`;
}

function renderDataPillContent(uid, presentation, disclosure = null) {
  return `<span class="mm-object-data-id">${dataIdLabel(uid)}</span>
    <span class="mm-object-separator" aria-hidden="true">:</span>
    <span class="mm-object-type">${esc(presentation.type)}</span>
    <span class="mm-value-separator" aria-hidden="true">·</span>
    <span class="mm-object-description">${esc(presentation.description)}</span>
    ${disclosure == null ? "" : `<span class="mm-disclosure" aria-hidden="true">${disclosure}</span>`}`;
}

function innerValue(v, heapByUid) {
  if (v?.kind === "ref") {
    const node = heapByUid?.get(v.uid);
    const inline = inlineRendering(node);
    if (inline) return `<span class="mm-mini-pill">${inline}</span>`;
    return `<button class="mm-inner-ref mm-object-id" type="button" data-target="object-${uidAttr(v.uid)}" data-uid="${uidAttr(v.uid)}" title="Move data ${uidAttr(v.uid)} to the top" aria-label="data ${uidAttr(v.uid)}, ${esc(objectSummary(node, heapByUid))}">↗ ${dataIdLabel(v.uid)} ${esc(objectSummary(node, heapByUid))}</button>`;
  }
  return `<span class="mm-mini-pill">${renderTypedValue(v, heapByUid)}</span>`;
}

function objectDetails(n, heapByUid) {
  if (!n) return '<div class="mm-object-note">Object details unavailable</div>';
  switch (n.kind) {
    case "list": case "tuple": case "set": case "frozenset": {
      const rows = (n.items ?? []).map((v, i) =>
        `<div class="mm-detail-row"><span class="mm-slot">${n.ordering === "unordered" ? "•" : i}</span>${innerValue(v, heapByUid)}</div>`);
      if (n.elided_count) rows.push(`<div class="mm-object-note">+${n.elided_count} elided</div>`);
      return rows.join("") || '<div class="mm-object-note">empty</div>';
    }
    case "dict":
      return (n.entries ?? []).map((entry) =>
        `<div class="mm-detail-row mm-dict-entry">${innerValue(entry.key, heapByUid)}<span class="mm-detail-arrow">→</span>${innerValue(entry.value, heapByUid)}</div>`)
        .concat(n.elided_count ? [`<div class="mm-object-note">+${n.elided_count} elided</div>`] : [])
        .join("") || '<div class="mm-object-note">empty</div>';
    case "instance":
      return (n.attributes ?? []).map((attribute) =>
        `<div class="mm-detail-row"><span class="mm-slot">${esc(attribute.name)}</span>${innerValue(attribute.value, heapByUid)}</div>`)
        .join("") || '<div class="mm-object-note">no attributes</div>';
    case "class": {
      const bases = displayFilters.inlineClassBases ? [] : (n.bases ?? []).map((base, index) =>
        `<div class="mm-detail-row"><span class="mm-slot">base${index || ""}</span>${innerValue(base, heapByUid)}</div>`);
      const attributes = (n.attributes ?? []).map((attribute) =>
        `<div class="mm-detail-row"><span class="mm-slot">${esc(attribute.name)}</span>${innerValue(attribute.value, heapByUid)}</div>`);
      return [...bases, ...attributes].join("") || '<div class="mm-object-note">no attributes</div>';
    }
    case "cell":
      return n.state === "value" ? innerValue(n.content, heapByUid) : '<div class="mm-object-note">empty</div>';
    case "function":
      return n.closure_environment_id != null
        ? `<div class="mm-object-note">closure environment ${n.closure_environment_id}</div>`
        : '<div class="mm-object-note">plain function</div>';
    case "opaque": case "elided":
      return `<div class="mm-object-note">${esc(n.reason ?? "details unavailable")}</div>`;
    default:
      return `<div class="mm-object-note">${heapNodeValue(n, heapByUid)}</div>`;
  }
}

export function createMemoryModel({ root, editor, onUserScrub }) {
  const els = {
    canvas: root.querySelector("[data-role=memory-canvas]"),
    lines: root.querySelector("[data-role=binding-lines]"),
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
  let hoveredName = null; // { cell, scope, name }; survives child mouseovers
  let hoveredObjectTarget = null;
  let surfacedUid = null;
  const expandedUids = new Set();
  let arrowFrame = 0;

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

  function drawBindingArrows() {
    arrowFrame = 0;
    if (!els.canvas || !els.lines) return;
    const canvasRect = els.canvas.getBoundingClientRect();
    const width = els.canvas.scrollWidth;
    const height = els.canvas.scrollHeight;
    els.lines.setAttribute("width", String(width));
    els.lines.setAttribute("height", String(height));
    els.lines.style.width = `${width}px`;
    els.lines.style.height = `${height}px`;

    const targets = new Map([...els.canvas.querySelectorAll("[data-value-id]")]
      .map((node) => [node.dataset.valueId, node]));
    const directPaths = [...els.names.querySelectorAll(".mm-binding-ref[data-target]")].map((source) => {
      const targetId = source.dataset.target;
      const target = targets.get(targetId)?.querySelector(".mm-object-pill");
      if (!target) return "";
      const from = source.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const x1 = from.right - canvasRect.left + els.canvas.scrollLeft;
      const y1 = from.top + from.height / 2 - canvasRect.top + els.canvas.scrollTop;
      const x2 = to.left - canvasRect.left + els.canvas.scrollLeft - 5;
      const y2 = to.top + Math.min(to.height, 34) / 2 - canvasRect.top + els.canvas.scrollTop;
      const bend = Math.max(22, (x2 - x1) * 0.52);
      const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
      const active = hoveredObjectTarget === targetId ? " active" : "";
      return `<path class="mm-binding-path${active}" data-target="${esc(targetId)}" d="${d}" marker-end="url(#mm-arrowhead)"></path>`;
    }).join("");

    const objectPaths = [...els.objects.querySelectorAll(".mm-object-node[data-child-targets]")]
      .flatMap((sourceNode) => sourceNode.dataset.childTargets.split(" ").filter(Boolean).map((targetId) => {
        const source = sourceNode.querySelector(".mm-object-pill");
        const target = targets.get(targetId)?.querySelector(".mm-object-pill");
        if (!source || !target || source === target) return "";
        const from = source.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const x1 = from.left - canvasRect.left + els.canvas.scrollLeft;
        const y1 = from.top + Math.min(from.height, 34) / 2 - canvasRect.top + els.canvas.scrollTop;
        const x2 = to.left - canvasRect.left + els.canvas.scrollLeft - 5;
        const y2 = to.top + Math.min(to.height, 34) / 2 - canvasRect.top + els.canvas.scrollTop;
        const outside = Math.min(x1, x2) - 26;
        const d = `M ${x1} ${y1} C ${outside} ${y1}, ${outside} ${y2}, ${x2} ${y2}`;
        const active = hoveredObjectTarget === targetId ? " active" : "";
        return `<path class="mm-object-path${active}" data-target="${esc(targetId)}" d="${d}" marker-end="url(#mm-arrowhead)"></path>`;
      })).join("");
    els.lines.innerHTML = '<defs><marker id="mm-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8 z"></path></marker></defs>' + directPaths + objectPaths;
  }

  function scheduleBindingArrows() {
    if (arrowFrame) cancelAnimationFrame(arrowFrame);
    arrowFrame = requestAnimationFrame(drawBindingArrows);
  }

  new ResizeObserver(scheduleBindingArrows).observe(els.canvas);
  els.names.addEventListener("scroll", scheduleBindingArrows, { passive: true });

  // Context-aware empty-state message (e.g. "that untraced run left no
  // steps"); reset() reverts to the default line.
  let emptyNote = null;

  function show(i) {
    // A redraw replaces every Names cell. End any active hover first so
    // Director dwell triggers cannot survive after their visual target did.
    endNameHover();
    endObjectHover();
    if (!steps.length) {
      els.counter.textContent = "no steps";
      els.event.textContent = "";
      els.flags.innerHTML = "";
      els.canvas.classList.add("is-empty");
      els.names.innerHTML = `<div class="memory-empty">${esc(emptyNote ?? "Run your program to see names bind to values.")}</div>`;
      els.objects.innerHTML = "";
      els.lines.innerHTML = "";
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
      els.canvas.classList.add("is-empty");
      els.names.innerHTML = '<div class="memory-empty">Nothing is bound yet.</div>';
      els.objects.innerHTML = "";
      els.lines.innerHTML = "";
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
    els.canvas.classList.remove("is-empty");

    els.flags.innerHTML = Object.entries(s.flags ?? {})
      .filter(([, v]) => v)
      .map(([k]) => `<span class="mm-flag on">${esc(k)}</span>`).join(" ");

    const heapByUid = new Map((s.heap ?? []).map((n) => [n.uid, n]));

    // Names pair with scalar pills or data-reference pills matching the
    // canonical Data In Memory form. Heap objects live in a separate ordered
    // list and render exactly once. Contextual SVG paths connect reference
    // pills and containing objects to the hovered target.
    const visible = displayFilters.chipReachableOnly
      ? reachableUids(s, heapByUid)
      : new Set((s.heap ?? []).map((n) => n.uid));
    const targets = new Map();
    const targetOrder = [];

    function registerTarget(id, spec) {
      if (!targets.has(id)) {
        targets.set(id, spec);
        targetOrder.push(id);
      }
      return id;
    }

    function bindingPresentation(value) {
      if (value?.kind === "ref") {
        const node = heapByUid.get(value.uid);
        const inline = inlineRendering(node);
        if (inline) return { html: `<span class="mm-value-pill mm-bound-value">${inline}</span>` };
        const target = registerTarget(`object-${value.uid}`, { kind: "object", node, uid: value.uid });
        return {
          html: `<button class="mm-value-pill mm-data-pill mm-binding-data-pill mm-binding-ref" type="button" data-target="${esc(target)}" data-uid="${uidAttr(value.uid)}" title="Find data ${uidAttr(value.uid)} in Data In Memory" aria-label="data ${uidAttr(value.uid)}"><span class="mm-object-data-id">${dataIdLabel(value.uid)}</span></button>`,
        };
      }
      return { html: `<span class="mm-value-pill mm-bound-value">${renderTypedValue(value, heapByUid)}</span>` };
    }

    function renderScope(label, allBindings, {
      scope = null, fn = null, active = false, classBody = false,
    } = {}) {
      const bindings = visibleBindings(allBindings, heapByUid, { classBody });
      const rows = bindings.length
        ? bindings.map((binding) => {
          const presentation = bindingPresentation(binding.value);
          const attrs = `${scope ? ` data-scope="${esc(scope)}"` : ""}${fn ? ` data-fn="${esc(fn)}"` : ""}`;
          return `<div class="mm-binding"><div class="mm-name-box name"${attrs}>${esc(binding.name)}</div><span class="mm-bind-symbol" aria-hidden="true">→</span>${presentation.html}</div>`;
        }).join("")
        : '<div class="mm-no-names">no names yet</div>';
      return `<section class="mm-scope${active ? " active" : ""}"><div class="mm-scope-title">${esc(label)}${active ? '<span class="mm-active-dot" title="Active scope"></span>' : ""}</div>${rows}</section>`;
    }

    let names = "";
    for (const g of s.globals ?? []) {
      names += renderScope(g.module === "__main__" ? "Globals" : `Globals · ${g.module}`, g.bindings,
        { scope: g.module === "__main__" ? "global" : null });
    }
    (s.stack ?? []).forEach((frame, frameIndex, stack) => {
      if (frame.function === "<module>") return;
      names += renderScope(`${frame.function}()`, frame.locals, {
        scope: "frame",
        fn: frame.function,
        active: frameIndex === stack.length - 1,
        classBody: true,
      });
    });
    for (const closure of s.closure_environments ?? []) {
      names += renderScope(`Closure ${closure.environment_id}`, closure.cells, { scope: "closure" });
    }
    els.names.innerHTML = names || '<div class="memory-empty">Nothing is bound at this step.</div>';

    // Include reachable child objects that have no direct name binding. They
    // remain single nodes and are reached from expanded object contents.
    for (const node of s.heap ?? []) {
      if (visible.has(node.uid)) registerTarget(`object-${node.uid}`, { kind: "object", node, uid: node.uid });
    }

    const orderedTargets = [...targetOrder];
    if (surfacedUid != null) {
      const surfacedId = `object-${surfacedUid}`;
      const surfacedIndex = orderedTargets.indexOf(surfacedId);
      if (surfacedIndex > 0) orderedTargets.unshift(...orderedTargets.splice(surfacedIndex, 1));
    }

    const objectItems = orderedTargets.map((id) => {
      const target = targets.get(id);
      const node = target.node;
      const presentation = objectPresentation(node, heapByUid);
      const summary = `${presentation.type} · ${presentation.description}`;
      const expanded = expandedUids.has(target.uid);
      const dim = displayFilters.dimOpaque && node?.kind === "opaque" ? " dim" : "";
      const childTargets = [...new Set(node ? [...nodeContentRefs(node)] : [])]
        .filter((uid) => visible.has(uid) && !inlineRendering(heapByUid.get(uid)))
        .map((uid) => `object-${uidAttr(uid)}`).join(" ");
      return `<div class="mm-value-node mm-object-node${dim}" data-value-id="${esc(id)}" data-uid="${uidAttr(target.uid)}"${childTargets ? ` data-child-targets="${childTargets}"` : ""}>
        <div class="mm-object-line">
          <button class="mm-value-pill mm-data-pill mm-object-pill" type="button" data-target="${esc(id)}" data-uid="${uidAttr(target.uid)}" aria-expanded="${expanded}" title="${expanded ? "Collapse" : "Expand"} ${esc(summary)}" aria-label="data ${uidAttr(target.uid)}: ${esc(summary)}">${renderDataPillContent(target.uid, presentation, expanded ? "▾" : "▸")}</button>
        </div>
        <div class="mm-object-detail"${expanded ? "" : " hidden"}>${objectDetails(node, heapByUid)}</div>
      </div>`;
    }).join("");
    els.objects.innerHTML = objectItems
      ? `<div class="mm-object-list-title">Data In Memory</div><div class="mm-object-scroll">${objectItems}</div>`
      : '<div class="mm-object-list-title">No Identity-Bearing Data In Memory</div>';
    const objectScroller = els.objects.querySelector(".mm-object-scroll");
    if (objectScroller) {
      // Alignment gutters are added only when the unpadded data list already
      // overflows. They let the first and last entries align with any visible
      // binding without making short lists artificially scrollable.
      const naturallyScrollable = objectScroller.scrollHeight > objectScroller.clientHeight + 1;
      objectScroller.dataset.scrollable = String(naturallyScrollable);
      if (naturallyScrollable) {
        const gutter = Math.max(0, objectScroller.clientHeight - 34);
        objectScroller.style.setProperty("--mm-alignment-gutter", `${gutter}px`);
        objectScroller.classList.add("is-alignment-scrollable");
        const firstObject = objectScroller.querySelector(".mm-object-node");
        if (firstObject) {
          const scrollerTop = objectScroller.getBoundingClientRect().top;
          objectScroller.scrollTop = firstObject.getBoundingClientRect().top - scrollerTop;
        }
      }
      objectScroller.addEventListener("scroll", scheduleBindingArrows, { passive: true });
    }
    scheduleBindingArrows();

    if (editor && hlModule === "__main__") editor.highlightLine(hlLine);
    else editor?.clearHighlight();
    events.emit("memory-rendered", { position: index });
  }

  // `silent` repositions the scrubber WITHOUT claiming the learner scrubbed:
  // no console reconstruction, no shared-scrub broadcast, no event. Used when
  // a finished trace parks at the start anchor — the console must keep showing
  // the run that just happened, or a completed program looks like it printed
  // nothing.
  function userShow(i, { silent = false } = {}) {
    follow = i >= positionCount() - 1; // scrubbing to the end resumes live follow
    show(i);
    if (silent) return;
    onUserScrub?.(stateIndex, steps);
    events.emit("scrubbed", {
      position: index,
      line: lineMode() && index > 0 ? groups[index - 1]?.line : steps[stateIndex]?.location?.line,
      stateIndex,
    });
  }

  modeToggle?.addEventListener("change", () => {
    show(follow ? positionCount() - 1 : Math.min(index, positionCount() - 1));
    events.emit("mode-changed", { lineMode: lineMode() });
  });

  els.slider.addEventListener("input", () => userShow(Number(els.slider.value)));
  els.prev.addEventListener("click", () => userShow(index - 1));
  els.next.addEventListener("click", () => userShow(index + 1));

  // ---- scope-aware hover highlighting -------------------------------------
  // Trace-derived scope info: each executed function's source-line range and
  // local-name set (from every stack frame across all steps). Lazy; rebuilt
  // after new records arrive.
  let scopeInfo = null;
  function computeScopeInfo() {
    if (scopeInfo) return scopeInfo;
    const ranges = new Map(); // function -> {min,max} executed line span
    const localsByFn = new Map(); // function -> Set(local names)
    for (const s of steps) {
      for (const f of s.stack ?? []) {
        if (f.function === "<module>") continue;
        const ln = f.location?.line;
        if (ln != null) {
          const r = ranges.get(f.function);
          if (r) { r.min = Math.min(r.min, ln); r.max = Math.max(r.max, ln); }
          else ranges.set(f.function, { min: ln, max: ln });
        }
        let set = localsByFn.get(f.function);
        if (!set) localsByFn.set(f.function, set = new Set());
        for (const b of f.locals ?? []) set.add(b.name);
      }
    }
    return scopeInfo = { ranges, localsByFn };
  }

  // Line filter for a hovered name: frame scope -> only that function's
  // executed line span; global scope -> everywhere except spans of functions
  // that shadow the name as a local. (Trace-informed: only functions that
  // actually ran have spans.)
  function lineFilterFor(scope, fn, name) {
    const { ranges, localsByFn } = computeScopeInfo();
    if (scope === "frame") {
      const r = ranges.get(fn);
      return r ? (ln) => ln >= r.min && ln <= r.max : null;
    }
    if (scope === "global") {
      const excluded = [...localsByFn]
        .filter(([, names]) => names.has(name))
        .map(([f]) => ranges.get(f))
        .filter(Boolean);
      if (!excluded.length) return null;
      return (ln) => !excluded.some((r) => ln >= r.min && ln <= r.max);
    }
    return null; // closure envs etc.: no scope restriction
  }

  function endNameHover() {
    if (!hoveredName) return;
    const { scope, name } = hoveredName;
    hoveredName = null;
    editor?.clearNameHighlight();
    events.emit("hover-name", { scope, name, active: false });
  }

  // Hovering a name highlights its occurrences in the editor (scope-aware).
  // The active phase lets lessons require a sustained hover before moving on.
  els.names.addEventListener("mouseover", (ev) => {
    const nameBox = ev.target.closest(".mm-name-box.name");
    if (!nameBox) return;
    if (hoveredName?.cell === nameBox) return;
    endNameHover();
    const name = nameBox.textContent.trim();
    const scope = nameBox.dataset.scope ?? null;
    hoveredName = { cell: nameBox, scope, name };
    editor?.highlightName(name, lineFilterFor(scope, nameBox.dataset.fn, name));
    events.emit("hover-name", { scope, name, active: true });
  });
  els.names.addEventListener("mouseout", (ev) => {
    const nameBox = ev.target.closest(".mm-name-box.name");
    if (!nameBox || hoveredName?.cell !== nameBox || nameBox.contains(ev.relatedTarget)) return;
    endNameHover();
  });
  els.names.addEventListener("mouseleave", endNameHover);

  function objectTargetFor(element) {
    if (!(element instanceof Element)) return null;
    const reference = element.closest(".mm-binding-ref[data-target], .mm-inner-ref[data-target]");
    if (reference) return reference.dataset.target;
    return element.closest(".mm-object-node")?.dataset.valueId ?? null;
  }

  function showObjectReferences(target) {
    if (!target || hoveredObjectTarget === target) return;
    endObjectHover();
    hoveredObjectTarget = target;
    const object = els.objects.querySelector(`.mm-object-node[data-value-id="${sel(target)}"]`);
    object?.classList.add("reference-active");
    for (const reference of root.querySelectorAll(`.mm-binding-ref[data-target="${sel(target)}"], .mm-inner-ref[data-target="${sel(target)}"]`)) {
      reference.classList.add("reference-active");
      reference.closest(".mm-binding")?.classList.add("reference-source");
    }
    for (const parent of els.objects.querySelectorAll(".mm-object-node[data-child-targets]")) {
      if (parent.dataset.childTargets.split(" ").includes(target)) parent.classList.add("reference-source");
    }
    scheduleBindingArrows();
  }

  function endObjectHover() {
    if (!hoveredObjectTarget) return;
    hoveredObjectTarget = null;
    for (const element of root.querySelectorAll(".reference-active, .reference-source")) {
      element.classList.remove("reference-active", "reference-source");
    }
    scheduleBindingArrows();
  }

  root.addEventListener("mouseover", (ev) => {
    const target = objectTargetFor(ev.target);
    if (target) showObjectReferences(target);
  });
  root.addEventListener("mouseout", (ev) => {
    const target = objectTargetFor(ev.target);
    if (!target || target !== hoveredObjectTarget) return;
    if (objectTargetFor(ev.relatedTarget) === target) return;
    endObjectHover();
  });

  function focusDataForBinding(reference) {
    const target = reference.dataset.target;
    const object = target ? els.objects.querySelector(`.mm-object-node[data-value-id="${sel(target)}"]`) : null;
    if (!object) return;
    const targetPill = object.querySelector(".mm-object-pill");
    const scroller = object.closest(".mm-object-scroll");

    if (targetPill && scroller?.dataset.scrollable === "true") {
      const sourceRect = reference.getBoundingClientRect();
      const targetRect = targetPill.getBoundingClientRect();
      const delta = (targetRect.top + targetRect.height / 2) - (sourceRect.top + sourceRect.height / 2);
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const nextScroll = Math.max(0, Math.min(maxScroll, scroller.scrollTop + delta));
      if (Math.abs(nextScroll - scroller.scrollTop) > 1) {
        scroller.scrollTo({ top: nextScroll, behavior: "smooth" });
      }
    }

    object.classList.remove("flash");
    requestAnimationFrame(() => object.classList.add("flash"));
    setTimeout(() => object.classList.remove("flash"), 900);
    events.emit("chip-clicked", { uid: Number(reference.dataset.uid) });
  }

  // Compound pills expand in place. Binding references navigate to their
  // canonical data pill without changing data order. References inside an
  // expanded object retain their existing surface-to-top behavior.
  root.addEventListener("click", (ev) => {
    const bindingReference = ev.target.closest(".mm-binding-ref[data-uid]");
    if (bindingReference) {
      focusDataForBinding(bindingReference);
      return;
    }

    const innerReference = ev.target.closest(".mm-inner-ref[data-uid]");
    if (innerReference) {
      const uid = Number(innerReference.dataset.uid);
      surfacedUid = uid;
      events.emit("chip-clicked", { uid });
      show(index);
      return;
    }

    const objectPill = ev.target.closest(".mm-object-pill");
    if (objectPill) {
      const node = objectPill.closest(".mm-object-node");
      const uid = Number(node.dataset.uid);
      const willExpand = objectPill.getAttribute("aria-expanded") !== "true";
      if (willExpand) expandedUids.add(uid);
      else expandedUids.delete(uid);
      surfacedUid = uid;
      events.emit("chip-clicked", { uid });
      show(index);
      return;
    }

    const ref = ev.target.closest(".mm-inner-ref, a.mm-ref");
    if (!ref) return;
    ev.preventDefault();
    const node = els.objects.querySelector(`.mm-object-node[data-uid="${sel(ref.dataset.uid)}"]`);
    if (!node) return;
    node.scrollIntoView({ block: "nearest" });
    node.classList.add("flash");
    setTimeout(() => node.classList.remove("flash"), 900);
    events.emit("chip-clicked", { uid: Number(ref.dataset.uid) });
  });

  // Rendering a snapshot is O(step contents); doing it synchronously per
  // record freezes the page on big traces. Appends only schedule a render of
  // the latest step, at most one per animation frame.
  let renderScheduled = false;
  function scheduleShowLatest() {
    if (renderScheduled) return;
    renderScheduled = true;
    const render = () => {
      renderScheduled = false;
      if (follow) show(positionCount() - 1);
      else show(index); // keep position, but refresh slider max/counter
    };
    // rAF never fires in hidden/backgrounded pages — records streaming into
    // a background tab would leave the pane stale. Fall back to a throttled
    // timeout there.
    if (document.hidden) setTimeout(render, 200);
    else requestAnimationFrame(render);
  }

  show(0);

  return {
    appendRecord(r) {
      if (r.kind === "step") {
        steps.push(r);
        trackGroup(steps.length - 1);
        scopeInfo = null; // scope spans grow as the trace streams
        scheduleShowLatest();
      }
    },
    reset() {
      steps = [];
      groups = [];
      index = 0;
      follow = true;
      scopeInfo = null;
      surfacedUid = null;
      expandedUids.clear();
      emptyNote = null;
      show(0);
    },
    // After an untraced run the empty pane can say WHY it's empty.
    setEmptyNote(text) { emptyNote = text ?? null; if (!steps.length) show(0); },
    // Position-space API (positions = executed lines in line-step mode,
    // raw engine steps otherwise).
    goTo: (i, opts) => userShow(i, opts),
    stepCount: () => positionCount(),
    stepIndex: () => index,
    steps: () => steps, // raw engine step records, always
    // Executed-line positions (line-step grouping) with the raw step index
    // whose snapshot each position displays — the question engine's input.
    linePositions: () => groups.map((g, gi) => ({
      line: g.line,
      function: g.function,
      module: g.module,
      stateIndex: groups[gi + 1]?.start ?? steps.length - 1,
    })),
    isFollowing: () => follow,
    lineMode,
    // Display-filter toggles (app/MEMORY.md). Mutate then call refresh(),
    // e.g. plp.memory.filters.inlinePlainFunctions = false; plp.memory.refresh()
    filters: displayFilters,
    refresh: () => show(index),
  };
}
