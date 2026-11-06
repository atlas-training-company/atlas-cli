import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as z from 'zod';
import { writePrivateFileAtomically } from '../private-file.js';
import { CLIError } from './cli-error.js';

const pendingSchema = z.object({
  device_code: z.string().min(1), user_code: z.string().min(1), url: z.string(), expires_at: z.number().finite(), interval: z.number().int().min(5).max(3600),
});
const agentStateSchema = z.object({
  version: z.literal(2), origin: z.string(),
  access_token: z.string().min(1).optional(), access_expires_at: z.number().finite().optional(), refresh_token: z.string().min(1).optional(),
  pending_approval: pendingSchema.optional(),
});
export type AgentState = z.infer<typeof agentStateSchema>;
export type PendingApproval = z.infer<typeof pendingSchema>;
// Agent Auth keys from CLI 0.6 and earlier. Atlas no longer accepts them, so connect starts over once.
const retiredStateSchema = z.object({ version: z.literal(1), origin: z.string() });

export function readAgentState(configPath: string, origin: string): AgentState | undefined {
  if (!existsSync(configPath)) return;
  let value: unknown;
  try {
    const stat = lstatSync(configPath);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new CLIError('insecure_config', 'Agent configuration must be a private regular file (mode 0600).');
    }
    value = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (cause) {
    if (cause instanceof CLIError) throw cause;
    throw new CLIError('invalid_config', 'Agent configuration could not be read.', { cause });
  }
  const retired = retiredStateSchema.safeParse(value);
  if (retired.success && retired.data.origin === origin) return;
  const parsed = agentStateSchema.safeParse(value);
  if (!parsed.success) throw new CLIError('invalid_config', 'Agent configuration does not match this Atlas origin.', { cause: parsed.error });
  if (parsed.data.origin !== origin) throw new CLIError('invalid_config', 'Agent configuration does not match this Atlas origin.');
  return parsed.data;
}

/** Write one file into the private configuration directory, refusing a directory that is a symbolic link. */
export function writePrivateConfigFile(path: string, content: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(directory).isDirectory()) throw new CLIError('insecure_config', 'Agent configuration directory must not be a symbolic link.');
  chmodSync(directory, 0o700);
  writePrivateFileAtomically(path, content);
}

export function saveAgentState(configPath: string, state: AgentState): void {
  try {
    writePrivateConfigFile(configPath, `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError('config_write_failed', 'Agent configuration could not be saved. Check access to the configured directory.', { cause: error });
  }
}
