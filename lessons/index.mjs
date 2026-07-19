// Lesson registry. Human-authored lessons register here; the shell builds
// its picker from this list. Order = suggested curriculum order.

import meetTheMachine from "./meet-the-machine.mjs";

export const lessons = [meetTheMachine];

export function lessonById(id) {
  return lessons.find((l) => l.id === id) ?? null;
}
