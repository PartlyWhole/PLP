// REFERENCE LESSON — grammar validation, not curriculum.
// Exercises every director primitive: per-beat code, gates (deny/allow),
// veil/unveil, spotlight+dim, pulse, popovers, event triggers, all-
// composition, trace predicates, idle + event hints, why-on-demand,
// quiz beats, signal branching, and a terminal resting beat.
// The words are stage directions for testing; the human director rewrites
// or replaces this. See app/DIRECTOR.md for the authoring guide.

export default {
  id: "meet-the-machine",
  title: "Meet the machine",
  concept: "app-mechanics", // interface-as-content (WASD rule)
  code: 'x = 1\ny = x + 2\nprint("y is", y)\n',
  beats: [
    {
      id: "press-run",
      do: [
        { gate: { deny: ["edit", "scrub", "step-mode", "quiz", "share", "maximize"] } },
        { veil: "memory-objects" },
        { spotlight: "run", dim: true },
        { popover: { at: "run", md: "This is a Python program. **Run it** and watch the right panel." } },
      ],
      until: { event: "run-ended", reason: "completed" },
      hints: [
        { when: { idleMs: 25000 }, popover: { at: "run", md: "Press the **Run ▶** button." } },
        { when: { event: "run-ended", reason: "uncaught_exception" },
          popover: { at: "console", md: "The program crashed — read the red line, then Run again." } },
      ],
      why: "Programs execute top to bottom. The memory panel on the right shows every name your program creates.",
    },
    {
      id: "read-names",
      do: [
        { spotlight: "memory-names", dim: true },
        { pulse: { name: "y", scope: "global" } },
        { popover: { at: "memory-names", md: "Every variable lives here. **Hover over `y`** to see where it appears in the code." } },
      ],
      until: { event: "hover-name", name: "y" },
      hints: [
        { when: { idleMs: 20000 }, popover: { at: "memory-names", md: "Move your mouse over the name `y` in this table." } },
      ],
      why: "A variable is a name bound to a value. Hovering shows every place the name is used.",
    },
    {
      id: "scrub-time",
      do: [
        { gate: { allow: ["scrub"] } },
        { spotlight: "scrubber", dim: true },
        { popover: { at: "scrubber", md: "This slider is **time travel**. Drag it back to line 1 to see the memory as it was." } },
      ],
      until: { all: [{ event: "scrubbed" }, { check: "ranLine", line: 2 }] },
      hints: [
        { when: { idleMs: 20000 }, popover: { at: "scrubber", md: "Drag the slider left, or press ◀." } },
      ],
      why: "The trace remembers every step, so you can replay the program's history without re-running it.",
    },
    {
      id: "answer-input",
      do: [
        { set: "code", value: 'name = input("Who are you? ")\nprint("hi", name)\n' },
        { clear: "effects" },
        { gate: { allow: ["run"] } },
        { spotlight: "console", dim: true },
        { popover: { at: "console", md: "New program: it will **ask you a question**. Run it, then type your answer in the terminal and press Enter." } },
      ],
      until: { all: [
        { event: "input-answered" },
        { event: "run-ended", reason: "completed" },
        { check: "outputContains", text: "hi " },
      ] },
      hints: [
        { when: { idleMs: 30000 }, popover: { at: "console", md: "Run first; when the program pauses, click the terminal and type." } },
        { when: { event: "interrupt-requested" },
          popover: { at: "console", md: "You stopped it — that's Ctrl+C. Run again and answer this time." } },
      ],
      why: "input() pauses the program until you provide a line — the memory panel holds still while it waits.",
    },
    {
      id: "rerun",
      do: [
        { set: "code", value: "x = 1\ny = x + 2\nprint(\"y is\", y)\n" },
        { clear: "effects" },
        { spotlight: "run", dim: true },
        { popover: { at: "run", md: "Back to the first program. **Run it once more** — then you'll predict its memory." } },
      ],
      until: { event: "run-ended", reason: "completed" },
      hints: [
        { when: { idleMs: 25000 }, popover: { at: "run", md: "Press **Run ▶**." } },
      ],
    },
    {
      id: "mastery",
      do: [
        { gate: { allow: ["quiz"] } },
        { quiz: { kind: "memory-next-line", opts: { from: 0, to: 1 } } },
        { popover: { at: "quiz-btn", md: "Last step: **predict the memory** before you peek. Fill the blank and press Check." } },
      ],
      // Advance on a correct answer OR on demonstrated struggle (3 tries) —
      // the branch below then routes strugglers to a review beat instead of
      // leaving them stuck (signal grammar, ability-matched ramping).
      until: { any: [
        { event: "quiz-graded", correct: true },
        { signal: "quizTries", gte: 3 },
      ] },
      next: [
        { if: { signal: "quizTries", lte: 2 }, then: "done" },
        "review",
      ],
      hints: [
        { when: { signal: "quizTries", gte: 2 }, popover: { at: "memory", md: "Scrub back — the answer is literally on screen at the earlier step." } },
      ],
    },
    {
      id: "review",
      do: [
        { gate: { allow: ["scrub"] } },
        { spotlight: "scrubber", dim: false },
        { popover: { at: "scrubber", md: "No rush. Scrub to the line the question asks about, read the table, then answer the quiz again." } },
      ],
      until: { event: "quiz-graded", correct: true },
      next: "done",
    },
    {
      id: "done",
      do: [
        { clear: "effects" },
        { popover: { at: "memory", md: "That's the whole machine: **code → run → memory → time travel**. Exit the lesson to explore freely." } },
      ],
      // No until: terminal resting beat — learner leaves via exit (or skip).
    },
  ],
};
