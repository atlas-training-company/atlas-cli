import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { writePrivateFileAtomically } from '../private-file.js';
import { CLIError } from './cli-error.js';
import type { CLIResult } from './client.js';

const packageName = '@atlas-training/cli';
const checkInterval = 24 * 60 * 60 * 1000;
const noticeTimeout = 1500;
const release = z.string().regex(/^\d+\.\d+\.\d+$/);
const manifestSchema = z.object({ name: z.string(), version: z.string() });
const cacheSchema = z.object({ checked_at: z.number().finite(), latest: release.optional() });

/** Added to a command's JSON result when npm has a newer release than the one that ran. */
export type UpdateNotice = { current: string; latest: string; command?: string; message: string };

/** The running CLI's package. Published, it sits two folders above dist/cli; in the source tree it is packages/cli. */
function runningPackage(): { root: string; version: string } | undefined {
  for (const candidate of ['../../package.json', '../../packages/cli/package.json']) {
    const url = new URL(candidate, import.meta.url);
    try {
      const manifest = manifestSchema.parse(JSON.parse(readFileSync(url, 'utf8')));
      if (manifest.name === packageName && release.safeParse(manifest.version).success) {
        return { root: dirname(fileURLToPath(url)), version: manifest.version };
      }
    } catch { /* Not this layout. */ }
  }
}

/** The running CLI's release, or nothing when this copy's package can't be found. */
export function cliVersion(): string | undefined {
  return runningPackage()?.version;
}

/** npm's global prefix for this copy, or nothing when a project, npx or another package manager installed it. */
function globalPrefix(root: string): string | undefined {
  let real: string;
  try { real = realpathSync(root); } catch { return; }
  const nodeModules = dirname(dirname(real));
  if (basename(real) !== 'cli' || basename(dirname(real)) !== '@atlas-training' || basename(nodeModules) !== 'node_modules') return;
  const parent = dirname(nodeModules);
  if (process.platform === 'win32') return existsSync(join(parent, 'atlas.cmd')) ? parent : undefined;
  const prefix = dirname(parent);
  return basename(parent) === 'lib' && existsSync(join(prefix, 'bin', 'atlas')) ? prefix : undefined;
}

function newer(candidate: string, current: string): boolean {
  const [a, b] = [candidate, current].map(version => version.split('.').map(Number));
  for (let index = 0; index < 3; index++) if (a![index] !== b![index]) return a![index]! > b![index]!;
  return false;
}

async function latestRelease(env: NodeJS.ProcessEnv, transport: typeof fetch, timeout: number): Promise<string> {
  const registry = env.npm_config_registry || 'https://registry.npmjs.org/';
  const url = new URL(`${packageName}/latest`, registry.endsWith('/') ? registry : `${registry}/`);
  const response = await transport(url.href, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`The npm registry answered ${response.status}.`);
  return z.object({ version: release }).parse(await response.json()).version;
}

function cachePath(env: NodeJS.ProcessEnv): string {
  return join(env.ATLAS_CONFIG_DIR || join(homedir(), '.config', 'atlas'), 'update-check.json');
}

function saveCheck(env: NodeJS.ProcessEnv, latest: string | undefined): void {
  try {
    const path = cachePath(env);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writePrivateFileAtomically(path, `${JSON.stringify({ checked_at: Date.now(), latest })}\n`);
  } catch { /* The next command checks again. */ }
}

function notice(current: string, latest: string, prefix: string | undefined): UpdateNotice {
  if (prefix === undefined) {
    return { current, latest, message: `Atlas CLI ${latest} is available; this is ${current}. Update it the way it was installed.` };
  }
  return { current, latest, command: 'atlas update', message: `Atlas CLI ${latest} is available; this is ${current}. Run atlas update to install it.` };
}

/**
 * Looks for a newer release at most once a day, sharing the answer through the config folder.
 * Resolves to nothing when this copy is current, its version is unknown, the check is off, or npm can't be reached.
 */
export async function checkForUpdate(env: NodeJS.ProcessEnv, transport: typeof fetch): Promise<UpdateNotice | undefined> {
  if (env.ATLAS_NO_UPDATE_CHECK) return;
  const running = runningPackage();
  if (!running) return;
  let latest: string | undefined;
  let cached: z.infer<typeof cacheSchema> | undefined;
  try { cached = cacheSchema.parse(JSON.parse(readFileSync(cachePath(env), 'utf8'))); } catch { /* Check now. */ }
  if (cached && Date.now() - cached.checked_at < checkInterval && cached.checked_at <= Date.now()) latest = cached.latest;
  else {
    try { latest = await latestRelease(env, transport, noticeTimeout); } catch { /* Quietly try again tomorrow. */ }
    saveCheck(env, latest);
  }
  return latest && newer(latest, running.version) ? notice(running.version, latest, globalPrefix(running.root)) : undefined;
}

function quoted(value: string): string {
  return process.platform === 'win32' && /\s/.test(value) ? `"${value}"` : value;
}

/** Run npm without letting its output into the CLI's one JSON result. */
function npmInstall(env: NodeJS.ProcessEnv, prefix: string, version: string): Promise<{ code: number | null; output: string }> {
  const args = ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', `${packageName}@${version}`];
  // Windows runs npm.cmd only through a shell, which needs paths with spaces quoted.
  const windows = process.platform === 'win32';
  return new Promise(resolve => {
    let output = '';
    const child = spawn(windows ? 'npm.cmd' : 'npm', args.map(quoted), { env, shell: windows, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => resolve({ code: null, output: error.message }));
    child.on('close', code => resolve({ code, output }));
  });
}

/**
 * `atlas update`: install the newest release over a global npm install, then confirm the version that landed. Whether or not
 * it can update, it also refreshes Atlas's training library and the skill folders `skills install` wrote, listing those it
 * rewrote as `skill_folders`.
 */
export async function runUpdate(env: NodeJS.ProcessEnv, transport: typeof fetch, refreshSkills: () => Promise<string[]>): Promise<CLIResult> {
  const refreshing = refreshSkills();
  const data = await installLatest(env, transport).finally(() => refreshing);
  const folders = await refreshing;
  return { ok: true, operation: 'update', status: 200, data: folders.length ? { ...data, skill_folders: folders } : data };
}

type UpdateData = { status: 'up_to_date'; version: string } | { status: 'updated'; previous: string; version: string };

async function installLatest(env: NodeJS.ProcessEnv, transport: typeof fetch): Promise<UpdateData> {
  const running = runningPackage();
  const prefix = running && globalPrefix(running.root);
  if (!running || prefix === undefined) {
    const example = `npm install --global ${packageName}@latest`;
    throw new CLIError('update_unavailable', `This Atlas CLI isn't a global npm install. Update it the way it was installed, for example ${example}.`);
  }
  let latest: string;
  try { latest = await latestRelease(env, transport, 30_000); }
  catch (cause) { throw new CLIError('network_error', 'The npm registry could not be reached to find the newest Atlas CLI.', { cause }); }
  saveCheck(env, latest);
  if (!newer(latest, running.version)) {
    return { status: 'up_to_date', version: running.version };
  }
  const installed = await npmInstall(env, prefix, latest);
  const version = runningPackage()?.version;
  if (installed.code !== 0 || version !== latest) {
    throw new CLIError('update_failed', `npm could not install Atlas CLI ${latest}; ${running.version} is still installed.`, {
      details: { npm_exit_code: installed.code, npm_output: installed.output.trim().slice(-2000) },
    });
  }
  return { status: 'updated', previous: running.version, version };
}
