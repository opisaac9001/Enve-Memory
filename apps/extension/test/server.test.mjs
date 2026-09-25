import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createClient, describeError } from '../src/lib/api.js';
import { bookmarkEntries, importEntries } from '../src/lib/bookmarks.js';
import { startScratchServer } from './support/scratch-server.mjs';

describe('client against a real enve-memory serve', () => {
  let server;
  let client;
  let project;

  before(async () => {
    server = await startScratchServer();
    project = await server.cli('project', 'new', 'Garage Door');
    client = createClient({ serverUrl: server.url, token: await server.token('Chrome', 'read,capture') });
  });
  after(() => server?.stop());

  test('status and whoami', async () => {
    assert.equal((await client.status()).name, 'enve-memory');
    const me = await client.whoami();
    assert.equal(me.name, 'Chrome');
    assert.deepEqual(me.scopes, ['read', 'capture']);
  });

  test('projects lists the library', async () => {
    const projects = await client.projects();
    assert.deepEqual(projects.map((p) => [p.id, p.name]), [[project.id, 'Garage Door']]);
  });

  test('capture creates a bookmark, lookup finds it, and a re-save merges', async () => {
    const url = 'https://example.com/security-plus-2';
    assert.equal(await client.lookup(url), null);

    const first = await client.capture({
      url, title: 'Security+ 2.0 protocol', selection: 'Rolling code\nfixed code', note: 'Read before the bench rig', project: project.id, tags: ['protocol', 'esp32'],
    });
    assert.equal(first.created, true);
    assert.equal(first.item.type, 'bookmark');
    assert.equal(first.item.title, 'Security+ 2.0 protocol');
    assert.equal(first.item.project.name, 'Garage Door');
    assert.deepEqual(first.item.tags, ['esp32', 'protocol']);
    assert.equal(first.item.body, 'Read before the bench rig\n\n> Rolling code\n> fixed code');

    const found = await client.lookup(url);
    assert.equal(found.id, first.item.id);

    const again = await client.capture({ url, note: 'Also covers the wall button', tags: ['garage'] });
    assert.equal(again.created, false);
    assert.equal(again.item.id, first.item.id);
    assert.deepEqual(again.item.tags, ['esp32', 'garage', 'protocol']);
    assert.match(again.item.body, /Also covers the wall button$/);
  });

  test('capture without a URL saves a note', async () => {
    const { item, created } = await client.capture({ title: 'Settings page', note: 'jot' });
    assert.equal(created, true);
    assert.equal(item.type, 'note');
  });

  test('an unknown project is a readable 404', async () => {
    await assert.rejects(client.capture({ url: 'https://example.com/x', project: 'no-such-project' }), (error) => {
      assert.equal(error.status, 404);
      assert.equal(describeError(error), error.message);
      return true;
    });
  });

  test('a bad token maps to the create-a-token hint', async () => {
    const bad = createClient({ serverUrl: server.url, token: 'em_not-a-real-token' });
    await assert.rejects(bad.whoami(), (error) => {
      assert.equal(error.code, 'unauthorized');
      assert.match(describeError(error), /enve-memory clients add "Browser" --scope read,capture/);
      return true;
    });
  });

  test('a read-only token cannot capture', async () => {
    const readOnly = createClient({ serverUrl: server.url, token: await server.token('Reader', 'read') });
    await assert.rejects(readOnly.capture({ url: 'https://example.com/y' }), { code: 'insufficient_scope', status: 403 });
  });

  test('whoami works for a capture-only token', async () => {
    const captureOnly = createClient({ serverUrl: server.url, token: await server.token('Capture only', 'capture') });
    assert.deepEqual((await captureOnly.whoami()).scopes, ['capture']);
  });

  test('capture sets intent, reminder and pin; shelves and reminders find them', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { item } = await client.capture({ url: 'https://example.com/watch-later', title: 'Talk', intent: 'watch', remind: past, pinned: true });
    assert.equal(item.intent, 'watch');
    assert.ok(item.pinnedAt);
    assert.equal(item.remindAt, past);

    const ids = (list) => list.map((i) => i.id);
    assert.ok(ids(await client.items({ intent: 'watch' })).includes(item.id));
    assert.ok(ids(await client.items({ pinned: true })).includes(item.id));
    assert.ok(ids(await client.items({ reminders: true })).includes(item.id));
    assert.ok(ids(await client.items({ unopened: 0 })).includes(item.id));
    assert.ok(ids(await client.dueReminders()).includes(item.id));

    await client.reminded(item.id);
    assert.ok(!ids(await client.dueReminders()).includes(item.id), 'delivered reminders leave the due list');
    assert.ok(ids(await client.items({ reminders: true })).includes(item.id), 'but stay on the shelf');

    await client.opened(item.id);
    assert.ok(!ids(await client.items({ unopened: 0 })).includes(item.id));
    assert.ok((await client.item(item.id)).openedAt);
  });

  test('re-saving with a capture-only token changes the intent', async () => {
    const url = 'https://example.com/intent-change';
    assert.equal((await client.capture({ url, intent: 'read' })).item.intent, 'read');
    const { item, created } = await client.capture({ url, intent: 'buy' });
    assert.equal(created, false);
    assert.equal(item.intent, 'buy');
  });

  test('write-scope edits: unpin, intent, reminder; accept without suggestions is a readable 400', async () => {
    const writer = createClient({ serverUrl: server.url, token: await server.token('Writer', 'read,write') });
    const { item } = await writer.capture({ url: 'https://example.com/editable', pinned: true, remind: 'tomorrow' });
    assert.equal((await writer.pin(item.id, false)).pinnedAt, null);
    assert.equal((await writer.setIntent(item.id, 'buy')).intent, 'buy');
    assert.equal((await writer.setReminder(item.id, null)).remindAt, null);
    await assert.rejects(writer.accept(item.id), (error) => error.status === 400 && /no suggestions/.test(describeError(error)));
    await assert.rejects(client.pin(item.id, true), { code: 'insufficient_scope' });
  });

  test('search and related', async () => {
    await client.capture({ url: 'https://example.com/rolling-codes', title: 'Rolling codes explained' });
    const hits = await client.search('rolling');
    assert.ok(hits.some((h) => h.title === 'Rolling codes explained' && h.match === 'keyword'));
    const related = await client.related('https://example.com/unsaved-page', 'rolling codes garage', 5);
    assert.ok(related.some((h) => h.title === 'Rolling codes explained'));
    const self = await client.related('https://example.com/rolling-codes', 'rolling', 5);
    assert.ok(!self.some((h) => h.url === 'https://example.com/rolling-codes'));
  });

  test('bookmark import through /capture/batch: created, already saved and failed, and a replayed chunk', async () => {
    const tree = [{ id: '0', title: '', children: [{ id: '1', title: 'Bookmarks bar', children: [
      { id: '2', title: 'Garage Door', children: [
        { id: '3', title: 'Security+', url: 'https://example.com/security-plus-2', dateAdded: Date.UTC(2020, 0, 1) },
        { id: '4', title: 'Opener manual', url: 'https://example.com/manual', dateAdded: Date.UTC(2021, 5, 15, 12) },
      ] },
    ] }] }];
    const originalDate = (await client.lookup('https://example.com/security-plus-2')).createdAt;
    const entries = [...bookmarkEntries(tree), { url: 'https://example.com/x', project: 'no-such-project' }];
    const totals = await importEntries(client, entries, { runId: 'server-test', size: 2 });
    assert.deepEqual({ created: totals.created, skipped: totals.skipped, failed: totals.failed }, { created: 1, skipped: 1, failed: 1 });
    assert.deepEqual((await client.lookup('https://example.com/security-plus-2')).tags, ['esp32', 'garage', 'garage-door', 'protocol']);
    assert.deepEqual((await client.lookup('https://example.com/manual')).tags, ['garage-door']);
    assert.equal((await client.lookup('https://example.com/manual')).createdAt, '2021-06-15T12:00:00.000Z');
    assert.equal((await client.lookup('https://example.com/security-plus-2')).createdAt, originalDate, 'only new bookmarks take the date');

    const replay = await importEntries(client, entries, { runId: 'server-test', size: 2 });
    assert.deepEqual({ created: replay.created, skipped: replay.skipped, failed: replay.failed }, { created: 1, skipped: 1, failed: 1 });
  });

  test('a stopped server reads as offline', async () => {
    const offline = createClient({ serverUrl: 'http://127.0.0.1:9', token: 'em_x', timeoutMs: 2000 });
    await assert.rejects(offline.status(), (error) => {
      assert.equal(error.code, 'offline');
      assert.match(describeError(error, 'http://127.0.0.1:9'), /run `enve-memory serve`/);
      return true;
    });
  });
});
