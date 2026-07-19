# Spaced repetition — research findings & component design

Deep-research report (2026-07-19) for a modular, general-purpose spaced-
repetition component for PLP. Method: 5-angle web research (cognitive-science
foundations, FSRS state of the art, ML scheduling research, beyond-flashcards
/ knowledge tracing, practitioner implementation), 23 sources fetched, 113
claims extracted, top 25 adversarially verified by 3-vote panels — **25
confirmed, 0 refuted**. Findings below are grouped by evidence tier.

---

## Part I — Verified findings

### 1. The foundations are rock-solid (high confidence, 3-0 votes, peer-reviewed meta-analyses)

- **Spacing and retrieval practice are among the best-replicated effects in
  learning science.** Spaced retrieval beats massed retrieval (g = 0.74, 29
  studies — Latimier et al. 2021); testing beats restudy (g = 0.50 across
  159 effect sizes from 61 studies — Rowland 2014); spaced beats massed
  study across 839 assessments in 317 experiments at all retention
  intervals (Cepeda et al. 2006).
- **The testing effect grows with delay and retrieval effort.** g = 0.69
  for retention intervals ≥ 1 day vs 0.41 for < 1 day; recognition formats
  g = 0.36 vs cued recall 0.72 and free recall 0.82 (Rowland 2014). Design
  implication: production-format questions (our fill-in blanks) at a delay
  beat same-session multiple choice. (Moderator analyses are
  between-study/correlational; the free-vs-cued difference alone was not
  significant.)

### 2. The lag effect: an interior optimum that scales with the retention goal (high confidence)

For each retention interval (RI) there is an optimal inter-study interval
(ISI); past it, accuracy declines — but **shallowly**. The optimal-gap/RI
ratio falls from ~1.0 at minutes-scale RIs to ~0.1 at multi-day RIs
(Cepeda et al. 2006; Cepeda et al. 2008/2009, N = 1,354, delays to 6
months):

- 10-day RI: 1-day gap optimal (+34% recall, d = 1.03; overshooting to 14
  days cost only ~11%).
- 6-month RI: 28-day gap optimal (+151% vs massed; a 1-day gap gave only
  +18%).

Design implications: (a) optimal spacing is worth a lot — up to ~150%
recall improvement; (b) **overshooting is much cheaper than
undershooting**, so schedulers should err long; (c) no fixed-ratio rule
holds — schedule against a target, don't hand-tune ratios.

### 3. The expanding-interval assumption is NOT supported (high confidence — and surprising)

The core assumption behind SuperMemo-style schedulers — that intervals must
progressively expand — has **no reliable retention advantage over uniform
spacing**: g = 0.034 across 54 effect sizes (Latimier et al. 2021); 62.0%
vs 58.6%, p = .61 (Cepeda et al. 2006, which explicitly calls out
Woźniak's assumption). Caveat: expanding schedules gain *relative* benefit
as retrieval exposures per item increase.

Why FSRS-style scheduling is still right: the win from a modern scheduler
is not the expanding *shape* but scheduling each item **when its predicted
recall hits a target** — which adapts per item and per learner. Expanding
intervals fall out of that as a consequence for well-learned items; they
are not the mechanism.

### 4. FSRS is the state of the art among practical schedulers (high confidence)

- **Model (DSR)**: three variables per item — Difficulty, Stability
  (days for retrievability to fall 100%→90%), Retrievability. Scheduling
  = invert the forgetting curve: next review when predicted R equals a
  user-set **desired retention** (sensible range 70–97%).
- **Fitting**: ~21 parameters per user, learned by gradient descent on
  log-loss over the user's review history (an optimizer companion to the
  scheduler); sensible pretrained defaults exist for cold start.
- **Adoption**: natively integrated in Anki since 23.10.
- **Benchmark**: on the open srs-benchmark (~727M reviews, 10,000 Anki
  users; 1.7B-review variant), **FSRS-6 is the best non-neural scheduler**:
  Log Loss 0.3460, RMSE(bins) 0.0653, AUC 0.7034 — ahead of FSRS-5/4.5/v4,
  DASH, and HLR on all three metrics. (Caveat: benchmark maintained by the
  FSRS organization — open and reproducible, but a self-benchmark.)
- The "20–30% fewer reviews than SM-2 at equal retention" figure is a
  first-party simulation claim, not an independent RCT.

### 5. Duolingo's HLR: the cautionary tale about item-difficulty features (high confidence)

Half-Life Regression models recall as p = 2^(−Δ/h), h = 2^(Θ·x) — Pimsleur
and Leitner are special cases with hand-picked weights. On 12.9M traces it
cut MAE ≥45% vs Leitner. The design-relevant result: **sparse per-item
difficulty features overfit** — they caused cold-start failures and
rapid-decay complaints, and *removing* them improved every live retention
metric in a 3.3M-student experiment (+12% daily activity) (Settles &
Meeder, ACL 2016). Direct caution for us: with generated/parameterized
questions, don't hang memory state on fine-grained item ids.

---

## Part II — Relevant but not adversarially verified

(Extracted from primary sources during research; didn't make the top-25
verification cut. Treat as leads, not established facts.)

- **DAS3H** (Choffin et al., EDM 2019) extends the DASH memory model to
  items tagged with multiple **knowledge components (skills)**, with
  per-skill learning/forgetting — the natural bridge between item-level
  SRS and skill-level scheduling for generated questions.
- **MEMORIZE** (Tabibian et al., PNAS 2019) frames scheduling as stochastic
  optimal control over temporal point processes with a closed-form online
  algorithm; a follow-up RCT (~50,700 learners, German driving-permit app)
  reported ~92% longer retention vs random item selection and ~67% vs a
  difficulty-ordered heuristic.
- **ts-fsrs** (MIT, open-spaced-repetition org) is the canonical maintained
  TypeScript FSRS implementation (FSRS-6): stateless `FSRS` class,
  `repeat()` pre-computes all four rating outcomes; four card states (New/
  Learning/Review/Relearning); knobs: `request_retention`, `enable_fuzz`,
  `learning_steps`/`relearning_steps`, `maximum_interval`; plus rollback/
  forget/reschedule helpers and a separate optimizer package. `fsrs.js`
  (FSRS v4) is deprecated in its favor. FSRS is implementable in ~100
  lines if we prefer hand-rolling (Borretti).
- The research base for **spacing problem-solving/procedural skills** is
  far thinner than for fact recall; no claims about BKT/Elo comparisons
  survived verification (see open questions).

## Part III — Caveats and open questions (from the verified report)

Caveats: classroom effects run smaller than lab meta-analytics; the
expanding-vs-fixed null is an average; FSRS's efficiency figure and
benchmark are first-party; the benchmark measures **prediction accuracy on
flashcard data, not learning outcomes**, and transfer to generated
programming questions is unvalidated.

Open questions:
1. How well does DSR-style scheduling transfer from fact recall to
   procedural programming knowledge — and what is "the card" when the item
   is a question *template* with varying instances?
2. How do knowledge-component approaches (BKT, Elo, DAS3H) compare
   empirically with item-level FSRS for skill domains?
3. Validated cold-start defaults and learning-step policies for a system
   with no review history?
4. What desired-retention target optimizes retention-vs-load for a
   learning platform (vs exam cramming)?

---

## Part IV — Design recommendations for the PLP component

### Architecture (mirrors the questions.mjs pattern: pure engine, thin UI)

```
app/srs.mjs               — pure scheduling engine, no DOM
  createSRS({ scheduler, store, now })
    .review(itemId, rating, at?)   -> new item state (+ appends to log)
    .due(at?, limit?)              -> [itemId] sorted by overdue-ness
    .state(itemId)                 -> { due, stability, difficulty, reps, lapses, phase }
    .retrievability(itemId, at?)   -> predicted recall probability
  schedulers = { fsrs: …, leitner: … }   // pluggable; leitner proves the seam
```

1. **Scheduler as a plug-in interface** — `{ initState(), review(state,
   rating, elapsedDays) -> { state, intervalDays } }`. Ship **FSRS-6 as
   the default** (vendor `ts-fsrs`, MIT — consistent with our vendoring
   policy; or hand-roll ~100 lines to stay dependency-light) and a
   trivial Leitner as the second implementation to keep the seam honest.
2. **Persist two things, separately**:
   - *Item state* (small, hot): FSRS card fields — due, stability,
     difficulty, reps, lapses, phase, last_review. localStorage-sized.
   - *Append-only review log* (itemId, rating, timestamp, elapsed): this
     is what makes us future-proof — parameters can be re-optimized and
     algorithms migrated by replaying the log. Never throw it away.
3. **Item identity = template × skill, not instance.** Following the HLR
   lesson, key memory state to the question *template + scope of
   variation* (e.g. `memory-next-line:assignment-aliasing`), not to each
   generated instance. Fresh instances per review are a feature (prevents
   answer memorization — retrieval stays effortful), while the memory
   state tracks the durable skill. Optionally tag items with knowledge
   components now (plain strings) so a DAS3H-style skill layer can be
   added later without migration.
4. **Ratings**: keep the full 4-grade FSRS scale in the interface
   (Again/Hard/Good/Easy) but let the quiz map automatically at first —
   wrong → Again, correct → Good (self-grading UI is friction; the two
   middle grades add little for auto-graded questions).
5. **Defaults, per the evidence**: desired retention **0.90** (Anki's
   default; expose 0.7–0.97); FSRS pretrained default parameters for cold
   start; fuzz **on** (research says near-optimum is flat — fuzz costs
   nothing and de-clumps reviews); err long when uncertain (overshooting
   is cheap, undershooting expensive); short learning steps for day-0 only.
6. **Honor the testing-effect moderators in the product**: schedule
   *production-format* questions (our blanks) rather than recognition;
   prefer next-day first review over same-session re-asks.
7. **What NOT to build**: no hand-tuned expanding-interval tables (the
   assumption is unsupported; the target-retention mechanism subsumes it);
   no per-instance difficulty features (HLR lesson); no neural scheduler
   (marginal benchmark gains, real complexity cost).
8. **Roadmap hooks**: per-user parameter optimization from the review log
   (ts-fsrs optimizer offline or in a worker); skill-level scheduling
   (DAS3H-style) once templates carry KC tags; retention-target tuning
   from our own logs.

### Validation plan (when built)

Engine is pure → unit-testable like questions.mjs: deterministic scheduling
given a fixed clock; property tests (interval grows on Good, resets toward
relearning on Again, retrievability monotonically decays); a replay test
(log → same states); and a scheduler-swap test through the plug-in seam.

---

## Sources (primary unless noted)

Cognitive science: [Latimier, Peyre & Ramus 2021 (meta-analysis)](https://link.springer.com/article/10.1007/s10648-020-09572-8) ·
[Rowland 2014 (meta-analysis, Psych Bulletin)](https://courseware.epfl.ch/assets/courseware/v1/fdde2f0aa590bf3b1324077a6bf1540c/asset-v1:EPFL+DEMO+2020+type@asset+block/Rowland2014-meta-analysis.pdf) ·
[Cepeda et al. 2006 (meta-analysis, Psych Bulletin)](https://augmentingcognition.com/assets/Cepeda2006.pdf) ·
[Cepeda et al. 2008/2009 (experiments)](https://home.cs.colorado.edu/~mozer/Research/Selected%20Publications/reprints/Cepedaetal2009.pdf)

Algorithms: [FSRS wiki — ABC of FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki/abc-of-fsrs) ·
[fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki) ·
[srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark) ·
[Anki 23.10 release notes](https://changes.ankiweb.net/changes/23.10.html) ·
[Anki deck options](https://docs.ankiweb.net/deck-options.html) ·
[Settles & Meeder ACL 2016 (Duolingo HLR)](https://research.duolingo.com/papers/settles.acl16.pdf) ·
[Tabibian et al. PNAS 2019 (MEMORIZE)](https://www.pnas.org/doi/pdf/10.1073/pnas.1815156116) ·
[Choffin et al. 2019 (DAS3H)](https://arxiv.org/pdf/1905.06873) ·
[RCT: ML scheduling in a driving-permit app](https://arxiv.org/pdf/2010.04430) ·
[Pelánek (Elo in education)](https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf)

Implementation: [ts-fsrs (GitHub, MIT)](https://github.com/open-spaced-repetition/ts-fsrs) ·
[ts-fsrs docs](https://open-spaced-repetition.github.io/ts-fsrs/) ·
[fsrs.js (deprecated → ts-fsrs)](https://github.com/open-spaced-repetition/fsrs.js) ·
[Expertium: FSRS algorithm explained (blog)](https://expertium.github.io/Algorithm.html) ·
[Expertium: benchmark notes (blog)](https://expertium.github.io/Benchmark.html) ·
[Borretti: implementing FSRS in 100 lines (blog)](https://borretti.me/article/implementing-fsrs-in-100-lines)
