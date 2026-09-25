import type { EnveMemory } from '@enve-memory/core';
import { type ImportResult, emptyResult, record } from './result.ts';

export interface Bookmark {
  url: string;
  title: string;
  addedAt?: string;
  folders: string[];
  tags: string[];
}

// Browser-provided root folders carry no meaning as tags.
const ROOT_FOLDERS = new Set(['bookmarks bar', 'bookmarks toolbar', 'bookmarks menu', 'other bookmarks', 'mobile bookmarks', 'favorites', 'favourites bar', 'bookmarks']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) =>
    code[0] === '#'
      ? String.fromCodePoint(code[1]!.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1)))
      : ENTITIES[code.toLowerCase()] ?? whole);

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
const attr = (tag: string, name: string) => {
  const m = attribute(tag, name);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
};
const text = (html: string) => decode(html.replace(/<[^>]*>/g, '')).trim();

/**
 * Parses the Netscape bookmark file every browser exports (Chrome, Edge, Firefox, Safari). Its <DT> and <p> tags are
 * never closed, which HTML parsers nest unpredictably, so this scans tokens: an <H3> names the next <DL>, and </DL> ends it.
 */
export function parseBookmarksHtml(html: string): Bookmark[] {
  const bookmarks: Bookmark[] = [];
  const stack: (string | null)[] = [];
  let pendingFolder: string | null = null;
  const tokens = /<h3\b[^>]*>([\s\S]*?)<\/h3>|<dl\b[^>]*>|<\/dl>|(<a\b[^>]*>)([\s\S]*?)<\/a>/gi;
  for (const [token, heading, anchor, title] of html.matchAll(tokens)) {
    if (heading !== undefined) {
      pendingFolder = text(heading);
    } else if (/^<dl/i.test(token)) {
      stack.push(pendingFolder);
      pendingFolder = null;
    } else if (/^<\/dl/i.test(token)) {
      stack.pop();
    } else if (anchor) {
      const url = attr(anchor, 'href') ?? '';
      if (!/^https?:/i.test(url)) continue;
      const added = Number(attr(anchor, 'add_date'));
      bookmarks.push({
        url,
        title: text(title ?? ''),
        addedAt: added > 0 ? new Date(added * 1000).toISOString() : undefined,
        folders: stack.filter((f): f is string => f !== null),
        tags: (attr(anchor, 'tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      });
    }
  }
  return bookmarks;
}

export interface BookmarkImportOptions {
  project?: string;
  /** Turn folder names into tags (default true). */
  folderTags?: boolean;
  /** Fetch and archive every page (default false: hundreds of pages at once is rarely wanted). */
  archive?: boolean;
}

export function importBookmarks(memory: EnveMemory, html: string, options: BookmarkImportOptions = {}): ImportResult {
  const result = emptyResult();
  memory.withActor('import:bookmarks', () => {
    for (const bookmark of parseBookmarksHtml(html)) {
      const folderTags = options.folderTags === false ? [] : bookmark.folders.filter((f) => !ROOT_FOLDERS.has(f.toLowerCase()));
      record(result, bookmark.url, () =>
        memory.items.saveLink({
          url: bookmark.url,
          title: bookmark.title,
          project: options.project,
          tags: [...folderTags, ...bookmark.tags],
          ingest: options.archive ?? false,
        }).created,
      );
    }
  });
  return result;
}
