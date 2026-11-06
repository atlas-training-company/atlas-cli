import * as z from 'zod';
import { idSchema, exerciseReferenceIdSchema, coreExerciseReferenceIdSchema, programReferenceIdSchema, type JsonValue } from '../domain.js';
import { CLIError, unsupportedFields } from './cli-error.js';
import type { JsonObject } from './json-object.js';
import type { Operation, Parameter } from './operation-catalog.js';

const scalarSchema = z.union([z.string(), z.boolean(), z.number()]);
const revisionSchema = z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)), 'Revision must be a positive safe integer');
const idempotencyKeySchema = z.string().regex(/^[\x20-\x7E]{1,128}$/);
// Behind Cloudflare, compressed replies carry W/"N"; accept it and send the strong form.
const revisionTagSchema = z.string().regex(/^(?:W\/)?"[1-9]\d*"$/).transform(tag => tag.replace(/^W\//, ''));
const requestHeaders = ['Idempotency-Key', 'If-Match', 'If-None-Match'];

export type OperationRequest = { target: string; headers: Headers; init: RequestInit };

function identifierSchema(operation: Operation, name: string) {
  if (name === 'id' && operation.path.startsWith('/v1/core-exercises/{id}')) return coreExerciseReferenceIdSchema;
  if (name === 'id' && operation.path.startsWith('/v1/exercises/{id}')) return exerciseReferenceIdSchema;
  if ((name === 'program_id' && operation.path.endsWith('/copy')) || (name === 'id' && operation.path.startsWith('/v1/programs/{id}'))) {
    return programReferenceIdSchema;
  }
  return idSchema;
}

function validPathValue(operation: Operation, name: string, value: string | boolean | number): boolean {
  if (name === 'revision') return revisionSchema.safeParse(String(value)).success;
  return identifierSchema(operation, name).safeParse(value).success;
}

/** Move path and query arguments out of `args` into the request target. */
function takeTarget(operation: Operation, args: JsonObject): string {
  const query = new URLSearchParams();
  let path = operation.path;
  for (const parameter of operation.parameters) {
    if (parameter.in === 'header') continue;
    const value = args[parameter.name];
    if (value === undefined && parameter.required) throw new CLIError('invalid_arguments', `Missing ${parameter.name}.`);
    if (value === undefined) continue;
    const scalar = scalarSchema.safeParse(value);
    if (!scalar.success) throw new CLIError('invalid_arguments', `${parameter.name} must be a scalar value.`);
    if (parameter.in === 'path') {
      if (!validPathValue(operation, parameter.name, scalar.data)) {
        const message = parameter.name === 'revision' ? 'revision must be a positive safe integer.' : `${parameter.name} must be a valid resource identifier.`;
        throw new CLIError('invalid_arguments', message);
      }
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(scalar.data)));
    } else query.set(parameter.name, String(scalar.data));
    delete args[parameter.name];
  }
  return `${path}${query.size ? `?${query}` : ''}`;
}

function checkPreconditions(conditional: Parameter[], match: JsonValue | undefined, none: JsonValue | undefined): void {
  const needsMatch = conditional.some(parameter => parameter.name === 'If-Match' && parameter.required);
  const allowsCreate = conditional.some(parameter => parameter.name === 'If-None-Match');
  if ((needsMatch && !match) || (allowsCreate && Boolean(match) === Boolean(none))) {
    const message = needsMatch
      ? 'Corrections require --if-match with the revision you read.'
      : 'This write requires exactly one of --if-match or --if-none-match "*".';
    throw new CLIError('precondition_required', message);
  }
  if ((match !== undefined && !revisionTagSchema.safeParse(match).success) || (none !== undefined && none !== '*')) {
    throw new CLIError('invalid_arguments', 'Use the revision ETag you read for --if-match or exactly * for --if-none-match.');
  }
}

/** Move write headers out of `args` after checking the idempotency key and preconditions. */
function takeWriteHeaders(operation: Operation, args: JsonObject, headers: Headers): void {
  const key = idempotencyKeySchema.safeParse(args['Idempotency-Key']);
  if (!key.success) {
    throw new CLIError('idempotency_key_required', 'Writes require an explicit --idempotency-key. Reuse it only when retrying the identical request.');
  }
  const conditional = operation.parameters.filter(parameter => parameter.in === 'header');
  checkPreconditions(conditional, args['If-Match'], args['If-None-Match']);
  for (const name of requestHeaders) {
    if (args[name] === undefined) continue;
    if (!conditional.some(parameter => parameter.name === name)) throw new CLIError('invalid_arguments', `${name} is not supported by this operation.`);
    const value = name === 'If-Match' ? revisionTagSchema.parse(args[name]) : String(args[name]);
    headers.set(name, value); delete args[name];
  }
  headers.set('Content-Type', 'application/json');
}

/** Encode flat operation arguments as an unauthenticated API request, rejecting arguments the operation does not accept. */
export function operationRequest(operation: Operation, arguments_: JsonObject): OperationRequest {
  const args = { ...arguments_ };
  const headers = new Headers();
  const target = takeTarget(operation, args);
  if (operation.requestBody) takeWriteHeaders(operation, args, headers);
  else if (Object.keys(args).length) {
    throw unsupportedFields('The operation contains unsupported arguments. Run atlas schema for its accepted fields.', Object.keys(args));
  }
  const init: RequestInit = { method: operation.method, headers };
  if (operation.requestBody) init.body = JSON.stringify(args);
  return { target, headers, init };
}
