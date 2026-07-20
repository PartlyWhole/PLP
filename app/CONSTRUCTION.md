# Construction practice - as-built documentation

Construction practice lets a learner answer with the same visual vocabulary
used by the live memory model. It has two related workspaces:

1. a memory graph builder for persistent state, and
2. an evaluation tray for the ordered temporary actions used to evaluate one
   expression or simple statement.

The implementation is split by responsibility:

- [construction.mjs](construction.mjs) contains the pure graph conversion,
  graph grading, supported expression planner, and sequence grading.
- [construction-ui.mjs](construction-ui.mjs) contains the interactive DOM
  renderers.
- [questions.mjs](questions.mjs) creates trace-grounded question payloads.
- [quiz.mjs](quiz.mjs) selects a renderer and connects Check to `grade()`.
- [construction.css](construction.css) contains the workspace styles.

## Learner model

Boxes are variable names. Typed scalar values such as `int · 3` stay inline.
Data with meaningful identity is represented once as a pill:

```text
data1 : list · [int · 1, data2]
```

The builder assigns data ids. A learner never types or predicts an engine uid.
Inside a collection or attribute, the learner can either enter a scalar value
or reference an existing data pill. The `+ new data` action creates a data pill
and immediately places a reference to it in the selected slot. This makes a
nested construction convenient without changing the underlying graph model.

The graph model is necessary because a tree cannot represent aliases or
cycles. Two references to one data pill mean shared identity. Two identical
data pills mean distinct identity.

## Memory workspace

Each scope is present as a card with an `+ Name` action. A name row contains:

```text
name → value or data reference
```

`+ Data` creates a question-local identity-bearing data pill. Type fields are
editable and filter suggestions as the learner types. Empty type fields show
only the beginner vocabulary: `int`, `str`, `float`, `bool`, `NoneType`, data
references, lists, dictionaries, tuples, sets, and instances. Less common
types such as `bytes`, `complex`, `frozenset`, `cell`, and `generator` appear
only when searched for. They remain constructible without crowding the initial
choice.

Supported editing surfaces include:

- list, tuple, set, frozenset, and cell item slots;
- dictionary key and value slots;
- instance and class attribute slots; and
- a description field for opaque, generator, and other compact data.

Scalar editors cover the trace scalar vocabulary. A slot may remain unbound,
which grades as incomplete.

Question starts are controlled by `starterGraph(target, mode)`:

- `blank`: scope shells only;
- `partial`: names are supplied, alternating scalar answers are supplied, and
  the remaining bindings are empty; and
- `complete`: a full editable copy, useful for transformation and diagnosis.

Next-line and line-span questions use `transform` mode. Their starter graph is
the state before the requested execution span, plus empty shells for any scope
that appears in the target state.

## Memory graph contract

```js
{
  scopes: [{
    id: "globals:__main__",
    label: "Globals",
    bindings: [{
      name: "items",
      value: { kind: "ref", target: "data1" }
    }]
  }],
  data: [{
    id: "data1",
    kind: "list",
    type: "list",
    description: "3 items",
    items: [{ kind: "scalar", type: "int", value: "3" }],
    entries: [],
    fields: []
  }]
}
```

`memoryGraphAt(steps, stateIndex)` derives this graph from exactly one trace
snapshot. Engine uids are used only while converting that snapshot. They are
not stored in the question graph and are never compared across steps.

The graph respects the live memory model's hidden plain-function and module
bindings. Reachable identity-bearing data is traversed from visible bindings,
including references inside other data.

## Graph grading

`gradeMemoryGraph(answer, target)` compares rooted graphs up to renaming of
question-local data ids. It maintains a bijection between expected and learner
nodes while recursively comparing bindings and contents. The bijection is what
makes aliasing and cycles grade correctly.

Feedback is separated into four areas:

- bindings: scopes, names, and missing connections;
- types: scalar and identity-bearing data types;
- contents: scalar values, ordered items, dictionary entries, and attributes;
- identity: shared versus distinct data and the number of data pills.

Current dictionary entry and set item order follows the trace's canonical
display order. Semantic equivalence across alternate dictionary or set orders
is deferred.

## Evaluation workspace

Expression questions start with an empty ordered tray and a shuffled palette of
semantic action cards. Selecting a card places it at the end of the tray. The
learner can move cards earlier or later or remove them before checking.

For:

```python
items += [4]
```

the expected sequence is:

1. Read target `items`.
2. Produce literal `int · 4`.
3. Construct a one-item list.
4. Apply `+=`, using in-place behavior when the data type supports it.
5. Store the result back in `items`.

This tray is intentionally distinct from persistent memory. It can represent
temporary data and operations even when the final memory state does not change,
as in `print(2 + 3)`.

## Supported expression subset

`buildEvaluationPlan(line)` currently supports:

- simple-name assignment and augmented assignment;
- names and scalar literals;
- list, dictionary, and set displays;
- unary and common binary operators;
- attribute and subscript lookup; and
- positional function and method calls.

It preserves Python's main evaluation-order rules for this subset: callables
before positional arguments, arguments left to right, binary operands left to
right, collection elements in source order, and an augmented-assignment target
before its right-hand side.

It intentionally returns `null` for structural statements, destructuring,
comprehensions, lambdas, conditional expressions, keyword arguments,
membership and identity operators, and other unsupported syntax. The planner is
a curated teaching layer, not a claim to be a complete Python parser.

## Question payloads and API

Memory construction payload:

```js
{
  construction: {
    type: "memory-graph",
    mode: "blank" | "partial" | "complete" | "transform",
    starter: MemoryGraph,
    target: MemoryGraph
  },
  grade({ type: "memory-graph-answer", graph })
}
```

Evaluation payload:

```js
{
  evaluation: {
    source: "items += [4]",
    cards: [...expectedCards],
    palette: [...shuffledCards]
  },
  grade(cardIdsInLearnerOrder)
}
```

The debug surface exposes `plp.quiz.currentAnswer()` in addition to the
existing `current()`, `newQuestion()`, and `check()` methods.

## Intentional next steps

- Let an author lock arbitrary graph fragments instead of using the current
  blank/partial presets.
- Add direct drag connections and drag reordering while retaining the existing
  keyboard-accessible controls.
- Add result sockets to evaluation cards so the learner constructs both order
  and intermediate data.
- Expand expression support through an explicit syntax registry with one
  semantics test per supported form.
- Grade unordered collections and dictionaries by semantic matching where the
  curriculum does not intend order to matter.
