import { resistanceContextSchema } from './resistance-context.js';
import { MAX_STEP_DEPTH, MAX_WORKOUT_STEPS, validateWorkoutStructure } from './workout-structure.js';
import * as z from 'zod';
import { util } from 'zod/v4/core';
import { isDeepStrictEqual } from 'node:util';
import { resistanceProfileSchema, devicesSchema, deviceResistanceSchema } from './measurements.js';

export const MAX_JSON_DEPTH = 32;
export const MAX_METADATA_BYTES = 65_536;
export { MAX_STEP_DEPTH, MAX_WORKOUT_STEPS };

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const safeKeySchema = z.string().min(1).max(100).refine((key) => !unsafeKeys.has(key), 'Unsafe object key');
export const idSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
export const exerciseReferenceIdSchema = z.union([idSchema, z.string().max(100).regex(/^atlas:exercise:[a-z0-9]+(?:-[a-z0-9]+)*$/)]).describe(
  'Private exercise ID or stable shared Atlas exercise reference.',
);
export const coreExerciseReferenceIdSchema = z.union([idSchema, z.string().max(100).regex(/^atlas:core:[a-z0-9]+(?:-[a-z0-9]+)*$/)]).describe(
  'Private core ID or stable shared Atlas core exercise reference.',
);
export const sharedProgramIdSchema = z.string().max(100).regex(/^atlas:program:[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const programReferenceIdSchema = z.union([idSchema, sharedProgramIdSchema]);
export const timestampSchema = z.iso.datetime({ offset: true });
const nameSchema = z.string().min(1).max(200);
export const notesSchema = z.string().max(100_000).describe('Freeform text or Markdown; preserved verbatim.');
const tagsSchema = z.array(z.string().min(1).max(100)).max(100);

function invalid(message: string, path: PropertyKey[] = []): never {
  throw new z.ZodError([{ code: 'custom', message, path }]);
}

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Call on decoded request JSON before any recursive Zod contract is parsed. */
export function assertJsonBounds(value: unknown): asserts value is JsonValue {
  const pending: { value: unknown; depth: number; path: PropertyKey[]; exit?: boolean }[] = [{ value, depth: 0, path: [] }];
  const ancestors = new WeakSet<object>();
  while (pending.length > 0) {
    const item = pending.pop()!;
    const current = item.value;
    if (item.exit) {
      if (Array.isArray(current) || util.isPlainObject(current)) ancestors.delete(current);
      continue;
    }
    if (item.depth > MAX_JSON_DEPTH) invalid(`JSON nesting exceeds ${MAX_JSON_DEPTH} levels`, item.path);
    if (jsonPrimitiveSchema.safeParse(current).success) continue;
    if (!Array.isArray(current) && !util.isPlainObject(current)) invalid('Expected a JSON value', item.path);
    if (ancestors.has(current)) invalid('Cyclic JSON is not supported', item.path);
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
      invalid('Expected a plain JSON object', item.path);
    }
    ancestors.add(current);
    pending.push({ ...item, exit: true });
    for (const [key, child] of Object.entries(current)) {
      if (unsafeKeys.has(key)) invalid('Unsafe object key', [...item.path, key]);
      pending.push({ value: child, depth: item.depth + 1, path: [...item.path, Array.isArray(current) ? Number(key) : key] });
    }
  }
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(),
  z.array(jsonValueSchema), z.record(safeKeySchema, jsonValueSchema),
]));
export const metadataSchema = z.record(safeKeySchema, jsonValueSchema).superRefine((value, context) => {
  try { assertJsonBounds(value); } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    for (const issue of error.issues) context.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_METADATA_BYTES) {
    context.addIssue({ code: 'custom', message: `Metadata exceeds ${MAX_METADATA_BYTES} UTF-8 bytes` });
  }
}).describe('Explicit JSON extensions, at most 65,536 UTF-8 bytes; object keys are 1–100 characters and unsafe prototype keys are rejected.');
export type Metadata = z.infer<typeof metadataSchema>;

export const scheduleAdjustmentSchema = z.strictObject({
  original_date: z.iso.date().nullable(), previous_date: z.iso.date().nullable(), scheduled_date: z.iso.date().nullable(),
  previous_program_revision: z.number().int().positive(),
});
export const workoutMetadataSchema = z.union([
  metadataSchema,
  z.object({ schedule_adjustment: scheduleAdjustmentSchema }).catchall(jsonValueSchema).superRefine((
    { schedule_adjustment: _adjustment, ...metadata },
    context,
  ) => {
    const parsed = metadataSchema.safeParse(metadata);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  }),
]).describe(
  'Workout JSON extensions use the ordinary 65,536 UTF-8 byte metadata allowance. A valid fixed-shape ' +
    'schedule_adjustment record has a separate allowance so scheduling never displaces user metadata.',
);

const rangeOf = (numberSchema: z.ZodNumber) => z.strictObject({ min: numberSchema, max: numberSchema })
  .refine(({ min, max }) => min <= max, 'Range minimum must not exceed maximum')
  .describe('Inclusive range with min <= max.');
const targetOf = (numberSchema: z.ZodNumber) => z.union([numberSchema, rangeOf(numberSchema)]);
const repsSchema = z.number().int().nonnegative();
const nonnegativeSchema = z.number().nonnegative();
const effortSchema = z.number().min(0).max(100).describe(
  'Effort percentage from 0 through 100, with 100 representing maximum effort. Independent of load, RPE, and RIR; values are never converted.',
);
export const effortScaleSchema = z.literal('percent').optional().describe(
  'Explicit scale of this record’s effort metric or target. New or corrected Effort is stored as percent. Absence on ' +
    'retained records means the scale is unknown; do not infer it from numeric bounds.',
);
export type EffortScale = { effort_scale?: 'percent' };
const legacyExertionSchema = z.number().min(0).max(10);
const metricKeySchema = safeKeySchema.regex(/^[A-Za-z][A-Za-z0-9_]*$/);
const metricNameCheck = (metrics: Record<string, number | { min: number; max: number } | undefined>, context: z.RefinementCtx) => {
  for (const key of Object.keys(metrics)) {
    if (!metricKeySchema.safeParse(key).success) context.addIssue({
      code: 'custom',
      path: [key],
      message: 'Metric names must be safe identifiers of 1–100 characters',
    });
  }
};
export const targetMetricsSchema = z.object({
  reps: targetOf(repsSchema).optional(),
  duration_seconds: targetOf(nonnegativeSchema).optional(),
  distance_meters: targetOf(nonnegativeSchema).optional(),
  effort: targetOf(effortSchema).optional(),
  rpe: targetOf(legacyExertionSchema).optional(),
  rir: targetOf(legacyExertionSchema).optional(),
}).catchall(targetOf(z.number())).superRefine(metricNameCheck)
  .describe('Exact numeric targets or inclusive ranges. Custom metric names include units, for example power_watts.');
export const actualMetricsSchema = z.object({
  reps: repsSchema.optional(),
  duration_seconds: nonnegativeSchema.optional(),
  distance_meters: nonnegativeSchema.optional(),
  effort: effortSchema.optional(),
  rpe: legacyExertionSchema.optional(),
  rir: legacyExertionSchema.optional(),
}).catchall(z.number()).superRefine(metricNameCheck);
export type TargetMetrics = z.infer<typeof targetMetricsSchema>;
export type ActualMetrics = z.infer<typeof actualMetricsSchema>;
// Effort was an unrestricted custom metric before it became a percentage.
// Read old values verbatim; authoring needs bounded schemas or source-relative validation.
const retainedEffortSchema = z.number().describe(
  'Retained Effort value. Older records accepted any finite number without declaring its scale; preserve it without conversion. ' +
    'New writes use 0–100 percent.',
);
export const retainedTargetMetricsSchema = targetMetricsSchema.safeExtend({ effort: targetOf(retainedEffortSchema).optional() });
export const retainedActualMetricsSchema = actualMetricsSchema.safeExtend({ effort: retainedEffortSchema.optional() });
export const externalRecordSchema = z.strictObject({
  provider: z.string().trim().min(1).max(100),
  namespace: z.string().min(1).max(200).refine(value => value.trim().length > 0, 'Namespace must not be blank'),
  external_id: z.string().min(1).max(200).refine(value => value.trim().length > 0, 'External ID must not be blank'),
  origin_application: z.string().max(200).optional(),
  role: z.enum(['observation', 'export']).default('observation'),
  status: z.enum(['active', 'deleted']).default('active'),
  source_revision: z.string().max(200).optional(),
  started_at: timestampSchema.optional(), ended_at: timestampSchema.optional(),
  metrics: actualMetricsSchema.optional(), effort_scale: effortScaleSchema, metadata: metadataSchema.optional(),
}).describe('External workout evidence or an export receipt attached to this session. Its metrics never replace Atlas metrics automatically.');
export type ExternalRecord = z.infer<typeof externalRecordSchema>;
export const retainedExternalRecordSchema = externalRecordSchema.extend({ metrics: retainedActualMetricsSchema.optional() });

// A weight means nothing without its unit and what it counts, so each refusal says what to send.
const absoluteLoadSchema = z.strictObject({
  type: z.literal('absolute'), value: z.number().nonnegative(),
  unit: z.enum(['kg', 'lb'], { error: 'Give the weight\'s unit: "lb" or "kg".' }),
  basis: z.enum(['total', 'per_implement'], {
    error: 'Say what the weight counts: "total" for the whole load (a loaded barbell, a machine stack) or "per_implement" for each dumbbell or kettlebell.',
  }),
  assistance: z.boolean().optional(),
});
const bodyweightLoadSchema = z.strictObject({ type: z.literal('bodyweight') });
const implementLoadSchema = z.strictObject({ type: z.literal('implement'), label: z.string().min(1).max(200) });
const percentLoadSchema = z.strictObject({ type: z.literal('percent'), value: z.number().nonnegative(), of: z.enum(['one_rep_max', 'training_max']) });
const unresolvedLoadSchema = z.strictObject({
  type: z.literal('unresolved'), value: z.number().nonnegative(), unit: z.enum(['kg', 'lb']).optional(),
  basis: z.enum(['total', 'per_implement']).optional(), source_label: z.string().max(200).optional(),
}).refine(value => value.unit === undefined || value.basis === undefined, 'Use an absolute load when both unit and basis are known')
  .describe('Historical load whose unit or total/per-implement basis is unknown. Preserve the numeric observation without inventing its meaning.');
export const loadSchema = z.discriminatedUnion('type', [absoluteLoadSchema, bodyweightLoadSchema, percentLoadSchema, implementLoadSchema]);
export const actualLoadSchema = z.discriminatedUnion('type', [absoluteLoadSchema, bodyweightLoadSchema, implementLoadSchema, unresolvedLoadSchema]);
export type Load = z.infer<typeof loadSchema>;
export type ActualLoad = z.infer<typeof actualLoadSchema>;
export const sideSchema = z.enum(['left', 'right', 'both', 'alternating']);

/** How one round of a set differs from the set's own values. Only the fields it names change. */
export const roundOverrideSchema = z.strictObject({
  rounds: z.array(z.number().int().nonnegative()).min(1).max(MAX_STEP_DEPTH - 1).describe(
    'Which round, counted from 0: one index per repeat around the set, outermost first, the same as a logged set\'s reference.rounds. '
      + 'A set directly in a 3-round superset has rounds [0], [1] or [2].',
  ),
  targets: targetMetricsSchema.optional().describe('Targets for this round, merged metric by metric over the set\'s targets.'),
  load: loadSchema.optional().describe('The weight for this round, in place of the set\'s load.'),
  rest_seconds: nonnegativeSchema.optional(), notes: notesSchema.optional(),
}).refine(round => round.targets !== undefined || round.load !== undefined || round.rest_seconds !== undefined || round.notes !== undefined,
  'Name what changes in this round: targets, load, rest_seconds or notes. A round with the set\'s own values needs no entry.');
export type RoundOverride = z.infer<typeof roundOverrideSchema>;

export const exerciseStepSchema = z.strictObject({
  id: idSchema, type: z.literal('exercise'), exercise_id: exerciseReferenceIdSchema,
  intended_core_exercise_id: coreExerciseReferenceIdSchema.optional().describe('Planned movement intent; exercise_id is the concrete default.'),
  side_pair_id: idSchema.optional().describe('Workout-scoped identity of one left/right pair on the same concrete variant and count-based repeat path.'),
  rep_count_basis: z.enum(['total', 'per_side']).optional(),
  devices: devicesSchema.optional(), setup_notes: notesSchema.optional(), targets: targetMetricsSchema.optional(), effort_scale: effortScaleSchema,
  resistance_context: resistanceContextSchema.optional(),
  load: loadSchema.optional(), resistance: resistanceProfileSchema.optional(), device_resistance: deviceResistanceSchema.optional(),
  side: sideSchema.optional(), rest_seconds: nonnegativeSchema.optional(),
  round_overrides: z.array(roundOverrideSchema).min(1).max(100).optional().describe(
    'Rounds of the repeat around this set that ask for something different, such as a heavier first round: '
      + '[{"rounds": [0], "load": {...75 lb...}, "targets": {"reps": 8, "effort": 90}}]. List only the rounds that differ, '
      + 'and put the value most rounds share on the set itself. Needs a repeat with until.rounds around the set.',
  ),
  tempo: z.string().max(100).optional().describe(
    'Seconds lowering, paused at the bottom, lifting and paused at the top, such as "3-1-1-0" or "31X0" (X is as fast as possible). '
      + 'The app paces each rep at it. Missing paces 2 seconds down and 2 up.',
  ),
  role: z.string().max(100).optional().describe(
    'Set purpose. Write "warmup" on each warm-up set before the working sets: exact reps and weight, no Effort. '
      + 'The app folds warm-ups into one line apart from the working sets and leaves them out of volume and progress. Missing means a working set.',
  ),
  notes: notesSchema.optional(), metadata: metadataSchema.optional(),
});
export type ExerciseStep = z.infer<typeof exerciseStepSchema>;
export const retainedExerciseStepSchema = exerciseStepSchema.extend({ targets: retainedTargetMetricsSchema.optional() });
// Preserve an own undefined property for explicit clearing until source-relative retention runs.
const clearablePlannedField = <T extends z.ZodType>(schema: T): z.ZodType<z.output<T> | undefined, z.input<T> | null | undefined> =>
  // SAFETY: overwrite maps only the added null/undefined inputs to undefined and preserves every other parsed output.
  schema.nullable().optional().overwrite(value => value ?? undefined) as z.ZodType<z.output<T> | undefined, z.input<T> | null | undefined>;
const replacementExerciseStepSchema = retainedExerciseStepSchema.extend({
  resistance_context: clearablePlannedField(resistanceContextSchema),
  intended_core_exercise_id: clearablePlannedField(coreExerciseReferenceIdSchema),
  side_pair_id: clearablePlannedField(idSchema),
  rep_count_basis: clearablePlannedField(z.enum(['total', 'per_side'])),
});
export const restStepSchema = z.strictObject({ id: idSchema, type: z.literal('rest'), duration_seconds: nonnegativeSchema, notes: notesSchema.optional() });
export type RestStep = z.infer<typeof restStepSchema>;
export const repeatUntilSchema = z.union([
  z.strictObject({ rounds: z.number().int().min(1).max(10_000) }),
  z.strictObject({ duration_seconds: z.number().positive().max(86_400) }),
]);
export interface RepeatStep {
  id: string;
  type: 'repeat';
  steps: Step[];
  until: z.infer<typeof repeatUntilSchema>;
  interval_seconds?: number;
  notes?: string;
}
export type Step = ExerciseStep | RestStep | RepeatStep;
function protocolSchema(exercise: typeof exerciseStepSchema | typeof replacementExerciseStepSchema): z.ZodType<Step> {
  const step: z.ZodType<Step> = z.lazy(() => z.discriminatedUnion('type', [
    exercise,
    restStepSchema,
    z.strictObject({
      id: idSchema, type: z.literal('repeat'), steps: z.array(step).min(1).max(MAX_WORKOUT_STEPS),
      until: repeatUntilSchema, interval_seconds: z.number().positive().max(86_400).optional(), notes: notesSchema.optional(),
    }),
  ]));
  return step;
}
export const stepSchema = protocolSchema(exerciseStepSchema);
export const retainedStepSchema = protocolSchema(retainedExerciseStepSchema);

export const workoutSchema = z.strictObject({
  id: idSchema, name: nameSchema, scheduled_date: z.iso.date().optional(), location_id: idSchema.optional(),
  week: z.number().int().min(1).max(104).optional().describe('One-based week in a finite program cycle.'),
  skipped: z.boolean().optional().describe('Explicitly skip this occurrence. Missing is false; elapsed dates never imply it. A new authored date clears it.'),
  purpose: z.enum(['baseline', 'additional']).optional().describe('Occurrence purpose. Missing retains the legacy baseline meaning.'),
  steps: z.array(stepSchema).max(MAX_WORKOUT_STEPS), metadata: workoutMetadataSchema.optional(),
}).superRefine(validateWorkoutStructure).describe('Ordered protocol tree: at most 1,000 total steps, 8 levels, and unique step IDs within each workout.');

export type Workout = z.infer<typeof workoutSchema>;
export const retainedWorkoutSchema = workoutSchema.safeExtend({ steps: z.array(retainedStepSchema).max(MAX_WORKOUT_STEPS) });
export const replacementWorkoutSchema = retainedWorkoutSchema.safeExtend({
  steps: z.array(protocolSchema(replacementExerciseStepSchema)).max(MAX_WORKOUT_STEPS),
});

/** Preserve known/unknown scale only when the value is retained from this exact source. */
function applyEffortScale(owner: EffortScale, value: TargetMetrics['effort'], source?: EffortScale, original?: TargetMetrics['effort']): void {
  if (value === undefined) { delete owner.effort_scale; return; }
  if (original !== undefined && isDeepStrictEqual(value, original) && (owner.effort_scale === undefined || owner.effort_scale === source?.effort_scale)) {
    if (source?.effort_scale) owner.effort_scale = source.effort_scale;
    else delete owner.effort_scale;
    return;
  }
  targetMetricsSchema.shape.effort.parse(value);
  owner.effort_scale = 'percent';
}

export function applyActualEffortScale(owner: EffortScale & { metrics?: ActualMetrics }, source?: EffortScale & { metrics?: ActualMetrics }): void {
  applyEffortScale(owner, owner.metrics?.effort, source, source?.metrics?.effort);
}

export function applyWorkoutEffortScale(workout: Workout, source?: Workout): void {
  const original = new Map(source ? collectExerciseSteps(source).map(({ step }) => [step.id, step]) : []);
  for (const { step } of collectExerciseSteps(workout)) {
    const previous = original.get(step.id);
    applyEffortScale(step, step.targets?.effort, previous, previous?.targets?.effort);
  }
}

/** Only the same step in the reviewed source may retain an older Effort value. */
export function parseWorkoutOverride(input: Workout, source: Workout): Workout {
  const workout = replacementWorkoutSchema.parse(input);
  applyWorkoutEffortScale(workout, source);
  return workout;
}

export const timeZoneSchema = z.string().min(1).max(128).refine(timeZone => {
  if (/^[+-]/.test(timeZone)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone }); return true; }
  catch { return false; }
}, 'Expected an IANA time zone supported by Intl');

export const locationSchema = z.strictObject({
  name: nameSchema,
  notes: notesSchema.optional().describe(
    'Primary current user-authored description of this location for workout programming, including equipment, setup, space, and constraints.',
  ),
  tags: tagsSchema.optional(), metadata: metadataSchema.optional(), archived: z.boolean().default(false),
  is_default: z.boolean().optional().describe(
    'Default training venue for this user. Selecting it clears the previous default; archiving clears this flag. Absence means false.',
  ),
});
export const locationCreateSchema = locationSchema.extend({ id: idSchema.optional() });
export type Location = z.infer<typeof locationSchema>;

export const coreExerciseSchema = z.strictObject({
  name: nameSchema.refine(value => value.trim().length > 0, 'Core exercise names must not be blank'),
  aliases: z.array(nameSchema.refine(value => value.trim().length > 0, 'Aliases must not be blank')).max(100).optional(),
  notes: notesSchema.optional(), related_core_ids: z.array(coreExerciseReferenceIdSchema).max(100).optional(),
  archived: z.boolean().default(false),
});
export const coreExerciseCreateSchema = coreExerciseSchema.extend({ id: idSchema.optional() });
export type CoreExercise = z.infer<typeof coreExerciseSchema> & { origin?: 'standard' | 'custom'; read_only?: boolean; deprecated?: boolean };

/** Stimulus-to-fatigue ratings: knowledge entry guides/stimulus-fatigue explains each level and factor. */
export const fatigueRatingSchema = z.enum(['low', 'medium', 'high']);
export const limitingFactorSchema = z.enum(['target_muscle', 'lower_back', 'grip', 'balance', 'breathing']);
export type FatigueRating = z.infer<typeof fatigueRatingSchema>;
export type LimitingFactor = z.infer<typeof limitingFactorSchema>;
export const exerciseSchema = z.strictObject({
  name: nameSchema.refine(value => value.trim().length > 0, 'Exercise names must not be blank'),
  aliases: z.array(nameSchema.refine(value => value.trim().length > 0, 'Aliases must not be blank')).max(100).optional().describe(
    'Alternative names for this exact exercise; aliases do not imply interchangeable load histories.',
  ),
  implement: z.string().trim().min(1).max(100).optional().describe(
    'Primary resistance type, for example dumbbell, barbell, cable, or bodyweight. Open vocabulary; independent of owned equipment IDs.',
  ),
  muscle_tags: tagsSchema.optional(), setup_notes: notesSchema.optional(),
  core_exercise_id: coreExerciseReferenceIdSchema.optional(),
  supported_sides: z.array(sideSchema).min(1).max(4).refine(
    sides => new Set(sides).size === sides.length,
    'Supported sides must be distinct',
  ).optional().describe('Known performed sides for this concrete variant; omission means unknown capability.'),
  tracking: z.array(z.enum(['load', 'reps', 'duration_seconds', 'distance_meters'])).min(1).max(4).refine(
    metrics => new Set(metrics).size === metrics.length,
    'Tracked metrics must be distinct',
  ).optional().describe(
    'Metrics this exercise is usually logged with, in display order. A default for clients and imports; any set may record other metrics.',
  ),
  source_exercise_id: exerciseReferenceIdSchema.optional().describe('Source definition copied into this private exercise; does not join histories.'),
  movement_family: idSchema.optional().describe('User-defined grouping, for example horizontal_press; related variants retain separate histories.'),
  fatigue_rating: fatigueRatingSchema.optional().describe(
    'How much a hard set costs beyond the target muscle: joints, lower back, grip, balance and breathing. See guides/stimulus-fatigue.',
  ),
  limiting_factor: limitingFactorSchema.optional().describe(
    'What usually ends a hard set. target_muscle is the goal; anything else is a cost to weigh. See guides/stimulus-fatigue.',
  ),
  notes: notesSchema.optional(), tags: tagsSchema.optional(), metadata: metadataSchema.optional(), archived: z.boolean().default(false),
});
export const exerciseCreateSchema = exerciseSchema.extend({
  id: idSchema.optional(),
  athlete_answers: z.string().trim().min(20).max(2000).optional().describe(
    'Agents only: the athlete\'s own answers to the questions Atlas returns with custom_exercise_needs_athlete, in their words. '
      + 'Required before an agent adds an exercise that is not in the shared catalog. Not stored on the exercise.',
  ),
});
export type Exercise = z.infer<typeof exerciseSchema> & { merged_into?: string; origin?: 'standard' | 'custom'; read_only?: boolean; deprecated?: boolean };
export type ExerciseCreate = z.infer<typeof exerciseCreateSchema>;
export const exerciseMergeSchema = z.strictObject({
  target_id: exerciseReferenceIdSchema,
  target_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe(
    'Revision of the canonical target reviewed before confirming this merge. If-Match supplies the source revision.',
  ),
});
/** Shared and private programs use the same workout identity and week constraints. */
export function validateProgramStructure(
  program: { weeks?: number; workouts: readonly { id: string; week?: number; skipped?: boolean }[] },
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  program.workouts.forEach((workout, i) => {
    if (seen.has(workout.id)) context.addIssue({ code: 'custom', path: ['workouts', i, 'id'], message: 'Workout IDs must be unique within the program' });
    seen.add(workout.id);
    if (program.weeks !== undefined) {
      if (workout.week === undefined || workout.week > program.weeks) context.addIssue({
        code: 'custom',
        path: ['workouts', i, 'week'],
        message: 'Every cycle workout must have a week within the program cycle length',
      });
    } else {
      if (workout.week !== undefined) context.addIssue({
        code: 'custom',
        path: ['workouts', i, 'week'],
        message: 'Reusable routine workouts do not have a cycle week',
      });
      if (workout.skipped !== undefined) context.addIssue({
        code: 'custom',
        path: ['workouts', i, 'skipped'],
        message: 'Skip belongs to a cycle occurrence, not a reusable routine',
      });
    }
  });
}
export const programSchema = z.strictObject({
  name: nameSchema, status: z.enum(['draft', 'active', 'archived']).default('draft'), notes: notesSchema.optional(),
  weeks: z.number().int().min(1).max(104).optional().describe(
    'Finite cycle length. Omit for a reusable collection of routines. Total workouts remain limited to 100.',
  ),
  metadata: metadataSchema.optional(), workouts: z.array(workoutSchema).max(100),
}).superRefine(validateProgramStructure);
export const trainingFrequencySchema = z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);
export const programGuideSchema = z.strictObject({
  id: z.string().min(1).max(100),
  version: z.number().int().positive(),
  default_frequency: trainingFrequencySchema,
});
const trainingPreferencesSchema = z.strictObject({
  normal: trainingFrequencySchema,
  by_week: z.record(z.string().regex(/^[1-9][0-9]*$/), trainingFrequencySchema).optional(),
});

/** Validate reserved authoring fields without reinterpreting historical reads or opaque metadata. */
function validateProgramPreferences(program: { weeks?: number; metadata?: z.infer<typeof metadataSchema> }, context: z.RefinementCtx): void {
  for (const [field, schema] of [['program_guide', programGuideSchema], ['training_frequency', trainingPreferencesSchema]] as const) {
    const value = program.metadata?.[field];
    if (value === undefined) continue;
    const parsed = schema.safeParse(value);
    if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ ...issue, path: ['metadata', field, ...issue.path] });
  }
  const preferences = trainingPreferencesSchema.safeParse(program.metadata?.training_frequency);
  if (preferences.success) for (const week of Object.keys(preferences.data.by_week ?? {})) {
    if (program.weeks === undefined || Number(week) > program.weeks) context.addIssue({
      code: 'custom',
      path: ['metadata', 'training_frequency', 'by_week', week],
      message: 'Training preferences require a week within a finite program.',
    });
  }
}
export const programCreateSchema = programSchema.safeExtend({ id: idSchema.optional() }).superRefine(validateProgramPreferences);
export type Program = z.infer<typeof programSchema>;
export type ProgramCreate = z.infer<typeof programCreateSchema>;
export const retainedProgramSchema = programSchema.safeExtend({ workouts: z.array(retainedWorkoutSchema).max(100) });
// Replacement widens only the purpose input to null; rebuild the shapes with their existing validators.
const replacementProgramWorkoutSchema = z.strictObject({
  ...replacementWorkoutSchema.shape,
  purpose: clearablePlannedField(workoutSchema.shape.purpose),
}).superRefine(validateWorkoutStructure);
export const programReplaceSchema = z.strictObject({ ...retainedProgramSchema.shape, workouts: z.array(replacementProgramWorkoutSchema).max(100) })
  .superRefine(validateProgramStructure)
  .superRefine(validateProgramPreferences)
  .describe('Replace a reviewed program. Omitted purpose retains the same workout value; null clears it to legacy baseline. ' +
    'Started or completed purpose cannot change. Omitted planned core/pair/rep-basis fields retain source values on the same workout and step IDs; ' +
    'null clears them. An unchanged Effort value on the same workout and step ID retains its original scale, including unknown legacy scale. ' +
    'New or changed Effort must be 0–100; validated against the current If-Match revision.');
export const programReplaceWithIdSchema = programReplaceSchema.safeExtend({ id: idSchema.optional() });

export const referenceSchema = z.strictObject({ step_id: idSchema, rounds: z.array(z.number().int().nonnegative()).max(MAX_STEP_DEPTH - 1) });
export type Reference = z.infer<typeof referenceSchema>;

/** Returns exercise leaves in their prescribed order and their enclosing repeats. */
export function collectExerciseSteps(workout: Workout): { step: ExerciseStep; repeats: RepeatStep[] }[] {
  const entries: { step: ExerciseStep; repeats: RepeatStep[] }[] = [];
  const walk = (steps: Step[], repeats: RepeatStep[]) => {
    for (const step of steps) {
      if (step.type === 'exercise') entries.push({ step, repeats });
      else if (step.type === 'repeat') walk(step.steps, [...repeats, step]);
    }
  };
  walk(workout.steps, []);
  return entries;
}

/** References identify intended bouts; they do not impose uniqueness on actual logs. */
export function validateReference(workout: Workout, value: Reference): ExerciseStep {
  const reference = referenceSchema.parse(value);
  const entry = collectExerciseSteps(workout).find(({ step }) => step.id === reference.step_id);
  if (!entry) invalid('The reference must identify an exercise step', ['reference', 'step_id']);
  if (reference.rounds.length !== entry.repeats.length) invalid('The reference must contain one index for every enclosing repeat', ['reference', 'rounds']);
  entry.repeats.forEach((repeat, i) => {
    if ('rounds' in repeat.until && reference.rounds[i]! >= repeat.until.rounds) invalid('The round index exceeds the prescription repeat count', [
      'reference',
      'rounds',
      i,
    ]);
  });
  return entry.step;
}
