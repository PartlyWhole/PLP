# Research: how game designers build learning curves (tutorials, onboarding, attention direction)

Deep-research pass (2026-07-19): 6 search angles, 26 sources, 110 extracted
claims, top 25 adversarially verified (3-vote): 19 confirmed, 6 refuted.
Purpose: ground PLP's future tutorial/onboarding experience in what's
actually known, before designing the UI.

## Verified findings (survived 3-0 adversarial verification)

1. **The best tutorial is invisible — do once and see the result.**
   (HIGH confidence) George Fan (Plants vs Zombies, GDC 2012): "teach
   players without them ever even realizing they're being taught"; "once
   they see the results of their action, that's often all it takes."
   Nintendo designs Mario levels so players "gradually and naturally
   understand" through level structure, not instruction.
   → PLP: the first thing a learner runs should itself demonstrate the
   memory model. No explanation panel before the first Run.

2. **One concept per level, structured as kishōtenketsu** (MEDIUM —
   single strong source, direct Hayashida quotes): introduce → develop
   through richer scenarios → twist unexpectedly → conclude with a mastery
   demonstration. One core concept "carried through absolutely all the way."
   → PLP: one Python concept per unit; end with a task that recombines it
   surprisingly (the `[[0,0]]*3` trap IS a twist for the aliasing unit).

3. **Adaptive, just-in-time help beats uniform instruction.** (HIGH)
   PvZ showed hints only to players observed doing the wrong thing —
   skilled players "feel smart" by seeing nothing. Academic reviews (Zhou &
   Guo; Czerwonka & McArthur) support just-in-time access, self-directed
   practice with timely feedback, and tailoring depth to demonstrated need.
   → PLP: trigger hints from observed behavior (wrong output, no scrub
   usage, idle), never on timers, never by default.

4. **Implicit vs explicit is a real trade-off, not a dogma.** (HIGH)
   Cao & Liu 2022 (n=47): implicit tutorials rated less boring (2.50 vs
   3.10/5, p=.002) but less helpful (3.50 vs 4.19, p=.017); for COMPLEX
   mechanics, explicit instruction produced far better performance (58.3%
   vs 18.8% task completion, p=.031).
   → PLP: teach simple mechanics implicitly (guided doing); keep explicit
   on-demand explanation for genuinely hard concepts (mutation vs
   rebinding, closures).

5. **No tutorial is worse than it feels.** (MEDIUM, n=46 single-game)
   Players without a tutorial *rated themselves* more successful yet found
   mechanics harder and pace slower. A context-sensitive tutorial woven
   into the real task beat a skippable practice sandbox (3.6 vs 5.1 min
   completion, less drop-out).
   → PLP: contextual guidance inside the real editor/panes beats both a
   separate "playground" and nothing.

6. **Challenge drives learning; immersion doesn't.** (HIGH, but
   self-reported outcomes) Hamari et al. 2016 (n=173, two physics games):
   engagement predicts perceived learning; challenge is the strongest
   predictor, directly and via engagement; immersion has no effect.
   → PLP: invest in well-calibrated problems and ramp with demonstrated
   ability; don't over-invest in atmosphere/gamification chrome.

7. **Scaffolding pays off in cognitive load and fluency, not test
   scores — and interacts with learner style.** (HIGH) RCT (n=62):
   adaptive scaffolding gave no test-score gains, but tailored scaffolding
   cut completion time (β=−90.6 s) and cognitive load (β=−0.88).
   Separate study: static step-prompts favor detail-focused (Serialist)
   learners; dynamic/big-picture scaffolds favor Holists.
   → PLP: measure the tutorial by effort/fluency reduction, not quiz
   scores; offer both a step-by-step mode and an explore-first mode.

8. **Anti-pattern: assuming conventions (the WASD problem).** (HIGH)
   Tutorials that presume genre conventions are "detrimental for new
   players" — onboarding must teach the interface itself.
   → PLP: terminal literacy, Run/Stop, the scrubber, even "what is a
   console" are first-class mechanics to teach, not assumed knowledge.

## Practitioner consensus (credible, but below verification bar)

From GDC talks / Game Developer articles / design blogs surveyed (Ernest
Adams' "Eight Ways to Make a Bad Tutorial", gating analyses, Filament
Games, Dan Cook's skill atoms):

- **Gating / progressive disclosure**: control the order mechanics are
  shown; "hitting the player with everything at once is a sure way to turn
  them off." Introduce mechanics in order of immediate utility. Hide UI a
  learner can't use yet.
- **Skill atoms (Dan Cook)**: learning = chained loops of action →
  simulation → feedback → mental-model update. Sequence lessons as a
  dependency graph of atomic skills, not a linear syllabus.
- **Empirical tutorial scoping**: playtest WITHOUT a tutorial first; teach
  only what observed players fail to grasp (Best Friends Cafe case).
- **Vollmer's four functions**: a tutorial must teach, comfort, excite,
  and respect the player.
- Classic anti-patterns: unskippable tutorials, walls of text, modal
  interruptions that pause the doing, teaching before the need is felt,
  front-loading everything.

## Refuted along the way (do not repeat as fact)

- Fan's "8-word text cap" (misquote; not in the talk as a hard rule).
- "Text-heavy tutorials are ineffective, doing always beats reading"
  (as a blanket claim — the implicit/explicit trade-off above is real).
- "Players prefer skill-gated teach-by-doing" as a stated novice
  preference (not supported by the cited study).
- "All scaffolding reduces cognitive load / improves performance"
  (only tailored scaffolding did; style interactions matter).

## Honest gaps

No claims survived verification on: Portal chamber design specifics,
Egoraptor/Extra Credits analyses, measured effects of specific
attention-direction techniques (highlight pulses, arrows, diegetic cues),
spacing/interleaving in game tutorials, or direct evidence that game-style
onboarding transfers to programming tools. These remain design intuitions,
not evidence. Small samples (n=29–173) and self-reported learning are
common caveats throughout.

## Design rules for PLP (synthesis)

R1. First contact = a forced-but-real action: preloaded program, one big
    Run button, memory model visibly reacting. Zero prose first.
R2. Progressive UI disclosure: start with editor+console+a minimal memory
    view; unlock the scrubber, objects table, filters, quiz as the lesson
    needs them (they already exist behind flags — gating is cheap for us).
R3. One concept per unit, kishōtenketsu-shaped: introduce (guided line-step),
    develop (edit-and-predict variants), twist (the surprising case:
    aliasing, shadowing, mutation-through-alias), conclude (mastery task).
R4. Attention direction reuses our existing affordances: line highlight,
    name-hover highlight, chip flash, scope labels — pulse/point at THE
    one thing the current beat is about; dim the rest.
R5. Hints are behavior-triggered and quiet by default (PvZ adaptive
    messaging); a stuck detector, not a tour guide.
R6. Explicit explanation exists but on-demand (complex concepts genuinely
    need it) — a "why?" affordance per beat, never a modal.
R7. Teach the interface as content: the console, Run/Stop, the scrubber
    each get their own do-once-and-see beat (WASD rule).
R8. Ramp with demonstrated ability; prefer harder well-calibrated next
    tasks over decorative polish (flow channel).
R9. Success metric: fluency and reduced effort (time-to-correct-prediction,
    scrub usage, hint usage), not quiz score deltas.
R10. Never block the doing: no modal tutorials, everything skippable,
     text in small contextual doses anchored to the thing it describes.

Sources: gamedeveloper.com (Fan GDC 2012; Mario/Hayashida; Adams; gating;
invisible tutorials), lostgarden.com (skill atoms), Cao & Liu 2022
(Heliyon), Zhou & Guo 2022, Czerwonka & McArthur 2022 (HCII), MDPI
Informatics 2023, Hamari et al. 2016 (CHB), BMC Med Educ 2024 RCT,
IJETHE 2023 scaffolding × cognitive style.
