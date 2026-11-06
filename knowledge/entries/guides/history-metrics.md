# Interpret history, measurements, imports and exports

Use actual session/set records for completed work, and snapshots for what was prescribed. `sessions list --query '{"sort":"recent","limit":20}'` orders by actual dates; default collections use ID order. Follow `data.next_cursor` with identical filters for more pages. Pagination is not a frozen snapshot; date corrections or concurrent inserts may require a fresh traversal.

## Define the analysis population

`exercises history ID` includes current log revisions, including skipped, voided or unknown sets and sessions that are cancelled or ongoing. Select and disclose the statuses appropriate to the question. Session completion does not prove every set was completed. History resolves canonical merged exercise identities but preserves original IDs and snapshots. Related movement families do not make load histories interchangeable.

`core-exercises history ID` groups explicit concrete members of that core while retaining each concrete identity and original snapshot. Related-core links, aliases and names do not add members or authorize substitutions. Both history commands accept recorded `side` and actual `resistance_context.setup_key` through `setup_key`, plus dates, timezone, location, role and statuses. Follow every page with identical filters; restart when a membership/filter-bound cursor becomes invalid. Missing actual side/setup does not inherit the plan, a venue proposal or an agent estimate.

Unknown values are not zero. `performed_on` is a calendar date, not a clock time or location; null timestamps must remain unknown. Historical effort labels such as `P90` and `AMRAP` remain source text. Do not convert them to numeric Effort %, RPE or RIR; the current Effort scale does not backfill imported history. Imported actual repetitions are not reconstructed targets. Session summaries are derived display counts, not independently measured or revisioned workload totals.

## Preserve measurement meaning

| Recorded value | Interpretation |
|---|---|
| Absolute load | Requires mass unit and total/per-implement basis; per-implement remains one implement even when using a pair |
| Unresolved load | Original value with any known unit or basis; at least one of unit or total/per-implement meaning remains unknown |
| Percentage load | Prescription only; resolve its reference before logging actual load |
| Bodyweight or implement label | Preserve the resistance description; do not invent mass |
| Device resistance | Reported configuration, not measured force; missing settings do not mean disabled |
| Moving hardware mass | Setup context, separate from device load and force |
| Force traces | Explicit lbf or N; do not relabel kg mass as force |
| Resistance context | Preserve `reading_kind`, setup identity, provenance and known mechanics. Stack/device settings and measured force do not establish external mass. A derived nominal handle-force projection requires explicit transmission evidence and its quasi-static, frictionless assumptions; it is neither measured force nor muscular load. |
| Rep-count basis | `total` and `per_side` retain the supplied count. Alternating total reps are not multiplied; absent basis remains unknown. Three completed left/right pairs are six side bouts and three sets on each side. |
| Effort % | Interpret `metrics.effort` or `targets.effort` as a percentage only when its owning record has `effort_scale: "percent"`. Values are finite 0–100 inclusive, including decimals; 100% means maximum effort. Targets may be exact or inclusive ranges. Effort is separate from percentage load; no AMRAP effort option. |
| Unmarked Effort | A retained `effort` without `effort_scale` has unknown scale, even if its number is within 0–100. Preserve the value verbatim; do not relabel, convert, or pool it with percentage Effort. |
| Legacy RPE/RIR | Preserve separately reported raw values; no conversion into Effort % or each other |
| Imported P90/AMRAP | Preserve original source labels without converting to numeric effort; AMRAP timed-repeat workout protocols are a separate concept |

The scale marker belongs alongside `targets` on an exercise step or `metrics` on a set, session, or external record. The server stamps new or changed Effort as percent; unchanged corrections preserve the source scale, including its absence. Historical revisions and retry receipts keep their original values and markers. Numeric bounds alone do not establish the scale.

Use `device_resistance` with `device_id` for known per-unit settings, referencing the containing step or set's inline `devices`. Do not copy settings between units or from targets into actuals. Setup side does not establish Twin Mode. Do not sum external load, hardware mass and device settings without a justified mechanical interpretation. Comparisons across these contexts require explicit assumptions.

Keep progression comparisons separate by concrete identity, actual side, rep basis, load unit/basis, setup and resistance evidence. Ordinary load volume and Epley estimates exclude stack settings, device settings and measured force; an unmarked legacy load does not establish a known setup. A load recommendation may use planned `metadata.load_estimate` or notes with source session/set IDs and reviewed revisions, target concrete/side/setup, assumptions, rationale and reassessment guidance. It remains a recommendation rather than actual performance.

## Use recorded body weight

`body-weights list` returns weigh-ins the athlete's iPhone uploaded from Apple Health, newest first. Use it for bodyweight and relative-strength work: added load on dips or pull-ups, bodyweight-relative targets, and progress expressed per unit of body weight. Each record keeps `value` and `unit` exactly as recorded, `measured_at` with its own offset, and `source`. Use the unit given; convert only when a calculation needs another unit, and show the conversion. State the reading and its date in the recommendation. A missing, old or retracted reading is unknown, not an estimate: ask the athlete rather than averaging, interpolating or carrying an old value forward. Agents cannot create or change these records.

```sh
atlas body-weights list --query '{"limit":3}'
atlas body-weights list --query '{"from":"2026-09-01","to":"2026-09-30"}'
```

## Use workouts from other apps

`activities list` returns workouts the athlete recorded outside Atlas, such as a Peloton ride, a run or a yoga class another app saved to Apple Health, newest first. The iPhone uploads them; Atlas's own workouts are never among them. Each record keeps `started_at` and `ended_at` with their own offsets, `duration_seconds` (time working, excluding pauses), `activity_type` (the source's type in snake_case, such as `running`, `cycling` or `traditional_strength_training`), a display `name`, optional `indoor`, and only the measurements the source recorded: `distance_m`, `active_energy_kcal`, `average_heart_rate_bpm`, plus `source` naming the app. Read them before planning the next sessions or reviewing a week: a hard ride yesterday or a long run tomorrow changes what a leg day should hold (see `guides/hybrid-decisions`). An absent measurement is unknown, not zero; a missing workout does not prove the athlete rested, since not every app shares with Health. These are not Atlas sessions: they have no sets, no Effort % and no prescription, so do not count them toward program progress or compare them with logged lifts. A fitness band or watch app can save its own copy of a workout the athlete logged in Atlas: an activity whose time overlaps an Atlas session, usually strength training, is almost always that same workout, so count it once, as the Atlas session. Agents cannot create or change these records.

```sh
atlas activities list --query '{"limit":10}'
atlas activities list --query '{"from":"2026-10-12","to":"2026-10-18"}'
```

A CLI without the `activities` alias reaches the same reads with `atlas call list_activity --file query.json` and `atlas call read_activity`.

## Retrieve detailed reps progressively

```sh
atlas reps list SESSION_ID SET_ID
atlas reps get SESSION_ID SET_ID REP_ID
atlas reps traces SESSION_ID SET_ID REP_ID
atlas reps revision SESSION_ID SET_ID REP_ID REVISION
```

Normal session/set responses exclude reps; rep summaries exclude traces and expose `has_traces`. Rep order uses numerical `position`. Set `metrics.reps` and uploaded rep count are independent; telemetry may be partial. Preserve phase/device attribution, units and source sign conventions. Missing sample timing cannot be reconstructed from ordering or a reported rep duration.

Use `schema write_rep` and `reps write` for actual telemetry, with stable ID and creation/correction conditions. Rep, set and session revisions are independent. A parent device selection correction may require correcting dependent rep observations first. New rep observations can arrive after session completion without reopening it.

## Import and external observations

For a whole export from another app (Strong, Hevy, Fitbod, a spreadsheet with one row per set), use the workout file import instead of building payloads: one command matches every exercise name and imports every workout.

```sh
atlas sessions import-file --file export.csv --data '{"source":"strong"}' --query '{"dry_run":true}' --idempotency-key FILE_KEY
atlas sessions import-file --file export.csv --data '{"source":"strong","exercises":{"NAME":"EXERCISE_ID"}}' --idempotency-key FILE_KEY
```

The preview writes nothing and lists each exercise name once as `catalog`, `yours`, `confirm` (candidates given) or `new` (kept as the athlete's own exercise). Before importing, show the athlete every `confirm` and `new` name and pass their choices as `exercises`: a `confirm` name needs one of its candidates, or `null`; a `new` name would otherwise become the athlete's own exercise without the questions `guides/program-authoring` asks, so ask whether a catalog exercise fits (pass its ID) or they want to keep it as their own (`null`). Without a choice for every `confirm` name, the import writes nothing. Workouts over 500 sets and rows without measurements are skipped and listed by line, so check `skipped_rows` and fix obvious export errors with the athlete before importing. The CLI sends a file over the 1 MiB request limit in parts that keep each workout whole and reports one combined result. Repeating the same command, or importing the same file again under the same `source`, leaves imported workouts unchanged. CLI 0.8.0 adds this command and 0.8.1 adds the parts and `--data` alongside the file; on older CLIs call `import_workout_file` with the file in a JSON `csv` field.

Use the authenticated session-import API for normalized historical workouts you build yourself. Discover `ensure_exercise`, `import_session`, and `read_session_import` and inspect their schemas first. The CLI has aliases for these operations, and the generic calls work too:

```sh
atlas call ensure_exercise --file exercises.json --idempotency-key EXERCISE_KEY
atlas call import_session --file session.json --query '{"dry_run":true}' --idempotency-key IMPORT_KEY
atlas call import_session --file session.json --idempotency-key IMPORT_KEY
atlas call read_session_import --query '{"provider":"PROVIDER","namespace":"NAMESPACE","external_id":"SOURCE_SESSION_ID"}'
```

When listed by `atlas help`, the corresponding aliases are `exercises ensure`, `sessions import`, and `sessions import-status`. For many workouts, preview one representative payload, then commit each directly: an import is atomic, an exact retry replays, and its `201` result is the receipt. Read the receipt only after an uncertain response. The POST operations require an idempotency key, including the dry run. A session dry run validates without storing records or a receipt and does not consume its key; it does not undo exercises created by a separate ensure call.

`ensure_exercise` (`POST /v1/exercises/ensure`) accepts `{exercises:[{key,exercise:ExerciseCreate}]}` with 1–100 unique caller keys. Its result contains `items:[{key,exercise_id,created}]` and total `created`/`reused` counts. Use the returned IDs in sets. Existing IDs resolve redirects; names and aliases match conservatively. Ambiguous matches, archived identities, or supplied implement/setup/movement-family context that conflicts with an existing record require reconciliation. Reuse leaves the exercise unchanged, including aliases and metadata. Do not infer equipment or collapse distinct variants to obtain a match. An entry that would create a new exercise is refused until it carries the athlete's answers about it; see `guides/program-authoring`. The workout file import (`import_workout_file`) keeps a source name the catalog lacks as the athlete's own exercise without that step.

`import_session` (`POST /v1/imports/sessions`, optionally `?dry_run=true`) accepts `source:{provider,namespace,external_id}`, `title`, `performed_on`, and up to 500 `sets`. Each set needs a stable `id` and normal set-log fields, excluding `reference`. An optional session `id` must also remain stable across retries. Optional session fields are `started_at`, `ended_at`, `location_id`, `notes`, `metrics`, `effort_scale`, and `metadata`. Unknown time and venue default to null; omitted set `performed_at` is null, omitted status is `unknown`, and omitted positions use array order starting at 1. Set `completed` only when the source establishes completion. Preserve source observations and provenance without guessing repetitions, load, equipment, times, or prescriptions. The import creates a completed session with empty prescription steps and the source identity as an external observation.

The result contains `dry_run`, `imported`, `session_id`, `set_ids`, `source`, and `source_hash`. A first import returns 201 with `imported:true`; a dry run returns 200 with `dry_run:true` and `imported:false`. An unchanged normalized source/payload submitted with a new key returns 200 with `imported:false`, preserving later corrections. An identical retry with the original key replays its original response. Changed content for an existing source conflicts; do not change the source identity to evade that check. `read_session_import` (`GET /v1/imports/sessions`) looks up the receipt by all three source fields and returns its IDs/source/hash without `dry_run` or `imported`. A source already linked to a manually created session also conflicts; reconcile the returned session ID instead of duplicating it. Correct accepted records through ordinary APIs.

Earlier imports recorded only in metadata or an agent's private mapping are not automatically matched by receipt lookup. Retain the mapping, reconcile those sessions once, and deliberately attach their matching `external_records` using current revisions before importing that source again. A missing receipt does not prove the workout is absent; do not create duplicates by restarting a previous import.

Vendor CSV authoring is retired and absent from canonical discovery. Use generic session imports for reviewed sessions/sets and separate resumable generic rep writes for detailed telemetry. Session import does not include nested reps; Atlas ships no vendor converter here. Existing vendor history, measurements, traces, provider/source identity, revisions, exports and sync remain readable. Only an identical command with its original accepted key/method/path/query/body/conditions replays its original response and ETag. Changed identity under that key returns `409 idempotency_conflict`; a new key returns `410 operation_retired`, even for the same source. Do not create another source identity or key to bypass retirement. Correct accepted logs through ordinary APIs.

Session `external_records` links identify provider, namespace and external ID. They are observations, not values to add to manual metrics. Time overlap alone does not prove the same workout. A supplied array replaces the array; retain unrelated links. Mark an upstream deletion as deleted while retaining identity. Explicit removal corrects a mistaken link. Source revisions are opaque, not Atlas revisions. Storage does not establish HealthKit/Google synchronization or device control.

A finished workout the iPhone saved to Apple Health carries an `apple_health` link (`namespace` `healthkit`, `role` `export`) with `metrics.average_heart_rate_bpm`, `metrics.maximum_heart_rate_bpm` and, from iOS 27, `metadata.heart_rate_zones`: five zones lowest first, each `{zone, min_bpm, max_bpm, seconds}` (no `min_bpm` on zone 1, no `max_bpm` on zone 5). Read time in zones from there to judge how hard a workout was; the zones are the athlete's own Health settings. Keep the link when patching `external_records`, and don't add its numbers to manual metrics. Any other app or assistant that reads Apple Health sees that same workout as strength training, with its time, heart rate and energy but no name, sets or Effort %: it is this session, so count it once and take its sets and Effort % from Atlas. Sleep, resting heart rate and heart rate variability stay on the athlete's iPhone and never reach Atlas; use them only from a source that has them, and do not diagnose from them.

## Export and precision

`atlas export` returns this authenticated user's current records and retained revisions. It can be large and private; retrieve it only when the task requires complete audit/export. It excludes credentials, retry receipts and private archived source bytes. Session import accepts normalized workouts, not a whole-account export; there is no general export-restore or archive-download API. Use ordinary session/set corrections for reviewed changes, `historical:true` for a missed set in an ended session, and revision reads to audit previous values. Export is not a reason to access the database or local private archives.

Export 8 includes versioned `standard_exercises` and `standard_core_exercises` for explicit current and retained references, including program-only defaults/intents, nested pairs, original/current sessions and captured catalogs. Private cores remain ordinary records/revisions. Stored related-core references are included; links solely in added bundled outputs are not recursively expanded into a closed graph. Metadata, rationale, venue proposals and input-only revision pins add no dependencies. Keep source snapshots and historical absence exact, using captured versions to interpret recorded work rather than today's library.
