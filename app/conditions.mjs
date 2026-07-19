// Curated, trace-grounded predicate library for lesson triggers.
// Lessons reference these BY NAME ONLY ({ check: "nameIs", ... }); adding a
// predicate = adding a function here + a row in app/DIRECTOR.md.
//
// Every predicate receives (args, app) where app = { runner, memory,
// consoleUI, editor } — live handles — and must be side-effect free and
// synchronous. Ground truth is the latest run's trace (memory.steps());
// uid comparisons only ever happen WITHIN one step (identity is per-step).

import { textValue } from "./questions.mjs";

function finalStep(app) {
  const steps = app.memory.steps();
  return steps.length ? steps[steps.length - 1] : null;
}

function heapOf(step) {
  return new Map((step.heap ?? []).map((n) => [n.uid, n]));
}

function findBinding(step, scope, name) {
  if (scope === "globals" || scope === undefined) {
    for (const g of step.globals ?? []) {
      if (g.module !== "__main__") continue;
      const b = (g.bindings ?? []).find((x) => x.name === name);
      if (b) return b;
    }
  }
  for (const f of step.stack ?? []) {
    if (f.function === "<module>") continue;
    if (scope !== undefined && scope !== "globals" && f.function !== scope) continue;
    if (scope === "globals") continue;
    const b = (f.locals ?? []).find((x) => x.name === name);
    if (b) return b;
  }
  return null;
}

const norm = (s) => String(s ?? "").replace(/\s+/g, "").replace(/'/g, '"');

export const conditions = {
  // The last run completed (any successful terminal).
  completedRun(_args, app) {
    return app.runner.summary()?.terminal_reason === "completed";
  },

  // The last run ended with the given terminal reason.
  endedWith({ reason }, app) {
    return app.runner.summary()?.terminal_reason === reason;
  },

  // A name's final value (text form, whitespace/quote-insensitive) matches.
  nameIs({ scope = "globals", name, value }, app) {
    const step = finalStep(app);
    if (!step) return false;
    const b = findBinding(step, scope, name);
    if (!b) return false;
    return norm(textValue(b.value, heapOf(step))) === norm(value);
  },

  // A name exists (bound) in the final snapshot.
  nameExists({ scope = "globals", name }, app) {
    const step = finalStep(app);
    return Boolean(step && findBinding(step, scope, name));
  },

  // Two (or more) names reference the SAME object in the final snapshot —
  // the aliasing predicate. Same-step uid comparison only.
  sameObject({ names, scope = "globals" }, app) {
    const step = finalStep(app);
    if (!step || !names?.length) return false;
    const uids = names.map((n) => {
      const b = findBinding(step, scope, n);
      return b?.value?.kind === "ref" ? b.value.uid : Symbol("non-ref");
    });
    return uids.every((u) => typeof u === "number" && u === uids[0]);
  },

  // The transcript (program output incl. echoed input) contains text.
  outputContains({ text }, app) {
    return app.consoleUI.text().includes(text);
  },

  // Some step of the last run executed the given __main__ source line.
  ranLine({ line }, app) {
    return app.memory.steps().some((s) =>
      s.location?.module === "__main__" && s.location.line === line);
  },

  // The last run raised an uncaught exception (optionally of a given type).
  raisedException({ type } = {}, app) {
    const records = app.runner.records();
    const t = records[records.length - 1];
    return t?.kind === "terminal" && Boolean(t.exception)
      && (type === undefined || t.exception.type_name === type);
  },

  // The program answered at least n input() prompts this run.
  usedInput({ count = 1 } = {}, app) {
    return app.memory.steps().filter((s) => s.event === "input").length >= count;
  },

  // The current editor source contains / lacks a fragment (whitespace-
  // insensitive) — for "did they write the line" style beats.
  sourceContains({ text }, app) {
    return norm(app.editor.getValue()).includes(norm(text));
  },
};

export function evaluateCheck(spec, app) {
  const fn = conditions[spec.check];
  if (!fn) throw new Error(`unknown condition: ${spec.check}`);
  try {
    return Boolean(fn(spec, app));
  } catch (err) {
    console.error(`condition ${spec.check} failed:`, err);
    return false;
  }
}

export function isValidCheck(name) {
  return name in conditions;
}
