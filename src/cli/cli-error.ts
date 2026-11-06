import type { JsonValue } from '../domain.js';

export class CLIError extends Error {
  status?: number;
  details?: JsonValue;
  requestId?: string;
  constructor(public code: string, message: string, options?: ErrorOptions & { status?: number; details?: JsonValue; requestId?: string }) {
    super(message, options);
    this.status = options?.status;
    this.details = options?.details;
    this.requestId = options?.requestId;
  }
}

/** Refuse fields a command does not accept, naming them in the API's validation detail shape. */
export function unsupportedFields(message: string, keys: string[]): CLIError {
  return new CLIError('invalid_arguments', message, { details: [{ code: 'unrecognized_keys', path: [], keys, message: 'Not accepted by this operation.' }] });
}
