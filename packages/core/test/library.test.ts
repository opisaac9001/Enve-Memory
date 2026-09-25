import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnveMemory, MemoryError } from '@enve-memory/core';

const open = () => EnveMemory.open({ inMemory: true, actor: 'test' });

const failsWith = (code: MemoryError['code']) => (error: unknown) => error instanceof MemoryError && error.code === code;

test('projects resolve by id, slug, or name in any case', () => {
  const memory = open();
  const project = memory.projects.create({ name: 'Garage Door Controller', description: 'ESP32 opener' });
  assert.equal(project.slug, 'garage-door-controller');
  for (const ref of [project.id, 'garage-door-controller', 'garage door controller', '  Garage Door Controller ']) {
    assert.equal(memory.projects.resolve(ref).id, project.id);
  }
  assert.throws(() => memory.projects.resolve('nope'), /Existing projects: Garage Door Controller/);
});

test('a slug prefix resolves only when it is unambiguous', () => {
  const memory = open();
  const door = memory.projects.create({ name: 'Garage Door' });
  assert.equal(memory.projects.resolve('garage').id, door.id);
  assert.throws(() => memory.projects.resolve('%'), failsWith('not_found'));
  memory.projects.create({ name: 'Garage Sale' });
  assert.throws(() => memory.projects.resolve('garage'), failsWith('not_found'));
  assert.equal(memory.projects.resolve('garage d').id, door.id);
});

test('project names that collide after slugging are rejected', () => {
  const memory = open();
  memory.projects.create({ name: 'Garage Door' });
  assert.throws(() => memory.projects.create({ name: 'garage-door' }), failsWith('conflict'));
  assert.throws(() => memory.projects.create({ name: '!!!' }), failsWith('invalid'));
});

test('renaming a project moves its slug; archived projects leave the default list', () => {
  const memory = open();
  memory.projects.create({ name: 'Garage' });
  const renamed = memory.projects.update('garage', { name: 'Garage Door' });
  assert.equal(renamed.slug, 'garage-door');
  assert.equal(memory.projects.resolve('garage-door').id, renamed.id);

  memory.projects.update('garage door', { status: 'archived' });
  assert.equal(memory.projects.list().length, 0);
  assert.equal(memory.projects.list('archived').length, 1);
  assert.throws(() => memory.projects.update('garage door', { status: 'deleted' }), failsWith('invalid'));
});

test('project memory can be replaced but every version stays in history', () => {
  const memory = open();
  memory.projects.create({ name: 'Garage' });
  memory.projects.setMemory('garage', 'Uses ESP32.');
  memory.projects.setMemory('garage', 'Uses ESP32-S3.');
  assert.equal(memory.projects.resolve('garage').memory, 'Uses ESP32-S3.');
  const history = memory.activity
    .recent({ project: 'garage' })
    .filter((change) => change.op === 'set_memory')
    .map((change) => change.data?.memory);
  assert.deepEqual(history, ['Uses ESP32-S3.', 'Uses ESP32.']);
});

test('notes and links are saved with project, tags, and the acting client', () => {
  const memory = open();
  memory.projects.create({ name: 'Garage' });
  memory.actor = 'mcp:claude-code';
  const note = memory.items.saveNote({ body: 'Bench test first', project: 'garage', tags: ['#ESP32', 'Bench Test'] });
  assert.equal(note.type, 'note');
  assert.equal(note.project?.name, 'Garage');
  assert.equal(note.source, 'mcp:claude-code');
  assert.deepEqual(note.tags, ['bench-test', 'esp32']);
  assert.equal(memory.activity.recent({ entityId: note.id }).at(-1)?.actor, 'mcp:claude-code');
});

test('saving an already-bookmarked URL returns the original and merges notes and tags', () => {
  const memory = open();
  const first = memory.items.saveLink({ url: 'https://example.com/security-plus', title: 'Security+ 2.0' });
  const again = memory.items.saveLink({ url: 'https://example.com/security-plus', tags: ['protocol'], note: 'Rolling codes' });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.item.id, first.item.id);
  assert.deepEqual(again.item.tags, ['protocol']);
  assert.equal(again.item.body, 'Rolling codes');
  const third = memory.items.saveLink({ url: 'https://example.com/security-plus', note: 'Section 4' });
  assert.equal(third.item.body, 'Rolling codes\n\nSection 4');
  assert.equal(memory.items.saveLink({ url: 'https://example.com/security-plus', note: 'Section 4' }).item.body, third.item.body);
  assert.throws(() => memory.items.saveLink({ url: 'not a url' }), failsWith('invalid'));
});

test('archived items are hidden from lists and search until unarchived', () => {
  const memory = open();
  const note = memory.items.saveNote({ body: 'rolling code research' });
  memory.items.archive(note.id);
  assert.equal(memory.items.list().length, 0);
  assert.equal(memory.search.query('rolling').length, 0);
  assert.equal(memory.search.query('rolling', { includeArchived: true }).length, 1);
  memory.items.unarchive(note.id);
  assert.equal(memory.search.query('rolling').length, 1);
});

test('relations are visible from both ends and deleted with their items', () => {
  const memory = open();
  const spec = memory.items.saveLink({ url: 'https://example.com/spec' }).item;
  const note = memory.items.saveNote({ body: 'Summary of the spec' });
  memory.items.relate(note.id, spec.id, 'derived_from');
  memory.items.relate(note.id, spec.id, 'derived_from');
  assert.deepEqual(
    memory.items.get(spec.id).relations.map((r) => [r.kind, r.direction, r.id]),
    [['derived_from', 'incoming', note.id]],
  );
  assert.throws(() => memory.items.relate(note.id, note.id, 'related_to'), failsWith('invalid'));
  assert.throws(() => memory.items.relate(note.id, spec.id, 'owns'), failsWith('invalid'));

  memory.items.delete(note.id);
  assert.deepEqual(memory.items.get(spec.id).relations, []);
  assert.throws(() => memory.items.get(note.id), failsWith('not_found'));
  assert.equal(memory.activity.recent({ entityId: note.id })[0]?.op, 'delete');
});

test('tasks sort by due date then priority, and completion is reversible', () => {
  const memory = open();
  memory.projects.create({ name: 'Garage' });
  const later = memory.tasks.create({ title: 'Mount enclosure', project: 'garage', due: '2026-12-01' });
  const urgent = memory.tasks.create({ title: 'Order ESP32', project: 'garage', due: '2026-10-01', priority: 'high' });
  const someday = memory.tasks.create({ title: 'Write docs', project: 'garage', priority: 'low' });
  memory.tasks.create({ title: 'Other project task' });

  assert.deepEqual(memory.tasks.list({ project: 'garage' }).map((t) => t.id), [urgent.id, later.id, someday.id]);

  const done = memory.tasks.complete(urgent.id);
  assert.equal(done.task.status, 'done');
  assert.ok(done.task.completedAt);
  assert.equal(memory.tasks.list({ project: 'garage' }).length, 2);
  assert.equal(memory.tasks.list({ project: 'garage', status: 'done' }).length, 1);

  const reopened = memory.tasks.update(urgent.id, { status: 'open' });
  assert.equal(reopened.task.completedAt, null);
  assert.equal(memory.tasks.update(later.id, { due: null }).task.dueAt, null);
  assert.throws(() => memory.tasks.create({ title: 'x', due: 'next tuesday' }), failsWith('invalid'));
  assert.throws(() => memory.tasks.update(memory.items.saveNote({ body: 'n' }).id, { status: 'done' }), failsWith('invalid'));
});

test('decisions are append-only and superseding keeps the old one', () => {
  const memory = open();
  memory.projects.create({ name: 'Garage' });
  memory.projects.create({ name: 'Plex' });
  const first = memory.decisions.record({ project: 'garage', decision: 'Use ESP32' });
  const second = memory.decisions.record({
    project: 'garage', decision: 'Use ESP32-S3', reason: 'Needs USB host', supersedes: [first.id],
  });

  const log = memory.decisions.list('garage');
  assert.deepEqual(log.map((d) => d.decision), ['Use ESP32', 'Use ESP32-S3']);
  assert.equal(log[0]!.supersededBy, second.id);
  assert.deepEqual(log[1]!.supersedes, [first.id]);

  assert.throws(() => memory.items.update(first.id, { title: 'Use RP2040' }), /append-only/);
  assert.throws(() => memory.items.archive(first.id), /append-only/);
  assert.throws(
    () => memory.decisions.record({ project: 'plex', decision: 'x', supersedes: [first.id] }),
    failsWith('invalid'),
  );
  assert.equal(memory.search.query('usb host')[0]?.id, second.id);
});

test('the briefing gathers memory, decisions, open tasks and recent material', () => {
  const memory = open();
  memory.projects.create({ name: 'Garage', instructions: 'Must work offline.' });
  memory.projects.setMemory('garage', '# Goal\nLocal-first controller.');
  memory.decisions.record({ project: 'garage', decision: 'Use ESP32' });
  const task = memory.tasks.create({ title: 'Build bench simulator', project: 'garage' });
  memory.tasks.complete(memory.tasks.create({ title: 'Done already', project: 'garage' }).id);
  const link = memory.items.saveLink({ url: 'https://example.com/ratgdo', project: 'garage' }).item;

  const briefing = memory.briefing('Garage');
  assert.equal(briefing.project.instructions, 'Must work offline.');
  assert.match(briefing.project.memory, /Local-first/);
  assert.equal(briefing.decisions.length, 1);
  assert.deepEqual(briefing.openTasks.map((t) => t.id), [task.id]);
  assert.deepEqual(briefing.recentItems.map((i) => i.id), [link.id]);
});
