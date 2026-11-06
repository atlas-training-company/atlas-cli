import { readFileSync } from 'node:fs';
import * as z from 'zod';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CLIError } from './client.js';
import { createKnowledgeLibrary as createLibrary, KnowledgeError, knowledgeEntryPath, type KnowledgeLibrary } from '../knowledge/library.js';

export { knowledgeQuerySchema, type KnowledgeLibrary } from '../knowledge/library.js';

function cliResult<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    if (!(error instanceof KnowledgeError)) throw error;
    throw new CLIError(error.code, error.message, { status: error.status, details: error.details, cause: error.cause });
  }
}

/** Library failures become CLI errors with the same code, status and details. */
function cliLibrary(library: KnowledgeLibrary): KnowledgeLibrary {
  return {
    readSkill: name => cliResult(() => library.readSkill(name)),
    listSkills: () => cliResult(() => library.listSkills()),
    listKnowledge: () => cliResult(() => library.listKnowledge()),
    searchKnowledge: (query, limit) => cliResult(() => library.searchKnowledge(query, limit)),
    getKnowledge: id => cliResult(() => library.getKnowledge(id)),
  };
}

export function createKnowledgeLibrary(rootUrl: URL): KnowledgeLibrary {
  const root = fileURLToPath(rootUrl);
  const library = createLibrary({
    readManifest: () => {
      const content = readFileSync(join(root, 'manifest.json'), 'utf8');
      try { return JSON.parse(content); }
      catch (cause) { throw new KnowledgeError('knowledge_unavailable', 'The bundled knowledge manifest is not valid JSON.', { cause }); }
    },
    readEntry: id => readFileSync(join(root, knowledgeEntryPath(id)), 'utf8'),
  });
  return cliLibrary(library);
}

/** A whole library as Atlas serves it at /knowledge.json. Its manifest and entries are fully checked when the library is first read. */
export const knowledgeSnapshotSchema = z.object({
  manifest: z.object({ version: z.string() }).passthrough(), entries: z.record(z.string(), z.string()),
});
export type KnowledgeSnapshot = z.infer<typeof knowledgeSnapshotSchema>;

/** A library held in memory, such as the copy of Atlas's library the CLI keeps. */
export function snapshotLibrary({ manifest, entries }: KnowledgeSnapshot): KnowledgeLibrary {
  const library = createLibrary({
    readManifest: () => manifest,
    readEntry: id => {
      const content = Object.hasOwn(entries, id) ? entries[id] : undefined;
      if (content === undefined) throw new KnowledgeError('knowledge_unavailable', `The knowledge entry ${id} is missing.`);
      return content;
    },
  });
  return cliLibrary(library);
}

const bundled = createKnowledgeLibrary(new URL('../../knowledge/', import.meta.url));
export const bundledLibrary = bundled;
export const readSkill = bundled.readSkill;
export const listSkills = bundled.listSkills;
export const listKnowledge = bundled.listKnowledge;
export const searchKnowledge = bundled.searchKnowledge;
export const getKnowledge = bundled.getKnowledge;
