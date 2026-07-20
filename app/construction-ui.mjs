// Interactive renderers for construction question payloads. The pure answer
// and grading contracts live in construction.mjs; this module only owns DOM.

import { cloneConstructionGraph, emptyDataNode } from "./construction.mjs";

const COMMON_DATA_KINDS = ["list", "dict", "tuple", "set", "instance"];
const ADVANCED_DATA_KINDS = ["frozenset", "class", "cell", "generator", "opaque"];
const COMMON_VALUE_TYPES = ["data reference", "int", "str", "float", "bool", "NoneType"];
const ADVANCED_VALUE_TYPES = ["bytes", "complex", "range", "slice", "ellipsis", "function", "module", "elided"];
let typeListSerial = 0;

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function option(value, label, selected = false) {
  const node = element("option", "", label);
  node.value = value;
  node.selected = selected;
  return node;
}

// Editable type picker backed by a dynamically filtered datalist. Common
// types appear when the field is empty; advanced types only appear after the
// learner searches for them. Arbitrary text is not committed as a type.
function filteringTypeInput({ value, label, common, advanced, className, allowEmpty = false, onCommit }) {
  const wrap = element("span", "construction-type-picker");
  const input = element("input", `${className} construction-type-input`);
  input.type = "text";
  input.value = value ?? "";
  input.placeholder = allowEmpty ? "type or search" : "search types";
  input.autocomplete = "off";
  input.setAttribute("aria-label", label);
  const list = element("datalist");
  list.id = `construction-type-list-${++typeListSerial}`;
  input.setAttribute("list", list.id);
  const all = [...new Set([...common, ...advanced, value].filter(Boolean))];

  function refreshOptions() {
    const query = input.value.trim().toLowerCase();
    const candidates = (query ? all : common)
      .filter((type) => !query || type.toLowerCase().includes(query));
    list.textContent = "";
    for (const type of candidates) list.appendChild(option(type, type));
    input.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
  }

  function commit() {
    const typed = input.value.trim();
    if (!typed && allowEmpty) { onCommit(""); return true; }
    const exact = all.find((type) => type.toLowerCase() === typed.toLowerCase());
    const matches = all.filter((type) => type.toLowerCase().includes(typed.toLowerCase()));
    const canonical = exact ?? (matches.length === 1 ? matches[0] : null);
    if (!canonical) {
      input.classList.add("invalid");
      input.setAttribute("aria-invalid", "true");
      return false;
    }
    input.value = canonical;
    onCommit(canonical);
    return true;
  }

  input.addEventListener("input", refreshOptions);
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    else if (event.key === "Escape") {
      input.value = value ?? "";
      refreshOptions();
    }
  });
  refreshOptions();
  wrap.append(input, list);
  return wrap;
}

function dataIdElement(id) {
  const node = element("span", "construction-data-id");
  const match = String(id).match(/^data(\d+)$/);
  if (!match) node.textContent = id;
  else {
    node.append("data");
    node.appendChild(element("sub", "", match[1]));
  }
  return node;
}

function defaultScalar(type) {
  if (type === "bool") return "False";
  if (type === "NoneType") return "None";
  if (type === "str") return '""';
  return "0";
}

function valueLabel(value) {
  if (!value) return "?";
  if (value.kind === "ref") return value.target;
  return `${value.type} · ${value.value}`;
}

function nodeSummary(node) {
  const values = (node.items ?? []).map(valueLabel);
  switch (node.kind) {
    case "list": return `[${values.join(", ")}]`;
    case "tuple": return `(${values.join(", ")}${values.length === 1 ? "," : ""})`;
    case "set": case "frozenset": return `{${values.join(", ")}}`;
    case "dict": return `{${(node.entries ?? []).map((entry) => `${valueLabel(entry.key)}: ${valueLabel(entry.value)}`).join(", ")}}`;
    case "instance": case "class": return `{${(node.fields ?? []).map((field) => `${field.name}=${valueLabel(field.value)}`).join(", ")}}`;
    case "cell": return values[0] ?? "empty";
    default: return node.description || node.kind;
  }
}

function nextDataId(state) {
  const used = new Set(state.data.map((node) => node.id));
  let index = 1;
  while (used.has(`data${index}`)) index++;
  return `data${index}`;
}

export function createMemoryConstruction(container, configuration) {
  const state = cloneConstructionGraph(configuration.starter);
  const root = element("div", "construction-workspace memory-construction");
  const toolbar = element("div", "construction-toolbar");
  const help = element("span", "construction-help", "Create names and data, then connect them. Nested data uses a reference to an existing or newly created data pill.");
  const addDataButton = element("button", "", "+ Data");
  addDataButton.type = "button";
  toolbar.append(addDataButton, help);
  const canvas = element("div", "construction-canvas");
  const scopesRegion = element("section", "construction-region construction-scopes");
  const dataRegion = element("section", "construction-region construction-data");
  const feedback = element("div", "construction-feedback");
  canvas.append(scopesRegion, dataRegion);
  root.append(toolbar, canvas, feedback);
  container.appendChild(root);

  function addData(kind = "list") {
    const node = emptyDataNode(nextDataId(state), kind);
    state.data.push(node);
    render();
    return node.id;
  }

  addDataButton.addEventListener("click", () => addData());

  function valueEditor(read, write, label) {
    const wrap = element("div", "construction-value-editor");
    const current = read();
    const currentType = !current ? "" : current.kind === "ref" ? "data reference" : current.type;
    wrap.appendChild(filteringTypeInput({
      value: currentType,
      label: `${label} type`,
      common: COMMON_VALUE_TYPES,
      advanced: ADVANCED_VALUE_TYPES,
      className: "construction-value-kind",
      allowEmpty: true,
      onCommit(type) {
        if (!type) write(null);
        else if (type === "data reference") {
          if (current?.kind === "ref") return;
          const target = state.data[0]?.id ?? addData();
          write({ kind: "ref", target });
        } else {
          if (current?.kind === "scalar" && current.type === type) return;
          write({ kind: "scalar", type, value: defaultScalar(type) });
        }
        render();
      },
    }));

    function renderValueControl() {
      wrap.querySelectorAll(".construction-value-control").forEach((node) => node.remove());
      const value = read();
      if (!value) return;
      const control = element("div", "construction-value-control");
      if (value.kind === "ref") {
        const target = element("select", "construction-target-select");
        target.setAttribute("aria-label", `${label} data target`);
        if (!state.data.length) target.append(option("", "no data yet", true));
        for (const node of state.data) target.append(option(node.id, node.id, node.id === value.target));
        if (value.target && !state.data.some((node) => node.id === value.target)) {
          target.append(option(value.target, `${value.target} (missing)`, true));
        }
        target.addEventListener("change", () => { value.target = target.value; });
        const nested = element("button", "construction-nested-button", "+ new data");
        nested.type = "button";
        nested.title = "Create data and place a reference to it here";
        nested.addEventListener("click", () => {
          const id = addData();
          value.target = id;
          render();
        });
        control.append(target, nested);
      } else if (value.type === "bool") {
        const input = element("select", "construction-scalar-input");
        input.setAttribute("aria-label", `${label} value`);
        input.append(option("False", "False", value.value === "False"), option("True", "True", value.value === "True"));
        input.addEventListener("change", () => { value.value = input.value; });
        control.appendChild(input);
      } else if (value.type !== "NoneType") {
        const input = element("input", "construction-scalar-input");
        input.type = "text";
        input.value = value.value ?? "";
        input.setAttribute("aria-label", `${label} value`);
        input.addEventListener("input", () => { value.value = input.value; });
        control.appendChild(input);
      } else {
        control.appendChild(element("span", "construction-fixed-value", "None"));
      }
      wrap.appendChild(control);
    }

    renderValueControl();
    return wrap;
  }

  function removeReferencesTo(id) {
    function clear(value) { if (value?.kind === "ref" && value.target === id) return null; return value; }
    for (const scope of state.scopes) for (const binding of scope.bindings) binding.value = clear(binding.value);
    for (const node of state.data) {
      node.items = (node.items ?? []).map(clear);
      node.entries = (node.entries ?? []).map((entry) => ({ key: clear(entry.key), value: clear(entry.value) }));
      node.fields = (node.fields ?? []).map((field) => ({ ...field, value: clear(field.value) }));
    }
  }

  function renderScopes() {
    scopesRegion.textContent = "";
    scopesRegion.appendChild(element("h4", "construction-region-title", "Variable Names"));
    for (const scope of state.scopes) {
      const card = element("div", "construction-scope-card");
      card.dataset.scopeId = scope.id;
      card.appendChild(element("div", "construction-scope-title", scope.label));
      for (const binding of scope.bindings) {
        const row = element("div", "construction-binding-row");
        const name = element("input", "construction-name-input");
        name.type = "text";
        name.value = binding.name;
        name.placeholder = "name";
        name.setAttribute("aria-label", `${scope.label} variable name`);
        name.addEventListener("input", () => { binding.name = name.value; });
        const arrow = element("span", "construction-arrow", "→");
        const remove = element("button", "construction-remove", "×");
        remove.type = "button";
        remove.title = `Remove ${binding.name || "name"}`;
        remove.addEventListener("click", () => {
          scope.bindings.splice(scope.bindings.indexOf(binding), 1);
          render();
        });
        row.append(name, arrow, valueEditor(() => binding.value, (value) => { binding.value = value; }, binding.name || "variable"), remove);
        card.appendChild(row);
      }
      const addName = element("button", "construction-add-name", "+ Name");
      addName.type = "button";
      addName.addEventListener("click", () => {
        scope.bindings.push({ name: "", value: null });
        render();
        card.querySelector(".construction-binding-row:last-of-type .construction-name-input")?.focus();
      });
      card.appendChild(addName);
      scopesRegion.appendChild(card);
    }
  }

  function dataValueRow(node, list, index, label) {
    const row = element("div", "construction-content-row");
    row.appendChild(element("span", "construction-slot", label));
    row.appendChild(valueEditor(() => list[index], (value) => { list[index] = value; }, `${node.id} ${label}`));
    const remove = element("button", "construction-remove", "×");
    remove.type = "button";
    remove.addEventListener("click", () => { list.splice(index, 1); render(); });
    row.appendChild(remove);
    return row;
  }

  function renderDataDetails(card, node) {
    const details = element("div", "construction-data-details");
    if (["list", "tuple", "set", "frozenset", "cell"].includes(node.kind)) {
      (node.items ??= []).forEach((value, index) => details.appendChild(dataValueRow(node, node.items, index, node.kind === "cell" ? "value" : String(index))));
      const add = element("button", "construction-add-content", node.kind === "cell" ? "+ Value" : "+ Item");
      add.type = "button";
      add.disabled = node.kind === "cell" && node.items.length > 0;
      add.addEventListener("click", () => { node.items.push(null); render(); });
      details.appendChild(add);
    } else if (node.kind === "dict") {
      (node.entries ??= []).forEach((entry, index) => {
        const row = element("div", "construction-content-row construction-dict-row");
        row.append(valueEditor(() => entry.key, (value) => { entry.key = value; }, `${node.id} key ${index}`));
        row.appendChild(element("span", "construction-arrow", "→"));
        row.append(valueEditor(() => entry.value, (value) => { entry.value = value; }, `${node.id} value ${index}`));
        const remove = element("button", "construction-remove", "×");
        remove.type = "button";
        remove.addEventListener("click", () => { node.entries.splice(index, 1); render(); });
        row.appendChild(remove);
        details.appendChild(row);
      });
      const add = element("button", "construction-add-content", "+ Entry");
      add.type = "button";
      add.addEventListener("click", () => { node.entries.push({ key: null, value: null }); render(); });
      details.appendChild(add);
    } else if (["instance", "class"].includes(node.kind)) {
      (node.fields ??= []).forEach((field, index) => {
        const row = element("div", "construction-content-row");
        const name = element("input", "construction-field-name");
        name.type = "text";
        name.value = field.name;
        name.placeholder = "attribute";
        name.addEventListener("input", () => { field.name = name.value; });
        row.append(name, element("span", "construction-arrow", "="));
        row.appendChild(valueEditor(() => field.value, (value) => { field.value = value; }, `${node.id} attribute`));
        const remove = element("button", "construction-remove", "×");
        remove.type = "button";
        remove.addEventListener("click", () => { node.fields.splice(index, 1); render(); });
        row.appendChild(remove);
        details.appendChild(row);
      });
      const add = element("button", "construction-add-content", "+ Attribute");
      add.type = "button";
      add.addEventListener("click", () => { node.fields.push({ name: "", value: null }); render(); });
      details.appendChild(add);
    } else {
      const description = element("input", "construction-description-input");
      description.type = "text";
      description.value = node.description ?? "";
      description.placeholder = "value or description";
      description.addEventListener("input", () => { node.description = description.value; });
      details.appendChild(description);
    }
    card.appendChild(details);
  }

  function renderData() {
    dataRegion.textContent = "";
    dataRegion.appendChild(element("h4", "construction-region-title", "Data In Memory"));
    if (!state.data.length) dataRegion.appendChild(element("p", "construction-empty", "No identity-bearing data yet."));
    for (const node of state.data) {
      const card = element("div", "construction-data-card");
      card.dataset.dataId = node.id;
      const pill = element("div", "construction-data-pill");
      pill.appendChild(dataIdElement(node.id));
      pill.appendChild(element("span", "construction-colon", ":"));
      pill.appendChild(filteringTypeInput({
        value: node.kind,
        label: `${node.id} data type`,
        common: COMMON_DATA_KINDS,
        advanced: ADVANCED_DATA_KINDS,
        className: "construction-data-kind",
        onCommit(kind) {
          if (kind === node.kind) return;
          node.kind = kind;
          node.type = kind;
          node.items = []; node.entries = []; node.fields = []; node.description = "";
          render();
        },
      }));
      if (node.kind === "instance") {
        const instanceType = element("input", "construction-instance-type");
        instanceType.type = "text";
        instanceType.value = node.type === "instance" ? "" : node.type;
        instanceType.placeholder = "class name";
        instanceType.setAttribute("aria-label", `${node.id} class name`);
        instanceType.addEventListener("input", () => { node.type = instanceType.value || "instance"; });
        pill.appendChild(instanceType);
      }
      pill.appendChild(element("span", "construction-dot", "·"));
      pill.appendChild(element("span", "construction-data-summary", nodeSummary(node)));
      const remove = element("button", "construction-remove construction-remove-data", "×");
      remove.type = "button";
      remove.title = `Remove ${node.id}`;
      remove.addEventListener("click", () => {
        state.data.splice(state.data.indexOf(node), 1);
        removeReferencesTo(node.id);
        render();
      });
      pill.appendChild(remove);
      card.appendChild(pill);
      renderDataDetails(card, node);
      dataRegion.appendChild(card);
    }
  }

  function render() {
    renderScopes();
    renderData();
    root.classList.remove("correct", "incorrect");
    feedback.textContent = "";
  }

  function mark(result) {
    root.classList.toggle("correct", result.correct === true);
    root.classList.toggle("incorrect", result.correct === false);
    feedback.textContent = "";
    if (result.correct) feedback.appendChild(element("p", "construction-success", "The bindings, data, contents, and identity relationships are correct."));
    else {
      const list = element("ul");
      for (const message of result.feedback ?? ["The memory construction is not complete yet."]) list.appendChild(element("li", "", message));
      feedback.appendChild(list);
    }
  }

  render();
  return {
    root,
    getAnswer: () => ({ type: "memory-graph-answer", graph: cloneConstructionGraph(state) }),
    mark,
  };
}

export function createEvaluationConstruction(container, evaluation) {
  const root = element("div", "construction-workspace evaluation-construction");
  const source = element("code", "evaluation-source", evaluation.source);
  const instruction = element("p", "construction-help", "Select action cards to place them in order. Use the arrow buttons to revise the sequence.");
  const layout = element("div", "evaluation-layout");
  const palette = element("section", "evaluation-palette");
  palette.appendChild(element("h4", "construction-region-title", "Available Actions"));
  const tray = element("section", "evaluation-tray");
  tray.appendChild(element("h4", "construction-region-title", "Evaluation Sequence"));
  const cardsHost = element("div", "evaluation-cards");
  tray.appendChild(cardsHost);
  const feedback = element("div", "construction-feedback");
  layout.append(palette, tray);
  root.append(source, instruction, layout, feedback);
  container.appendChild(root);
  const order = [];

  function render() {
    palette.querySelectorAll(".evaluation-palette-card").forEach((node) => node.remove());
    for (const card of evaluation.palette) {
      const button = element("button", "evaluation-palette-card");
      button.type = "button";
      button.dataset.cardId = card.id;
      button.disabled = order.includes(card.id);
      button.append(element("strong", "", card.label), element("span", "", card.detail));
      button.addEventListener("click", () => { order.push(card.id); render(); });
      palette.appendChild(button);
    }
    cardsHost.textContent = "";
    if (!order.length) cardsHost.appendChild(element("p", "construction-empty", "The sequence is empty."));
    order.forEach((id, index) => {
      const card = evaluation.cards.find((candidate) => candidate.id === id);
      const row = element("div", "evaluation-sequence-card");
      row.dataset.cardId = id;
      row.appendChild(element("span", "evaluation-number", String(index + 1)));
      const copy = element("div", "evaluation-card-copy");
      copy.append(element("strong", "", card.label), element("span", "", card.detail));
      row.appendChild(copy);
      const up = element("button", "", "↑");
      up.type = "button"; up.title = "Move earlier"; up.disabled = index === 0;
      up.addEventListener("click", () => { [order[index - 1], order[index]] = [order[index], order[index - 1]]; render(); });
      const down = element("button", "", "↓");
      down.type = "button"; down.title = "Move later"; down.disabled = index === order.length - 1;
      down.addEventListener("click", () => { [order[index], order[index + 1]] = [order[index + 1], order[index]]; render(); });
      const remove = element("button", "construction-remove", "×");
      remove.type = "button"; remove.title = "Remove action";
      remove.addEventListener("click", () => { order.splice(index, 1); render(); });
      row.append(up, down, remove);
      cardsHost.appendChild(row);
    });
    root.classList.remove("correct", "incorrect");
    feedback.textContent = "";
  }

  function mark(result) {
    root.classList.toggle("correct", result.correct === true);
    root.classList.toggle("incorrect", result.correct === false);
    [...cardsHost.querySelectorAll(".evaluation-sequence-card")].forEach((row, index) => {
      row.classList.toggle("bad", result.perIndex?.[index] === false);
      row.classList.toggle("ok", result.perIndex?.[index] === true);
    });
    feedback.textContent = result.correct
      ? "Python evaluates these actions in this order."
      : result.feedback?.[0] ?? "The sequence is not complete yet.";
  }

  render();
  return { root, getAnswer: () => [...order], mark };
}
