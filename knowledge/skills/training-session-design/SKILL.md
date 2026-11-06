---
name: training-session-design
description: Use when designing or adapting one resistance-training workout, choosing exercise substitutions, or shortening a session for available equipment and time. Use training-program-design for multiweek structure.
---

# Design a training session

Read guidance by ID with the Atlas `knowledge` tool (`get` action) or `atlas knowledge get ID`. Start with `guides/coaching-context`; use `guides/session-decisions` for substitutions, warm-ups, short sessions and effort, and `guides/stimulus-fatigue` for exercise cost.

From Atlas, establish today's location and equipment, time (`session_minutes_by_day` for today, else `session_minutes`, unless the athlete says otherwise), `preferred_styles`, `avoided_styles`, the current prescription, recent comparable work and readiness. Adapt the plan or give a provisional draft.

1. Identify the priority stimulus and progression-critical exercises; preserve them before filling accessories.
2. Select catalog exercises by target, movement, setup, range and measurable loading; a shared muscle label does not make them equivalent. Pick the lowest `fatigue_rating` that still trains the muscle, ideally with `limiting_factor` `target_muscle`: a seated cable row, not a barbell row, when the lower back or grip would give out first. Order by fatigue on purpose: high-fatigue lifts first, isolation last.
3. Separate warm-ups from work sets. Give heavy lifts a short ramp to the working weight, following `warmup_style` (`guides/session-decisions`), written with `role: "warmup"` and no Effort. Specify order, work sets, reps, Effort %, rest, substitution and estimated time; numbers come from the prescription or are labeled proposals.
4. Budget setup, warm-up and transitions. If time is tight, trim lower-priority work or pair compatible low-fatigue accessories (supersets or circuits when preferred, and only ones the athlete's equipment lets them go between without moving or setting anything up, per `guides/program-authoring`) before rushing priority lifts (`evidence/2026-10-12-rest-recovery-time-efficiency`). Keep the session under the stacking caps.
5. Define what to record and when to stop or modify. Judge by clean, comparable performance and tolerability, not soreness.

Finish with the workout, differences from the plan, assumptions and the next comparison. Save it only when the athlete asks or approves, following `guides/program-authoring` (a planned workout) or `guides/live-workout` (today's session).
