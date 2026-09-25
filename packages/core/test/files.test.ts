import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EnveMemory, MemoryError } from '@enve-memory/core';

const openOnDisk = () => EnveMemory.open({ home: mkdtempSync(join(tmpdir(), 'enve-memory-files-')), actor: 'test' });
const bytes = (text: string) => new TextEncoder().encode(text);

test('text files become searchable file items backed by a content-addressed blob', () => {
  const memory = openOnDisk();
  memory.projects.create({ name: 'Garage' });
  const { item, created } = memory.files.save({
    data: bytes('Pinout: GPIO4 drives the relay.'), filename: 'pinout.md', project: 'garage', tags: ['wiring'],
  });
  assert.equal(created, true);
  assert.equal(item.type, 'file');
  assert.equal(item.title, 'pinout.md');
  assert.equal(item.content, 'Pinout: GPIO4 drives the relay.');
  assert.deepEqual(item.attachments.map((a) => [a.filename, a.mimeType, a.size]), [['pinout.md', 'text/markdown', 31]]);
  assert.deepEqual(memory.search.query('gpio4 relay').map((h) => h.id), [item.id]);

  const { path } = memory.files.primary(item.id);
  assert.ok(path.endsWith(join(item.attachments[0]!.sha256.slice(0, 2), item.attachments[0]!.sha256)));
  assert.equal(memory.files.read(item.id).data.toString(), 'Pinout: GPIO4 drives the relay.');
});

test('the same bytes saved again return the original, merging note and tags', () => {
  const memory = openOnDisk();
  const first = memory.files.save({ data: bytes('same'), filename: 'a.txt' });
  const second = memory.files.save({ data: bytes('same'), filename: 'copy-of-a.txt', note: 'Second copy', tags: ['dup'] });
  assert.equal(second.created, false);
  assert.equal(second.item.id, first.item.id);
  assert.equal(second.item.body, 'Second copy');
  assert.deepEqual(second.item.tags, ['dup']);
});

test('images and PDFs get their own handling', () => {
  const memory = openOnDisk();
  const image = memory.files.save({ data: bytes('\x89PNG fake'), filename: 'board.png' }).item;
  assert.equal(image.type, 'image');
  assert.equal(image.content, '');

  const pdf = memory.files.save({ data: bytes('%PDF-1.7 fake'), filename: 'spec.pdf' }).item;
  assert.equal(pdf.metadata.ingest?.status, 'pending');
  assert.deepEqual(memory.items.pendingIngest(), [pdf.id]);

  const typed = memory.files.save({ data: bytes('{"a":1}'), filename: 'blob', mimeType: 'application/json; charset=utf-8' }).item;
  assert.equal(typed.attachments[0]!.mimeType, 'application/json');
  assert.equal(typed.content, '{"a":1}');
});

test('deleting an item removes its blob only when nothing else uses it', () => {
  const memory = openOnDisk();
  const path = join(tmpdir(), `enve-memory-shared-${process.pid}.txt`);
  writeFileSync(path, 'shared bytes');
  const original = memory.files.saveFromPath(path).item;
  memory.items.archive(original.id);
  const reupload = memory.files.saveFromPath(path).item;
  assert.notEqual(reupload.id, original.id);
  const blob = memory.files.primary(reupload.id).path;

  memory.items.delete(original.id);
  assert.ok(existsSync(blob));
  memory.items.delete(reupload.id);
  assert.equal(existsSync(blob), false);
});

test('ingestion results fill gaps without overwriting what the user wrote', () => {
  const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
  const untitled = memory.items.saveLink({ url: 'https://example.com/a' }).item;
  const titled = memory.items.saveLink({ url: 'https://example.com/b', title: 'My title' }).item;
  assert.deepEqual(memory.items.pendingIngest(), [untitled.id, titled.id]);

  memory.actor = 'ingest';
  const filled = memory.items.setSource(untitled.id, {
    title: 'Page title', content: 'Readable article text about rolling codes', metadata: { siteName: 'Example', ingest: { status: 'done' } },
  });
  assert.equal(filled.title, 'Page title');
  assert.equal(filled.metadata.siteName, 'Example');
  assert.equal(memory.items.setSource(titled.id, { title: 'Page title', metadata: { ingest: { status: 'done' } } }).title, 'My title');
  assert.deepEqual(memory.items.pendingIngest(), []);
  assert.deepEqual(memory.search.query('rolling codes').map((h) => h.id), [untitled.id]);
  assert.equal(memory.activity.recent({ entityId: untitled.id })[0]?.op, 'ingest');

  assert.equal(memory.items.saveLink({ url: 'https://example.com/c', ingest: false }).item.metadata.ingest, undefined);
  memory.settings.set('fetchLinks', false);
  assert.equal(memory.items.saveLink({ url: 'https://example.com/d' }).item.metadata.ingest, undefined);
  assert.equal(memory.items.saveLink({ url: 'https://example.com/e', ingest: true }).item.metadata.ingest?.status, 'pending');
  assert.throws(() => memory.settings.set('fetchLinks', 'yes' as unknown as boolean), MemoryError);
});

test('in-memory libraries refuse files', () => {
  const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
  assert.throws(() => memory.files.save({ data: bytes('x'), filename: 'x.txt' }), MemoryError);
  assert.throws(() => openOnDisk().files.save({ data: new Uint8Array(), filename: 'empty.txt' }), /empty/);
});
