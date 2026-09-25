import { type Context, ITEM_COLUMNS, ITEM_JOINS, type ItemRow, toItem } from './context.ts';
import { invalid } from './errors.ts';
import { type ItemFilter, type ItemService, clampLimit } from './items.ts';
import type { SearchHit } from './types.ts';

// bm25 column weights for (title, body, url, content): the user's own words outrank extracted source text.
const RANK = 'bm25(items_fts, 10.0, 1.5, 2.0, 1.0)';

export class SearchService {
  private readonly ctx: Context;
  private readonly items: ItemService;

  constructor(ctx: Context, items: ItemService) {
    this.ctx = ctx;
    this.items = items;
  }

  query(text: string, filter: ItemFilter = {}, limit?: number): SearchHit[] {
    const match = toFtsQuery(text);
    if (!match) throw invalid('Search needs at least one word or number.');
    const { where, params } = this.items.filterClauses(filter);
    return this.ctx
      .all<ItemRow & { snippet: string }>(
        `SELECT ${ITEM_COLUMNS}, snippet(items_fts, -1, '[', ']', '…', 24) AS snippet
         FROM items_fts JOIN items i ON i.seq = items_fts.rowid ${ITEM_JOINS}
         WHERE items_fts MATCH ? ${where.map((w) => `AND ${w}`).join(' ')}
         ORDER BY ${RANK}, i.updated_at DESC
         LIMIT ?`,
        match, ...params, clampLimit(limit ?? 20),
      )
      .map((row) => {
        const item = toItem(row);
        return {
          id: item.id,
          type: item.type,
          title: item.title,
          url: item.url,
          project: item.project,
          snippet: row.snippet,
          taskStatus: row.task_status,
          updatedAt: item.updatedAt,
        };
      });
  }
}

/**
 * Free text → FTS5 query. Every term is quoted so user input can never be parsed as FTS syntax,
 * terms are OR'd so partial matches still surface (bm25 ranks fuller matches first), and the last
 * term is a prefix match so half-typed queries work.
 */
export function toFtsQuery(text: string): string | null {
  const terms = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  if (terms.length === 0) return null;
  return terms.map((term, i) => (i === terms.length - 1 ? `"${term}"*` : `"${term}"`)).join(' OR ');
}
