import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EnveMemory } from '@enve-memory/core';

const temp = (label: string) => mkdtempSync(join(tmpdir(), `enve-memory-sync-${label}-`));

function devices(count = 2) {
  const folder = temp('folder');
  const libraries = Array.from({ length: Math.max(count, 2) }, (_, i) => {
    const memory = EnveMemory.open({ home: temp(`device${i}`), actor: `device${i}` });
    memory.settings.set('syncFolder', folder);
    memory.settings.set('fetchLinks', false);
    return memory;
  }) as [EnveMemory, EnveMemory, ...EnveMemory[]];
  const syncAll = () => {
    // Twice around, so every device sees every other device's latest segment.
    for (let round = 0; round < 2; round++) for (const m of libraries) m.sync.run();
  };
  return { folder, libraries, syncAll };
}

const snapshot = (memory: EnveMemory) => ({
  projects: memory.projects.list('active').map((p) => [p.id, p.name, p.memory]).sort(),
  items: memory.items.list({ includeArchived: true }, 200).map((i) => {
    const d = memory.items.get(i.id);
    return [d.id, d.type, d.title, d.body, d.project?.id ?? null, d.tags.join(','), d.task?.status ?? null, d.archivedAt !== null, d.relations.length];
  }).sort(),
});

test('two devices converge on projects, items, tasks, tags, decisions and relations', () => {
  const { libraries: [a, b], syncAll } = devices();
  a.projects.create({ name: 'Garage Door', instructions: 'Offline only.' });
  a.projects.setMemory('garage', '# Goal\nLocal control');
  const note = a.items.saveNote({ body: 'Use a dry contact', project: 'garage', tags: ['wiring'] });
  const task = a.tasks.create({ title: 'Order relays', project: 'garage', due: '2026-10-01', priority: 'high' });
  const first = a.decisions.record({ project: 'garage', decision: 'Use ESP32' });
  a.decisions.record({ project: 'garage', decision: 'Use ESP32-S3', supersedes: [first.id] });
  syncAll();

  assert.deepEqual(snapshot(b), snapshot(a));
  assert.equal(b.tasks.get(task.id).task.dueAt, '2026-10-01');
  assert.equal(b.tasks.get(task.id).task.priority, 'high');
  assert.equal(b.decisions.list('garage')[0]!.supersededBy !== null, true);
  assert.deepEqual(b.search.query('dry contact').map((h) => h.id), [note.id]);

  b.tasks.complete(task.id);
  b.items.tag(note.id, { add: ['relay'], remove: ['wiring'] });
  b.items.archive(note.id);
  syncAll();
  assert.equal(a.tasks.get(task.id).task.status, 'done');
  assert.deepEqual(a.items.get(note.id).tags, ['relay']);
  assert.notEqual(a.items.get(note.id).archivedAt, null);
  assert.deepEqual(snapshot(a), snapshot(b));
});

test('deletes propagate and changes are attributed to the device that made them', () => {
  const { libraries: [a, b], syncAll } = devices();
  const doomed = a.items.saveNote({ body: 'temporary' });
  syncAll();
  b.items.delete(doomed.id);
  syncAll();
  assert.throws(() => a.items.get(doomed.id), /No item/);
  const deletion = a.activity.recent({ entityId: doomed.id })[0]!;
  assert.equal(deletion.op, 'delete');
  assert.equal(deletion.actor, 'device1');
  assert.equal(deletion.deviceId, b.deviceId);
});

test('concurrent edits keep the newest version and preserve the other as a conflict note', async () => {
  const { libraries: [a, b], syncAll } = devices();
  a.projects.create({ name: 'Garage' });
  const note = a.items.saveNote({ title: 'Wiring', body: 'original', project: 'garage' });
  syncAll();

  a.items.update(note.id, { body: 'edited on A' });
  await new Promise((r) => setTimeout(r, 5));
  b.items.update(note.id, { body: 'edited on B' });
  syncAll();

  for (const memory of [a, b]) {
    assert.equal(memory.items.get(note.id).body, 'edited on B', 'the later edit wins everywhere');
    const conflicts = memory.search.query('conflicting');
    assert.equal(conflicts.length, 1);
    assert.equal(memory.items.get(conflicts[0]!.id).body, 'edited on A', 'the other edit is kept, not lost');
    assert.equal(memory.items.get(conflicts[0]!.id).project?.name, 'Garage');
  }
  assert.deepEqual(snapshot(a), snapshot(b));
});

test('concurrent project memory edits are preserved too', async () => {
  const { libraries: [a, b], syncAll } = devices();
  a.projects.create({ name: 'Garage' });
  syncAll();
  b.projects.setMemory('garage', 'B memory');
  await new Promise((r) => setTimeout(r, 5));
  a.projects.setMemory('garage', 'A memory');
  syncAll();
  for (const memory of [a, b]) {
    assert.equal(memory.projects.resolve('garage').memory, 'A memory');
    assert.equal(memory.items.get(memory.search.query('conflicting garage memory')[0]!.id).body, 'B memory');
  }
});

test('sequential edits fast-forward without conflicts', () => {
  const { libraries: [a, b], syncAll } = devices();
  const note = a.items.saveNote({ body: 'v1' });
  syncAll();
  b.items.update(note.id, { body: 'v2' });
  syncAll();
  a.items.update(note.id, { body: 'v3' });
  syncAll();
  assert.equal(b.items.get(note.id).body, 'v3');
  assert.equal(a.search.query('conflicting').length, 0);
  assert.equal(b.search.query('conflicting').length, 0);
});

test('a third device joining later receives the whole library, files included', () => {
  const { folder, libraries: [a, b], syncAll } = devices();
  a.projects.create({ name: 'Garage' });
  const file = a.files.save({ data: new TextEncoder().encode('schematic bytes'), filename: 'schematic.txt', project: 'garage' }).item;
  b.items.saveNote({ body: 'from B' });
  syncAll();

  const c = EnveMemory.open({ home: temp('late'), actor: 'late' });
  c.settings.set('syncFolder', folder);
  c.sync.run();
  assert.deepEqual(snapshot(c).items.map((i) => i[3]).sort(), snapshot(a).items.map((i) => i[3]).sort());
  assert.equal(c.files.read(file.id).data.toString(), 'schematic bytes');
});

test('re-running is idempotent and partially written segments are retried later', () => {
  const { folder, libraries: [a, b], syncAll } = devices();
  a.items.saveNote({ body: 'one' });
  syncAll();
  const before = snapshot(b);
  assert.deepEqual(b.sync.run(), { exported: 0, imported: 0, conflicts: 0, devices: 1 });
  assert.deepEqual(a.sync.run(), { exported: 0, imported: 0, conflicts: 0, devices: 1 });
  assert.deepEqual(snapshot(b), before);

  const aDir = join(folder, 'devices', a.deviceId);
  writeFileSync(join(aDir, '999999999999.ndjson'), '{"entity":"item","id":"half-written');
  assert.doesNotThrow(() => b.sync.run());
  assert.ok(readdirSync(aDir).includes('999999999999.ndjson'));
});

test('two devices that each created the same project name keep both', () => {
  const { libraries: [a, b], syncAll } = devices();
  a.projects.create({ name: 'Garage' });
  b.projects.create({ name: 'Garage' });
  syncAll();
  assert.deepEqual(a.projects.list().map((p) => p.name).sort(), ['Garage', 'Garage (2)']);
  assert.equal(b.projects.list().length, 2);
});

test('a device whose clock runs an hour slow still orders its later edits after what it has seen', (t) => {
  const { libraries: [a, b], syncAll } = devices();
  const note = a.items.saveNote({ body: 'written on the correct clock' });
  syncAll();

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() - 3_600_000 });
  b.items.update(note.id, { body: 'edited later on the slow clock' });
  t.mock.timers.reset();
  syncAll();

  assert.equal(a.items.get(note.id).body, 'edited later on the slow clock');
  assert.equal(a.search.query('conflicting').length, 0);
});

test('an encrypted sync folder holds no readable data and needs the passphrase', () => {
  const folder = temp('sealed');
  const open = (label: string) => {
    const memory = EnveMemory.open({ home: temp(label), actor: label });
    memory.settings.set('syncFolder', folder);
    return memory;
  };
  const a = open('a');
  a.sync.setPassphrase('correct horse battery');
  assert.equal(a.sync.encrypted, true);
  const note = a.items.saveNote({ body: 'the garage code is 4417' });
  const file = a.files.save({ data: new TextEncoder().encode('secret schematic'), filename: 'schematic.txt' }).item;
  a.sync.run();

  const everything = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? everything(join(dir, e.name)) : [readFileSync(join(dir, e.name), 'latin1')]));
  const stored = everything(folder).join('\n');
  assert.equal(stored.includes('4417'), false);
  assert.equal(stored.includes('secret schematic'), false);
  assert.equal(stored.includes('schematic.txt'), false);

  const b = open('b');
  assert.throws(() => b.sync.run(), /encrypted\. Enter its passphrase/);
  assert.throws(() => b.sync.setPassphrase('wrong passphrase'), /does not match/);
  b.sync.setPassphrase('correct horse battery');
  b.sync.run();
  assert.equal(b.items.get(note.id).body, 'the garage code is 4417');
  assert.equal(b.files.read(file.id).data.toString(), 'secret schematic');

  const plainFolder = temp('plain');
  const c = EnveMemory.open({ home: temp('c'), actor: 'c' });
  c.sync.run(plainFolder);
  assert.throws(() => c.sync.setPassphrase('correct horse battery', plainFolder), /already holds unencrypted/);
  assert.throws(() => c.sync.setPassphrase('short', temp('empty')), /at least 8/);
});
