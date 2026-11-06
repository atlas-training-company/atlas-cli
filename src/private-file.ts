import { randomUUID } from 'node:crypto';
import { closeSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The caller validates the parent directory and supplies the complete payload. Private unless a wider mode is given. */
export function writePrivateFileAtomically(target: string, content: string, mode = 0o600): void {
  const temporary = join(dirname(target), `.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  let owned = false;
  try {
    descriptor = openSync(temporary, 'wx', mode);
    owned = true;
    writeFileSync(descriptor, content);
    const written = descriptor;
    // A failed close may have released the descriptor; do not retry it.
    descriptor = undefined;
    closeSync(written);
    renameSync(temporary, target);
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* Still attempt removal while retaining the write failure. */ }
    }
    if (owned) {
      try { rmSync(temporary, { force: true }); } catch { /* An unremovable partial file remains private. */ }
    }
    throw error;
  }
}
