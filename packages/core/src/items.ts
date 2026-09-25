import type { SQLInputValue } from 'node:sqlite';
import {
  type Context, ITEM_COLUMNS, ITEM_FROM, type ItemRow, newId, normalizeTag, oneOf, required, toItem, toTaskFields,
} from './context.ts';
import { MemoryError, invalid, notFound } from './errors.ts';
import { type AttachmentRow, removeBlobIfUnused, toAttachment } from './blobs.ts';
import type { ProjectService } from './projects.ts';
import type { SettingsService } from './settings.ts';
import {
  type AiSuggestions, ITEM_TYPES, type Item, type ItemDetail, type ItemMetadata, type ItemType, RELATION_KINDS, type RelatedItem, type RelationKind,
} from './types.ts';

export interface ItemFilter {
  project?: string;
  type?: string;
  tag?: string;
  includeArchived?: boolean;
}

export interface NewItem {
  type: ItemType;
  title?: string;
  body?: string;
  url?: string | null;
  content?: string;
  metadata?: ItemMetadata;
  project?: string;
  tags?: string[];
}

export interface SourceUpdate {
  /** Applied only when the item has no title yet; the user's own title always wins. */
  title?: string;
  content?: string;
  metadata: ItemMetadata;
}

export interface SaveNoteInput {
  body: string;
  title?: string;
  project?: string;
  tags?: string[];
}

export interface SaveLinkInput {
  url: string;
  title?: string;
  note?: string;
  project?: string;
  tags?: string[];
  /** Fetch and extract the page afterwards. Defaults to the library's fetchLinks setting. */
  ingest?: boolean;
}

export interface UpdateItemInput {
  title?: string;
  body?: string;
  url?: string | null;
  project?: string | null;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw invalid('Limit must be a positive integer.');
  return Math.min(limit, MAX_LIMIT);
}

export class ItemService {
  private readonly ctx: Context;
  private readonly projects: ProjectService;

  private readonly settings: SettingsService;

  constructor(ctx: Context, projects: ProjectService, settings: SettingsService) {
    this.ctx = ctx;
    this.projects = projects;
    this.settings = settings;
  }

  saveNote(input: SaveNoteInput): ItemDetail {
    const body = required(input.body, 'Note text');
    return this.get(this.insert({ type: 'note', body, title: input.title, project: input.project, tags: input.tags }));
  }

  /**
   * Saving a URL that is already bookmarked returns the existing bookmark, appending any new note, adding any new tags,
   * and filing it into the given project if it has none. It never moves a bookmark out of a project it's already in.
   */
  saveLink(input: SaveLinkInput): { item: ItemDetail; created: boolean } {
    const url = parseUrl(input.url);
    const existing = this.findByUrl(url);
    if (existing) {
      this.ctx.tx(() => {
        const note = input.note?.trim();
        if (note) {
          const row = this.row(existing.id);
          if (!row.body.includes(note)) this.write(row, { body: row.body ? `${row.body}\n\n${note}` : note }, 'update');
        }
        if (input.tags?.length) this.tag(existing.id, { add: input.tags });
        if (input.project && !existing.project) {
          this.write(this.row(existing.id), { project_id: this.projects.resolve(input.project).id }, 'update');
        }
      });
      return { item: this.get(existing.id), created: false };
    }
    const id = this.insert({
      type: 'bookmark', url, title: input.title, body: input.note, project: input.project, tags: input.tags,
      metadata: (input.ingest ?? this.settings.get('fetchLinks')) ? { ingest: { status: 'pending' } } : {},
    });
    return { item: this.get(id), created: true };
  }

  /** The active bookmark for a URL, if one exists. */
  findByUrl(url: string): ItemDetail | null {
    const row = this.ctx.get<{ id: string }>(
      `SELECT id FROM items WHERE type = 'bookmark' AND url = ? AND archived_at IS NULL ORDER BY seq LIMIT 1`, parseUrl(url),
    );
    return row ? this.get(row.id) : null;
  }

  /** Low-level create shared by the typed services. Returns the new item's id. */
  insert(input: NewItem): string {
    const projectId = input.project ? this.projects.resolve(input.project).id : null;
    const tags = (input.tags ?? []).map(normalizeTag);
    const id = newId();
    const now = this.ctx.now();
    const title = input.title?.trim() ?? '';
    const body = input.body?.trim() ?? '';
    const url = input.url ?? null;
    const content = input.content ?? '';
    const metadata = input.metadata ?? {};
    this.ctx.tx(() => {
      this.ctx.run(
        `INSERT INTO items (id, type, title, body, url, content, metadata, project_id, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, input.type, title, body, url, content, JSON.stringify(metadata), projectId, this.ctx.actor, now, now,
      );
      this.ctx.record('item', id, 'create', projectId, { type: input.type, title, body, url, content, metadata, projectId });
      if (tags.length) this.applyTags(id, projectId, tags, []);
    });
    return id;
  }

  get(id: string): ItemDetail {
    const row = this.row(id);
    const tags = this.ctx
      .all<{ name: string }>(
        `SELECT tg.name FROM item_tags it JOIN tags tg ON tg.id = it.tag_id WHERE it.item_id = ? ORDER BY tg.name`, row.id,
      )
      .map((r) => r.name);
    const relations = this.ctx
      .all<{ kind: RelationKind; direction: RelatedItem['direction']; id: string; type: ItemType; title: string }>(
        `SELECT r.kind, 'outgoing' AS direction, i.id, i.type, i.title
           FROM relations r JOIN items i ON i.id = r.to_id WHERE r.from_id = ?
         UNION ALL
         SELECT r.kind, 'incoming' AS direction, i.id, i.type, i.title
           FROM relations r JOIN items i ON i.id = r.from_id WHERE r.to_id = ?`,
        row.id, row.id,
      )
      .map((r) => ({ kind: r.kind, direction: r.direction, id: r.id, type: r.type, title: r.title }));
    const { content } = this.ctx.get<{ content: string }>(`SELECT content FROM items WHERE id = ?`, row.id)!;
    const attachments = this.ctx
      .all<AttachmentRow>(`SELECT * FROM attachments WHERE item_id = ? ORDER BY created_at`, row.id)
      .map(toAttachment);
    return { ...toItem(row), content, attachments, tags, task: toTaskFields(row), relations };
  }

  /** Records what ingestion extracted from the item's source. Metadata is merged shallowly. */
  setSource(id: string, update: SourceUpdate): ItemDetail {
    const row = this.row(id);
    const changes: Record<string, SQLInputValue> = {
      metadata: JSON.stringify({ ...(JSON.parse(row.metadata) as ItemMetadata), ...update.metadata }),
    };
    if (update.content !== undefined) changes.content = update.content;
    if (update.title?.trim() && !row.title) changes.title = update.title.trim();
    this.write(row, changes, 'ingest', { ...changes, metadata: update.metadata });
    return this.get(row.id);
  }

  /** Records AI suggestions (summary, tags, project) for an item without applying them. */
  suggest(id: string, ai: AiSuggestions): ItemDetail {
    const row = this.row(id);
    const metadata = { ...(JSON.parse(row.metadata) as ItemMetadata), ai };
    this.write(row, { metadata: JSON.stringify(metadata) }, 'enrich', { ai });
    return this.get(row.id);
  }

  /** Applies an item's suggested tags, and its suggested project when it has none. */
  acceptSuggestions(id: string): ItemDetail {
    const item = this.get(id);
    const ai = item.metadata.ai;
    if (!ai || ai.status !== 'done') throw invalid('This item has no suggestions to accept.');
    this.ctx.tx(() => {
      if (ai.tags?.length) this.tag(item.id, { add: ai.tags });
      if (ai.project && !item.project) this.update(item.id, { project: ai.project.id });
      const row = this.row(item.id);
      this.write(row, { metadata: JSON.stringify({ ...(JSON.parse(row.metadata) as ItemMetadata), ai: { ...ai, accepted: true } }) }, 'accept');
    });
    return this.get(item.id);
  }

  /** Saved since `since`, readable, and not yet enriched; oldest first. */
  pendingEnrichment(since: string, limit = 20): string[] {
    if (!since) return [];
    return this.ctx
      .all<{ id: string }>(
        `SELECT id FROM items
         WHERE created_at >= ? AND archived_at IS NULL AND type IN ('note', 'bookmark', 'file', 'image')
           AND json_extract(metadata, '$.ai') IS NULL
           AND coalesce(json_extract(metadata, '$.ingest.status'), 'done') != 'pending'
         ORDER BY seq LIMIT ?`,
        since, limit,
      )
      .map((r) => r.id);
  }

  /** Queues failed fetches/extractions for another attempt. Returns how many. */
  retryFailedIngest(): number {
    const failed = this.ctx.all<{ id: string }>(`SELECT id FROM items WHERE json_extract(metadata, '$.ingest.status') = 'failed'`);
    for (const { id } of failed) this.setSource(id, { metadata: { ingest: { status: 'pending' } } });
    return failed.length;
  }

  /** Oldest first, so a backlog drains in the order things were saved. */
  pendingIngest(limit = 20): string[] {
    return this.ctx
      .all<{ id: string }>(
        `SELECT id FROM items WHERE json_extract(metadata, '$.ingest.status') = 'pending' AND archived_at IS NULL ORDER BY seq LIMIT ?`,
        limit,
      )
      .map((r) => r.id);
  }

  list(filter: ItemFilter = {}, limit?: number): Item[] {
    const { where, params } = this.filterClauses(filter);
    return this.ctx
      .all<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY i.updated_at DESC, i.seq DESC LIMIT ?`,
        ...params, clampLimit(limit),
      )
      .map(toItem);
  }

  update(id: string, input: UpdateItemInput): ItemDetail {
    const row = this.row(id);
    assertMutable(row);
    const changes: Record<string, SQLInputValue> = {};
    if (input.title !== undefined) changes.title = input.title.trim();
    if (input.body !== undefined) changes.body = input.body.trim();
    if (input.url !== undefined) changes.url = input.url === null ? null : parseUrl(input.url);
    if (input.project !== undefined) {
      changes.project_id = input.project === null ? null : this.projects.resolve(input.project).id;
    }
    if (row.type === 'bookmark' && changes.url === null) throw invalid('A bookmark needs a URL.');
    this.write(row, changes, 'update');
    return this.get(row.id);
  }

  archive(id: string): ItemDetail {
    const row = this.row(id);
    assertMutable(row);
    if (row.archived_at === null) this.write(row, { archived_at: this.ctx.now() }, 'archive');
    return this.get(row.id);
  }

  unarchive(id: string): ItemDetail {
    const row = this.row(id);
    if (row.archived_at !== null) this.write(row, { archived_at: null }, 'unarchive');
    return this.get(row.id);
  }

  /** Permanent. Only exposed to the user directly, never to AI clients. */
  delete(id: string): void {
    const row = this.row(id);
    const blobs = this.ctx.all<{ sha256: string }>(`SELECT sha256 FROM attachments WHERE item_id = ?`, row.id);
    this.ctx.tx(() => {
      this.ctx.run(`DELETE FROM items WHERE id = ?`, row.id);
      this.ctx.record('item', row.id, 'delete', row.project_id, { type: row.type, title: row.title });
    });
    for (const { sha256 } of blobs) removeBlobIfUnused(this.ctx, sha256);
  }

  tag(id: string, { add = [], remove = [] }: { add?: string[]; remove?: string[] }): ItemDetail {
    const row = this.row(id);
    const added = add.map(normalizeTag);
    const removed = remove.map(normalizeTag);
    if (added.length || removed.length) {
      this.ctx.tx(() => {
        this.applyTags(row.id, row.project_id, added, removed);
        this.touch(row.id);
      });
    }
    return this.get(row.id);
  }

  relate(fromId: string, toId: string, kind: string): ItemDetail {
    const from = this.row(fromId);
    const to = this.row(toId);
    const relationKind = oneOf(kind, RELATION_KINDS, 'relation kind');
    if (from.id === to.id) throw invalid('An item cannot relate to itself.');
    this.link(from.id, to.id, relationKind, from.project_id);
    return this.get(from.id);
  }

  link(fromId: string, toId: string, kind: RelationKind, projectId: string | null): void {
    this.ctx.tx(() => {
      const exists = this.ctx.get(
        `SELECT 1 FROM relations WHERE from_id = ? AND to_id = ? AND kind = ?`, fromId, toId, kind,
      );
      if (exists) return;
      const id = newId();
      this.ctx.run(
        `INSERT INTO relations (id, from_id, to_id, kind, created_at) VALUES (?, ?, ?, ?, ?)`,
        id, fromId, toId, kind, this.ctx.now(),
      );
      this.ctx.record('relation', id, 'create', projectId, { from: fromId, to: toId, kind });
    });
  }

  row(id: string): ItemRow {
    const row = this.ctx.get<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM} WHERE i.id = ?`, required(id, 'Item id'));
    if (!row) throw notFound(`No item with id "${id}".`);
    return row;
  }

  write(row: ItemRow, changes: Record<string, SQLInputValue>, op: string, data: object = changes): void {
    if (Object.keys(data).length === 0) return;
    this.ctx.tx(() => {
      this.ctx.run(
        `UPDATE items SET ${[...Object.keys(changes), 'updated_at'].map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
        ...Object.values(changes), this.ctx.now(), row.id,
      );
      const projectId = 'project_id' in changes ? (changes.project_id as string | null) : row.project_id;
      this.ctx.record('item', row.id, op, projectId, data);
    });
  }

  filterClauses(filter: ItemFilter): { where: string[]; params: SQLInputValue[] } {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (!filter.includeArchived) where.push('i.archived_at IS NULL');
    if (filter.project !== undefined) {
      where.push('i.project_id = ?');
      params.push(this.projects.resolve(filter.project).id);
    }
    if (filter.type !== undefined) {
      where.push('i.type = ?');
      params.push(oneOf(filter.type, ITEM_TYPES, 'item type'));
    }
    if (filter.tag !== undefined) {
      where.push('EXISTS (SELECT 1 FROM item_tags it JOIN tags tg ON tg.id = it.tag_id WHERE it.item_id = i.id AND tg.name = ?)');
      params.push(normalizeTag(filter.tag));
    }
    return { where, params };
  }

  private touch(id: string): void {
    this.ctx.run(`UPDATE items SET updated_at = ? WHERE id = ?`, this.ctx.now(), id);
  }

  private applyTags(itemId: string, projectId: string | null, add: string[], remove: string[]): void {
    const now = this.ctx.now();
    for (const name of add) {
      this.ctx.run(`INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING`, newId(), name, now);
      this.ctx.run(
        `INSERT INTO item_tags (item_id, tag_id, created_at)
         SELECT ?, id, ? FROM tags WHERE name = ? ON CONFLICT DO NOTHING`,
        itemId, now, name,
      );
    }
    for (const name of remove) {
      this.ctx.run(`DELETE FROM item_tags WHERE item_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)`, itemId, name);
    }
    this.ctx.record('item', itemId, 'tag', projectId, { add, remove });
  }
}

function assertMutable(row: ItemRow): void {
  if (row.type === 'decision') {
    throw new MemoryError('invalid', 'Decisions are append-only. Record a new decision that supersedes this one instead.');
  }
}

function parseUrl(value: string): string {
  const trimmed = required(value, 'URL');
  try {
    return new URL(trimmed).href;
  } catch {
    throw invalid(`"${trimmed}" is not a valid URL.`);
  }
}
