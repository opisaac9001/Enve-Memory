import { isCapturableUrl } from './api.js';

export const IMPORT_CHUNK = 500;

/** The server's tag normalization, so every folder name sent is a usable tag. */
export function folderTag(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

/**
 * Flattens `bookmarks.getTree()` into capture bodies. Folder names become tags, except the browser's own top-level
 * folders (Bookmarks bar, Other bookmarks…), which are skipped by position so it works in every language and browser.
 * Only web pages are kept, and a page filed in several folders is sent once with all their tags and its earliest date,
 * which the server applies only to bookmarks it creates.
 */
export function bookmarkEntries(tree) {
  const byUrl = new Map();
  const walk = (node, tags, depth) => {
    if (node.url) {
      if (!isCapturableUrl(node.url)) return;
      const url = new URL(node.url).href;
      const entry = byUrl.get(url) ?? { url, title: node.title?.trim() ?? '', tags: new Set(), added: Infinity };
      for (const tag of tags) entry.tags.add(tag);
      if (node.dateAdded < entry.added) entry.added = node.dateAdded;
      byUrl.set(url, entry);
      return;
    }
    const tag = depth >= 2 ? folderTag(node.title) : '';
    for (const child of node.children ?? []) walk(child, tag ? [...tags, tag] : tags, depth + 1);
  };
  for (const root of tree) walk(root, [], 0);
  return [...byUrl.values()].map(({ url, title, tags, added }) => ({
    url,
    ...(title ? { title } : {}),
    ...(tags.size ? { tags: [...tags] } : {}),
    ...(Number.isFinite(added) ? { createdAt: new Date(added).toISOString() } : {}),
  }));
}

export function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

/**
 * Sends entries in chunks, one Idempotency-Key per chunk so a retried import never double-counts. Stops at the first
 * failed request and returns the totals so far along with the error.
 */
export async function importEntries(client, entries, { runId = crypto.randomUUID(), size = IMPORT_CHUNK, onProgress } = {}) {
  const totals = { total: entries.length, done: 0, created: 0, skipped: 0, failed: 0, errors: [] };
  const chunks = chunk(entries, size);
  for (const [index, items] of chunks.entries()) {
    try {
      const result = await client.captureBatch(items, { idempotencyKey: `import-${runId}-${index}` });
      totals.created += result.created;
      totals.skipped += result.skipped;
      totals.failed += result.failed;
      result.results.forEach((r, i) => r.error && totals.errors.push({ url: items[i].url, message: r.error }));
      totals.done += items.length;
      onProgress?.(totals);
    } catch (error) {
      return { ...totals, error };
    }
  }
  return totals;
}
