import type { ApiClient, ClientScope, EnveMemory } from '@enve-memory/core';
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
  scope: ClientScope;
  status?: number;
  handle: (ctx: RouteContext) => unknown;
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

function queryLimit(query: URLSearchParams): number | undefined {
  const raw = query.get('limit');
  return raw === null ? undefined : Number(raw);
}

const queryFilter = (query: URLSearchParams) => ({
  project: query.get('project') ?? undefined,
  type: query.get('type') ?? undefined,
  tag: query.get('tag') ?? undefined,
  includeArchived: query.get('archived') === 'true',
});

const ID = '([^/]+)';
const path = (template: string) => new RegExp(`^/api/v1${template.replaceAll(':id', ID)}$`);

/** Combines the page note and any selected text into one bookmark note. */
function captureNote(note: string | undefined, selection: string | undefined): string | undefined {
  const quoted = selection?.trim() ? selection.trim().split('\n').map((line) => `> ${line}`).join('\n') : undefined;
  return [note?.trim(), quoted].filter(Boolean).join('\n\n') || undefined;
}

export const routes: Route[] = [
  { method: 'GET', pattern: path('/whoami'), scope: 'read', handle: ({ client }) => client },

  {
    method: 'GET', pattern: path('/search'), scope: 'read',
    handle: ({ memory, query }) => memory.search.query(query.get('q') ?? '', queryFilter(query), queryLimit(query)),
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
  { method: 'POST', pattern: path('/items/:id/archive'), scope: 'write', handle: ({ memory, params }) => memory.items.archive(params[0]!) },
  { method: 'POST', pattern: path('/items/:id/unarchive'), scope: 'write', handle: ({ memory, params }) => memory.items.unarchive(params[0]!) },
  {
    method: 'POST', pattern: path('/items/:id/tags'), scope: 'write',
    handle: ({ memory, params, body }) => memory.items.tag(params[0]!, { add: strList(body, 'add'), remove: strList(body, 'remove') }),
  },

  {
    // The browser extension and share sheets post here: a URL becomes a bookmark, anything else a note.
    method: 'POST', pattern: path('/capture'), scope: 'capture', status: 201,
    handle: ({ memory, body }) => {
      const url = str(body, 'url');
      const note = captureNote(str(body, 'note'), str(body, 'selection'));
      const common = { title: str(body, 'title'), project: str(body, 'project'), tags: strList(body, 'tags') };
      if (url) return memory.items.saveLink({ ...common, url, note });
      return { item: memory.items.saveNote({ ...common, body: note ?? '' }), created: true };
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
        { project: query.get('project') ?? undefined, status: query.get('status') ?? undefined, tag: query.get('tag') ?? undefined },
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
