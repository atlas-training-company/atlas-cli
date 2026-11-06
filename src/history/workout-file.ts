// One reader for every app's workout export: one row per set, columns recognized by header name.
// Supporting another app means adding a header spelling below, never app-specific code.

export type Field = 'exercise' | 'date' | 'title' | 'set_order' | 'set_type' | 'weight' | 'weight_unit' | 'reps'
  | 'distance' | 'distance_unit' | 'duration' | 'rpe' | 'notes' | 'workout_notes';
export type WeightUnit = 'kg' | 'lb';
export type DistanceUnit = 'km' | 'mi' | 'm';

// Header spellings, compared after lowercasing and collapsing punctuation to single spaces.
const headers: [Field, string[], (WeightUnit | DistanceUnit)?][] = [
  ['exercise', ['exercise', 'exercise name', 'exercise title', 'ename', 'movement']],
  ['date', ['date', 'start time', 'started at', 'workout date', 'start']],
  ['title', ['workout name', 'workout', 'title', 'workout title', 'routine', 'routine name', 'session name']],
  ['set_order', ['set order', 'set index', 'set', 'set number']],
  ['set_type', ['set type']],
  ['weight', ['weight', 'load']],
  ['weight', ['weight kg', 'weight kgs'], 'kg'],
  ['weight', ['weight lb', 'weight lbs'], 'lb'],
  ['weight_unit', ['weight unit', 'unit', 'units']],
  ['reps', ['reps', 'rep', 'repetitions']],
  ['distance', ['distance']],
  ['distance', ['distance km'], 'km'],
  ['distance', ['distance mi', 'distance miles'], 'mi'],
  ['distance', ['distance m', 'distance meters', 'distance metres'], 'm'],
  ['distance_unit', ['distance unit']],
  ['duration', ['seconds', 'duration seconds', 'duration s', 'duration sec', 'time seconds', 'time s']],
  ['rpe', ['rpe']],
  ['notes', ['notes', 'note', 'set notes', 'exercise notes']],
  ['workout_notes', ['workout notes', 'description', 'session notes']],
];
const fieldsByHeader = new Map(headers.flatMap(([field, names]) => names.map(name => [name, field] as const)));
const unitsByHeader = new Map(headers.flatMap(([, names, unit]) => unit ? names.map(name => [name, unit] as const) : []));
const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export type ParsedSet = {
  row: number; exercise: string; reps?: number; weight?: number; weight_unit?: WeightUnit; distance_meters?: number;
  duration_seconds?: number; rpe?: number; role?: string; notes?: string;
};
export type ParsedWorkout = { key: string; title: string; performed_on: string; notes?: string; sets: ParsedSet[] };
export type SkippedRow = { row: number; reason: 'missing_exercise' | 'unrecognized_date' | 'no_measurements' | 'invalid_number' | 'rest_timer' };
export type ParsedFile = { workouts: ParsedWorkout[]; skipped: SkippedRow[]; unknown_distance_unit: number; unknown_weight_unit: number };
export class WorkoutFileError extends Error {}

/** RFC 4180 rows: quoted fields may hold the delimiter, doubled quotes and line breaks. */
function rows(text: string, delimiter: string): string[][] {
  const result: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field); result.push(row); row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length) { row.push(field); result.push(row); }
  return result.filter(cells => cells.some(cell => cell.trim() !== ''));
}

// Some locales export with semicolons or tabs; the header line decides.
function delimiterOf(text: string): string {
  const header = text.slice(0, text.search(/\r|\n|$/));
  return [',', ';', '\t'].map(delimiter => [delimiter, header.split(delimiter).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
}

const months = new Map(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((month, index) => [month, index + 1]));
const isoDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : undefined;
};
/** Calendar date only; exports rarely say which timezone a clock time is in, so no timestamp is inferred. */
export function workoutDate(value: string): string | undefined {
  const text = value.trim();
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T,])/.exec(text);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})(?:$|[\s,])/.exec(text);
  if (match) return isoDate(Number(match[3]), months.get(match[2]!.slice(0, 3).toLowerCase()) ?? 0, Number(match[1]));
  match = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})(?:$|[\s,])/.exec(text);
  if (match) return isoDate(Number(match[3]), months.get(match[1]!.slice(0, 3).toLowerCase()) ?? 0, Number(match[2]));
}

/** Blank is absent; anything else must be a finite, nonnegative number. Decimal commas are accepted. */
function number(value: string | undefined): number | undefined | null {
  const text = value?.trim() ?? '';
  if (text === '') return undefined;
  const parsed = Number(/^\d+,\d+$/.test(text) ? text.replace(',', '.') : text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
/** Seconds, or clock notation such as 1:30 or 1:02:03. */
function seconds(value: string | undefined): number | undefined | null {
  const text = value?.trim() ?? '';
  if (!/^\d+(:\d{1,2}){1,2}$/.test(text)) return number(value);
  return text.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
}
const weightUnits = new Map<string, WeightUnit>([['kg', 'kg'], ['kgs', 'kg'], ['lb', 'lb'], ['lbs', 'lb']]);
const distanceUnits = new Map<string, DistanceUnit>([['km', 'km'], ['mi', 'mi'], ['miles', 'mi'], ['m', 'm'], ['meters', 'm'], ['metres', 'm']]);
const metersPer: Record<DistanceUnit, number> = { km: 1000, mi: 1609.344, m: 1 };
// Hevy writes the set type; Strong marks warmup, drop and failure sets in the set order column.
const roles = new Map([['warmup', 'warmup'], ['w', 'warmup'], ['dropset', 'drop'], ['drop', 'drop'], ['d', 'drop'], ['failure', 'failure'], ['f', 'failure']]);

/** The header and data rows of an export, with a reader for each recognized column. */
function table(text: string) {
  const content = text.replace(/^\uFEFF/, '');
  const delimiter = delimiterOf(content);
  const [header = [], ...body] = rows(content, delimiter);
  const names = header.map(normalizeHeader);
  const index = (field: Field) => names.findIndex(name => fieldsByHeader.get(name) === field);
  if (index('exercise') < 0 || index('date') < 0) {
    throw new WorkoutFileError('The file needs an exercise column and a date column, with one row per set.');
  }
  const cell = (cells: string[], field: Field) => { const at = index(field); return at < 0 ? undefined : cells[at]?.trim(); };
  const title = (cells: string[]) => cell(cells, 'title') || 'Imported workout';
  // A workout is every row sharing its start date (and time, when the export has one) and name.
  const key = (cells: string[]) => `${cell(cells, 'date') ?? ''}\n${title(cells)}`;
  return { delimiter, header, body, names, index, cell, title, key };
}

export function parseWorkoutFile(text: string, defaults: { weight_unit?: WeightUnit; distance_unit?: DistanceUnit } = {}): ParsedFile {
  const { body, names, index, cell, title, key } = table(text);
  // A unit named in the header wins, then a unit column on the row, then the caller's default.
  const unitOf = <T extends string>(field: 'weight' | 'distance', units: Map<string, T>, cells: string[], fallback?: T): T | undefined =>
    units.get(unitsByHeader.get(names[index(field)] ?? '') ?? '') ?? units.get(cell(cells, `${field}_unit`)?.toLowerCase() ?? '') ?? fallback;
  const workouts = new Map<string, ParsedWorkout>();
  const parsed: ParsedFile = { workouts: [], skipped: [], unknown_distance_unit: 0, unknown_weight_unit: 0 };
  body.forEach((cells, offset) => {
    const row = offset + 2;
    const exercise = cell(cells, 'exercise');
    if (!exercise) return parsed.skipped.push({ row, reason: 'missing_exercise' });
    // Strong logs each rest between sets as its own row.
    if (normalizeHeader(cell(cells, 'set_order') ?? '') === 'rest timer') return parsed.skipped.push({ row, reason: 'rest_timer' });
    const rawDate = cell(cells, 'date') ?? '';
    const performedOn = workoutDate(rawDate);
    if (!performedOn) return parsed.skipped.push({ row, reason: 'unrecognized_date' });
    const values = { reps: number(cell(cells, 'reps')), weight: number(cell(cells, 'weight')), distance: number(cell(cells, 'distance')),
      duration: seconds(cell(cells, 'duration')), rpe: number(cell(cells, 'rpe')) };
    if (Object.values(values).includes(null) || (values.rpe ?? 0) > 10 || !Number.isInteger(values.reps ?? 0)) {
      return parsed.skipped.push({ row, reason: 'invalid_number' });
    }
    const set: ParsedSet = { row, exercise };
    if (values.reps) set.reps = values.reps!;
    if (values.duration) set.duration_seconds = values.duration!;
    if (values.rpe) set.rpe = values.rpe!;
    if (values.weight) {
      set.weight = values.weight!;
      const unit = unitOf('weight', weightUnits, cells, defaults.weight_unit);
      if (unit) set.weight_unit = unit; else parsed.unknown_weight_unit++;
    }
    if (values.distance) {
      const unit = unitOf('distance', distanceUnits, cells, defaults.distance_unit);
      if (unit) set.distance_meters = Math.round(values.distance! * metersPer[unit] * 100) / 100; else parsed.unknown_distance_unit++;
    }
    if (set.reps === undefined && set.duration_seconds === undefined && set.distance_meters === undefined && set.weight === undefined) {
      return parsed.skipped.push({ row, reason: 'no_measurements' });
    }
    const role = roles.get((cell(cells, 'set_type') || cell(cells, 'set_order') || '').toLowerCase());
    if (role) set.role = role;
    const notes = cell(cells, 'notes');
    if (notes) set.notes = notes;
    const workout = workouts.get(key(cells)) ?? { key: key(cells), title: title(cells), performed_on: performedOn, sets: [] };
    const workoutNotes = cell(cells, 'workout_notes');
    if (workoutNotes && !workout.notes) workout.notes = workoutNotes;
    workout.sets.push(set);
    workouts.set(workout.key, workout);
  });
  parsed.workouts = [...workouts.values()];
  return parsed;
}

const encoder = new TextEncoder();
// UTF-8 bytes a line adds inside a JSON string, without the surrounding quotes.
const jsonBytes = (text: string) => encoder.encode(JSON.stringify(text)).length - 2;

/**
 * Split an export too large for one request into parts that each repeat the header and keep whole workouts, in file order.
 * Each part, written as a JSON string, fits maxJsonBytes unless one workout alone is larger.
 * `rows[i]` is the original row of the part's row i + 2, so skipped rows can be reported against the original file.
 */
export function splitWorkoutFile(text: string, maxJsonBytes: number): { csv: string; rows: number[] }[] {
  const { delimiter, header, body, key } = table(text);
  const line = (cells: string[]) => cells
    .map(value => /["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replaceAll('"', '""')}"` : value).join(delimiter);
  const workouts = new Map<string, number[]>();
  body.forEach((cells, offset) => {
    const rows = workouts.get(key(cells)) ?? [];
    rows.push(offset);
    workouts.set(key(cells), rows);
  });
  const head = line(header);
  const parts: { csv: string; rows: number[] }[] = [];
  let lines: string[] = [], rows: number[] = [], size = 2 + jsonBytes(head);
  for (const offsets of workouts.values()) {
    const added = offsets.map(offset => line(body[offset]!));
    // Each line also adds a newline, written as two bytes in JSON.
    const addedSize = added.reduce((total, text) => total + 2 + jsonBytes(text), 0);
    if (lines.length && size + addedSize > maxJsonBytes) {
      parts.push({ csv: [head, ...lines].join('\n'), rows });
      lines = []; rows = []; size = 2 + jsonBytes(head);
    }
    lines.push(...added);
    rows.push(...offsets.map(offset => offset + 2));
    size += addedSize;
  }
  if (lines.length) parts.push({ csv: [head, ...lines].join('\n'), rows });
  return parts;
}
