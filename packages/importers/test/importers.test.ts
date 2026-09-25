import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EnveMemory } from '@enve-memory/core';
import { importBookmarks, importCsv, importEnveExport, importMarkdownFolder, parseBookmarksHtml, parseCsv, parseMarkdownNote } from '@enve-memory/importers';

const temp = (label: string) => mkdtempSync(join(tmpdir(), `enve-memory-import-${label}-`));
const open = (home?: string) => {
  const memory = home ? EnveMemory.open({ home, actor: 'test' }) : EnveMemory.open({ inMemory: true, actor: 'test' });
  memory.settings.set('fetchLinks', false);
  return memory;
};

const BOOKMARKS = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><H3 ADD_DATE="1700000000">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://github.com/ratgdo/esphome-ratgdo" ADD_DATE="1700000100">ratgdo firmware</A>
    <DT><H3>Garage</H3>
    <DL><p>
      <DT><A HREF="https://example.com/security-plus" ADD_DATE="1700000200" TAGS="protocol,liftmaster">Security+ 2.0</A>
      <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="https://example.com/sourdough">Sourdough guide</A>
</DL><p>`;

test('browser bookmark exports keep folders as tags and skip bookmarklets', () => {
  const parsed = parseBookmarksHtml(BOOKMARKS);
  assert.deepEqual(parsed.map((b) => [b.title, b.folders.join('/'), b.tags.join(',')]), [
    ['ratgdo firmware', 'Bookmarks bar', ''],
    ['Security+ 2.0', 'Bookmarks bar/Garage', 'protocol,liftmaster'],
    ['Sourdough guide', '', ''],
  ]);
  assert.equal(parsed[0]!.addedAt, '2023-11-14T22:15:00.000Z');

  const memory = open();
  assert.deepEqual(importBookmarks(memory, BOOKMARKS), { created: 3, skipped: 0, failed: [] });
  const spec = memory.items.findByUrl('https://example.com/security-plus')!;
  assert.deepEqual(spec.tags, ['garage', 'liftmaster', 'protocol']);
  assert.equal(spec.source, 'import:bookmarks');
  assert.equal(spec.metadata.ingest, undefined, 'no mass fetching unless asked');
  assert.deepEqual(importBookmarks(memory, BOOKMARKS), { created: 0, skipped: 3, failed: [] });
});

test('Markdown folders import with front matter, headings, inline tags and dates, once', () => {
  const vault = temp('vault');
  mkdirSync(join(vault, 'Projects'));
  mkdirSync(join(vault, '.obsidian'));
  writeFileSync(join(vault, '.obsidian', 'workspace.md'), '# internal');
  writeFileSync(join(vault, 'Projects', 'garage.md'), '---\ntitle: Garage controller\ntags: [esp32, "home automation"]\ncreated: 2025-02-03\n---\nWire the relay to #hardware/relays.\n');
  writeFileSync(join(vault, 'Bench rig.md'), '# Bench rig plan\n\nTest before touching the opener.\n');
  writeFileSync(join(vault, 'empty.md'), '---\ntitle: nothing\n---\n');

  const note = parseMarkdownNote('x.md', '---\ntags:\n  - one\n  - two\n---\nbody #three');
  assert.deepEqual(note.tags, ['one', 'two', 'three']);

  const memory = open();
  assert.deepEqual(importMarkdownFolder(memory, vault), { created: 2, skipped: 1, failed: [] });
  const [hit] = memory.search.query('relay');
  const garage = memory.items.get(hit!.id);
  assert.equal(garage.title, 'Garage controller');
  assert.deepEqual(garage.tags, ['esp32', 'hardware-relays', 'home-automation']);
  assert.equal(garage.createdAt, '2025-02-03T00:00:00.000Z');
  assert.equal(memory.items.get(memory.search.query('opener')[0]!.id).title, 'Bench rig plan');
  assert.equal(importMarkdownFolder(memory, vault).created, 0, 're-running skips what was imported');
});

test('CSV bookmark exports map common columns and report bad rows', () => {
  const csv = '﻿id,title,note,excerpt,url,folder,tags,created\n'
    + '1,"ratgdo, the board","Local control ""no cloud""",,https://ratgdo.example,Garage,"esp32, hardware",2024-01-01\n'
    + '2,No link,,,,Unsorted,,\n'
    + '3,"Multi\nline title",,,https://example.com/multi,Unsorted,,\n';
  assert.deepEqual(parseCsv('a,"b,c"\n"d ""e"""\n'), [['a', 'b,c'], ['d "e"']]);

  const memory = open();
  const result = importCsv(memory, csv);
  assert.equal(result.created, 2);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0]!.error, /Row 3 has no http/);
  const ratgdo = memory.items.findByUrl('https://ratgdo.example')!;
  assert.equal(ratgdo.title, 'ratgdo, the board');
  assert.equal(ratgdo.body, 'Local control "no cloud"');
  assert.deepEqual(ratgdo.tags, ['esp32', 'garage', 'hardware']);
  assert.throws(() => importCsv(open(), 'title,notes\nx,y\n'), /needs a "url"/);
});

test('an Enve export restores into a fresh library with ids, dates, files and history intact', () => {
  const source = open(temp('source'));
  source.projects.create({ name: 'Garage Door', instructions: 'Offline only.' });
  source.projects.setMemory('garage', '# Goal');
  const first = source.decisions.record({ project: 'garage', decision: 'Use ESP32' });
  const second = source.decisions.record({ project: 'garage', decision: 'Use ESP32-S3', supersedes: [first.id] });
  const task = source.tasks.create({ title: 'Order relays', project: 'garage', due: '2026-10-01', priority: 'high' });
  source.tasks.complete(task.id);
  const note = source.items.saveNote({ title: 'Wiring', body: 'Dry contact', project: 'garage', tags: ['wiring'] });
  const link = source.items.saveLink({ url: 'https://example.com/spec', title: 'Spec', ingest: false }).item;
  source.items.setSource(link.id, { content: 'archived spec text', metadata: { siteName: 'Example' } });
  source.items.relate(note.id, link.id, 'references');
  const file = source.files.save({ data: new TextEncoder().encode('pin map'), filename: 'pins.txt', project: 'garage' }).item;
  const old = source.items.saveNote({ body: 'archived thought' });
  source.items.archive(old.id);
  const out = join(temp('export'), 'export');
  source.exports.write(out);

  const target = open(temp('target'));
  const result = importEnveExport(target, out);
  assert.deepEqual(result.failed, []);
  assert.equal(target.projects.resolve('garage').memory, '# Goal');
  assert.equal(target.projects.resolve('garage').instructions, 'Offline only.');
  assert.equal(target.decisions.list('garage').find((d) => d.id === first.id)?.supersededBy, second.id);
  assert.equal(target.tasks.get(task.id).task.status, 'done');
  assert.equal(target.tasks.get(task.id).task.priority, 'high');
  assert.equal(target.items.get(note.id).createdAt, note.createdAt);
  assert.deepEqual(target.items.get(note.id).tags, ['wiring']);
  assert.equal(target.items.get(link.id).content, 'archived spec text');
  assert.equal(target.items.get(link.id).metadata.siteName, 'Example');
  assert.deepEqual(target.items.get(note.id).relations.map((r) => r.id), [link.id]);
  assert.ok(target.items.get(old.id).archivedAt);
  const restoredFile = target.search.query('pins')[0]!;
  assert.equal(target.files.read(restoredFile.id).data.toString(), 'pin map');
  assert.ok(file.id);

  const again = importEnveExport(target, out);
  assert.equal(again.created, 0);
  assert.deepEqual(again.failed, []);
});
