import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnveMemory, MemoryError } from '@enve-memory/core';

test('tokens authenticate until revoked, and only their hash is stored', () => {
  const home = mkdtempSync(join(tmpdir(), 'enve-memory-clients-'));
  const memory = EnveMemory.open({ home, actor: 'test' });
  const { client, token } = memory.clients.create('Chrome extension', ['capture', 'capture']);
  assert.match(token, /^em_[\w-]{43}$/);
  assert.deepEqual(client.scopes, ['capture']);
  assert.equal(memory.clients.authenticate(token)?.id, client.id);
  assert.equal(memory.clients.authenticate(`${token}x`), null);
  assert.equal(memory.clients.authenticate('Bearer nonsense'), null);
  assert.ok(memory.clients.get(client.id).lastUsedAt);

  memory.clients.revoke(client.id);
  assert.equal(memory.clients.authenticate(token), null);
  memory.close();

  const raw = new DatabaseSync(join(home, 'memory.sqlite'));
  const dump = JSON.stringify(raw.prepare('SELECT * FROM api_clients').all());
  raw.close();
  assert.equal(dump.includes(token), false);
  assert.equal(dump.includes(token.slice(3)), false);
});

test('clients need a name and known scopes', () => {
  const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
  assert.throws(() => memory.clients.create('x', []), MemoryError);
  assert.throws(() => memory.clients.create('x', ['admin']), MemoryError);
  assert.throws(() => memory.clients.create(' ', ['read']), MemoryError);
});
