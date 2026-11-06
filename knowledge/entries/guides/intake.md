# Establish and maintain individual context

Start with `atlas me`, `atlas profile get`, and `atlas context`. A profile 404 means no profile exists. Blank location notes or a missing default venue does not establish that the athlete has no equipment. Read the active program and recent sessions when they help, and reuse context already supplied in the conversation.

An empty active-program list does not mean no plan exists. Follow a program ID retained in coaching notes, or inspect `atlas programs list --query '{"status":"draft"}'`. A draft remains a proposal; do not silently activate it or treat its workouts as completed.

## Ask proportionately

For a new coaching plan, establish the person's priorities, training experience, available days/session time, relevant restrictions, preferred or disliked activities, and actual venue/equipment. Ask only about gaps that change the decision. Current readiness, symptoms, or a reported restriction may require a narrower plan; retrieve `assessment-and-readiness` for the coaching assessment and `adherence-and-recovery` for feasible goals. Do not turn a simple set-logging request into a full intake interview.

### First-time onboarding

When the profile is missing or lacks the basics and the person wants a plan or a review, ask these in one short, friendly message. Skip any question the profile, location notes or conversation already answers, and accept short answers:

1. What matters most right now (for example building muscle, getting stronger, fitness, general health), in order?
2. How long have you been training, and what does a normal week look like now?
3. How many days a week can you train, and how long per session? Is it different on some days, such as weekends?
4. Where do you train, and what equipment is there?
5. Any injuries, pain, or movements to avoid?
6. How do you like to train (straight sets, supersets, circuits, cardio), and is there anything you love or hate doing?

Then save the answers before programming. Put what fits into the structured planning fields: usual workout length in `session_minutes`, days that differ (such as longer weekends) in `session_minutes_by_day`, `days_per_week` and `preferred_days`, and liked or avoided styles in `preferred_styles` and `avoided_styles`. Keep goals, experience, restrictions, and anything the fields cannot express (cardio, loved or hated exercises, a day that varies week to week) in the matching text fields, and equipment in the training location's notes. Tell the person what you saved. A logging request, a question about one exercise, or a quick edit never needs this interview.

Separate the athlete's statement, an observed record, and your inference. Old imported notes may be stale or refer to a different context. Ask about a consequential conflict instead of treating old text as a new instruction. An absent restriction is unknown, not a confirmed negative.

## Save durable context

Use `atlas schema write_profile`. The fixed profile has these optional editable fields:

| Field | Intended content |
|---|---|
| `goals` | Stated training priorities |
| `experience` | Relevant training background |
| `schedule` | Sustainable availability and session constraints |
| `session_minutes` | Usual workout length in whole minutes (5–600), including warm-up |
| `session_minutes_by_day` | `monday`…`sunday` lengths for days that differ; other days use `session_minutes` |
| `days_per_week` | Training days per week (1–7) |
| `preferred_days` | Weekdays that suit training; may list more days than `days_per_week` |
| `preferred_styles` / `avoided_styles` | `straight_sets`, `supersets`, `circuits`, `intervals`, `amrap`, `emom`; a style cannot be in both |
| `warmup_style` | How they like to warm up: `empty_bar: false` to skip the empty-bar set, `max_sets` (1–5) to cap warm-ups per lift |
| `time_zone` | Known IANA default for calendar/history queries; explicit query zones take precedence, and changing it never rewrites past sessions |
| `restrictions` | Stated limitations or applicable professional guidance |
| `preferences` | Activities and coaching preferences |
| `coaching_notes` | Markdown factual context, source/date, labeled inference and review criteria |
| `reviewed_at` | Timestamp of the athlete's actual review |

Plan within the structured fields rather than reinterpreting prose: each workout fits its day's length, and the week uses the stated days and styles unless the athlete changes them. Omit unknown fields. An empty array means explicitly no stated items, not that assessment occurred. Do not fill a date, diagnosis, biological measurement, or restriction from inference. Keep current session energy, soreness, and transient readiness in session notes or known session metrics rather than making them durable traits.

When storing the authorized intake, create only after confirming absence:

```sh
atlas profile write --file profile.json \
  --if-none-match '*' --idempotency-key PROFILE_CREATE_KEY
```

For a later authorized edit, read the profile and preserve all unaffected editable fields:

```sh
atlas profile write --file profile-edited.json \
  --if-match PROFILE_REVISION --idempotency-key PROFILE_EDIT_KEY
```

This is full replacement, not a patch. Omitted optional fields are removed, including the structured session and style fields, so copy them from the current profile even when the edit is about something else. Exclude returned `id`, `revision`, `created_at`, and `updated_at`; the ID is fixed and is not a command argument. An existing profile needs its revision, not a second creation attempt. Advance `reviewed_at` only when the athlete reviews the profile, not merely because an agent edits notes.

A concise note can say: “Athlete reported [fact] on [date]. Coaching inference: [interpretation]. Revisit if [specific change].” Use actual known dates; preserve uncertainty when a source date is unavailable. This is a writing convention, not a required new schema.

## Refresh where it matters

Revisit relevant assumptions when goals, availability, restrictions, equipment, or tolerance change. Read `atlas context --query '{"location_id":"VENUE_ID"}'` for the chosen venue, read its Markdown notes, and save confirmed equipment or travel changes into those location notes with the current revision. Profile context does not substitute for the selected gym description.

After saving, inspect the response and tell the athlete what durable facts changed. Proceed with the requested plan or session; profile maintenance is part of coaching, not an independent approval ritual.
