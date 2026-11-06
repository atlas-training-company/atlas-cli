import { createHash } from 'node:crypto';
import * as z from 'zod';
import { splitWorkoutFile, WorkoutFileError } from '../history/workout-file.js';
import { CLIError } from './cli-error.js';
import type { AtlasCLIClient, CLIResult } from './client.js';
import type { JsonObject } from './json-object.js';

// Atlas refuses request bodies over 1 MiB.
const maxBodyBytes = 1024 * 1024;
const bytes = (value: JsonObject) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const count = z.number().int().min(0);
const partSchema = z.looseObject({
  dry_run: z.boolean(), workouts: count, sets: count, already_imported: count, imported_workouts: count,
  exercises: z.array(z.looseObject({ name: z.string(), sets: count, status: z.string() })),
  skipped_rows: z.array(z.looseObject({ row: count, reason: z.string() })), skipped_row_count: count,
  unresolved_weight_unit_sets: count, dropped_distance_sets: count,
});
type Part = z.infer<typeof partSchema>;

/** A stable key per part, so repeating the same command replays every part that already succeeded. */
function partKey(key: string, part: number, parts: number): string {
  const suffix = ` part ${part}/${parts}`;
  return `${key.length + suffix.length > 128 ? createHash('sha256').update(key).digest('hex') : key}${suffix}`;
}

/** One result for the whole file, in the shape a single request returns. */
function combined(results: CLIResult[], parts: { rows: number[] }[]): CLIResult {
  const data = results.map(result => partSchema.parse(result.data));
  const sum = (field: 'workouts' | 'sets' | 'already_imported' | 'imported_workouts' | 'skipped_row_count'
    | 'unresolved_weight_unit_sets' | 'dropped_distance_sets') => data.reduce((total, part) => total + part[field], 0);
  // A name keeps its first part's match (an exercise created there is "yours" in later parts) with the sets from every part.
  const exercises = new Map<string, Part['exercises'][number]>();
  for (const exercise of data.flatMap(part => part.exercises)) {
    const first = exercises.get(exercise.name);
    exercises.set(exercise.name, first ? { ...first, sets: first.sets + exercise.sets } : exercise);
  }
  const skipped = data.flatMap((part, index) => part.skipped_rows.map(row => ({ ...row, row: parts[index]!.rows[row.row - 2] ?? row.row })));
  const result: CLIResult = {
    ok: true, operation: 'import_workout_file', status: results.some(result => result.status === 201) ? 201 : 200, parts: results.length,
    data: {
      dry_run: data[0]!.dry_run, workouts: sum('workouts'), sets: sum('sets'), already_imported: sum('already_imported'),
      imported_workouts: sum('imported_workouts'),
      exercises: [...exercises.values()].sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name)),
      skipped_rows: skipped.sort((a, b) => a.row - b.row).slice(0, 100), skipped_row_count: sum('skipped_row_count'),
      unresolved_weight_unit_sets: sum('unresolved_weight_unit_sets'), dropped_distance_sets: sum('dropped_distance_sets'),
    },
  };
  if (results.every(result => result.replayed)) result.replayed = true;
  return result;
}

/**
 * Import a whole export with one command. A file larger than one request is sent as several, each holding whole workouts.
 * Every part is previewed before any is imported, so a name still marked confirm anywhere in the file writes nothing.
 */
export async function importWorkoutFile(client: AtlasCLIClient, arguments_: JsonObject): Promise<CLIResult> {
  const csv = z.string().safeParse(arguments_.csv).data;
  if (csv === undefined || bytes(arguments_) <= maxBodyBytes) return client.call('import_workout_file', arguments_);
  let parts: ReturnType<typeof splitWorkoutFile>;
  // The other arguments stay the same in every part; the file gets the rest of the request.
  try { parts = splitWorkoutFile(csv, maxBodyBytes - bytes({ ...arguments_, csv: '' }) + 2); }
  catch (error) {
    if (error instanceof WorkoutFileError) throw new CLIError('invalid_workout_file', error.message, { cause: error });
    throw error;
  }
  if (parts.length < 2) return client.call('import_workout_file', arguments_);
  const key = z.string().safeParse(arguments_['Idempotency-Key']).data;
  const send = async (preview: boolean) => {
    const results: CLIResult[] = [];
    for (const [index, part] of parts.entries()) {
      const request: JsonObject = { ...arguments_, csv: part.csv };
      if (preview) request.dry_run = true;
      if (key !== undefined) request['Idempotency-Key'] = partKey(key, index + 1, parts.length);
      results.push(await client.call('import_workout_file', request));
    }
    return combined(results, parts);
  };
  const preview = await send(true);
  if (String(arguments_.dry_run) === 'true') return preview;
  const unconfirmed = partSchema.parse(preview.data).exercises.filter(exercise => exercise.status === 'confirm').map(exercise => exercise.name);
  if (unconfirmed.length) {
    throw new CLIError('exercise_choice_required', 'Choose an exercise for each name marked confirm, then import again.', {
      status: 409, details: { names: unconfirmed },
    });
  }
  return send(false);
}
