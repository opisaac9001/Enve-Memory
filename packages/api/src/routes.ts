import { type ApiClient, type ClientScope, type EnveMemory, INTENTS, type Intent } from '@enve-memory/core';
import { HttpError } from './errors.ts';

export interface RouteContext {
  memory: EnveMemory;
  client: ApiClient;
  params: string[];
  query: URLSearchParams;
  body: Record<string, unknown> | undefined;
}

export interface Route {
  method: string;
  pattern: RegExp;
  /** null: any valid token, e.g. so a capture-only client can confirm it's connected. */
  scope: ClientScope | null;
  status?: number;
  handle: (ctx: RouteContext) => unknown | Promise<unknown>;
}

const badField = (name: string, expected: string) => new HttpError(400, 'invalid', `"${name}" must be ${expected}.`);

function str(body: RouteContext['body'], name: string): string | undefined {
  const value = body?.[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badField(name, 'a string');
  return value;
}

function nullableStr(body: RouteContext['body'], name: string): string | null | undefined {
  return body?.[name] === null ? null : str(body, name);
}

function strList(body: RouteContext['body'], name: string): string[] | undefined {
  const value = body?.[name];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw badField(name, 'an array of strings');
  return value as string[];
}

function queryOffset(query: URLSearchParams): number {
  const raw = query.get('offset');
  const offset = raw === null ? 0 : Number(raw);
  if (!Number.isInteger(offset) || offset < 0) throw badField('offset', 'a non-negative integer');
  return offset;
}

function queryLimit(query: URLSearchParams): number | undefined {
  const raw = query.get('limit');
  return raw === null ? undefined : Number(raw);
}

const queryFilter = (query: URLSearchParams) => ({
  project: query.get('project') ?? undefined,
  type: query.get('type') ?? undefined,
  tag: query.get('tag') ?? undefined,
  includeArchived: query.get('archived') === 'true',
  inbox: query.get('inbox') === 'true',
  before: query.get('before') ?? undefined,
  pinned: query.get('pinned') === 'true' || undefined,
  intent: query.get('intent') ?? undefined,
  reminders: query.get('reminders') === 'true' || undefined,
  unopenedDays: query.get('unopened') === null ? undefined : Number(query.get('unopened')),
});

const ID = '([^/]+)';
const path = (template: string) => new RegExp(`^/api/v1${template.replaceAll(':id', ID)}$`);

function bool(body: RouteContext['body'], name: string): boolean | undefined {
  const value = body?.[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw badField(name, 'true or false');
  return value;
}

const MAX_BATCH = 2000;

/** One capture: a URL becomes a bookmark (re-saving merges), anything else a note. Pin, reminder and intent apply at capture time. */
function capture(memory: EnveMemory, body: RouteContext['body']) {
  const url = str(body, 'url');
  const note = captureNote(str(body, 'note'), str(body, 'selection'));
  const common = { title: str(body, 'title'), project: str(body, 'project'), tags: strList(body, 'tags') };
  const intent = str(body, 'intent');
  const createdAt = str(body, 'createdAt');
  if (createdAt !== undefined && Number.isNaN(Date.parse(createdAt))) throw badField('createdAt', 'an ISO 8601 time');
  const saved = url
    ? memory.items.saveLink({
      ...common, url, note, ...(intent ? { intent: oneOfIntent(intent) } : {}),
      ...(createdAt ? { createdAt: new Date(Date.parse(createdAt)).toISOString() } : {}),
    })
    : { item: memory.items.saveNote({ ...common, body: note ?? '' }), created: true };
  // Re-saving a page is how capture-only clients say "actually, I want to watch this".
  if (!saved.created && intent && saved.item.intent !== intent) memory.items.setIntent(saved.item.id, intent);
  const remind = str(body, 'remind');
  if (remind) memory.items.setReminder(saved.item.id, remind);
  if (bool(body, 'pinned')) memory.items.pin(saved.item.id, true);
  const changed = remind || bool(body, 'pinned') || (!saved.created && intent);
  return { item: changed ? memory.items.get(saved.item.id) : saved.item, created: saved.created };
}

function oneOfIntent(value: string): Intent {
  if (!(INTENTS as readonly string[]).includes(value)) throw badField('intent', `one of ${INTENTS.join(', ')}`);
  return value as Intent;
}

/** Combines the page note and any selected text into one bookmark note. */
function captureNote(note: string | undefined, selection: string | undefined): string | undefined {
  const quoted = selection?.trim() ? selection.trim().split('\n').map((line) => `> ${line}`).join('\n') : undefined;
  return [note?.trim(), quoted].filter(Boolean).join('\n\n') || undefined;
}

export const routes: Route[] = [
  { method: 'GET', pattern: path('/whoami'), scope: null, handle: ({ client }) => client },

  {
    method: 'GET', pattern: path('/search'), scope: 'read',
    handle: ({ memory, query }) => memory.search.hybrid(query.get('q') ?? '', queryFilter(query), queryLimit(query)),
  },

  {
    method: 'GET', pattern: path('/items'), scope: 'read',
    handle: ({ memory, query }) => memory.items.list(queryFilter(query), queryLimit(query)),
  },
  {
    method: 'GET', pattern: path('/lookup'), scope: 'read',
    handle: ({ memory, query }) => ({ item: memory.items.findByUrl(query.get('url') ?? '') }),
  },
  { method: 'GET', pattern: path('/items/:id'), scope: 'read', handle: ({ memory, params }) => memory.items.get(params[0]!) },
  {
    method: 'POST', pattern: path('/items'), scope: 'capture', status: 201,
    handle: ({ memory, body }) => {
      const type = str(body, 'type');
      const common = { title: str(body, 'title'), project: str(body, 'project'), tags: strList(body, 'tags') };
      switch (type) {
        case 'note':
          return memory.items.saveNote({ ...common, body: str(body, 'body') ?? '' });
        case 'bookmark':
          return memory.items.saveLink({ ...common, url: str(body, 'url') ?? '', note: str(body, 'body') }).item;
        case 'task':
          return memory.tasks.create({
            ...common, title: common.title ?? '', notes: str(body, 'body'), due: str(body, 'due'), priority: str(body, 'priority'),
          });
        default:
          throw badField('type', '"note", "bookmark" or "task"');
      }
    },
  },
  {
    method: 'PATCH', pattern: path('/items/:id'), scope: 'write',
    handle: ({ memory, params, body }) =>
      memory.items.update(params[0]!, {
        title: str(body, 'title'), body: str(body, 'body'), url: nullableStr(body, 'url'), project: nullableStr(body, 'project'),
      }),
  },
  {
    method: 'POST', pattern: path('/items/:id/pin'), scope: 'write',
    handle: ({ memory, params, body }) => memory.items.pin(params[0]!, bool(body, 'pinned') ?? true),
  },
  {
    // A signal, not an edit: capture-only clients (the extension) may report that a saved link was opened.
    method: 'POST', pattern: path('/items/:id/opened'), scope: 'capture',
    handle: ({ memory, params }) => {
      memory.items.markOpened(params[0]!);
      return { ok: true };
    },
  },
  {
    method: 'PUT', pattern: path('/items/:id/reminder'), scope: 'write',
    handle: ({ memory, params, body }) => memory.items.setReminder(params[0]!, nullableStr(body, 'at') ?? null),
  },
  {
    method: 'PUT', pattern: path('/items/:id/intent'), scope: 'write',
    handle: ({ memory, params, body }) => memory.items.setIntent(params[0]!, nullableStr(body, 'intent') ?? null),
  },
  {
    method: 'POST', pattern: path('/items/:id/accept'), scope: 'write',
    handle: ({ memory, params }) => memory.items.acceptSuggestions(params[0]!),
  },
  {
    // Whichever client shows a reminder first (desktop, extension, phone) marks it, so the others don't repeat it.
    method: 'POST', pattern: path('/items/:id/reminded'), scope: 'capture',
    handle: ({ memory, params }) => {
      memory.items.markReminded(params[0]!);
      return { ok: true };
    },
  },
  {
    method: 'GET', pattern: path('/reminders'), scope: 'read',
    handle: ({ memory, query }) => (query.get('due') === 'true' ? memory.items.dueReminders() : memory.items.list({ reminders: true }, queryLimit(query))),
  },
  { method: 'POST', pattern: path('/items/:id/archive'), scope: 'write', handle: ({ memory, params }) => memory.items.archive(params[0]!) },
  { method: 'POST', pattern: path('/items/:id/unarchive'), scope: 'write', handle: ({ memory, params }) => memory.items.unarchive(params[0]!) },
  {
    method: 'POST', pattern: path('/items/:id/tags'), scope: 'write',
    handle: ({ memory, params, body }) => memory.items.tag(params[0]!, { add: strList(body, 'add'), remove: strList(body, 'remove') }),
  },

  {
    // The browser extension and share sheets post here: a URL becomes a bookmark, anything else a note.
    method: 'POST', pattern: path('/capture'), scope: 'capture', status: 201,
    handle: ({ memory, body }) => capture(memory, body),
  },
  {
    // Bulk capture, e.g. importing a browser's whole bookmark tree. Each entry succeeds or fails on its own.
    method: 'POST', pattern: path('/capture/batch'), scope: 'capture',
    handle: ({ memory, body }) => {
      const entries = body?.items;
      if (!Array.isArray(entries)) throw badField('items', 'an array');
      if (entries.length > MAX_BATCH) throw badField('items', `at most ${MAX_BATCH} entries`);
      const results = entries.map((entry) => {
        try {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw badField('item', 'an object');
          const { item, created } = capture(memory, entry as Record<string, unknown>);
          return { id: item.id, created };
        } catch (error) {
          return { error: (error as Error).message };
        }
      });
      return {
        created: results.filter((r) => 'created' in r && r.created).length,
        skipped: results.filter((r) => 'created' in r && !r.created).length,
        failed: results.filter((r) => 'error' in r).length,
        results,
      };
    },
  },
  {
    // What's already in the library about the page you're looking at.
    method: 'GET', pattern: path('/related'), scope: 'read',
    handle: async ({ memory, query }) => {
      const url = query.get('url');
      const saved = url ? memory.items.findByUrl(url) : null;
      const text = [query.get('q'), saved?.title, saved?.metadata.excerpt].filter(Boolean).join(' ');
      if (!text.trim()) return [];
      const hits = await memory.search.hybrid(text, {}, (queryLimit(query) ?? 8) + 1);
      return hits.filter((h) => h.id !== saved?.id && h.url !== url).slice(0, queryLimit(query) ?? 8);
    },
  },

  { method: 'GET', pattern: path('/projects'), scope: 'read', handle: ({ memory, query }) => memory.projects.list(query.get('status') ?? undefined) },
  {
    method: 'POST', pattern: path('/projects'), scope: 'write', status: 201,
    handle: ({ memory, body }) =>
      memory.projects.create({ name: str(body, 'name') ?? '', description: str(body, 'description'), instructions: str(body, 'instructions') }),
  },
  { method: 'GET', pattern: path('/projects/:id'), scope: 'read', handle: ({ memory, params }) => memory.briefing(params[0]!) },
  {
    method: 'PATCH', pattern: path('/projects/:id'), scope: 'write',
    handle: ({ memory, params, body }) =>
      memory.projects.update(params[0]!, {
        name: str(body, 'name'), description: str(body, 'description'), instructions: str(body, 'instructions'), status: str(body, 'status'),
      }),
  },
  {
    method: 'PUT', pattern: path('/projects/:id/memory'), scope: 'write',
    handle: ({ memory, params, body }) => memory.projects.setMemory(params[0]!, str(body, 'memory') ?? ''),
  },
  { method: 'GET', pattern: path('/projects/:id/decisions'), scope: 'read', handle: ({ memory, params }) => memory.decisions.list(params[0]!) },
  {
    method: 'POST', pattern: path('/projects/:id/decisions'), scope: 'write', status: 201,
    handle: ({ memory, params, body }) =>
      memory.decisions.record({
        project: params[0]!, decision: str(body, 'decision') ?? '', reason: str(body, 'reason'), supersedes: strList(body, 'supersedes'),
      }),
  },

  {
    method: 'GET', pattern: path('/tasks'), scope: 'read',
    handle: ({ memory, query }) =>
      memory.tasks.list(
        {
          project: query.get('project') ?? undefined, status: query.get('status') ?? undefined, tag: query.get('tag') ?? undefined,
          offset: queryOffset(query),
        },
        queryLimit(query),
      ),
  },
  {
    method: 'PATCH', pattern: path('/tasks/:id'), scope: 'write',
    handle: ({ memory, params, body }) =>
      memory.tasks.update(params[0]!, {
        title: str(body, 'title'), notes: str(body, 'notes'), status: str(body, 'status'), due: nullableStr(body, 'due'),
        priority: str(body, 'priority'), project: nullableStr(body, 'project'),
      }),
  },
  { method: 'POST', pattern: path('/tasks/:id/complete'), scope: 'write', handle: ({ memory, params }) => memory.tasks.complete(params[0]!) },

  {
    method: 'GET', pattern: path('/activity'), scope: 'read',
    handle: ({ memory, query }) => memory.activity.recent({ project: query.get('project') ?? undefined }, queryLimit(query)),
  },
];
