import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createClient, describeError } from '../src/lib/api.js';
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

  test('a stopped server reads as offline', async () => {
    const offline = createClient({ serverUrl: 'http://127.0.0.1:9', token: 'em_x', timeoutMs: 2000 });
    await assert.rejects(offline.status(), (error) => {
      assert.equal(error.code, 'offline');
      assert.match(describeError(error, 'http://127.0.0.1:9'), /run `enve-memory serve`/);
      return true;
    });
  });
});
