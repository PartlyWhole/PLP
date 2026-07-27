// Curriculum registry: the ordered unit list the tutor runtime offers.
// Each unit = { id, title, lesson } where lesson is a step script
// (vocabulary + lint rules: app/tutor.mjs). Content trajectory and the
// exercise-bank mapping: design/tutor-plan.md §7.
//
// Lessons are plain data modules — no DOM, no engine access — so they can
// be authored and reviewed as prose.

import u1 from "./u1-state-io.mjs";

export const curriculum = {
  units: [
    { id: "u1-state-io", title: u1.title, lesson: u1 },
  ],
};
