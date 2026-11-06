# Stimulus and fatigue: choose exercises by what they cost

## What it means

Every hard set gives the target muscle a stimulus and costs the athlete something: joint stress, lower-back and grip fatigue, balance, breathing and bracing, and the mental effort of grinding a heavy lift. The stimulus-to-fatigue ratio (SFR) compares the two. A high-SFR exercise works the target muscle hard for little cost elsewhere; a low-SFR exercise spends a lot of the athlete's recovery on things the plan did not ask for. The idea comes from Mike Israetel and colleagues at Renaissance Periodization. It is a coaching framework for choosing between exercises, not a measured quantity.

"CNS fatigue" is a mix of causes rather than one thing, so do not treat it as a single dial. Score the parts instead: how tired the target muscle is, and what else the exercise wore down.

## Fatigue rating

Every exercise in Atlas's shared catalog carries a `fatigue_rating`, judged for hard working sets done well:

- **Low**: little total cost and quick to recover from, usually supported, guided, light or single-joint work. Cable and machine isolation, chest-supported and seated rows, pulldowns, Smith and VTS presses. Grip, balance or breathing can still end the set; the limiting factor says which. Most low-fatigue work is easy to add or keep.
- **Medium**: compound work with some balancing, bracing or joint cost, or a lot of muscle working hard on a machine. Dumbbell and barbell bench press, pull-ups, loaded lunges, step-ups and split squats, leg press, hack squat, belt squat, front squat, dumbbell RDL.
- **High**: heavy free-weight lifts that load the spine or the whole body and take the longest to recover from. Barbell bent-over row, conventional and trap-bar deadlift, rack pull, heavy back squat, barbell RDL, good morning, full Olympic lifts, barbell thruster.

The rating describes the exercise, not today's load. Light, technique-focused sets of a high-fatigue lift cost less; a medium lift taken to failure for many sets costs more. Custom exercises can carry the same two fields; a private copy without them uses the ratings of the catalog exercise it was copied from.

## Limiting factor

Each exercise also has a `limiting_factor`: what usually ends a hard set.

- `target_muscle`: the muscle the exercise is for gives out first. This is the goal. Grip work such as plate pinches and dead hangs counts here, since grip is the target.
- `lower_back`: the lower back tires holding a hinge or a bar on the back (barbell rows, deadlifts and rack pulls, back squats).
- `grip`: the hands give out first (heavy dumbbell hinges, shrugs and carries).
- `balance`: staying steady ends the set (single-leg work, rings, standing cable presses).
- `breathing`: breathing and bracing end the set (front squats, goblet squats, thrusters, walking lunges, conditioning).

When something other than the target muscle ends the set, the target got less work than the athlete paid for. For muscle growth, prefer a version where the target muscle is the limiting factor.

## Pick the version

Keep the training goal first: a lifter who competes in, tests or enjoys a lift keeps training it. For muscle growth, compare candidates that train the same muscle through a similar movement and pick the lowest fatigue that still loads it well.

- Back, when the lower back or grip gives out first: seated cable row or chest-supported row instead of a barbell bent-over row.
- Quads, when the lower back or bracing gives out first: hack squat, pendulum squat, belt squat or leg press instead of a heavy back or front squat.
- Hamstrings, when the lower back gives out first: seated or lying leg curl, or a lighter RDL kept well short of failure.
- Single-leg work, when balance gives out first: the Smith machine version of the split squat or lunge.
- Grip-limited pulls: straps, or a machine or cable version.

A higher-fatigue exercise is still a sound choice when it is the lift the athlete wants to get stronger at, when the equipment is all there is, or when it is the athlete's favourite. Say what it costs and budget for it.

## Session stacking score

Fatigue adds up within a session. Score each workout with four counts, leaving out warm-up sets, stretches, mobility drills and cardio. A left/right pair counts as one set.

| Count | What it counts | Suggested cap per session |
| --- | --- | --- |
| High-fatigue lifts | Different exercises rated high | 2 |
| Hard sets | Working sets at 85% Effort or higher | 10 |
| Dense blocks | Each giant set or circuit (rounds of three or more different exercises) counts once; a high-fatigue lift outside one counts when it is in a superset, on an interval under 2 minutes, or followed by under 2 minutes' rest | 1 |
| Working sets | All working sets, counting each round of a repeat. A repeat that runs for a set time (AMRAP or EMOM) counts its sets once, so budget its rounds by hand | 24 |

The score leaves out cardio, so budget sprints and hard intervals yourself (sprints are rated high) and keep them off days with heavy squats or hinges.

**Same-area rule**: never put two high-fatigue lifts on the same area in one day, for example heavy back squats followed by barbell bent-over rows, which both load the lower back. Two high-fatigue lifts share an area when they have the same limiting factor other than the target muscle, or the same main muscle.

Atlas saves a program that goes over a cap and returns a `fatigue_stacked` warning naming each workout, its four counts, what went over and how to fix it. It warns on a new workout, and on an edited one only when the edit makes it worse, so a stacked session the athlete chose to keep does not warn again when its weights change. To bring a session under the caps, swap a high-fatigue lift for a lower-fatigue one that trains the same muscle, move it to another day, bring earlier sets down to 80% Effort, split a circuit, or trim sets. If the athlete wants the session as written, keep it.

The caps are coaching defaults for a general lifter in a session of about an hour, not research limits. Shorter sessions, beginners and athletes under outside stress usually want less; a well-recovered advanced lifter on a focused day may carry more.

## Effort by exercise type

Assign Effort % by what the exercise costs rather than one number for everything:

- About 90% only for a lift's top set and the last set of an isolation exercise.
- 80–85% for most other work, including back-off sets of compound lifts. Use 80% for the earlier sets so the session stays under the hard-set cap.
- For high-fatigue lifts, use 90% only for one top set and keep back-off sets at about 80%: failure on a barbell row costs far more than failure on a cable curl.

## Watch for fatigue across weeks

Possible fatigue signals include:

- Fewer reps at the same load and Effort.
- Effort climbing at the same weight and reps.
- Sessions running longer than planned, or sets skipped near the end.
- The same lift stalling or dropping for two or more exposures in a row.

Use `guides/progression-decisions` to distinguish today's readiness from a repeated decline. A lower-fatigue exercise or fewer sets can reduce demand while preserving a useful load; reducing the load or taking a deload is also an option when context warrants it, without a mandatory waiting period. Choose the smallest justified change and a reassessment condition. One bad day, missing logs or ordinary soreness do not establish accumulated fatigue (`deloads`).

## Evidence note

What research shows:

- Free weights and machines produced similar average muscle growth in direct comparisons, so a lower-fatigue machine or cable version is a reasonable growth choice; strength results depended on the tested task. [haugen-2023-equipment]
- Sets taken closer to failure tend to add hypertrophy but not clearly strength. [robinson-2024-rir]
- In ten trained men, bench press and squat sets taken to failure slowed recovery of jump height and bar speed over 24 to 48 hours compared with the same volume stopped short of failure. [moran-navarro-2017-failure-recovery]
- In ten male athletes, fatigue after heavy back squats took up to 72 hours to clear, but it was mostly in the muscle rather than the nervous system; drops in voluntary activation lasted 48 hours. "CNS fatigue" alone does not explain how long heavy lifting takes to recover from. [thomas-2018-fatigue-recovery]
- Fatigue is best described as two interacting parts, how much performance drops (from both the nervous system and the muscle) and how tired the athlete feels, not one measure. [enoka-2016-fatigue]

What is coaching practice: the SFR idea itself [israetel-2021-hypertrophy], every exercise's rating and limiting factor, the stacking caps, the same-area rule, and the Effort split by exercise type. No study validates these numbers. The catalog ratings are a first editorial pass awaiting human review. Borderline ones include heavy back squat, barbell RDL and stiff-leg deadlift (medium to high depending on load), front and Zercher squats and trap-bar deadlift (could be high or medium), and the Olympic lifts (technique, not a listed factor, ends most sets). Treat a rating as a starting point and let the athlete's own response overrule it.
