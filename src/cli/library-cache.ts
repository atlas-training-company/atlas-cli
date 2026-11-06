import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as z from 'zod';
import { writePrivateFileAtomically } from '../private-file.js';
import { atlasOrigin, DEFAULT_ATLAS_URL } from './client.js';
import { bundledLibrary, knowledgeSnapshotSchema, snapshotLibrary, type KnowledgeLibrary, type KnowledgeSnapshot } from './knowledge.js';

const refreshInterval = 24 * 60 * 60 * 1000;
/** Most of a day's refreshes run beside a command, so they wait no longer than the update check does. */
const backgroundTimeout = 1500;
const explicitTimeout = 10_000;
const maxBytes = 5_000_000;

const cacheSchema = z.object({ origin: z.string(), checked_at: z.number().finite(), library: knowledgeSnapshotSchema.optional() });
const folderSchema = z.object({ path: z.string(), origin: z.string(), version: z.string(), skills: z.array(z.string()) });
const foldersSchema = z.object({ folders: z.array(folderSchema) });
type Folder = z.infer<typeof folderSchema>;

const configDirectory = (env: NodeJS.ProcessEnv) => env.ATLAS_CONFIG_DIR || join(homedir(), '.config', 'atlas');
const cachePath = (env: NodeJS.ProcessEnv) => join(configDirectory(env), 'knowledge-cache.json');
const foldersPath = (env: NodeJS.ProcessEnv) => join(configDirectory(env), 'skill-folders.json');

/** The origin the library comes from, or nothing when ATLAS_URL isn't a usable one (plain HTTP off loopback, a path, a typo). */
function originOf(env: NodeJS.ProcessEnv): string | undefined {
  try { return atlasOrigin(env.ATLAS_URL || DEFAULT_ATLAS_URL); } catch { return; }
}

function readJSON<T>(path: string, schema: z.ZodType<T>): T | undefined {
  try { return schema.parse(JSON.parse(readFileSync(path, 'utf8'))); } catch { return; }
}

function writeJSON<T extends object>(path: string, value: T): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writePrivateFileAtomically(path, `${JSON.stringify(value)}\n`);
}

/** Library versions read YYYY-MM-DD.N. An unreadable version is never newer. */
function versionKey(version: string): [string, number] | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(version);
  return match ? [match[1]!, Number(match[2])] : undefined;
}
function newer(candidate: string, current: string): boolean {
  const [a, b] = [versionKey(candidate), versionKey(current)];
  if (!a || !b) return false;
  return a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];
}

/** A snapshot whose every entry and skill frontmatter checks out, or nothing. */
function validLibrary(snapshot: KnowledgeSnapshot | undefined): KnowledgeLibrary | undefined {
  if (!snapshot) return;
  const library = snapshotLibrary(snapshot);
  try { library.listKnowledge(); return library; } catch { return; }
}

/**
 * The library every local command reads: the copy kept from this origin's Atlas when it is newer than the one bundled with the
 * CLI, otherwise the bundle. Commands stay local and work offline.
 */
export function currentLibrary(env: NodeJS.ProcessEnv): KnowledgeLibrary {
  const cache = readJSON(cachePath(env), cacheSchema);
  const bundledVersion = bundledLibrary.listKnowledge().library_version;
  if (!cache?.library || cache.origin !== originOf(env) || !newer(cache.library.manifest.version, bundledVersion)) return bundledLibrary;
  return validLibrary(cache.library) ?? bundledLibrary;
}

async function fetchLibrary(origin: string, transport: typeof fetch, timeout: number): Promise<KnowledgeSnapshot | undefined> {
  try {
    const response = await transport(new URL('/knowledge.json', origin).href, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeout),
    });
    const text = response.ok ? await response.text() : '';
    if (!text || text.length > maxBytes) return;
    const snapshot = knowledgeSnapshotSchema.parse(JSON.parse(text));
    return validLibrary(snapshot) ? snapshot : undefined;
  } catch { return; }
}

/** Rewrites one folder's skills from the library, replacing each file whole and removing skills the library no longer has. */
function writeFolder(path: string, library: KnowledgeLibrary, previous: readonly string[]): string[] {
  const skills = library.listSkills().items.map(skill => skill.name);
  for (const name of skills) {
    mkdirSync(join(path, name), { recursive: true });
    writePrivateFileAtomically(join(path, name, 'SKILL.md'), library.readSkill(name), 0o644);
  }
  for (const name of previous.filter(name => !skills.includes(name))) {
    rmSync(join(path, name, 'SKILL.md'), { force: true });
    try { rmdirSync(join(path, name)); } catch { /* The person keeps other files there. */ }
  }
  return skills.map(name => join(path, name, 'SKILL.md'));
}

/** Brings every remembered folder from this origin up to the current library. Folders the person deleted are forgotten. */
function updateFolders(env: NodeJS.ProcessEnv): string[] {
  const record = readJSON(foldersPath(env), foldersSchema);
  const origin = originOf(env);
  if (!record?.folders.length || !origin) return [];
  const library = currentLibrary(env);
  const version = library.listKnowledge().library_version;
  const written: string[] = [];
  const folders = record.folders.filter(folder => existsSync(folder.path)).map(folder => {
    if (folder.origin !== origin || !newer(version, folder.version)) return folder;
    try { writeFolder(folder.path, library, folder.skills); } catch { return folder; }
    written.push(folder.path);
    return { ...folder, version, skills: library.listSkills().items.map(skill => skill.name) };
  });
  try { writeJSON(foldersPath(env), { folders }); } catch { /* The next refresh tries again. */ }
  return written;
}

/**
 * Fetches this origin's library at most once a day (or now, when forced), keeps it when it checks out, and rewrites the skill
 * folders `skills install` wrote. Resolves to the folders it rewrote. An unreachable Atlas leaves everything as it was.
 */
export async function refreshLibrary(env: NodeJS.ProcessEnv, transport: typeof fetch, force = false): Promise<string[]> {
  const origin = originOf(env);
  if (!origin || (!force && env.ATLAS_NO_UPDATE_CHECK)) return [];
  const cache = readJSON(cachePath(env), cacheSchema);
  const fresh = cache?.origin === origin && Date.now() - cache.checked_at < refreshInterval && cache.checked_at <= Date.now();
  if (!force && fresh) return [];
  const fetched = await fetchLibrary(origin, transport, force ? explicitTimeout : backgroundTimeout);
  const library = fetched ?? (cache?.origin === origin ? cache.library : undefined);
  try { writeJSON(cachePath(env), { origin, checked_at: Date.now(), ...library && { library } }); } catch { /* Check again next time. */ }
  return updateFolders(env);
}

/** `atlas skills install DIRECTORY`: write every current skill there and remember the folder, so later refreshes keep it current. */
export async function installSkills(folder: string, env: NodeJS.ProcessEnv, transport: typeof fetch): Promise<string[]> {
  const path = resolve(folder);
  await refreshLibrary(env, transport, true);
  const library = currentLibrary(env);
  const record = readJSON(foldersPath(env), foldersSchema);
  const previous = record?.folders.find(entry => entry.path === path);
  const installed = writeFolder(path, library, previous?.skills ?? []);
  const entry: Folder = {
    path, origin: originOf(env) ?? '', version: library.listKnowledge().library_version,
    skills: library.listSkills().items.map(skill => skill.name),
  };
  try {
    writeJSON(foldersPath(env), { folders: [...(record?.folders ?? []).filter(other => other.path !== path), entry] });
  } catch { /* The folder is written; it just won't be refreshed. */ }
  return installed;
}
