import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MemoryError } from './errors.ts';
import { MIGRATIONS, type Migration } from './migrations.ts';

export const IN_MEMORY = ':memory:';

export interface MigrateOptions {
  migrations?: readonly Migration[];
  backupDir?: string;
}

export function openDatabase(file: string, options: MigrateOptions = {}): DatabaseSync {
  if (file !== IN_MEMORY) mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  try {
    migrate(db, options);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export function schemaVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

export function migrate(db: DatabaseSync, { migrations = MIGRATIONS, backupDir }: MigrateOptions = {}): void {
  const current = schemaVersion(db);
  const latest = migrations.length;
  if (current > latest) {
    throw new MemoryError(
      'schema',
      `This library was written by a newer Enve Memory (schema ${current}; this build supports ${latest}). Update Enve Memory to open it.`,
    );
  }
  if (current === latest) return;

  if (current > 0 && backupDir) {
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    db.prepare('VACUUM INTO ?').run(join(backupDir, `pre-migration-v${current}-${stamp}.sqlite`));
  }

  for (let version = current + 1; version <= latest; version++) {
    transaction(db, () => {
      db.exec(migrations[version - 1]!.sql);
      db.exec(`PRAGMA user_version = ${version}`);
    });
  }
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
