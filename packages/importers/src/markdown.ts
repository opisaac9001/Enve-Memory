import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { EnveMemory } from '@enve-memory/core';
import { type ImportResult, emptyResult, record } from './result.ts';

export interface MarkdownNote {
  path: string;
  title: string;
  body: string;
  tags: string[];
  createdAt?: string;
}

/** Just enough YAML for note front matter: scalars, `[a, b]` lists and `- item` lists. */
export function parseFrontMatter(text: string): { data: Record<string, string | string[]>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of match[1]!.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]!));
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, value] = pair as unknown as [string, string, string];
    if (value === '') {
      data[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(value)) {
      data[key] = value.slice(1, -1).split(',').map((v) => unquote(v.trim())).filter(Boolean);
      listKey = null;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  }
  return { data, body: text.slice(match[0].length) };
}

const unquote = (value: string) => value.replace(/^["']|["']$/g, '');

export function parseMarkdownNote(path: string, text: string): MarkdownNote {
  const { data, body } = parseFrontMatter(text);
  const heading = /^#\s+(.+)$/m.exec(body);
  const listOf = (value: string | string[] | undefined) => (Array.isArray(value) ? value : value ? value.split(/[,\s]+/) : []);
  const inline = [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu)].map((m) => m[1]!);
  const created = typeof data.created === 'string' ? data.created : typeof data.date === 'string' ? data.date : undefined;
  return {
    path,
    title: (typeof data.title === 'string' && data.title) || heading?.[1]?.trim() || basename(path).replace(/\.md$/i, ''),
    body: body.trim(),
    tags: [...new Set([...listOf(data.tags), ...listOf(data.tag), ...inline].map((t) => t.replace(/^#/, '').replace(/\//g, '-')).filter(Boolean))],
    createdAt: created && !Number.isNaN(Date.parse(created)) ? new Date(Date.parse(created)).toISOString() : undefined,
  };
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return /\.(md|markdown)$/i.test(entry.name) ? [path] : [];
  });
}

/** Imports a folder of Markdown notes (an Obsidian vault, a notes directory). Re-running skips notes already imported. */
export function importMarkdownFolder(memory: EnveMemory, dir: string, options: { project?: string } = {}): ImportResult {
  const result = emptyResult();
  memory.withActor('import:markdown', () => {
    for (const path of markdownFiles(dir)) {
      const source = relative(dir, path);
      record(result, source, () => {
        const note = parseMarkdownNote(path, readFileSync(path, 'utf8'));
        if (!note.body) return false;
        if (memory.items.findImported('markdown', source)) return false;
        const id = memory.items.insert({
          type: 'note', title: note.title, body: note.body, project: options.project, tags: note.tags,
          createdAt: note.createdAt, metadata: { importedFrom: { kind: 'markdown', path: source } },
        });
        return Boolean(id);
      });
    }
  });
  return result;
}
