import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import { SHA256_PATTERN, blobPath, removeBlobIfUnused } from './blobs.ts';
import { type Context, HLC_PATTERN, newId, normalizeTag, slugify } from './context.ts';
import { invalid } from './errors.ts';
import type { ItemService } from './items.ts';
import type { SettingsService } from './settings.ts';
import { type Change, ITEM_TYPES, RELATION_KINDS } from './types.ts';

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
  /** Records from other devices that were malformed or failed to apply, and were skipped. */
  rejected: number;
  devices: number;
}

const ITEM_FIELDS = ['id', 'type', 'title', 'body', 'url', 'content', 'metadata', 'project_id', 'source', 'created_at', 'updated_at', 'archived_at'];
const PROJECT_FIELDS = ['id', 'name', 'slug', 'description', 'instructions', 'memory', 'status', 'created_at', 'updated_at'];
const APPLY_ORDER: Record<Entity, number> = { project: 0, item: 1, relation: 2 };
const EXPORTED_SEQ = 'sync.exported_seq';
const SEGMENT = /^\d{12}\.ndjson$/;
const DEVICE_ID = /^[\w-]{1,64}$/;
const KEY_SETTING = 'sync.key';
const MARKER = 'sync.json';
const VERIFIER = 'enve-memory sync key check';
// scrypt cost: ~64 MB and a fraction of a second, once per device.
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

interface Marker {
  version: 1;
  encryption: { kdf: 'scrypt'; salt: string; verifier: string } | null;
}

/** AES-256-GCM: 12-byte IV, 16-byte tag, then ciphertext. */
class Sealer {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    this.key = key;
  }

  /** `name` is bound in as associated data, so sealed files can't be swapped between names undetected. */
  seal(plain: Buffer, name: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(name));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  open(sealed: Buffer, name: string): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', this.key, sealed.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(sealed.subarray(12, 28));
    return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
  }
}

const deriveKey = (passphrase: string, salt: Buffer) => scryptSync(passphrase.normalize('NFKC'), salt, 32, SCRYPT);

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
  private sealer: Sealer | null = null;

  constructor(ctx: Context, items: ItemService, settings: SettingsService) {
    this.ctx = ctx;
    this.items = items;
    this.settings = settings;
  }

  /**
   * Encrypts everything this library puts in the folder. The first device to set a passphrase on an empty folder
   * creates its key; every other device must enter the same passphrase. An existing unencrypted folder can't be
   * converted in place: start a new, empty one.
   */
  setPassphrase(passphrase: string, folder = this.settings.get('syncFolder')): void {
    if (!folder) throw invalid('Choose a sync folder first.');
    if (passphrase.length < 8) throw invalid('Use a passphrase of at least 8 characters.');
    const marker = readMarker(folder);
    if (marker && !marker.encryption) {
      throw invalid('This folder already holds unencrypted sync data. Choose a new, empty folder for encrypted sync.');
    }
    let key: Buffer;
    if (marker?.encryption) {
      key = deriveKey(passphrase, Buffer.from(marker.encryption.salt, 'base64'));
      try {
        if (new Sealer(key).open(Buffer.from(marker.encryption.verifier, 'base64'), MARKER).toString() !== VERIFIER) throw new Error();
      } catch {
        throw invalid('That passphrase does not match the one this sync folder was set up with.');
      }
    } else {
      mkdirSync(folder, { recursive: true });
      const salt = randomBytes(16);
      key = deriveKey(passphrase, salt);
      const verifier = new Sealer(key).seal(Buffer.from(VERIFIER), MARKER).toString('base64');
      writeMarker(folder, { version: 1, encryption: { kdf: 'scrypt', salt: salt.toString('base64'), verifier } });
    }
    this.ctx.run(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      KEY_SETTING, key.toString('hex'),
    );
  }

  get encrypted(): boolean {
    return this.ctx.get(`SELECT 1 FROM settings WHERE key = ?`, KEY_SETTING) !== undefined;
  }

  /** Forgets the key (e.g. when stopping sync); the folder's data is untouched. */
  forgetKey(): void {
    this.ctx.run(`DELETE FROM settings WHERE key = ?`, KEY_SETTING);
  }

  private sealerFor(folder: string): Sealer | null {
    const marker = readMarker(folder);
    const hex = this.ctx.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, KEY_SETTING)?.value;
    if (!marker) {
      if (hex) throw invalid('The sync folder is missing its setup file. Set the passphrase again to reinitialize it.');
      mkdirSync(folder, { recursive: true });
      writeMarker(folder, { version: 1, encryption: null });
      return null;
    }
    if (marker.encryption && !hex) throw invalid('This sync folder is encrypted. Enter its passphrase to sync with it.');
    if (!marker.encryption && hex) throw invalid('This sync folder is not encrypted, but this library expects encryption. Choose the right folder or stop syncing.');
    return hex ? new Sealer(Buffer.from(hex, 'hex')) : null;
  }

  run(folder = this.settings.get('syncFolder')): SyncResult {
    if (!folder) throw invalid('Choose a sync folder first.');
    if (!this.ctx.attachmentsDir) throw invalid('In-memory libraries cannot sync.');
    this.sealer = this.sealerFor(folder);
    const dir = join(folder, 'devices', this.ctx.deviceId);
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(folder, 'blobs'), { recursive: true });
    writeFileSync(join(dir, 'device.json'), JSON.stringify({ deviceId: this.ctx.deviceId, name: hostname(), lastSync: this.ctx.now() }));
    let exported = this.export(folder);
    const { imported, conflicts, rejected, devices } = this.import(folder);
    // Conflict notes made while importing go out now rather than on the next run.
    exported += this.export(folder);
    this.fetchMissingBlobs(folder);
    return { exported, imported, conflicts, rejected, devices };
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
    // Names must only ever grow: after a backup restore the change sequence restarts lower, and peers only read
    // names past their cursor, so continue from the highest segment already in the folder.
    const highest = Math.max(0, ...readdirSync(dir).filter((f) => SEGMENT.test(f)).map((f) => Number(f.slice(0, 12))));
    const name = `${String(Math.max(lastSeq, highest + 1)).padStart(12, '0')}.ndjson`;
    // Write then rename, so a reader never sees half a segment from this device.
    writeFileSync(join(dir, `.${name}.tmp`), this.pack(Buffer.from(`${records.map((r) => JSON.stringify(r)).join('\n')}\n`), `${this.ctx.deviceId}/${name}`));
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

  /**
   * Reads every pending segment from every device, then applies them in one global order (projects, items, relations;
   * then clock order), so an item never lands before its project just because its device folder was read first.
   * Each record applies under its own savepoint: a malformed or failing record is skipped, never a blocker.
   */
  private import(folder: string): { imported: number; conflicts: number; rejected: number; devices: number } {
    const devicesDir = join(folder, 'devices');
    const others = readdirSync(devicesDir).filter((d) => d !== this.ctx.deviceId && DEVICE_ID.test(d) && existsSync(join(devicesDir, d, 'device.json')));
    const records: SyncRecord[] = [];
    const cursors = new Map<string, string>();
    let rejected = 0;
    for (const device of others) {
      const cursor = this.ctx.get<{ segment: string }>(`SELECT segment FROM sync_cursors WHERE device_id = ?`, device)?.segment ?? '';
      const segments = readdirSync(join(devicesDir, device)).filter((f) => SEGMENT.test(f) && f > cursor).sort();
      for (const segment of segments) {
        let lines: unknown[];
        try {
          lines = this.unpack(readFileSync(join(devicesDir, device, segment)), `${device}/${segment}`)
            .toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown);
        } catch {
          // A cloud folder can deliver a file before it's complete; try again next run.
          break;
        }
        for (const line of lines) {
          if (isRecord(line) && line.device === device) records.push(line);
          else rejected++;
        }
        cursors.set(device, segment);
      }
    }
    records.sort((a, b) => APPLY_ORDER[a.entity] - APPLY_ORDER[b.entity] || (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));

    let imported = 0;
    let conflicts = 0;
    this.ctx.tx(() => {
      for (const record of records) {
        this.ctx.db.exec('SAVEPOINT sync_record');
        try {
          const outcome = this.apply(record);
          this.ctx.db.exec('RELEASE sync_record');
          if (outcome !== 'skipped') imported++;
          if (outcome === 'conflict') conflicts++;
        } catch {
          this.ctx.db.exec('ROLLBACK TO sync_record');
          this.ctx.db.exec('RELEASE sync_record');
          rejected++;
        }
      }
      this.resolvePending();
      for (const [device, segment] of cursors) {
        this.ctx.run(
          `INSERT INTO sync_cursors (device_id, segment) VALUES (?, ?) ON CONFLICT (device_id) DO UPDATE SET segment = excluded.segment`,
          device, segment,
        );
      }
    });
    return { imported, conflicts, rejected, devices: others.length };
  }

  /** Links references whose targets have since arrived. */
  private resolvePending(): void {
    for (const pending of this.ctx.all<{ kind: string; key: string; payload: string }>(`SELECT * FROM sync_pending`)) {
      const payload = JSON.parse(pending.payload) as Record<string, string>;
      if (pending.kind === 'item_project') {
        const item = this.ctx.get<{ project_id: string | null }>(`SELECT project_id FROM items WHERE id = ?`, pending.key);
        const current = this.ctx.get<{ hlc: string }>(`SELECT hlc FROM sync_versions WHERE entity = 'item' AND entity_id = ?`, pending.key)?.hlc;
        if (!item || current !== payload.hlc || item.project_id !== null) {
          this.ctx.run(`DELETE FROM sync_pending WHERE kind = ? AND key = ?`, pending.kind, pending.key);
        } else if (this.ctx.get(`SELECT 1 FROM projects WHERE id = ?`, payload.projectId!)) {
          this.ctx.run(`UPDATE items SET project_id = ? WHERE id = ?`, payload.projectId!, pending.key);
          this.ctx.run(`DELETE FROM sync_pending WHERE kind = ? AND key = ?`, pending.kind, pending.key);
        }
      } else if (pending.kind === 'relation' && this.bothItemsExist(payload.from_id!, payload.to_id!)) {
        this.insertRelation(payload);
        this.ctx.run(`DELETE FROM sync_pending WHERE kind = ? AND key = ?`, pending.kind, pending.key);
      }
    }
  }

  private defer(kind: string, key: string, payload: object): void {
    this.ctx.run(
      `INSERT INTO sync_pending (kind, key, payload) VALUES (?, ?, ?) ON CONFLICT (kind, key) DO UPDATE SET payload = excluded.payload`,
      kind, key, JSON.stringify(payload),
    );
  }

  private apply(record: SyncRecord): 'applied' | 'conflict' | 'skipped' {
    this.ctx.observe(record.hlc);
    const local = this.ctx.get<{ hlc: string }>(`SELECT hlc FROM sync_versions WHERE entity = ? AND entity_id = ?`, record.entity, record.id);
    if (local && local.hlc >= record.hlc) return 'skipped';
    // The writer hadn't seen our latest version: both sides changed it since they last agreed.
    const concurrent = local !== undefined && record.base !== local.hlc;
    const preserved = concurrent ? this.preserveLosingText(record) : false;

    const origin = { deviceId: record.device, actor: record.actor, hlc: record.hlc };
    if (record.entity === 'item') this.applyItem(record.id, record.state as ItemState | null, record.hlc);
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

  private applyItem(id: string, state: ItemState | null, hlc: string): void {
    if (!state) {
      const blobs = this.ctx.all<{ sha256: string }>(`SELECT sha256 FROM attachments WHERE item_id = ?`, id);
      this.ctx.run(`DELETE FROM items WHERE id = ?`, id);
      for (const { sha256 } of blobs) removeBlobIfUnused(this.ctx, sha256);
      return;
    }
    const item = { ...state.item };
    if (item.project_id && !this.ctx.get(`SELECT 1 FROM projects WHERE id = ?`, item.project_id)) {
      this.defer('item_project', id, { projectId: item.project_id, hlc });
      item.project_id = null;
    }
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
      while (this.ctx.get(`SELECT 1 FROM projects WHERE slug = ? AND id != ?`, `${project.slug}-${n}`, project.id!)) n++;
      project.slug = `${project.slug}-${n}`;
      project.name = `${project.name} (${n})`;
    }
    this.upsert('projects', PROJECT_FIELDS, project);
  }

  private applyRelation(state: Record<string, SQLInputValue> | null): void {
    if (!state) return;
    if (this.bothItemsExist(state.from_id as string, state.to_id as string)) this.insertRelation(state);
    else this.defer('relation', state.id as string, state);
  }

  private bothItemsExist(from: string, to: string): boolean {
    return (this.ctx.get<{ n: number }>(`SELECT count(*) AS n FROM items WHERE id IN (?, ?)`, from, to)!).n === 2;
  }

  private insertRelation(state: Record<string, SQLInputValue>): void {
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

  private pack(plain: Buffer, name: string): Buffer {
    return this.sealer ? this.sealer.seal(plain, name) : plain;
  }

  private unpack(stored: Buffer, name: string): Buffer {
    return this.sealer ? this.sealer.open(stored, name) : stored;
  }

  private exportBlobs(folder: string, state: ItemState): void {
    for (const attachment of state.attachments) {
      const target = join(folder, 'blobs', attachment.sha256 as string);
      const source = blobPath(this.ctx, attachment.sha256 as string);
      if (!existsSync(target) && existsSync(source)) {
        writeFileSync(`${target}.tmp`, this.pack(readFileSync(source), `blobs/${attachment.sha256 as string}`));
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
      let bytes: Buffer;
      try {
        bytes = this.unpack(readFileSync(remote), `blobs/${sha256}`);
      } catch {
        continue;
      }
      // A partly downloaded or tampered file must not become the attachment; try again next run.
      if (createHash('sha256').update(bytes).digest('hex') !== sha256) continue;
      mkdirSync(join(local, '..'), { recursive: true });
      writeFileSync(`${local}.tmp`, bytes);
      renameSync(`${local}.tmp`, local);
    }
  }
}

function readMarker(folder: string): Marker | null {
  const path = join(folder, MARKER);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Marker) : null;
}

function writeMarker(folder: string, marker: Marker): void {
  writeFileSync(join(folder, `.${MARKER}.tmp`), JSON.stringify(marker, null, 2));
  renameSync(join(folder, `.${MARKER}.tmp`), join(folder, MARKER));
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isId = (value: unknown): value is string => isString(value) && DEVICE_ID.test(value);

/**
 * Shape checks for records read from a folder another machine writes. Column types are enforced by the STRICT
 * tables; these guard what the tables can't: anything used to build a path, and values the app relies on.
 */
function isRecord(value: unknown): value is SyncRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  if (r.entity !== 'item' && r.entity !== 'project' && r.entity !== 'relation') return false;
  if (!isId(r.id) || !isId(r.device) || !isString(r.actor)) return false;
  if (!isString(r.hlc) || !HLC_PATTERN.test(r.hlc)) return false;
  if (r.base !== null && !(isString(r.base) && HLC_PATTERN.test(r.base))) return false;
  if (r.state === null) return true;
  if (!r.state || typeof r.state !== 'object') return false;
  const state = r.state as Record<string, unknown>;
  if (r.entity === 'project') {
    return state.id === r.id && isString(state.name) && isString(state.slug) && state.slug !== '' && slugify(state.slug) === state.slug;
  }
  if (r.entity === 'relation') {
    return state.id === r.id && isId(state.from_id) && isId(state.to_id) && (RELATION_KINDS as readonly unknown[]).includes(state.kind);
  }
  const item = state.item as Record<string, unknown> | undefined;
  if (!item || item.id !== r.id || !(ITEM_TYPES as readonly unknown[]).includes(item.type)) return false;
  if (item.project_id != null && !isId(item.project_id)) return false;
  if (!Array.isArray(state.tags) || !state.tags.every((t) => isString(t) && safeTag(t) === t)) return false;
  return Array.isArray(state.attachments) && state.attachments.every((a: Record<string, unknown>) =>
    isId(a.id) && isString(a.sha256) && SHA256_PATTERN.test(a.sha256)
    && isString(a.filename) && a.filename !== '' && basename(a.filename) === a.filename && a.filename !== '..' && !a.filename.includes('\\'));
}

function safeTag(tag: string): string | null {
  try {
    return normalizeTag(tag);
  } catch {
    return null;
  }
}
