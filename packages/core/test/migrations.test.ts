import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { EnveMemory, MIGRATIONS, type Migration, MemoryError, migrate, openDatabase, schemaVersion } from '@enve-memory/core';

const tempHome = () => mkdtempSync(join(tmpdir(), 'enve-memory-test-'));

test('a new library is created at the latest schema', () => {
  const home = tempHome();
  const memory = EnveMemory.open({ home, actor: 'test' });
  assert.equal(memory.schemaVersion, MIGRATIONS.length);
  assert.ok(existsSync(join(home, 'memory.sqlite')));
  memory.close();
});

test('reopening an up-to-date library changes nothing and keeps the device id', () => {
  const home = tempHome();
  const first = EnveMemory.open({ home, actor: 'test' });
  const deviceId = first.deviceId;
  first.projects.create({ name: 'Garage' });
  first.close();

  const second = EnveMemory.open({ home, actor: 'test' });
  assert.equal(second.deviceId, deviceId);
  assert.equal(second.projects.list().length, 1);
  second.close();
  assert.equal(existsSync(join(home, 'backups')), false, 'no backup without a migration');
});

test('a library from a newer build is refused, not modified', () => {
  const home = tempHome();
  EnveMemory.open({ home, actor: 'test' }).close();
  const raw = new DatabaseSync(join(home, 'memory.sqlite'));
  raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  raw.close();

  assert.throws(
    () => EnveMemory.open({ home, actor: 'test' }),
    (error: unknown) => error instanceof MemoryError && error.code === 'schema',
  );
});

test('upgrading an existing library snapshots it first', () => {
  const home = tempHome();
  const file = join(home, 'memory.sqlite');
  const backups = join(home, 'backups');
  const v1: Migration[] = [{ name: 'one', sql: 'CREATE TABLE a (x TEXT) STRICT; INSERT INTO a VALUES (\'kept\');' }];
  const v2: Migration[] = [...v1, { name: 'two', sql: 'ALTER TABLE a ADD COLUMN y TEXT;' }];

  openDatabase(file, { migrations: v1, backupDir: backups }).close();
  const db = openDatabase(file, { migrations: v2, backupDir: backups });
  assert.equal(schemaVersion(db), 2);
  db.close();

  const snapshots = readdirSync(backups);
  assert.equal(snapshots.length, 1);
  assert.match(snapshots[0]!, /^pre-migration-v1-/);
  const snapshot = new DatabaseSync(join(backups, snapshots[0]!));
  assert.equal(schemaVersion(snapshot), 1);
  assert.deepEqual({ ...snapshot.prepare('SELECT x FROM a').get() }, { x: 'kept' });
  snapshot.close();
});

test('a failing migration rolls back completely', () => {
  const db = new DatabaseSync(':memory:');
  const good: Migration = { name: 'one', sql: 'CREATE TABLE a (x TEXT) STRICT;' };
  const bad: Migration = { name: 'two', sql: 'CREATE TABLE b (x TEXT) STRICT; INSERT INTO nowhere VALUES (1);' };

  migrate(db, { migrations: [good] });
  assert.throws(() => migrate(db, { migrations: [good, bad] }));
  assert.equal(schemaVersion(db), 1);
  assert.equal(db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name = 'b'`).get()!.n, 0);
});

test('the search index survives VACUUM after deletes', () => {
  const home = tempHome();
  const memory = EnveMemory.open({ home, actor: 'test' });
  const doomed = memory.items.saveNote({ body: 'alpha doomed' });
  const kept = memory.items.saveNote({ body: 'alpha kept' });
  memory.items.delete(doomed.id);
  memory.close();

  const raw = new DatabaseSync(join(home, 'memory.sqlite'));
  raw.exec('VACUUM');
  raw.close();

  const reopened = EnveMemory.open({ home, actor: 'test' });
  reopened.items.update(kept.id, { body: 'beta kept' });
  assert.deepEqual(reopened.search.query('alpha'), []);
  assert.deepEqual(reopened.search.query('beta').map((h) => h.id), [kept.id]);
  reopened.close();
});

test('a populated v1 library upgrades to the latest schema without losing anything', () => {
  const home = tempHome();
  const file = join(home, 'memory.sqlite');
  const v1 = openDatabase(file, { migrations: MIGRATIONS.slice(0, 1) });
  const now = new Date().toISOString();
  v1.prepare(`INSERT INTO projects (id, name, slug, memory, created_at, updated_at) VALUES ('p1', 'Garage', 'garage', 'Goal: offline', ?, ?)`).run(now, now);
  v1.prepare(`INSERT INTO items (id, type, title, body, project_id, source, created_at, updated_at) VALUES ('i1', 'note', 'Relay wiring', 'Use the NO contact', 'p1', 'cli', ?, ?)`).run(now, now);
  v1.prepare(`INSERT INTO items (id, type, title, project_id, source, created_at, updated_at) VALUES ('t1', 'task', 'Order relays', 'p1', 'cli', ?, ?)`).run(now, now);
  v1.prepare(`INSERT INTO tasks (item_id, due_at) VALUES ('t1', '2026-10-01')`).run();
  v1.close();

  const memory = EnveMemory.open({ home, actor: 'test' });
  assert.equal(memory.schemaVersion, MIGRATIONS.length);
  assert.equal(memory.projects.resolve('garage').memory, 'Goal: offline');
  assert.deepEqual(memory.search.query('contact').map((h) => h.id), ['i1']);
  assert.equal(memory.tasks.get('t1').task.dueAt, '2026-10-01');
  assert.deepEqual(memory.briefing('garage').openTasks.map((t) => t.id), ['t1']);
  memory.close();
  assert.equal(readdirSync(join(home, 'backups')).length, 1);
});
