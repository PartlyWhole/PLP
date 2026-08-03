// Session-summary model (Exercises revamp phase 6). PURE over the KB and
// the tutor's recorded card descriptors — no DOM, no storage — so it loads
// in plain Node for tests and rebuilds identically on reload.

import { loadKB } from "../kb/index.mjs";
import { conceptTopics, frontierTags, drillTopicFor, kbTopics } from "./kb-session.mjs";

const kb = loadKB();

// Learner-facing label for a concept tag: the slug with hyphens spaced
// ("name-holds-value" → "name holds value").
export function conceptLabel(tag) {
  return kb.concepts.get(tag)?.slug.replaceAll("-", " ") ?? tag;
}

// cards: the transcript store's recorded descriptors (question-frozen ones
// carry {ok, concept}); roundMet: tags granted met during THIS round;
// met: ALL met tags (the caller reads its store — this module stays pure).
// Returns the summary card model:
//   { asked, correct,
//     perQuestion: [{ tag, label, ok }],
//     newlyMet:    [{ tag, label }],
//     missed:      [{ tag, label }],          // deduped concepts to revisit
//     next: { topic, title, readyCount } | null }
export function summarizeRound(cards, roundMet, met = []) {
  const questions = (cards ?? []).filter((c) => c.type === "question-frozen");
  const perQuestion = questions.map((c) => ({
    tag: c.concept ?? null,
    label: c.concept ? conceptLabel(c.concept) : "",
    ok: c.ok === true,
  }));
  const missedTags = [...new Set(questions.filter((c) => c.ok !== true && c.concept).map((c) => c.concept))];
  const newlyMet = (roundMet ?? []).map((tag) => ({ tag, label: conceptLabel(tag) }));

  // Next step: where the newly-unlocked frontier is thickest.
  const frontier = frontierTags(met);
  let next = null;
  if (frontier.length) {
    const topic = drillTopicFor(frontier);
    const topics = conceptTopics();
    const readyCount = frontier.filter((t) => topics.get(t) === topic).length;
    next = {
      topic,
      title: kbTopics.find((t) => t.id === topic)?.title ?? topic,
      readyCount,
    };
  }

  return {
    asked: perQuestion.length,
    correct: perQuestion.filter((q) => q.ok).length,
    perQuestion,
    newlyMet,
    missed: missedTags.map((tag) => ({ tag, label: conceptLabel(tag) })),
    next,
  };
}
