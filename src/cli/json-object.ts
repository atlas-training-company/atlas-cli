import * as z from 'zod';
import type { JsonValue } from '../domain.js';
import { CLIError } from './cli-error.js';

export const jsonObjectRootSchema = z.object({});
export const jsonObjectSchema = z.record(z.string(), z.json());
export type JsonObject = Record<string, JsonValue>;

export function requireJsonObject<T>(value: T, message = 'Expected a JSON object.'): JsonObject {
  const parsed = jsonObjectRootSchema.safeParse(value);
  if (!parsed.success) throw new CLIError('invalid_response', message, { cause: parsed.error });
  // SAFETY: Callers supply decoded response JSON or the CLI's own JSON envelope; the shallow schema excludes null and arrays without cloning protocol keys.
  return value as JsonObject;
}
