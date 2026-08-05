// Unit 1 — the state + I/O model.
//
// Core idea: every program is (current state, input) → next state, output.
// Shape (design/tutor-plan.md §7.2, research R1/R7): first contact is a
// real Trace with zero prose before it; the interface (Trace, the memory
// pane, the scrubber, the console) is taught as content; predictions are
// locked in BEFORE the run that reveals the truth.

export default {
  id: "u1-state-io",
  unit: 1,
  title: "1 · State and I/O",
  // KB concepts this unit touches (design/lesson-kb-binding.md §3). The old
  // free-text `skills` had no KB witness: state-model/read-trace are the
  // structural-roots narrative and predict-output is a form not a concept.
  // `input-boundary` is now `0026` (expansion ladder §R4a): the concept is
  // minted and wired, and the predict-io ask below is its graded witness, so
  // the unit's input steps finally grant met.
  concepts: ["0006", "0009", "000A", "000B", "0026"],
  steps: [
    // ---- first contact: do, then see (no prose first) --------------------
    {
      loadCode: "x = 3\ny = x + 4\nx = 10\nprint(x + y)\n",
    },
    {
      action: "Press **Trace** (above the editor) and watch what happens.",
      await: { event: "run-ended" },
    },
    {
      say: "You just watched a program run, one line at a time.\n\n"
        + "The **Memory model** pane is the program's **state**: every name "
        + "it currently knows, and the value each name holds. The **Console** "
        + "below is its **output**.",
      pause: true,
    },
    {
      action: "Use the memory slider's **▶** button to step through the "
        + "program line by line. Watch the state change.",
      await: { event: "scrubbed", count: 3 },
    },
    {
      say: "Here is the one idea this whole course sits on:\n\n"
        + "```\n"
        + "current state ──▶ [ a line runs ] ──▶ next state\n"
        + "      ▲                                  │\n"
        + "   input                              output\n"
        + "```\n\n"
        + "Every line takes the current state and produces the next one. "
        + "Line 1 turned an empty state into `x = 3`. Line 2 **read** `x` "
        + "and added `y = 7`. Line 3 **replaced** what `x` holds. "
        + "Line 4 produced **output** from the state.",
      pause: true,
    },

    // ---- first prediction: commit before running -------------------------
    {
      say: "Now you predict. A new program is in the editor — read it "
        + "**without running it**.",
    },
    {
      loadCode: "a = 2\nb = a * 3\na = a + 1\nprint(b)\n",
    },
    {
      ask: {
        kind: "predict-output",
        focus: "0009", // evaluate-before-bind: b was computed before a changed
        singleLine: true,
        hints: [
          "Step through the state in your head, line by line — exactly like "
            + "the slider did. What does the state hold after line 3?",
          "`b` was computed on line 2, **before** `a` changed. A line only "
            + "changes the state when it runs — nothing updates `b` afterwards.",
        ],
      },
    },
    {
      if: { lastAnswer: "wrong" },
      say: "The catch: `b = a * 3` ran when `a` was `2`, so `b` became `6` — "
        + "and **stayed** `6`. A binding changes only when a line assigns to "
        + "it. Step the slider through the run you just made and watch `b` "
        + "hold still while `a` changes.",
      pause: true,
    },
    {
      if: { lastAnswer: "correct" },
      say: "Exactly. `b` kept its value because no later line assigned to it "
        + "— state only changes when a line changes it.",
    },

    // ---- the input boundary ----------------------------------------------
    {
      say: "So far the state changed only from within. **Input** is the "
        + "outside world reaching in.",
    },
    {
      loadCode: 'name = input("What\'s your name? ")\n'
        + 'print("Hello,", name)\n'
        + 'print("Your name has", len(name), "letters")\n',
    },
    {
      action: "Press **Trace**, then answer the prompt by typing your name "
        + "into the console and pressing Enter.",
      await: { event: "input-answered" },
    },
    {
      say: "Notice what happened: at `input(...)` the program **stopped**. "
        + "The state could not advance until the outside world — you — "
        + "supplied a value. Then that value entered the state as an "
        + "ordinary binding, `name`, and the program moved on.\n\n"
        + "In a video game, input is key presses and mouse moves instead of "
        + "typed lines — but it's the same idea: outside world → state.",
      pause: true,
    },
    // The int(input()) bridge. Hand-authored rather than a KB exercise: a
    // drill's closure for 0026 admits print/names/input only (K-4), so the
    // str→int conversion cannot appear in one — but it is exactly the thing a
    // learner meets first in the wild, so the lesson carries it.
    {
      say: "Your turn. This time **you** predict the whole console — the "
        + "prompt, the line that gets typed, and everything the program "
        + "prints. Someone will type `7`.",
    },
    {
      loadCode: 'answer = input("Pick a number: ")\n'
        + 'number = int(answer)\n'
        + 'print(number + 1)\n',
    },
    {
      ask: {
        kind: "predict-io",
        focus: "0026", // input-pauses-for-value
        stdinScript: ["7"],
        // The stdin chips are a PRACTICE-surface affordance; a guided lesson
        // renders on the stage, so the script is named in the prompt itself.
        prompt: "Someone types `7`. What does the whole console show — every line of it?",
        hints: [
          "The prompt is printed by the program, and the typed line lands "
            + "right where the typing happened — on the same line as the "
            + "prompt, because pressing Enter is what ends that line.",
          "`input(...)` always hands back **text**, so `answer` holds `\"7\"`. "
            + "`int(answer)` turns that text into the number `7`, and then "
            + "`7 + 1` prints.",
        ],
      },
    },
    {
      if: { lastAnswer: "correct" },
      say: "Exactly — and notice the last piece: `input(...)` handed back the "
        + "**text** `\"7\"`, not the number. `int(...)` is what made it a "
        + "number you can add to.",
    },
    {
      say: "**Output** is the same boundary in reverse: `print(...)` sends "
        + "values from the state out to the console. A game 'prints' by "
        + "drawing pixels and playing sounds. State → outside world.",
      pause: true,
    },

    // ---- mastery: precision prediction -----------------------------------
    {
      say: "Last one — and this time the exact characters matter. Read "
        + "carefully.",
    },
    {
      loadCode: 'total = 0\ntotal = total + 5\ntotal = total + 10\n'
        + 'print("total:", total)\n',
    },
    {
      ask: {
        kind: "predict-output",
        focus: "000B", // accumulate-rebind: total reads old, computes, rebinds
        singleLine: true,
        hints: [
          "Follow `total` through the state: `0` → `5` → `15`.",
          "`print` with a comma puts exactly one space between the pieces: "
            + "`total: 15`.",
        ],
      },
    },
    {
      if: { lastAnswer: "correct" },
      say: "Character-perfect. That precision is a skill, and it compounds.",
    },
    {
      say: "**Every program you will ever write is this loop:**\n\n"
        + "state (+ input) → next state (+ output), one line at a time.\n\n"
        + "When a program confuses you, the question to ask is always: "
        + "*what is the state right now, and what does this line do to it?* "
        + "The Trace button and the slider answer that question for real.",
      pocket: "Pocket of knowledge",
    },
    {
      done: "That's Unit 1. Next: **names and state** — what a binding "
        + "really is, and what `a, b = b, a` does under the hood.",
    },
  ],
};
