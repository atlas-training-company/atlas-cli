#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL } from 'node:url';
import {
  AtlasCLIClient, CLIError, legacyCLIOperation, DEFAULT_ATLAS_URL, jsonObjectRootSchema,
  type CLIInvocation, type CLIResult, type JsonObject, type Operation,
} from './client.js';
import { unsupportedFields } from './cli-error.js';
import { knowledgeQuerySchema } from './knowledge.js';
import { checkForUpdate, runUpdate, type UpdateNotice } from './updates.js';
import { currentLibrary, installSkills, refreshLibrary } from './library-cache.js';
import { importWorkoutFile } from './workout-file-import.js';

export const cliHelp = {
  usage: 'atlas [--url ORIGIN] COMMAND [OPTIONS]',
  commands: {
    '--skill': 'Print the agent handbook as Markdown. Local; no server or credentials required.',
    'skills list': 'List the coaching skills by name and description. Local JSON output.',
    'skills get NAME': 'Print one skill\'s SKILL.md as Markdown, e.g. training-program-design. Local.',
    'skills install DIRECTORY':
      'Write every skill to DIRECTORY/NAME/SKILL.md (for example ~/.claude/skills or .agents/skills), replacing older copies, and'
        + ' keep that folder current: later commands refresh it when Atlas has newer skills. JSON output.',
    'knowledge list': 'List training guidance with entry and library versions. Local JSON output.',
    'knowledge search --query JSON': 'Find guidance with {"q":"hypertrophy volume","limit":10}; limit is 1–50. Local JSON output.',
    'knowledge get ID': 'Read guidance and sources, e.g. proximity-to-failure or programs/min-max. Local JSON output.',
    discover: 'List all implemented API operations.',
    'connect [--wait SECONDS] [--invite CODE]':
      'Connect this computer to Atlas with full training access. Shows an approval link and code for the person to approve on their phone;'
        + ' rerun or wait up to 1–600 seconds for approval. With a setup code from the person\'s Atlas app, connects to their account'
        + ' at once. With an athlete\'s trainer invite, connects at once, limited to what the invite shares.',
    'schema [OPERATION]': 'Read the OpenAPI document or one self-contained operation schema.',
    me: 'Read the current authenticated user.',
    initialize: 'Ensure an active default training location. Submit an empty object with --data and an explicit --idempotency-key.',
    'profile get': 'Read this athlete\'s durable goals, constraints, preferences and coaching notes; 404 when not yet recorded.',
    'profile write':
      'Replace the athlete profile. Create with --if-none-match "*", or replace with the current --if-match revision; always include --idempotency-key.',
    context:
      'Read the selected or default training location. Read location.notes for equipment, setup, and travel constraints before programming.'
        + ' Use --query {"location_id":"home"} to choose a venue.',
    'locations list|get|create|replace [ID]': 'Read locations or replace all editable location fields with the current revision.',
    'exercises list|get|create|replace [ID]': 'Read exercises or replace all editable exercise fields with the current revision.',
    'programs list|get|create|replace [ID]': 'Browse private and shared programs; replace all editable private program fields with the current revision.',
    'programs copy PROGRAM_ID':
      'Copy a reviewed private or shared source into a new private draft.'
        + ' Supply destination id and source_revision, optional schedule and explicit active replacement; requires --idempotency-key.',
    'sessions list|get|start|patch [ID]':
      'Start a workout or patch supplied session fields with the current revision. Complete with patch and status completed.',
    'core-exercises list|get|create|replace [ID]': 'Read cores or replace all editable private core fields with the current revision.',
    'sets list SESSION | sets write SESSION SET': 'Read or record sets.',
    'reps list SESSION SET | reps get|write|traces SESSION SET REP': 'Read or record rep measurements and traces.',
    'body-weights list|get [ID]':
      'Read recorded body-weight measurements, newest first, in the unit recorded. Filter with --query {"from":"2026-10-01","limit":5}.',
    'activities list|get [ID]':
      'Read workouts recorded outside Atlas, such as rides and runs from Apple Health, newest first. Filter with --query {"from":"2026-10-01"}.',
    'core-exercises history ID': 'Read grouped actual history for explicit core members with recorded side/setup filters.',
    'exercises history ID':
      'Read exercise history; filter by recorded side/setup, dates, timezone, actual role, set/session status and location, or sort recent.',
    'exercises ensure': 'Resolve or create up to 100 exercises from {exercises:[{key,exercise}]}; requires --idempotency-key.',
    'sessions import':
      'Atomically import one completed historical session with source identity and up to 500 actual sets;'
        + ' requires --idempotency-key even with --query {"dry_run":true}.',
    'sessions import-status': 'Read an import receipt with --query {"provider":"source","namespace":"account","external_id":"workout"}.',
    'sessions import-file':
      'Import a whole workout export from any app (Strong, Hevy, a spreadsheet) with --file export.csv: every workout, exercise matching included.'
        + ' Preview with --query {"dry_run":true}, then import with --data {"exercises":{NAME:ID|null}} for each name marked confirm.'
        + ' A file over 1 MiB is sent in parts of whole workouts. Requires --idempotency-key; repeat the same command to retry.',
    'sessions correct ID': 'Correct an ended workout outcome or program link with a reason and current revision.',
    'sessions revision ID REVISION': 'Read retained session fields and snapshots; set revisions are separate.',
    'programs revision ID REVISION': 'Read a retained program revision.',
    'programs schedule ID': 'Schedule program occurrences from explicit dates and workout IDs; requires --idempotency-key.',
    'programs edit ID': 'Swap, change or remove exercises by ID without resending the program; requires --if-match and --idempotency-key.',
    'exercises merge ID': 'Merge a source exercise into a reviewed target with target_revision, --if-match and --idempotency-key.',
    'programs progress ID': 'Read weekly progress and the next scheduled workout.',
    'weekly-summary':
      'Read one week of scheduled versus logged workouts, missed sets and top-load changes; read it before writing the next week.'
        + ' Defaults to the last complete Monday–Sunday week; --query {"week_of":"2026-10-05","timezone":"America/Toronto"}.',
    'sets revision SESSION SET REVISION': 'Read a retained set revision.',
    'reps revision SESSION SET REP REVISION': 'Read a retained rep revision.',
    export: 'Export all training records and retained revisions for the current user.',
    'call OPERATION': 'Execute any operation from discover using flat JSON arguments.',
    'auth status': 'Report whether this computer is connected, and to which account.',
    'auth logout': 'End this computer\'s connection in Atlas and forget it locally.',
    update:
      'Install the newest Atlas CLI from npm over this global npm install and report the version installed. It also fetches Atlas\'s'
        + ' current training library and rewrites installed skill folders. Results from Atlas carry an update field when a newer CLI is'
        + ' out; npm and the library are checked at most once a day.',
  },
  input: {
    '--data JSON': 'A JSON object containing body fields (or all flat arguments for call).',
    '--file PATH':
      'Read JSON from a file (--file - for stdin) instead of --data. A .csv export for sessions import-file is sent as csv, alongside any --data fields.',
    '--query JSON': 'Query/filter fields, e.g. {"limit":20,"sort":"recent"}.',
    '--idempotency-key KEY': 'Required for every write. Reuse only for an identical retry.',
    '--if-match REVISION': 'Required for correction. Use 3 or the ETag you read, such as "3" or W/"3".',
    '--if-none-match *': 'Explicitly create a new stable set or rep.',
  },
  environment: [
    `ATLAS_URL (default ${DEFAULT_ATLAS_URL})`,
    'ATLAS_CONFIG_DIR (default ~/.config/atlas)',
    'ATLAS_API_TOKEN (agent key fallback; a connection from atlas connect takes priority)',
    'ATLAS_NO_UPDATE_CHECK (set to skip the daily check for a newer CLI)',
  ],
  output: 'One JSON envelope on stdout, except successful --skill and skills get print Markdown. Exit 0 for success, 1 for errors.'
    + ' API data pages include next_cursor; local knowledge search reports total and truncated.'
    + ' No automatic mutation retries, pagination, or credential fallback after a connection is refused.',
};

export function parseCLIArguments(args: string[]) {
  const positional: string[] = [], flags: Record<string, string> = {};
  const names = new Set(['url', 'data', 'file', 'query', 'idempotency-key', 'if-match', 'if-none-match', 'wait', 'invite', 'capabilities']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--help' || arg === '-h') return { positional: ['help'], flags };
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const equals = arg.indexOf('=');
    const name = arg.slice(2, equals < 0 ? undefined : equals);
    if (!names.has(name) || flags[name] !== undefined) throw new CLIError('invalid_arguments', `Unknown or repeated option --${name}.`);
    const value = equals < 0 ? args[++index] : arg.slice(equals + 1);
    if (value === undefined || (equals < 0 && value.startsWith('--'))) throw new CLIError('invalid_arguments', `Missing value for --${name}.`);
    flags[name] = value;
  }
  return { positional, flags };
}
function json(text: string): JsonObject {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (cause) { throw new CLIError('invalid_json', 'Input must contain valid JSON.', { cause }); }
  const result = jsonObjectRootSchema.safeParse(parsed);
  if (!result.success) throw new CLIError('invalid_arguments', 'Input must be a JSON object.', { cause: result.error });
  // SAFETY: JSON.parse established JSON values and the object schema excludes null and arrays; preserve every original key for API validation.
  return parsed as JsonObject;
}

type CLIArguments = ReturnType<typeof parseCLIArguments>;
function localKnowledge(input: CLIArguments, env: NodeJS.ProcessEnv) {
  const { positional, flags } = input;
  const { getKnowledge, listKnowledge, searchKnowledge } = currentLibrary(env);
  const action = positional[1];
  const allowedFlags = action === 'search' ? ['query'] : [];
  if (Object.keys(flags).some(flag => !allowedFlags.includes(flag))) {
    throw new CLIError('invalid_arguments', 'Knowledge commands only accept --query for search. Run atlas help.');
  }
  if (action === 'list' && positional.length === 2) return { operation: 'knowledge_list', data: listKnowledge() };
  if (action === 'get' && positional.length === 3) return { operation: 'knowledge_get', data: getKnowledge(positional[2]!) };
  if (action === 'search' && positional.length === 2 && flags.query !== undefined) {
    const query = knowledgeQuerySchema.safeParse(json(flags.query));
    if (!query.success) {
      throw new CLIError(
        'invalid_arguments',
        'Search requires q (1–200 characters) and optional integer limit (1–50), with no other fields.',
        { cause: query.error },
      );
    }
    return { operation: 'knowledge_search', data: searchKnowledge(query.data.q, query.data.limit) };
  }
  throw new CLIError('invalid_arguments', 'Use atlas knowledge list, get ID, or search --query JSON.');
}
type LocalSkillResult = { operation: string; data: unknown } | { markdown: string };
async function localSkills(input: CLIArguments, env: NodeJS.ProcessEnv, transport: typeof fetch): Promise<LocalSkillResult> {
  const { positional, flags } = input;
  const [, action, argument] = positional;
  if (Object.keys(flags).length) throw new CLIError('invalid_arguments', 'Skills commands take no options. Run atlas help.');
  if (action === 'install' && positional.length === 3) {
    return { operation: 'skills_install', data: { installed: await installSkills(argument!, env, transport) } };
  }
  const { listSkills, readSkill } = currentLibrary(env);
  if (action === 'list' && positional.length === 2) return { operation: 'skills_list', data: listSkills() };
  if (action === 'get' && positional.length === 3) return { markdown: readSkill(argument) };
  throw new CLIError('invalid_arguments', 'Use atlas skills list, get NAME, or install DIRECTORY.');
}
function combine(target: JsonObject, source: JsonObject): void {
  for (const [key, value] of Object.entries(source)) {
    if (Object.hasOwn(target, key)) throw new CLIError('invalid_arguments', `Argument ${key} was supplied more than once.`);
    target[key] = value;
  }
}
type CommandSelection = { operation: string; ids: string[] };
const profileOperations = new Map([['get', 'read_profile'], ['write', 'write_profile'], ['update', 'write_profile']]);
const singleWordOperations = new Map([
  ['context', 'read_training_context'], ['weekly-summary', 'read_weekly_summary'], ['me', 'get_me'], ['initialize', 'initialize_account'], ['export', 'export'],
]);
const namedActions = new Map([
  ['programs', new Map([
    ['copy', 'copy_program'], ['edit', 'edit_program'], ['schedule', 'schedule_program'], ['repeat', 'repeat_program'], ['progress', 'read_program_progress'],
    ['changes', 'read_program_changes'], ['undo', 'undo_program_changes'],
  ])],
  ['exercises', new Map([
    ['merge', 'merge_exercise'], ['ensure', 'ensure_exercise'],
    ['standardize-preview', 'read_exercise_standardization'], ['standardize', 'apply_exercise_standardization'],
  ])],
  ['equipment-items', new Map([['ensure', 'ensure_equipment_item']])],
  ['sessions', new Map([
    ['correct', 'correct_session'], ['import', 'import_session'], ['import-status', 'read_session_import'], ['import-file', 'import_workout_file'],
  ])],
]);
const resources = new Map([
  ['locations', 'location'], ['core-exercises', 'core_exercise'], ['exercises', 'exercise'], ['programs', 'program'],
  ['sessions', 'session'], ['sets', 'set'], ['reps', 'rep'], ['body-weights', 'body_weight'], ['activities', 'activity'],
  ['equipment-items', 'equipment_item'], ['equipment-models', 'equipment_model'],
]);
const allowedActions = new Map([
  ['location', ['list', 'get', 'create', 'replace', 'update']],
  ['core_exercise', ['list', 'get', 'create', 'replace', 'update', 'history']],
  ['exercise', ['list', 'get', 'create', 'replace', 'update', 'history']],
  ['program', ['list', 'get', 'create', 'replace', 'update', 'revision']],
  ['session', ['list', 'get', 'start', 'create', 'patch', 'update', 'revision']],
  ['set', ['list', 'write', 'revision']], ['rep', ['list', 'get', 'write', 'revision', 'traces']], ['body_weight', ['list', 'get']],
  ['activity', ['list', 'get']], ['equipment_item', ['list', 'get', 'create', 'replace', 'update']], ['equipment_model', ['list', 'get']],
]);
const actionVerbs = new Map([
  ['list', 'list'], ['get', 'read'], ['create', 'create'], ['start', 'create'], ['replace', 'replace'], ['patch', 'patch'],
  ['write', 'write'], ['history', 'history'], ['revision', 'read'], ['traces', 'read'],
]);
function resourceCommand(words: string[]): CommandSelection | undefined {
  const resource = resources.get(words[0] ?? '');
  const action = words[1];
  if (!resource || !action || !allowedActions.get(resource)?.includes(action)) return;
  const verb = action === 'update' ? (resource === 'session' ? 'patch' : 'replace') : actionVerbs.get(action);
  const suffix = action === 'revision' ? '_revision' : action === 'traces' ? '_traces' : '';
  return { operation: `${verb}_${resource}${suffix}`, ids: words.slice(2) };
}
function command(words: string[]): CommandSelection {
  const [name = '', action = ''] = words;
  const profile = name === 'profile' && words.length === 2 ? profileOperations.get(action) : undefined;
  if (profile) return { operation: profile, ids: [] };
  const single = words.length === 1 ? singleWordOperations.get(name) : undefined;
  if (single) return { operation: single, ids: [] };
  if (name === 'starters' && ['list', 'get', 'adopt'].includes(action)) {
    return { operation: `${action === 'get' ? 'read' : action}_starter_program`, ids: words.slice(2) };
  }
  if (name === 'call' && words.length === 2) return { operation: action, ids: [] };
  const named = namedActions.get(name)?.get(action);
  if (named) return { operation: named, ids: words.slice(2) };
  const selection = resourceCommand(words);
  if (selection) return selection;
  throw new CLIError('invalid_arguments', 'Unknown command. Run atlas help or atlas discover.');
}

export type CLIIO = {
  authentication?: 'default' | 'proxy';
  invocation?: CLIInvocation;
  env?: NodeJS.ProcessEnv;
  input?: () => Promise<string>;
  output?: (value: string) => void;
  fetch?: typeof fetch;
  /** Check npm for a newer CLI alongside commands that reach Atlas. Only the installed executable turns this on. */
  updates?: boolean;
};
type CLIErrorDetail = { code: string; message: string; details?: CLIError['details'] };
type CLIFailure = { ok: false; error: CLIErrorDetail; status?: number; request_id?: string };

function commandFlags([name]: string[]): string[] {
  if (name === 'connect') return ['url', 'wait', 'invite'];
  if (name === 'auth' || name === 'discover' || name === 'schema') return ['url'];
  if (name === 'update') return [];
  return ['url', 'data', 'file', 'query', 'idempotency-key', 'if-match', 'if-none-match'];
}

async function readStdin(): Promise<string> {
  const decoder = new StringDecoder('utf8');
  let result = '';
  for await (const chunk of process.stdin) result += decoder.write(chunk);
  return result + decoder.end();
}

type CLIFlags = CLIArguments['flags'];
function writeJSON<T>(output: (value: string) => void, value: T): void {
  output(`${JSON.stringify(value, null, 2)}\n`);
}
function rejectUnsupportedFlags(positional: string[], flags: CLIFlags): void {
  const acceptedFlags = commandFlags(positional);
  if (Object.keys(flags).some(flag => !acceptedFlags.includes(flag))) {
    throw new CLIError('invalid_arguments', 'An option is not supported by this command. Run atlas help.');
  }
}
async function inputData(flags: CLIFlags, input?: () => Promise<string>): Promise<JsonObject> {
  // A CSV export becomes the csv field of a workout file import, next to any other fields; every other payload is JSON.
  const csv = flags.file?.toLowerCase().endsWith('.csv') ?? false;
  if (flags.data !== undefined && flags.file !== undefined && !csv) throw new CLIError('invalid_arguments', 'Choose either --data or --file.');
  let data: JsonObject = {};
  if (flags.data !== undefined) data = json(flags.data);
  if (flags.file !== undefined) {
    let text: string;
    try { text = flags.file === '-' ? await (input ?? readStdin)() : readFileSync(flags.file, 'utf8'); }
    catch (cause) { throw new CLIError('input_error', 'The input file could not be read.', { cause }); }
    data = csv ? { ...data, csv: text } : json(text);
  }
  return data;
}
function connectWait(value: string | undefined): number {
  const wait = value === undefined ? 0 : Number(value);
  if (value !== undefined && (!/^\d+$/.test(value) || !Number.isSafeInteger(wait) || wait < 1 || wait > 600)) {
    throw new CLIError('invalid_arguments', '--wait must be an integer from 1 to 600 seconds.');
  }
  return wait;
}
async function runAuthCommand(client: AtlasCLIClient, action: string | undefined): Promise<CLIResult> {
  if (action === 'status') return client.authStatus();
  if (action === 'logout') return client.authLogout();
  throw new CLIError('invalid_arguments', 'Unknown auth command. Run atlas connect to connect, or atlas help.');
}
function combineConditionFlags(arguments_: JsonObject, flags: CLIFlags): void {
  if (flags['idempotency-key'] !== undefined) combine(arguments_, { 'Idempotency-Key': flags['idempotency-key'] });
  const match = flags['if-match'];
  if (match !== undefined) combine(arguments_, { 'If-Match': /^[1-9]\d*$/.test(match) ? `"${match}"` : match });
  if (flags['if-none-match'] !== undefined) combine(arguments_, { 'If-None-Match': flags['if-none-match'] });
}
/** Merge positional identifiers, input data, query fields and condition flags into one flat argument object. */
function operationArguments(definition: Operation, ids: string[], data: JsonObject, { positional, flags }: CLIArguments): JsonObject {
  const pathFields = definition.parameters.filter(parameter => parameter.in === 'path');
  if (positional[0] !== 'call' && ids.length !== pathFields.length) {
    throw new CLIError(
      'invalid_arguments',
      `This command requires ${pathFields.length} identifier(s): ${pathFields.map(field => field.name).join(', ')}.`,
    );
  }
  const arguments_: JsonObject = { ...data };
  for (const [index, value] of ids.entries()) combine(arguments_, { [pathFields[index]!.name]: value });
  if (flags.query) {
    const query = json(flags.query);
    const allowed = new Set(definition.parameters.filter(parameter => parameter.in === 'query').map(parameter => parameter.name));
    const unsupported = Object.keys(query).filter(name => !allowed.has(name));
    if (unsupported.length) throw unsupportedFields('The query contains unsupported fields. Run atlas schema for this operation.', unsupported);
    combine(arguments_, query);
  }
  if (positional[0] === 'programs' && positional[1] === 'list' && arguments_.visibility === undefined) {
    arguments_.visibility = arguments_.status === undefined ? 'all' : 'private';
  }
  combineConditionFlags(arguments_, flags);
  return arguments_;
}
async function runOperationCommand(client: AtlasCLIClient, parsed: CLIArguments, data: JsonObject): Promise<CLIResult> {
  const { positional } = parsed;
  const { operation, ids } = command(positional);
  const legacy = positional[0] === 'starters' || (positional[0] === 'programs' && positional[1] === 'repeat');
  const definition = (await client.operations()).find(entry => entry.operation === operation) ?? (legacy ? legacyCLIOperation(operation) : undefined);
  if (!definition) throw new CLIError('unknown_operation', 'This operation is not implemented by the server. Run atlas discover.');
  const arguments_ = operationArguments(definition, ids, data, parsed);
  if (legacy) return client.callLegacy(operation, arguments_);
  return operation === 'import_workout_file' ? importWorkoutFile(client, arguments_) : client.call(operation, arguments_);
}
async function runServerCommand(client: AtlasCLIClient, parsed: CLIArguments, data: JsonObject): Promise<CLIResult> {
  const { positional, flags } = parsed;
  const name = positional[0];
  if (name === 'connect' && positional.length === 1) return client.connect(connectWait(flags.wait), flags.invite);
  if (name === 'discover' && positional.length === 1) return client.discover();
  if (name === 'schema' && positional.length <= 2) return client.schema(positional[1]);
  if (name === 'auth' && positional.length === 2) return runAuthCommand(client, positional[1]);
  return runOperationCommand(client, parsed, data);
}

export async function runCLI(args: string[], io: CLIIO = {}): Promise<number> {
  const output = io.output ?? (value => process.stdout.write(value));
  let update: Promise<UpdateNotice | undefined> | undefined;
  let refreshing: Promise<string[]> | undefined;
  const withUpdate = async <T extends object>(result: T) => {
    const [notice] = await Promise.all([update, refreshing]);
    return notice ? { ...result, update: notice } : result;
  };
  try {
    if (args.includes('--skill')) {
      if (args.length !== 1) throw new CLIError('invalid_arguments', 'Use atlas --skill without other commands or options.');
      output(currentLibrary(io.env ?? process.env).readSkill());
      return 0;
    }
    const parsed = parseCLIArguments(args);
    const { positional, flags } = parsed;
    const env = { ...(io.env ?? process.env) };
    if (flags.url) env.ATLAS_URL = flags.url;
    if (!positional.length || positional[0] === 'help') {
      writeJSON(output, { ok: true, operation: 'help', status: 200, data: cliHelp }); return 0;
    }
    if (positional[0] === 'skills') {
      const result = await localSkills(parsed, env, io.fetch ?? fetch);
      if ('markdown' in result) output(result.markdown);
      else writeJSON(output, { ok: true, operation: result.operation, status: 200, data: result.data });
      return 0;
    }
    if (positional[0] === 'knowledge') {
      const result = localKnowledge(parsed, env);
      writeJSON(output, { ok: true, operation: result.operation, status: 200, data: result.data });
      return 0;
    }
    rejectUnsupportedFlags(positional, flags);
    if (positional[0] === 'update' && positional.length === 1) {
      writeJSON(output, await runUpdate(env, io.fetch ?? fetch, () => refreshLibrary(env, io.fetch ?? fetch, true))); return 0;
    }
    // Both run alongside the command, so a stale check adds at most their short timeout.
    if (io.updates) {
      update = checkForUpdate(env, io.fetch ?? fetch);
      refreshing = refreshLibrary(env, io.fetch ?? fetch);
    }
    const client = new AtlasCLIClient(env, io.fetch, io.invocation, io.authentication);
    const data = await inputData(flags, io.input);
    writeJSON(output, await withUpdate(await runServerCommand(client, parsed, data))); return 0;
  } catch (error) {
    writeJSON(output, await withUpdate(cliFailure(error instanceof CLIError
      ? error
      : new CLIError('client_error', 'The Atlas client could not complete the request.', { cause: error }))));
    return 1;
  }
}
export function cliFailure(failure: CLIError): CLIFailure {
  const detail: CLIErrorDetail = { code: failure.code, message: failure.message };
  if (failure.details !== undefined) detail.details = failure.details;
  const result: CLIFailure = { ok: false, error: detail };
  if (failure.status !== undefined) result.status = failure.status;
  if (failure.requestId) result.request_id = failure.requestId;
  return result;
}
function isExecutableEntry(): boolean {
  const entry = process.argv[1];
  if (!entry || entry === '-') return false;
  try { return import.meta.url === pathToFileURL(realpathSync(entry)).href; }
  catch { return false; }
}
if (isExecutableEntry()) {
  process.exitCode = await runCLI(process.argv.slice(2), {
    invocation: { argv: [process.execPath, ...process.execArgv, process.argv[1]!], cwd: process.cwd() },
    updates: true,
  });
}
