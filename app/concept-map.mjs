// The learner-facing concept map ("My map"): the KB's concept DAG rendered
// as seven calm topic lanes of chips — met (done), frontier (ready to try),
// locked (not yet). HTML chips in normal flow with an SVG edge underlay
// measured from the DOM (the memory pane's mm-binding-lines precedent);
// in-lane edges only — cross-topic prerequisites surface in the chip's
// detail card as "First: …" jump links, keeping every lane readable.
//
// mapModel() is PURE (loads in plain Node for tests); renderConceptMap()
// is the DOM half.

import { loadKB } from "../kb/index.mjs";
import { conceptTopics, kbTopics } from "./kb-session.mjs";

const kb = loadKB();

const byTag = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const label = (tag) => kb.concepts.get(tag)?.slug.replaceAll("-", " ") ?? tag;

// met: iterable of met tags. → { lanes: [{ id, title, met, total, rows: [[node…]] }] }
// node = { tag, label, state: "met"|"frontier"|"locked",
//          parentsInLane: [tag], parentsCross: [{tag,label,topicTitle}], statement }
// Rows are longest-path layers over IN-LANE non-structural parents; within a
// row, one barycenter pass orders children under their parents (ties by tag)
// so the layout is deterministic.
export function mapModel(met) {
  const metSet = new Set(met);
  const frontier = kb.frontier(metSet);
  const topics = conceptTopics();
  const titleOf = new Map(kbTopics.map((t) => [t.id, t.title]));

  // In-lane longest-path row per tag (structural roots are omitted —
  // "vacuously met" has no learner meaning).
  const rowOf = new Map();
  const rowFor = (tag) => {
    if (rowOf.has(tag)) return rowOf.get(tag);
    const laneId = topics.get(tag);
    const parents = (kb.concepts.get(tag)?.parents ?? [])
      .filter((p) => !kb.structural.has(p) && topics.get(p) === laneId);
    const r = parents.length ? Math.max(...parents.map(rowFor)) + 1 : 0;
    rowOf.set(tag, r);
    return r;
  };

  const lanes = kbTopics.map((t) => ({ id: t.id, title: t.title, met: 0, total: 0, rows: [] }));
  const byLane = new Map(lanes.map((l) => [l.id, l]));
  for (const [tag, laneId] of [...topics].sort(([a], [b]) => byTag(a, b))) {
    const lane = byLane.get(laneId);
    if (!lane) continue;
    const c = kb.concepts.get(tag);
    const state = metSet.has(tag) ? "met" : frontier.has(tag) ? "frontier" : "locked";
    lane.total += 1;
    if (state === "met") lane.met += 1;
    const node = {
      tag,
      label: label(tag),
      state,
      statement: c.statement,
      parentsInLane: c.parents.filter((p) => !kb.structural.has(p) && topics.get(p) === laneId),
      parentsCross: c.parents
        .filter((p) => !kb.structural.has(p) && topics.get(p) !== laneId)
        .map((p) => ({ tag: p, label: label(p), topicTitle: titleOf.get(topics.get(p)) ?? "" })),
    };
    const r = rowFor(tag);
    (lane.rows[r] ??= []).push(node);
  }
  // Barycenter ordering: children sit under the mean position of their
  // in-lane parents in the row above; ties break by tag.
  for (const lane of lanes) {
    lane.rows = lane.rows.filter(Boolean);
    for (let r = 1; r < lane.rows.length; r++) {
      const prevIndex = new Map(lane.rows[r - 1].map((n, i) => [n.tag, i]));
      lane.rows[r].sort((a, b) => {
        const bary = (n) => {
          const idx = n.parentsInLane.map((p) => prevIndex.get(p)).filter((i) => i !== undefined);
          return idx.length ? idx.reduce((x, y) => x + y, 0) / idx.length : 1e9;
        };
        return (bary(a) - bary(b)) || byTag(a.tag, b.tag);
      });
    }
  }
  return { lanes };
}

// Render into `host`. onPractice(tag) starts a targeted round;
// onJump(tag) scrolls to and flashes a chip (cross-lane prerequisite links).
export function renderConceptMap(host, model, { onPractice, onJump } = {}) {
  host.textContent = "";
  host.className = "cm-map";
  const chipByTag = new Map();
  const jump = (tag) => {
    const chip = chipByTag.get(tag);
    if (!chip) return;
    chip.scrollIntoView({ block: "center", behavior: "smooth" });
    chip.classList.add("cm-flash");
    chip.addEventListener("animationend", () => chip.classList.remove("cm-flash"), { once: true });
    onJump?.(tag);
  };

  for (const lane of model.lanes) {
    const section = document.createElement("section");
    section.className = "cm-lane";
    const head = document.createElement("h3");
    head.className = "cm-lane-title";
    head.textContent = `${lane.title} · ${lane.met}/${lane.total}`;
    section.appendChild(head);

    const rowsHost = document.createElement("div");
    rowsHost.className = "cm-rows";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("cm-edge-lines");
    rowsHost.appendChild(svg);

    let detail = null;
    for (const row of lane.rows) {
      const rowEl = document.createElement("div");
      rowEl.className = "cm-row";
      for (const node of row) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `cm-node ${node.state}`;
        chip.dataset.tag = node.tag;
        chip.textContent = (node.state === "met" ? "✓ " : "") + node.label;
        chip.setAttribute("aria-label", `${node.label} — ${node.state === "met" ? "learned" : node.state === "frontier" ? "ready to try" : "not yet"}`);
        chip.addEventListener("click", () => {
          if (detail?.dataset.tag === node.tag) { detail.remove(); detail = null; return; }
          detail?.remove();
          detail = buildDetail(node, { onPractice, jump });
          rowEl.after(detail);
        });
        chipByTag.set(node.tag, chip);
        rowEl.appendChild(chip);
      }
      rowsHost.appendChild(rowEl);
    }
    section.appendChild(rowsHost);
    host.appendChild(section);

    // Edge underlay: parent → child cubics, measured from the laid-out chips
    // (drawn after insertion; redrawn when the lane resizes).
    const draw = () => {
      const rect = rowsHost.getBoundingClientRect();
      if (!rect.width) return;
      svg.setAttribute("width", rect.width);
      svg.setAttribute("height", rect.height);
      svg.textContent = "";
      for (const row of lane.rows) {
        for (const node of row) {
          const to = chipByTag.get(node.tag)?.getBoundingClientRect();
          if (!to) continue;
          for (const p of node.parentsInLane) {
            const from = chipByTag.get(p)?.getBoundingClientRect();
            if (!from) continue;
            const x1 = from.left + from.width / 2 - rect.left;
            const y1 = from.bottom - rect.top;
            const x2 = to.left + to.width / 2 - rect.left;
            const y2 = to.top - rect.top;
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`);
            path.classList.add("cm-edge");
            if (node.state === "frontier") path.classList.add("into-frontier");
            svg.appendChild(path);
          }
        }
      }
    };
    requestAnimationFrame(draw);
    new ResizeObserver(() => draw()).observe(rowsHost);
  }
  return { jump };
}

function buildDetail(node, { onPractice, jump }) {
  const card = document.createElement("div");
  card.className = "tutor-card cm-detail";
  card.dataset.tag = node.tag;
  const statement = document.createElement("p");
  statement.textContent = node.statement;
  card.appendChild(statement);
  const status = document.createElement("p");
  status.className = "hint";
  if (node.state === "met") status.textContent = "You've got this.";
  else if (node.state === "frontier") status.textContent = "Ready to try.";
  else {
    status.textContent = "First: ";
    const parents = [...node.parentsInLane.map((tag) => ({ tag, label: labelOf(tag), cross: null })),
      ...node.parentsCross.map((p) => ({ tag: p.tag, label: p.label, cross: p.topicTitle }))];
    parents.forEach((p, i) => {
      if (i) status.append(", ");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cm-parent-link";
      btn.textContent = p.cross ? `${p.label} (${p.cross})` : p.label;
      btn.addEventListener("click", () => jump(p.tag));
      status.appendChild(btn);
    });
  }
  card.appendChild(status);
  if (onPractice) {
    // The map recommends, it never forbids: a locked chip keeps its
    // "First: …" guidance but still lets the learner jump ahead — its
    // first ask teaches the rule (introStyle), and met is still only
    // EARNED, so the map stays honest about what's been demonstrated.
    const go = document.createElement("button");
    go.type = "button";
    if (node.state !== "locked") go.className = "primary";
    go.textContent = node.state === "locked" ? "Try it anyway ▶" : "Practice this ▶";
    go.addEventListener("click", () => onPractice(node.tag));
    card.appendChild(go);
  }
  return card;
}

function labelOf(tag) {
  return label(tag);
}
