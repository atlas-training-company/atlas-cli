import * as z from 'zod';
export type KnowledgeSource = {
  // The source boundary is untrusted; loadManifest validates it before use.
  // oxlint-disable-next-line anti-slop/no-unknown-returns
  readManifest(): unknown;
  readEntry(id: string): string;
};

/** The skill `atlas --skill` and /skill.md routes start from; the others are listed from the manifest. */
export const mainSkill = 'atlas-training';
const skillPrefix = 'skills/';

/** Skills keep the portable `skills/NAME/SKILL.md` layout; every other entry is `entries/ID.md`. */
export function knowledgeEntryPath(id: string): string {
  return id.startsWith(skillPrefix) ? `${id}/SKILL.md` : `entries/${id}.md`;
}

export class KnowledgeError extends Error {
  status?: number;
  details?: { issues: string[] };
  constructor(
    public code: 'knowledge_unavailable' | 'knowledge_not_found' | 'invalid_arguments',
    message: string,
    options?: ErrorOptions & { status?: number; details?: { issues: string[] } },
  ) {
    super(message, options);
    this.status = options?.status;
    this.details = options?.details;
  }
}

const safeId = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const sourceSchema = z.object({
  id: z.string().regex(safeId),
  title: z.string().min(1),
  year: z.number().int(),
  kind: z.string().min(1),
  access: z.enum(['abstract', 'full_text', 'secondary_notes']),
  url: z.string().url().optional(),
  locator: z.string().min(1).optional(),
}).strict();
const entrySchema = z.object({
  id: z.string().regex(safeId),
  title: z.string().min(1),
  summary: z.string().min(1),
  kind: z.enum(['research', 'practice', 'program', 'skill']),
  tags: z.array(z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reviewed_at: z.iso.date(),
  source_ids: z.array(z.string().regex(safeId)),
}).strict();
const manifestSchema = z.object({
  schema_version: z.literal(1),
  version: z.string().min(1),
  sources: z.array(sourceSchema),
  entries: z.array(entrySchema),
}).strict().superRefine((manifest, context) => {
  const sourceIds = new Set<string>();
  for (const source of manifest.sources) {
    if (sourceIds.has(source.id)) context.addIssue({ code: 'custom', message: `Duplicate source ID: ${source.id}` });
    sourceIds.add(source.id);
  }
  const entryIds = new Set<string>();
  for (const entry of manifest.entries) {
    if (entryIds.has(entry.id)) context.addIssue({ code: 'custom', message: `Duplicate entry ID: ${entry.id}` });
    entryIds.add(entry.id);
    if ((entry.kind === 'skill') !== /^skills\/[a-z0-9-]+$/.test(entry.id)) {
      context.addIssue({ code: 'custom', message: `Skill entries, and only they, use a skills/NAME ID: ${entry.id}` });
    }
    for (const sourceId of entry.source_ids) {
      if (!sourceIds.has(sourceId)) context.addIssue({ code: 'custom', message: `Unknown source ID ${sourceId} in ${entry.id}` });
    }
  }
});
export const knowledgeQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(10),
}).strict();

type Source = z.infer<typeof sourceSchema>;
type Entry = z.infer<typeof entrySchema>;
type Manifest = z.infer<typeof manifestSchema>;
type ListResult = { library_version: string; items: Entry[] };
type SearchResult = ListResult & { total: number; truncated: boolean };
type GetResult = { library_version: string; entry: Entry; content: string; sources: Source[] };
type SkillSummary = { name: string; description: string; version: number };
type KnowledgeErrorDetails = { issues: string[] };
export type KnowledgeLibrary = {
  readSkill(name?: string): string;
  listSkills(): { library_version: string; items: SkillSummary[] };
  listKnowledge(): ListResult;
  searchKnowledge(query: string, limit: number): SearchResult;
  getKnowledge(id: string): GetResult;
};

function unavailable(message: string, details?: KnowledgeErrorDetails, options?: ErrorOptions): KnowledgeError {
  return new KnowledgeError('knowledge_unavailable', message, { ...options, details });
}

function read<T>(load: () => T, description: string): T {
  try { return load(); }
  catch (cause) {
    if (cause instanceof KnowledgeError) throw cause;
    throw unavailable(`The bundled ${description} could not be read.`, undefined, { cause });
  }
}

function loadManifest(source: KnowledgeSource): Manifest {
  const value = read(() => source.readManifest(), 'knowledge manifest');
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    throw unavailable('The bundled knowledge manifest is invalid.', { issues: parsed.error.issues.map(issue => issue.message) }, { cause: parsed.error });
  }
  for (const entry of parsed.data.entries) {
    const content = read(() => source.readEntry(entry.id), `knowledge entry ${entry.id}`);
    if (entry.kind === 'skill') checkSkillFrontmatter(entry, content);
  }
  return parsed.data;
}

/** A skill file is also served verbatim to skill hosts, so its frontmatter must agree with the manifest entry. */
function checkSkillFrontmatter(entry: Entry, content: string): void {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(content)?.[1] ?? '';
  const field = (key: string) => new RegExp(`^${key}: (.+)$`, 'm').exec(frontmatter)?.[1];
  if (field('name') !== entry.id.slice(skillPrefix.length) || field('description') !== entry.summary) {
    throw unavailable(`Skill ${entry.id} frontmatter must match its manifest name and summary.`);
  }
}

function score(entry: Entry, content: string, terms: string[]): number | undefined {
  const id = entry.id.toLocaleLowerCase('en-US');
  const title = entry.title.toLocaleLowerCase('en-US');
  const tags = entry.tags.join(' ').toLocaleLowerCase('en-US');
  const summary = entry.summary.toLocaleLowerCase('en-US');
  const body = content.toLocaleLowerCase('en-US');
  if (terms.some(term => !`${id}\n${title}\n${tags}\n${summary}\n${body}`.includes(term))) return;
  return terms.reduce((total, term) => total
    + (title.includes(term) ? 4 : 0)
    + (tags.includes(term) ? 3 : 0)
    + (id.includes(term) ? 2 : 0)
    + (summary.includes(term) ? 2 : 0)
    + (body.includes(term) ? 1 : 0), 0);
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createKnowledgeLibrary(source: KnowledgeSource): KnowledgeLibrary {
  const manifest = (): Manifest => loadManifest(source);
  return {
    readSkill: (name = mainSkill) => {
      const entry = manifest().entries.find(candidate => candidate.id === `${skillPrefix}${name}`);
      if (!entry) throw new KnowledgeError('knowledge_not_found', `Skill ${name} was not found.`, { status: 404 });
      return read(() => source.readEntry(entry.id), `skill ${name}`);
    },
    listSkills: () => {
      const loaded = manifest();
      const items = loaded.entries.filter(entry => entry.kind === 'skill').toSorted((left, right) => compareIds(left.id, right.id))
        .map(entry => ({ name: entry.id.slice(skillPrefix.length), description: entry.summary, version: entry.version }));
      return { library_version: loaded.version, items };
    },
    listKnowledge: () => {
      const loaded = manifest();
      return { library_version: loaded.version, items: loaded.entries.toSorted((left, right) => compareIds(left.id, right.id)) };
    },
    searchKnowledge: (query, limit) => {
      const parsedQuery = knowledgeQuerySchema.safeParse({ q: query, limit });
      if (!parsedQuery.success) {
        throw new KnowledgeError(
          'invalid_arguments',
          'Knowledge search requires a 1–200 character query and an integer limit from 1 to 50.',
          { cause: parsedQuery.error },
        );
      }
      const loaded = manifest();
      const terms = parsedQuery.data.q.toLocaleLowerCase('en-US').split(/\s+/);
      const matches = loaded.entries.flatMap(entry => {
        const relevance = score(entry, read(() => source.readEntry(entry.id), `knowledge entry ${entry.id}`), terms);
        return relevance === undefined ? [] : [{ entry, relevance }];
      }).toSorted((left, right) => right.relevance - left.relevance || compareIds(left.entry.id, right.entry.id));
      return {
        library_version: loaded.version,
        items: matches.slice(0, parsedQuery.data.limit).map(match => match.entry),
        total: matches.length,
        truncated: matches.length > parsedQuery.data.limit,
      };
    },
    getKnowledge: id => {
      const loaded = manifest();
      const entry = loaded.entries.find(candidate => candidate.id === id);
      if (!entry) throw new KnowledgeError('knowledge_not_found', `Knowledge entry ${id} was not found.`, { status: 404 });
      const sources = entry.source_ids.map(sourceId => loaded.sources.find(source => source.id === sourceId));
      if (sources.some(source => source === undefined)) throw unavailable(`Knowledge entry ${id} has an unresolved source.`);
      return {
        library_version: loaded.version,
        entry,
        content: read(() => source.readEntry(entry.id), `knowledge entry ${entry.id}`),
        sources: sources.filter(source => source !== undefined),
      };
    },
  };
}
