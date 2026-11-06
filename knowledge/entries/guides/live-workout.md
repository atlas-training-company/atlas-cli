# Coach and record a workout

Address acute concerning symptoms immediately, before the record-reading flow below. Stop exercise and follow `assessment-and-readiness` for emergency escalation; do not substitute another movement or finish logging before advising urgent help.

Read the relevant profile restrictions/preferences, current venue, program and progress. For session-specific assessment retrieve `assessment-and-readiness`. Confirm the immediate task using information already available. Coaching a session does not require repeating full intake or rewriting the program.

## Resume or start

```sh
atlas programs progress PROGRAM_ID
atlas sessions get SESSION_ID
atlas sessions list --query '{"status":"in_progress","limit":20}'
atlas schema create_session
```

Resume the intended ongoing session. Several independent sessions may exist, so do not pick an unrelated one. For a planned occurrence, create a session using its exact `program_id`, current `program_revision`, and `workout_id`. A duplicate start returns `409 existing_session`; read that session rather than inventing a new occurrence. Cancelled attempts can be retried. A standalone session supplies a `workout` instead and does not silently complete a planned occurrence.

`programs progress` applies to finite programs with `weeks`. For a reusable routine it returns `not_cycle`; choose the intended workout from the program and inspect ongoing sessions instead. A reusable routine can be started repeatedly; its prior completion does not consume it permanently.

```sh
atlas sessions start --file session.json --idempotency-key SESSION_START_KEY
```

A session stores its workout/catalog snapshot. Future program edits do not change this session. Session venue defaults from the workout then the user's default; explicit `location_id:null` records unknown and suppresses those fallbacks. Record known actual start/local calendar dates, not invented precision.

For an authorized change before starting a linked workout, supply `workout_override` alongside its reviewed program link. Its workout ID must match `workout_id`. The server preserves the original prescription and derives the adjustment record; the source program is unchanged. Choosing a different implement selects its distinct exercise variant, without pooling its load history with the original.

An adaptation handoff or today-only proposal review is read-only. Keep the chosen override pending until the athlete selects the existing session start. For a reviewed bilateral-to-paired substitution, carry the existing `workout_substitutions` relationship: removed source step, fresh concrete left/right targets, retained source repeat path and full target repeat path including the fresh one-round wrapper. Preserve the pair and intended core, independently authored side reps/rest and unknown loads. Three paired rounds are three sets per side and six bouts. The server’s existing adjustment validator owns the map; do not invent a second mapping or infer completed sides from the proposal. A venue change alone never proves performed setup or device state.

## Guide and log actual bouts

Read the snapshot prescription, then coach the next relevant bout. Keep set targets separate from the athlete's report. Do not infer completed repetitions, effort, or load just because a target exists. For substitutions, keep the original prescription reference while recording the actual exercise/equipment/setup. Unplanned work omits `reference`.

A session's `swaps` name the exercise a step's sets still to do are done as, chosen during the workout on any device. Name that exercise when coaching the step, and log its sets with the swap's `exercise_id`, keeping the step's `reference`. To swap or return a step to the plan, `atlas sessions patch` the whole `swaps` list; `[]` returns every step to the plan. The prescription itself does not change.

A session's `exercise_notes` hold what the athlete noted about an exercise in this workout, one note per `exercise_id`, such as a seat setting, a cue that helped or a joint that complained. Read them before coaching that exercise again and before writing the next program change. To add or change one for the athlete, `atlas sessions patch` the whole `exercise_notes` list; `[]` removes every note. They stay editable after the workout ends.

A session with `paused_at` is paused: the athlete stepped away, and their devices have stopped the workout's time and any rest timer. Don't coach the next set or log sets for it until it resumes; a timer's time left is `ends_at` minus `paused_at`. `paused_seconds` is the time spent paused so far, which the workout's time leaves out. Only pause or resume for the athlete when they ask: `atlas sessions patch` with `paused_at` set to the time, and `paused_at: null` to resume.

```sh
atlas schema write_set
atlas sets write SESSION_ID SET_ID --file actual-set.json \
  --if-none-match '*' --idempotency-key SET_CREATE_KEY
```

Choose a stable set ID for this actual bout. `reference` contains the exercise `step_id` and zero-based `rounds`, outermost first; use `[]` for an exercise outside repeats. Multiple logs may reference one prescribed bout. Record side when known.

Record new intensity reports as `metrics.effort`, **Effort %**: finite 0–100 inclusive, decimals accepted, with 100% meaning maximum effort. For example, `"metrics":{"reps":8,"effort":87.5}` records eight reps and reported 87.5% Effort. There is no separate AMRAP effort option. Actual metrics are numbers, not target ranges: confirming an Effort target range does not establish an exact actual. Keep an unknown actual absent, and preserve explicitly reported zero. Retain legacy RIR/RPE in their original fields and imported `P90`/`AMRAP` source text without conversion; the API does not map them to Effort. AMRAP as a timed-repeat protocol remains supported. Absolute load requires a unit and total/per-implement basis. Use unresolved load when historical semantics are unknown, not a guessed conversion. Prescription device resistance is not automatically copied into the actual set. Record observed/reported settings only.

If `devices` is omitted, the matching prescription's inline devices may be used; send `devices:[]` to explicitly record none. Exercises have no device defaults or owned-equipment dependencies. Record actual `setup_notes` explicitly; location notes and prescribed setup do not prove what happened. Read the saved set to confirm its context.

## Rest and finish

Start a session `timer` with `duration_seconds` and an optional `step_id`. Omit `ends_at` so the server calculates and stores the absolute deadline during the first successful command execution. Inspect `atlas schema patch_session`; update with the current session revision:

```sh
atlas sessions patch SESSION_ID --data '{"timer":{"duration_seconds":90}}' \
  --if-match SESSION_REVISION --idempotency-key TIMER_START_KEY
```

Retry the identical request with the same body, revision precondition and idempotency key to retain its original deadline. An explicit `ends_at` is also supported; preserve that timestamp unchanged on retries. The server stores timer state but does not run a countdown. Send `timer:null` with the current session revision and a new idempotency key to clear it.

Upload and acknowledge pending logs before completion or cancellation. Then use the current session revision:

```sh
atlas sessions patch SESSION_ID --data '{"status":"completed"}' \
  --if-match SESSION_REVISION --idempotency-key SESSION_FINISH_KEY
```

Terminal status clears the timer and sets the end time unless the historical contract retains unknown time. Completed/cancelled sessions cannot transition through ordinary `sessions patch`; an explicit correction can repair their outcome or program link. Summarize actual work and the athlete's reported response; do not claim every prescribed set happened.

## Correct or backfill

For a mistaken ended-workout outcome or program association, inspect `atlas schema correct_session`, then use `atlas sessions correct SESSION_ID` with `--if-match SESSION_REVISION`, an idempotency key, and a body containing `reason` plus a changed `status`, `program_link`, or both. This requires the separately granted `correct_session` capability. Outcomes can change between `completed` and `cancelled`; correction never reopens a session or changes its logged sets or original prescription.

Omit `program_link` to preserve the association, send `null` to detach it from program progress, or supply the reviewed target `program_id`, current `program_revision`, and `workout_id`. The target occurrence must still exist and be unskipped; a completed correction cannot claim a finite occurrence already underway or completed elsewhere. Inspect conflicts before changing the request. Use `sessions revision SESSION_ID REVISION` to read retained session evidence; set revisions are separate.

Read current logs through `sessions get` or `sets list`; there is no standalone current `sets get` alias/route. Correct an existing set with full editable content and its own revision using `--if-match`, preserving source metadata/setup. Sets do not increment the session revision.

A missed new historical set in an ended session requires explicit `--query '{"historical":true}'` plus `--if-none-match '*'`. Ordinary new set creation requires an ongoing session. Rep telemetry may arrive after completion. Session notes, metrics, dates and existing logs remain correctable without reopening. Use `guides/safe-mutations` for conflicts or an uncertain response, and `guides/history-metrics` for unknown dates, reps and imported observations.
