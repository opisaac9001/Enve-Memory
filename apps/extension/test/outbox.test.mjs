import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiError, createClient } from '../src/lib/api.js';
import { installFakeBrowser } from './support/fake-browser.mjs';
import { startScratchServer } from './support/scratch-server.mjs';

const storage = installFakeBrowser();
const { drain, flushOutbox, listOutbox, saveCapture, summarize, retryFailed, discardFailed } = await import('../src/lib/outbox.js');
const { unshownReminders } = await import('../src/lib/reminders.js');

const entry = (key, extra = {}) => ({ key, payload: { note: key }, queuedAt: `2026-09-25T00:00:0${key.length}Z`, ...extra });

describe('drain', () => {
  test('sends in order and marks per-entry failures without stopping', async () => {
    const sent = [];
    const result = await drain([entry('a'), entry('bb'), entry('ccc'), entry('dddd', { error: 'old' })], async ({ key }) => {
      if (key === 'bb') throw new ApiError('not_found', 'No project matches "gone".', 404);
      sent.push(key);
    });
    assert.deepEqual(sent, ['a', 'ccc']);
    assert.deepEqual(result.sent, ['a', 'ccc']);
    assert.deepEqual(result.failed.map((f) => f.key), ['bb']);
    assert.equal(result.stoppedBy, null);
  });

  test('stops at the first error that is not about the entry itself', async () => {
    for (const code of ['offline', 'timeout', 'locked', 'in_progress', 'unauthorized', 'insufficient_scope', 'internal']) {
      const result = await drain([entry('a'), entry('bb')], async ({ key }) => {
        if (key === 'a') throw new ApiError(code, code);
      });
      assert.deepEqual(result.sent, [], code);
      assert.equal(result.stoppedBy.code, code);
    }
  });

  test('summarize counts waiting and failed', () => {
    assert.deepEqual(summarize([entry('a'), entry('bb', { error: 'x' }), entry('ccc')]), { waiting: 2, failed: 1 });
  });
});

describe('outbox against a real server', () => {
  let server;
  let client;

  before(async () => {
    server = await startScratchServer();
    client = createClient({ serverUrl: server.url, token: await server.token('Chrome', 'read,capture') });
  });
  after(() => server?.stop());

  test('queues while the server is down and flushes once it is back, without duplicates', async () => {
    await server.pause();
    const first = await saveCapture(client, { url: 'https://example.com/offline-1', title: 'Offline one' }, server.url);
    const second = await saveCapture(client, { note: 'Jotted offline' }, server.url);
    assert.deepEqual([first, second], [{ queued: true }, { queued: true }]);
    const queued = await listOutbox();
    assert.equal(queued.length, 2);
    assert.ok(Object.keys(storage).every((key) => !key.startsWith('outbox:') || queued.some((e) => `outbox:${e.key}` === key)));

    const stillDown = await flushOutbox(client, server.url);
    assert.equal(stillDown.stoppedBy.code, 'offline');
    assert.equal((await listOutbox()).length, 2);

    await server.resume();
    // As if the note had reached the server just before the connection dropped: flushing reuses its key, so no copy.
    const note = queued.find((e) => e.payload.note);
    await client.capture(note.payload, { idempotencyKey: note.key });
    const flushed = await flushOutbox(client, server.url);
    assert.equal(flushed.sent.length, 2);
    assert.deepEqual(await listOutbox(), []);
    assert.equal((await client.lookup('https://example.com/offline-1')).title, 'Offline one');
    const notes = await client.items({ type: 'note' });
    assert.equal(notes.filter((n) => n.body === 'Jotted offline').length, 1);
  });

  test('a later successful save flushes the queue', async () => {
    await server.pause();
    await saveCapture(client, { url: 'https://example.com/offline-2' }, server.url);
    await server.resume();
    const saved = await saveCapture(client, { url: 'https://example.com/online' }, server.url);
    assert.equal(saved.queued, false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(await listOutbox(), []);
    assert.ok(await client.lookup('https://example.com/offline-2'));
  });

  test('an entry the server rejects is kept as failed, then retried or discarded', async () => {
    await server.pause();
    await saveCapture(client, { url: 'https://example.com/bad-project', project: 'no-such-project' }, server.url);
    await server.resume();
    await flushOutbox(client, server.url);
    const [failed] = await listOutbox();
    assert.match(failed.error, /no-such-project|No project/);
    await retryFailed();
    assert.equal((await listOutbox())[0].error, undefined);
    await flushOutbox(client, server.url);
    await discardFailed();
    assert.deepEqual(await listOutbox(), []);
  });

  test('errors that retrying cannot fix are thrown, not queued', async () => {
    const bad = createClient({ serverUrl: server.url, token: 'em_wrong' });
    await assert.rejects(saveCapture(bad, { note: 'x' }, server.url), { code: 'unauthorized' });
    assert.deepEqual(await listOutbox(), []);
  });
});

test('unshownReminders skips reminders already shown at the same time', () => {
  const due = [
    { id: 'a', remindAt: '2026-09-25T09:00:00.000Z' },
    { id: 'b', remindAt: '2026-09-25T10:00:00.000Z' },
  ];
  assert.deepEqual(unshownReminders(due, ['a@2026-09-25T09:00:00.000Z']).map((i) => i.id), ['b']);
  assert.deepEqual(unshownReminders(due, ['a@2026-09-24T09:00:00.000Z']).map((i) => i.id), ['a', 'b']);
});
