import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import { blobPath, removeBlobIfUnused } from './blobs.ts';
import { type Context, newId } from './context.ts';
import { invalid } from './errors.ts';
import type { ItemService } from './items.ts';
import type { SettingsService } from './settings.ts';
import type { Change } from './types.ts';

type Entity = Change['entity'];

interface ItemState {
  item: Record<string, SQLInputValue>;
  task: Record<string, SQLInputValue> | null;
  tags: string[];
  attachments: Record<string, SQLInputValue>[];
}

/** One line of a segment file: an entity's full state (null = deleted) at a clock stamp. */
export interface SyncRecord {
  entity: Entity;
  id: string;
  hlc: string;
  /** The version the writing device had last exchanged before editing; lets the reader spot concurrent edits. */
  base: string | null;
  device: string;
  actor: string;
  state: ItemState | Record<string, SQLInputValue> | null;
}

export interface SyncResult {
  exported: number;
  imported: number;
  conflicts: number;
  devices: number;
}

const ITEM_FIELDS = ['id', 'type', 'title', 'body', 'url', 'content', 'metadata', 'project_id', 'source', 'created_at', 'updated_at', 'archived_at'];
const PROJECT_FIELDS = ['id', 'name', 'slug', 'description', 'instructions', 'memory', 'status', 'created_at', 'updated_at'];
const APPLY_ORDER: Record<Entity, number> = { project: 0, item: 1, relation: 2 };
const EXPORTED_SEQ = 'sync.exported_seq';

/**
 * Folder sync between devices (iCloud Drive, Dropbox, Syncthing, a network share). Each device appends
 * segments to its own subfolder, so cloud providers never see two writers on one file. Entities converge
 * by newest clock stamp; when two devices edited the same note or project memory between syncs, the
 * losing text is kept as a "conflicting edit" note instead of disappearing.
 */
export class SyncService {
  private readonly ctx: Context;
  private readonly items: ItemService;
  private readonly settings: SettingsService;

  constructor(ctx: Context, items: ItemService, settings: SettingsService) {
    this.ctx = ctx;
    this.items = items;
    this.settings = settings;
  }

  run(folder = this.settings.get('syncFolder')): SyncResult {
    if (!folder) throw invalid('Choose a sync folder first.');
    if (!this.ctx.attachmentsDir) throw invalid('In-memory libraries cannot sync.');
    const dir = join(folder, 'devices', this.ctx.deviceId);
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(folder, 'blobs'), { recursive: true });
    writeFileSync(join(dir, 'device.json'), JSON.stringify({ deviceId: this.ctx.deviceId, name: hostname(), lastSync: this.ctx.now() }));
    let exported = this.export(folder);
    const { imported, conflicts, devices } = this.import(folder);
    // Conflict notes made while importing go out now rather than on the next run.
    exported += this.export(folder);
    this.fetchMissingBlobs(folder);
    return { exported, imported, conflicts, devices };
  }

  private export(folder: string): number {
    const cursor = Number(this.ctx.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, EXPORTED_SEQ)?.value ?? 0);
    const changed = this.ctx.all<{ entity: Entity; entity_id: string; seq: number; actor: string }>(
      `SELECT entity, entity_id, max(seq) AS seq, actor FROM changes
       WHERE seq > ? AND device_id = ? GROUP BY entity, entity_id ORDER BY max(seq)`,
      cursor, this.ctx.deviceId,
    );
    if (changed.length === 0) return 0;
    const records: SyncRecord[] = changed.map((c) => {
      const version = this.ctx.get<{ hlc: string; synced: string | null }>(
        `SELECT hlc, synced FROM sync_versions WHERE entity = ? AND entity_id = ?`, c.entity, c.entity_id,
      )!;
      const state = this.read(c.entity, c.entity_id);
      if (c.entity === 'item' && state) this.exportBlobs(folder, state as ItemState);
      return { entity: c.entity, id: c.entity_id, hlc: version.hlc, base: version.synced, device: this.ctx.deviceId, actor: c.actor, state };
    });
    const lastSeq = Math.max(...changed.map((c) => c.seq));
    const dir = join(folder, 'devices', this.ctx.deviceId);
    const name = `${String(lastSeq).padStart(12, '0')}.ndjson`;
    // Write then rename, so a reader never sees half a segment from this device.
    writeFileSync(join(dir, `.${name}.tmp`), `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
    renameSync(join(dir, `.${name}.tmp`), join(dir, name));
    this.ctx.tx(() => {
      for (const r of records) {
        this.ctx.run(`UPDATE sync_versions SET synced = hlc WHERE entity = ? AND entity_id = ?`, r.entity, r.id);
      }
      this.ctx.run(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        EXPORTED_SEQ, String(lastSeq),
      );
    });
    return records.length;
  }

  private import(folder: string): { imported: number; conflicts: number; devices: number } {
    const devicesDir = join(folder, 'devices');
    const others = readdirSync(devicesDir).filter((d) => d !== this.ctx.deviceId && existsSync(join(devicesDir, d, 'device.json')));
    let imported = 0;
    let conflicts = 0;
    for (const device of others) {
      const cursor = this.ctx.get<{ segment: string }>(`SELECT segment FROM sync_cursors WHERE device_id = ?`, device)?.segment ?? '';
      const segments = readdirSync(join(devicesDir, device)).filter((f) => /^\d{12}\.ndjson$/.test(f) && f > cursor).sort();
      for (const segment of segments) {
        let records: SyncRecord[];
        try {
          records = readFileSync(join(devicesDir, device, segment), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as SyncRecord);
        } catch {
          // A cloud folder can deliver a file before it's complete; try again next run.
          break;
        }
        records.sort((a, b) => APPLY_ORDER[a.entity] - APPLY_ORDER[b.entity] || a.hlc.localeCompare(b.hlc));
        this.ctx.tx(() => {
          for (const record of records) {
            const outcome = this.apply(record);
            if (outcome !== 'skipped') imported++;
            if (outcome === 'conflict') conflicts++;
          }
          this.ctx.run(
            `INSERT INTO sync_cursors (device_id, segment) VALUES (?, ?) ON CONFLICT (device_id) DO UPDATE SET segment = excluded.segment`,
            device, segment,
          );
        });
      }
    }
    return { imported, conflicts, devices: others.length };
  }

  private apply(record: SyncRecord): 'applied' | 'conflict' | 'skipped' {
    this.ctx.observe(record.hlc);
    const local = this.ctx.get<{ hlc: string }>(`SELECT hlc FROM sync_versions WHERE entity = ? AND entity_id = ?`, record.entity, record.id);
    if (local && local.hlc >= record.hlc) return 'skipped';
    // The writer hadn't seen our latest version: both sides changed it since they last agreed.
    const concurrent = local !== undefined && record.base !== local.hlc;
    const preserved = concurrent ? this.preserveLosingText(record) : false;

    const origin = { deviceId: record.device, actor: record.actor, hlc: record.hlc };
    if (record.entity === 'item') this.applyItem(record.id, record.state as ItemState | null);
    else if (record.entity === 'project') this.applyProject(record.state as Record<string, SQLInputValue> | null);
    else this.applyRelation(record.state as Record<string, SQLInputValue> | null);
    const projectId = record.entity === 'item' ? ((record.state as ItemState | null)?.item.project_id as string | null) ?? null
      : record.entity === 'project' ? record.id : null;
    this.ctx.record(record.entity, record.id, record.state ? 'sync' : 'delete', projectId, null, origin);
    return preserved ? 'conflict' : 'applied';
  }

  /** Keeps our side of a concurrent edit to a note body or a project memory as its own note. */
  private preserveLosingText(record: SyncRecord): boolean {
    if (record.entity === 'item') {
      const mine = this.ctx.get<{ title: string; body: string; project_id: string | null; type: string }>(
        `SELECT title, body, project_id, type FROM items WHERE id = ?`, record.id,
      );
      const theirs = (record.state as ItemState | null)?.item;
      if (!mine || !mine.body || mine.body === theirs?.body) return false;
      const copy = this.items.insert({
        type: 'note',
        title: `Conflicting edit of ${mine.title || 'an untitled note'}`,
        body: mine.body,
        project: mine.project_id ?? undefined,
      });
      if (theirs) this.items.link(copy, record.id, 'related_to', mine.project_id);
      return true;
    }
    if (record.entity === 'project') {
      const mine = this.ctx.get<{ name: string; memory: string }>(`SELECT name, memory FROM projects WHERE id = ?`, record.id);
      const theirs = record.state as Record<string, SQLInputValue> | null;
      if (!mine || !mine.memory || mine.memory === theirs?.memory) return false;
      this.items.insert({ type: 'note', title: `Conflicting edit of the ${mine.name} memory`, body: mine.memory, project: record.id });
      return true;
    }
    return false;
  }

  private read(entity: Entity, id: string): SyncRecord['state'] {
    if (entity === 'project') {
      return this.ctx.get<Record<string, SQLInputValue>>(`SELECT ${PROJECT_FIELDS.join(', ')} FROM projects WHERE id = ?`, id) ?? null;
    }
    if (entity === 'relation') {
      return this.ctx.get<Record<string, SQLInputValue>>(`SELECT id, from_id, to_id, kind, created_at FROM relations WHERE id = ?`, id) ?? null;
    }
    const item = this.ctx.get<Record<string, SQLInputValue>>(`SELECT ${ITEM_FIELDS.join(', ')} FROM items WHERE id = ?`, id);
    if (!item) return null;
    return {
      item: { ...item },
      task: this.ctx.get<Record<string, SQLInputValue>>(`SELECT status, priority, due_at, completed_at FROM tasks WHERE item_id = ?`, id) ?? null,
      tags: this.ctx.all<{ name: string }>(
        `SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name`, id,
      ).map((r) => r.name),
      attachments: this.ctx.all<Record<string, SQLInputValue>>(
        `SELECT id, sha256, filename, mime_type, size, created_at FROM attachments WHERE item_id = ?`, id,
      ),
    };
  }

  private applyItem(id: string, state: ItemState | null): void {
    if (!state) {
      const blobs = this.ctx.all<{ sha256: string }>(`SELECT sha256 FROM attachments WHERE item_id = ?`, id);
      this.ctx.run(`DELETE FROM items WHERE id = ?`, id);
      for (const { sha256 } of blobs) removeBlobIfUnused(this.ctx, sha256);
      return;
    }
    const item = { ...state.item };
    if (item.project_id && !this.ctx.get(`SELECT 1 FROM projects WHERE id = ?`, item.project_id)) item.project_id = null;
    this.upsert('items', ITEM_FIELDS, item);
    if (state.task) {
      this.ctx.run(
        `INSERT INTO tasks (item_id, status, priority, due_at, completed_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (item_id) DO UPDATE SET status = excluded.status, priority = excluded.priority, due_at = excluded.due_at, completed_at = excluded.completed_at`,
        id, state.task.status!, state.task.priority!, state.task.due_at ?? null, state.task.completed_at ?? null,
      );
    } else {
      this.ctx.run(`DELETE FROM tasks WHERE item_id = ?`, id);
    }
    this.ctx.run(`DELETE FROM item_tags WHERE item_id = ?`, id);
    const now = this.ctx.now();
    for (const name of state.tags) {
      this.ctx.run(`INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING`, newId(), name, now);
      this.ctx.run(`INSERT INTO item_tags (item_id, tag_id, created_at) SELECT ?, id, ? FROM tags WHERE name = ?`, id, now, name);
    }
    const keep = new Set(state.attachments.map((a) => a.id as string));
    for (const old of this.ctx.all<{ id: string; sha256: string }>(`SELECT id, sha256 FROM attachments WHERE item_id = ?`, id)) {
      if (keep.has(old.id)) continue;
      this.ctx.run(`DELETE FROM attachments WHERE id = ?`, old.id);
      removeBlobIfUnused(this.ctx, old.sha256);
    }
    for (const attachment of state.attachments) this.upsert('attachments', ['id', 'item_id', 'sha256', 'filename', 'mime_type', 'size', 'created_at'], { ...attachment, item_id: id });
  }

  private applyProject(state: Record<string, SQLInputValue> | null): void {
    if (!state) return;
    const project = { ...state };
    // Two devices can each create "Garage" before they first sync; keep both rather than merging blindly.
    const clash = this.ctx.get<{ id: string }>(`SELECT id FROM projects WHERE slug = ? AND id != ?`, project.slug!, project.id!);
    if (clash) {
      let n = 2;
      while (this.ctx.get(`SELECT 1 FROM projects WHERE slug = ?`, `${project.slug}-${n}`)) n++;
      project.slug = `${project.slug}-${n}`;
      project.name = `${project.name} (${n})`;
    }
    this.upsert('projects', PROJECT_FIELDS, project);
  }

  private applyRelation(state: Record<string, SQLInputValue> | null): void {
    if (!state) return;
    const bothExist = this.ctx.get(`SELECT count(*) AS n FROM items WHERE id IN (?, ?)`, state.from_id!, state.to_id!) as { n: number };
    if (bothExist.n < 2) return;
    this.ctx.run(
      `INSERT INTO relations (id, from_id, to_id, kind, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      state.id!, state.from_id!, state.to_id!, state.kind!, state.created_at!,
    );
  }

  private upsert(table: string, fields: string[], row: Record<string, SQLInputValue>): void {
    const updates = fields.filter((f) => f !== 'id').map((f) => `${f} = excluded.${f}`).join(', ');
    this.ctx.run(
      `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
      ...fields.map((f) => row[f] ?? null),
    );
  }

  private exportBlobs(folder: string, state: ItemState): void {
    for (const attachment of state.attachments) {
      const target = join(folder, 'blobs', attachment.sha256 as string);
      const source = blobPath(this.ctx, attachment.sha256 as string);
      if (!existsSync(target) && existsSync(source)) {
        copyFileSync(source, `${target}.tmp`);
        renameSync(`${target}.tmp`, target);
      }
    }
  }

  /** Attachment rows can arrive before their bytes do; fill them in whenever the folder has them. */
  private fetchMissingBlobs(folder: string): void {
    for (const { sha256 } of this.ctx.all<{ sha256: string }>(`SELECT DISTINCT sha256 FROM attachments`)) {
      const local = blobPath(this.ctx, sha256);
      const remote = join(folder, 'blobs', sha256);
      if (existsSync(local) || !existsSync(remote)) continue;
      mkdirSync(join(local, '..'), { recursive: true });
      copyFileSync(remote, `${local}.tmp`);
      renameSync(`${local}.tmp`, local);
    }
  }
}
