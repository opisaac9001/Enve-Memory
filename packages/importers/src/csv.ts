import type { EnveMemory } from '@enve-memory/core';
import { type ImportResult, emptyResult, record } from './result.ts';

/** RFC 4180: quoted fields, doubled quotes, and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

const COLUMNS = {
  url: ['url', 'link', 'href', 'address'],
  title: ['title', 'name'],
  note: ['note', 'notes', 'description', 'excerpt', 'comment'],
  tags: ['tags', 'tag', 'labels'],
  folder: ['folder', 'collection', 'category', 'list'],
  created: ['created', 'created_at', 'date', 'added', 'time_added'],
};

/** Bookmark exports as CSV (Raindrop, Pinboard, Instapaper, spreadsheets). Columns are matched by common header names. */
export function importCsv(memory: EnveMemory, text: string, options: { project?: string } = {}): ImportResult {
  const result = emptyResult();
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  if (!header) return result;
  const names = header.map((h) => h.trim().toLowerCase());
  const column = (keys: string[]) => names.findIndex((n) => keys.includes(n));
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([key, keys]) => [key, column(keys)])) as Record<keyof typeof COLUMNS, number>;
  if (at.url < 0) throw new Error('The CSV needs a "url" (or "link") column.');
  memory.withActor('import:csv', () => {
    rows.forEach((row, index) => {
      const cell = (i: number) => (i >= 0 ? row[i]?.trim() ?? '' : '');
      const url = cell(at.url);
      record(result, url || `row ${index + 2}`, () => {
        if (!/^https?:\/\//i.test(url)) throw new Error(`Row ${index + 2} has no http(s) URL.`);
        const tags = [...cell(at.tags).split(/[,;|]|\s{2,}/), cell(at.folder)].map((t) => t.trim()).filter((t) => t && t.toLowerCase() !== 'unsorted');
        return memory.items.saveLink({
          url, title: cell(at.title), note: cell(at.note), project: options.project, tags, ingest: false,
        }).created;
      });
    });
  });
  return result;
}
