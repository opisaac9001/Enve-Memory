import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnveMemory, MemoryError, toFtsQuery } from '@enve-memory/core';

const open = () => EnveMemory.open({ inMemory: true, actor: 'test' });

test('free text is quoted so FTS syntax in user input is inert', () => {
  assert.equal(toFtsQuery('ESP32 garage'), '"esp32" OR "garage"*');
  assert.equal(toFtsQuery('"x" NEAR(b) -c OR d*'), '"x" OR "near" OR "b" OR "c" OR "d"*');
  assert.equal(toFtsQuery('how does the opener work'), '"opener" OR "work"*');
  assert.equal(toFtsQuery('to be or'), '"to" OR "be" OR "or"*');
  assert.equal(toFtsQuery('  ?!  '), null);
});

test('titles outrank bodies and fuller matches outrank partial ones', () => {
  const memory = open();
  const bodyOnly = memory.items.saveNote({ body: 'Some notes that mention the opener in passing' });
  const titled = memory.items.saveNote({ title: 'Opener wiring', body: 'Pinout and wiring' });
  const both = memory.items.saveNote({ title: 'Opener protocol', body: 'Security+ opener protocol details' });
  assert.deepEqual(memory.search.query('opener protocol').map((h) => h.id), [both.id, titled.id, bodyOnly.id]);
});

test('stemming and trailing-prefix matching find near spellings', () => {
  const memory = open();
  const note = memory.items.saveNote({ body: 'Testing the garage controllers on the bench' });
  assert.deepEqual(memory.search.query('controller tested').map((h) => h.id), [note.id]);
  assert.deepEqual(memory.search.query('gar').map((h) => h.id), [note.id]);
});

test('search filters by project, type and tag and reports task status', () => {
  const memory = open();
  memory.projects.create({ name: 'Garage' });
  memory.projects.create({ name: 'Plex' });
  const task = memory.tasks.create({ title: 'Flash firmware', project: 'garage', tags: ['esp32'] });
  const note = memory.items.saveNote({ body: 'firmware notes', project: 'garage' });
  memory.items.saveNote({ body: 'firmware for the Plex box', project: 'plex' });

  assert.equal(memory.search.query('firmware').length, 3);
  assert.deepEqual(new Set(memory.search.query('firmware', { project: 'garage' }).map((h) => h.id)), new Set([task.id, note.id]));
  const [hit] = memory.search.query('firmware', { type: 'task' });
  assert.equal(hit?.id, task.id);
  assert.equal(hit?.taskStatus, 'open');
  assert.deepEqual(memory.search.query('firmware', { tag: '#ESP32' }).map((h) => h.id), [task.id]);
  assert.throws(() => memory.search.query('firmware', { type: 'video' }), MemoryError);
});

test('snippets highlight the matched terms', () => {
  const memory = open();
  memory.items.saveNote({ body: 'The LiftMaster uses Security+ 2.0 rolling codes over a serial bus.' });
  assert.match(memory.search.query('rolling')[0]!.snippet, /\[rolling\]/);
});

test('updated text is re-indexed', () => {
  const memory = open();
  const note = memory.items.saveNote({ body: 'draft about relays' });
  memory.items.update(note.id, { body: 'final about reed switches' });
  assert.equal(memory.search.query('relays').length, 0);
  assert.equal(memory.search.query('reed').length, 1);
});
