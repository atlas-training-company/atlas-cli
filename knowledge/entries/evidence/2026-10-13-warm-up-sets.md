# How heavy should warm-up sets before resistance training be?

Reviewed: 2026-10-13. Scope: exercise-specific warm-up sets before working sets of a resistance exercise. Acute performance in the same session only; no study here measures long-term strength or muscle gain.

## Why this review adds something

`research/2026-05-19-warmups-ramp-sets` is an unchecked pointer, and `guides/session-decisions` says to ramp without counting warm-ups as hard sets. This check reads two trials that compare warm-up loads directly, so agents can choose a ramp and explain how much it is supported.

## Source checks

### 1. A heavier warm-up set helped more than a light one

Ribeiro et al., *The Role of Specific Warm-up during Bench Press and Squat Exercises: A Novel Approach*. International Journal of Environmental Research and Public Health 17(18):6882, 2020. [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/), DOI 10.3390/ijerph17186882, PMID 32971729. Full text checked October 13.

Randomized crossover in 40 resistance-trained men (squat n = 14, bench press n = 26) on a Smith machine. Before 3 × 6 at 80% 1RM, each did one of: 6 reps at 40% plus 6 at 80% of the training load (1 minute apart), 6 at 80% only, or 6 at 40% only. The light-only warm-up was generally least effective. Squat bar speed was higher after the 80% set than after the 40% set in working sets 2 and 3 (about 0.02 m/s). In the bench press, the 40%-then-80% ramp gave a shorter time to peak velocity in sets 1 and 2 and slightly more total work than the 40% set. Heart rate and RPE did not differ. Limitations: small groups, two lifts, velocity outcomes rather than reps to failure, men only.

### 2. A very heavy warm-up did not add reps across sets to failure

Souza et al., *Effect of warm-up protocols using lower and higher loads on multiple-set back squat volume-load*. PeerJ 12:e17347, 2024. [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11243969/), DOI 10.7717/peerj.17347, PMID 39006036. Full text checked October 13.

Randomized crossover in 14 resistance-trained men. Before three sets of back squats at 75% 1RM to failure, each did 3 reps at 90% 1RM (10 minutes' rest), 6 fast reps at 45% (10 minutes), or a usual 8 reps at 45% (2 minutes). Total reps (21 vs 19 vs 19, p = 0.17) and total volume load (p = 0.15) did not differ; the 90% set gave more volume load in the first set only (p = 0.04). Limitations: small sample with low power, one lift, a fixed long rest after the conditioning sets, men only.

## Interpretation

- Warm-up sets prepare the first working sets. They are not hard training volume and should not be counted as working sets, personal bests or progress.
- One reasonably heavy warm-up near the working load (roughly 70–85%) appears more useful than only light sets. A very heavy single adds little over a normal ramp for higher-rep work and needs long rest to be worth it.
- Effects are small and short-lived, and the trials are small, so exact percentages are coaching convention, not evidence-backed optima.

## Practical application in Atlas

A short ramp keyed to the first working weight and finishing close to it is a reasonable default: with a barbell, the empty bar for about 8 reps, about 50% for 5, then about 80% for 3; before heavy, low-rep or high-Effort work, about 70% for 3 and then about 87% for 1–2. Reps fall as the load rises and no warm-up approaches failure. Viveiros et al. 2024 (*Journal of Bodywork and Movement Therapies*, 15 trained men; not independently checked here) reportedly found one set of 5 at 80% of the 10-repetition load gave more total reps across three sets to failure than lighter single warm-ups, which fits the same direction. Rest about a minute between warm-ups and a little longer before the first working set. Use only the set near the work for a lift already warmed by an earlier exercise of the same pattern, and none for light accessories. The athlete's preference and response override this default; the profile's `warmup_style` records it.

Write warm-ups as their own sets with `role: "warmup"`, exact reps and weight, and no Effort target. See `guides/program-authoring`.
