import type * as z from 'zod';
import type { RepeatStep, RoundOverride, Step } from './domain.js';

export const MAX_STEP_DEPTH = 8;
export const MAX_WORKOUT_STEPS = 1_000;

export function validateWorkoutStructure(workout: { steps: Step[] }, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  const pending: { step: Step; depth: number; path: PropertyKey[]; repeats: RepeatStep[] }[] =
    workout.steps.map((step, i) => ({ step, depth: 1, path: ['steps', i], repeats: [] }));
  let total = 0;
  while (pending.length > 0) {
    const { step, depth, path, repeats } = pending.pop()!;
    if (++total > MAX_WORKOUT_STEPS) {
      context.addIssue({ code: 'custom', path: ['steps'], message: `A workout may contain at most ${MAX_WORKOUT_STEPS} total steps` });
      return;
    }
    if (depth > MAX_STEP_DEPTH) {
      context.addIssue({ code: 'custom', path, message: `Step nesting may not exceed ${MAX_STEP_DEPTH} levels` });
      return;
    }
    if (seen.has(step.id)) context.addIssue({ code: 'custom', path: [...path, 'id'], message: 'Step IDs must be unique within the workout' });
    seen.add(step.id);
    if (step.type === 'repeat') {
      step.steps.forEach((child, i) => pending.push({ step: child, depth: depth + 1, path: [...path, 'steps', i], repeats: [...repeats, step] }));
    }
    if (step.type === 'exercise' && step.round_overrides) validateRoundOverrides(step.round_overrides, repeats, [...path, 'round_overrides'], context);
  }
}

/** Each round a set names is one that runs: an index for every repeat around it, inside that repeat's count. */
function validateRoundOverrides(overrides: readonly RoundOverride[], repeats: readonly RepeatStep[], path: PropertyKey[], context: z.RefinementCtx): void {
  if (repeats.length === 0 || repeats.some(repeat => !('rounds' in repeat.until))) {
    context.addIssue({ code: 'custom', path, message: 'round_overrides needs a repeat with until.rounds around the set, and none that runs for a time' });
    return;
  }
  const seen = new Set<string>();
  overrides.forEach((override, i) => {
    const at = [...path, i, 'rounds'];
    if (override.rounds.length !== repeats.length) {
      context.addIssue({ code: 'custom', path: at, message: `Give one round index per repeat around this set: ${repeats.length === 1
        ? 'one number, such as [0] for the first round' : `${repeats.length} numbers, outermost first`}` });
      return;
    }
    override.rounds.forEach((round, level) => {
      const until = repeats[level]!.until;
      const count = 'rounds' in until ? until.rounds : 0;
      const message = `Rounds count from 0, so this repeat of ${count} has rounds 0 to ${count - 1}`;
      if (round >= count) context.addIssue({ code: 'custom', path: [...at, level], message });
    });
    const key = override.rounds.join(',');
    if (seen.has(key)) context.addIssue({ code: 'custom', path: at, message: 'Each round is listed once; put everything that changes in it in one entry' });
    seen.add(key);
  });
}

/** The set as one round asks for it: its own values with that round's changes over them. */
type RoundChanges = { rounds: readonly number[]; targets?: object | undefined; load?: unknown; rest_seconds?: number | undefined; notes?: string | undefined };
export function stepAtRound<S extends { round_overrides?: readonly RoundChanges[] | undefined; targets?: object | undefined }>(
  step: S, rounds: readonly number[],
): Omit<S, 'round_overrides'> {
  const { round_overrides: overrides, ...base } = step;
  const round = overrides?.find(entry => entry.rounds.length === rounds.length && entry.rounds.every((index, level) => index === rounds[level]));
  if (!round) return base;
  const changes: Omit<RoundChanges, 'rounds'> & { effort_scale?: 'percent' } = {};
  if (round.targets) changes.targets = { ...base.targets, ...round.targets };
  if (round.targets && 'effort' in round.targets && round.targets.effort !== undefined) changes.effort_scale = 'percent';
  if (round.load) changes.load = round.load;
  if (round.rest_seconds !== undefined) changes.rest_seconds = round.rest_seconds;
  if (round.notes !== undefined) changes.notes = round.notes;
  const resolved = { ...base, ...changes };
  // SAFETY: resolved copies base and replaces only targets, effort_scale, load, rest_seconds and notes with values of the same field types.
  return resolved as Omit<S, 'round_overrides'>;
}

/**
 * Drops the named fields from each round of a set, and rounds left with nothing to change. A swap drops the old exercise's
 * weights this way; a change to every round drops that field so each round takes the set's new value.
 */
export function clearRoundFields<O extends RoundChanges>(overrides: readonly O[] | undefined, fields: readonly (keyof RoundChanges)[]): O[] | undefined {
  const kept = overrides?.map(override => {
    const copy = { ...override };
    for (const field of fields) if (field !== 'rounds') delete copy[field];
    return copy;
  }).filter(override => override.targets !== undefined || override.load !== undefined || override.rest_seconds !== undefined || override.notes !== undefined);
  return kept?.length ? kept : undefined;
}

/** clearRoundFields on a set in place, leaving no round_overrides when no round still differs. */
export function dropRoundFields<O extends RoundChanges>(step: { round_overrides?: O[] | undefined }, fields: readonly (keyof RoundChanges)[]): void {
  const kept = clearRoundFields(step.round_overrides, fields);
  if (kept) step.round_overrides = kept;
  else delete step.round_overrides;
}

/** Every round of nested repeats in the order they run, one index per repeat: counts [3] give [0], [1], [2]. */
export function roundPaths(counts: readonly number[]): number[][] {
  return counts.reduce<number[][]>((paths, count) => paths.flatMap(path => Array.from({ length: count }, (_, round) => [...path, round])), [[]]);
}
