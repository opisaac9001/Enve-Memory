import { randomBytes } from 'node:crypto';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import { transaction } from './db.ts';
import { invalid } from './errors.ts';
import type { Change, Item, ItemMetadata, ItemType, TaskFields, TaskPriority, TaskStatus } from './types.ts';

/** RFC 9562 UUIDv7: 48-bit millisecond timestamp, then random bits. Node 24 (Electron's runtime) lacks crypto.randomUUIDv7. */
export function newId(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class Context {
  readonly db: DatabaseSync;
  readonly deviceId: string;
  actor: string;
  private readonly statements = new Map<string, StatementSync>();

  /** Null for in-memory libraries, which can't hold files. */
  readonly attachmentsDir: string | null;

  constructor(db: DatabaseSync, actor: string, attachmentsDir: string | null) {
    this.db = db;
    this.actor = actor;
    this.attachmentsDir = attachmentsDir;
    this.deviceId = this.loadDeviceId();
  }

  now(): string {
    return new Date().toISOString();
  }

  stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLInputValue[]): void {
    this.stmt(sql).run(...params);
  }

  tx<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  record(entity: Change['entity'], entityId: string, op: string, projectId: string | null, data: object | null = null): void {
    this.run(
      `INSERT INTO changes (id, device_id, actor, entity, entity_id, op, project_id, data, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), this.deviceId, this.actor, entity, entityId, op, projectId,
      data === null ? null : JSON.stringify(data), this.now(),
    );
  }

  private loadDeviceId(): string {
    const row = this.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'device_id'`);
    if (row) return row.value;
    const id = newId();
    this.run(`INSERT INTO settings (key, value) VALUES ('device_id', ?)`, id);
    return id;
  }
}

export const ITEM_COLUMNS = `
  i.id, i.type, i.title, i.body, i.url, i.project_id, p.name AS project_name,
  i.source, i.metadata, i.created_at, i.updated_at, i.archived_at,
  t.status AS task_status, t.priority AS task_priority, t.due_at AS task_due_at, t.completed_at AS task_completed_at`;

export const ITEM_JOINS = `
  LEFT JOIN projects p ON p.id = i.project_id
  LEFT JOIN tasks t ON t.item_id = i.id`;

export const ITEM_FROM = `items i ${ITEM_JOINS}`;

export interface ItemRow {
  id: string;
  type: ItemType;
  title: string;
  body: string;
  url: string | null;
  project_id: string | null;
  project_name: string | null;
  source: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  task_status: TaskStatus | null;
  task_priority: number | null;
  task_due_at: string | null;
  task_completed_at: string | null;
}

const PRIORITY_FROM_INT: Record<number, TaskPriority> = { 1: 'high', 2: 'normal', 3: 'low' };
export const PRIORITY_TO_INT: Record<TaskPriority, number> = { high: 1, normal: 2, low: 3 };

export function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    url: row.url,
    project: row.project_id ? { id: row.project_id, name: row.project_name! } : null,
    source: row.source,
    metadata: JSON.parse(row.metadata) as ItemMetadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export function toTaskFields(row: ItemRow): TaskFields | null {
  if (row.task_status === null) return null;
  return {
    status: row.task_status,
    priority: PRIORITY_FROM_INT[row.task_priority!]!,
    dueAt: row.task_due_at,
    completedAt: row.task_completed_at,
  };
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw invalid(`Unknown ${label} "${value}". Expected one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function required(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw invalid(`${label} is required.`);
  return trimmed;
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeTag(value: string): string {
  const tag = slugify(value.replace(/^#+/, ''));
  if (!tag) throw invalid(`"${value}" is not a usable tag.`);
  if (tag.length > 64) throw invalid(`Tag "${tag}" is longer than 64 characters.`);
  return tag;
}

export function normalizeDue(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) throw invalid(`Due date "${value}" must be YYYY-MM-DD or an ISO 8601 timestamp.`);
  return new Date(parsed).toISOString();
}
