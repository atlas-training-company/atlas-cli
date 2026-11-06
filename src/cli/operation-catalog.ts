import { lstatSync, readFileSync } from 'node:fs';
import * as z from 'zod';
import type { JsonValue } from '../domain.js';
import { writePrivateConfigFile } from './agent-credentials.js';
import { CLIError } from './cli-error.js';
import { jsonObjectRootSchema, requireJsonObject, type JsonObject } from './json-object.js';

const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH']);
const parameterLocationSchema = z.enum(['header', 'path', 'query']);
type HttpMethod = z.infer<typeof httpMethodSchema>;
type ParameterLocation = z.infer<typeof parameterLocationSchema>;
const parameterSchema = z.object({
  name: z.string(), in: parameterLocationSchema, required: z.boolean().optional(), schema: jsonObjectRootSchema.optional(),
});
export type Parameter = { name: string; in: ParameterLocation; required?: boolean; schema?: JsonObject };
export type Operation = { operation: string; method: HttpMethod; path: string; summary: string; parameters: Parameter[]; requestBody?: JsonValue };

const idempotencyKeyParameter: Parameter = { name: 'Idempotency-Key', in: 'header', required: true };
// Fixed execution-only adapters for published starter/repeat command identities.
// They are never added to discovery, generic call, or automatic grant requests.
const legacyCLIOperations: readonly Operation[] = [
  { operation: 'list_starter_program', method: 'GET', path: '/v1/starter-programs', summary: 'Legacy starter list', parameters: [] },
  {
    operation: 'read_starter_program', method: 'GET', path: '/v1/starter-programs/{id}', summary: 'Legacy starter read',
    parameters: [{ name: 'id', in: 'path', required: true }],
  },
  {
    operation: 'adopt_starter_program', method: 'POST', path: '/v1/starter-programs/{template_id}/adopt', summary: 'Legacy starter adoption',
    parameters: [{ name: 'template_id', in: 'path', required: true }, idempotencyKeyParameter], requestBody: true,
  },
  {
    operation: 'repeat_program', method: 'POST', path: '/v1/programs/{program_id}/repeat', summary: 'Legacy program repetition',
    parameters: [{ name: 'program_id', in: 'path', required: true }, idempotencyKeyParameter], requestBody: true,
  },
];
export function legacyCLIOperation(name: string): Operation | undefined {
  return legacyCLIOperations.find(operation => operation.operation === name);
}

function documentedOperation(path: string, method: string, value: JsonValue): Operation | undefined {
  const supportedMethod = httpMethodSchema.safeParse(method.toUpperCase());
  // OpenAPI method keys are lowercase; retain the existing exact filter.
  if (!supportedMethod.success || method !== supportedMethod.data.toLowerCase()) return;
  const entry = requireJsonObject(value);
  const operationId = z.string().safeParse(entry.operationId);
  if (!operationId.success) return;
  const parameters = entry.parameters ?? [];
  const parsed = z.array(parameterSchema).safeParse(parameters);
  if (!parsed.success) throw new CLIError('invalid_response', 'Atlas returned invalid operation parameters.', { cause: parsed.error });
  const operation: Operation = {
    operation: operationId.data, method: supportedMethod.data, path, summary: String(entry.summary ?? ''),
    // SAFETY: The array schema checked each parameter's fields, supported location and schema object;
    // retain the decoded JSON's descriptions and schema extension keys.
    parameters: parameters as Parameter[],
  };
  if (entry.requestBody) operation.requestBody = entry.requestBody;
  return operation;
}

/** List the versioned API operations an OpenAPI document advertises. */
export function documentedOperations(document: JsonObject): Operation[] {
  const operations: Operation[] = [];
  for (const [path, entries] of Object.entries(requireJsonObject(document.paths))) {
    if (!path.startsWith('/v1/')) continue;
    for (const [method, value] of Object.entries(requireJsonObject(entries))) {
      const operation = documentedOperation(path, method, value);
      if (operation) operations.push(operation);
    }
  }
  return operations;
}

const operationSchema = z.object({
  operation: z.string(), method: httpMethodSchema, path: z.string().startsWith('/v1/'), summary: z.string(),
  parameters: z.array(parameterSchema), requestBody: z.json().optional(),
});
const operationCacheSchema = z.object({ origin: z.string(), cli: z.string(), etag: z.string().min(1), operations: z.array(z.json()) });
/** The operations one server's OpenAPI document listed, kept with that document's ETag by the CLI version that read it. */
export type OperationCache = { origin: string; cli: string; etag: string; operations: Operation[] };

/** A saved copy for this origin and CLI version, or nothing when it is missing, unreadable, or not a private regular file. */
export function readOperationCache(path: string, origin: string, cli: string): OperationCache | undefined {
  let value: JsonValue;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) return;
    value = z.json().parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch { return; }
  const cache = operationCacheSchema.safeParse(value).data;
  if (cache?.origin !== origin || cache.cli !== cli || !cache.operations.every(entry => operationSchema.safeParse(entry).success)) return;
  // SAFETY: Each entry was checked against the Operation fields; keep its decoded descriptions and schema keys.
  return { ...cache, operations: cache.operations as Operation[] };
}

/** Keep the operations for the next command. Best effort: a failed write only means the next command downloads the document. */
export function saveOperationCache(path: string, cache: OperationCache): void {
  try { writePrivateConfigFile(path, JSON.stringify(cache)); } catch { /* Revalidated or downloaded next time. */ }
}
