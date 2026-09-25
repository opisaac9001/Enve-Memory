import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { after, test } from 'node:test';
import { createApiServer, pairingLink } from '@enve-memory/api';
import { EnveMemory } from '@enve-memory/core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
const api = createApiServer(memory, { version: '0.0.0-test', port: 0 });
const base = await api.listen();
after(() => api.close());

const tokenFor = (name: string, scopes: string[]) => memory.clients.create(name, scopes).token;
const reader = tokenFor('reader', ['read']);
const extension = tokenFor('Chrome extension', ['capture']);
const writer = tokenFor('phone', ['read', 'write']);

async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
}

test('status is public; everything else needs a valid token', async () => {
  assert.deepEqual((await call('GET', '/api/v1/status')).data, { name: 'enve-memory', version: '0.0.0-test', api: 1 });
  const anonymous = await call('GET', '/api/v1/search?q=x');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('www-authenticate'), 'Bearer');
  assert.equal((await call('GET', '/api/v1/search?q=x', 'em_forged')).status, 401);
  assert.equal((await call('GET', '/api/v1/whoami', reader)).data.name, 'reader');
});

test('revoked tokens stop working immediately', async () => {
  const { client, token } = memory.clients.create('temporary', ['read']);
  assert.equal((await call('GET', '/api/v1/whoami', token)).status, 200);
  memory.clients.revoke(client.id);
  assert.equal((await call('GET', '/api/v1/whoami', token)).status, 401);
});

test('web pages are rejected; extensions and loopback pages are allowed', async () => {
  const evil = await call('GET', '/api/v1/whoami', reader, undefined, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal(evil.data.error.code, 'forbidden_origin');

  const ext = await call('GET', '/api/v1/whoami', reader, undefined, { Origin: 'chrome-extension://abcdefghijklmnop' });
  assert.equal(ext.status, 200);
  assert.equal(ext.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnop');
  assert.equal((await call('OPTIONS', '/api/v1/capture', undefined, undefined, { Origin: 'moz-extension://x' })).status, 204);
  assert.equal((await call('GET', '/api/v1/whoami', reader, undefined, { Origin: 'http://localhost:6274' })).status, 200);
});

test('a forged Host header (DNS rebinding) is rejected', async () => {
  const { port } = new URL(base);
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/v1/status', headers: { Host: `attacker.example:${port}` } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('a capture-only client can save but not read or edit', async () => {
  const saved = await call('POST', '/api/v1/capture', extension, {
    url: 'https://example.com/ratgdo', title: 'ratgdo', note: 'Firmware for Security+ 2.0', selection: 'Works with yellow learn buttons\nLocal only',
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.data.created, true);
  assert.equal(saved.data.item.body, 'Firmware for Security+ 2.0\n\n> Works with yellow learn buttons\n> Local only');
  assert.equal(saved.data.item.source, 'api:Chrome extension');

  const again = await call('POST', '/api/v1/capture', extension, { url: 'https://example.com/ratgdo', note: 'Check wiring diagram' });
  assert.equal(again.data.created, false);
  assert.match(again.data.item.body, /Check wiring diagram$/);

  const denied = await call('GET', '/api/v1/search?q=ratgdo', extension);
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error.code, 'insufficient_scope');
  assert.equal((await call('PATCH', `/api/v1/items/${saved.data.item.id}`, extension, { title: 'x' })).status, 403);

  const found = await call('GET', `/api/v1/lookup?url=${encodeURIComponent('https://example.com/ratgdo')}`, reader);
  assert.equal(found.data.item.id, saved.data.item.id);
  assert.equal((await call('GET', '/api/v1/lookup?url=https%3A%2F%2Fexample.com%2Fnope', reader)).data.item, null);

  const note = await call('POST', '/api/v1/capture', extension, { selection: 'A quote with no URL' });
  assert.equal(note.data.item.type, 'note');
});

test('a writer can run the whole project workflow over REST', async () => {
  const project = await call('POST', '/api/v1/projects', writer, { name: 'Garage Door', instructions: 'Offline only.' });
  assert.equal(project.status, 201);
  const task = await call('POST', '/api/v1/items', writer, { type: 'task', title: 'Order ESP32', project: 'garage', due: '2026-10-01' });
  assert.equal(task.status, 201);
  await call('POST', '/api/v1/projects/garage/decisions', writer, { decision: 'Use ESP32-S3', reason: 'USB host' });
  await call('PUT', '/api/v1/projects/garage/memory', writer, { memory: '# Goal\nLocal control' });
  assert.equal((await call('POST', `/api/v1/tasks/${task.data.id}/complete`, writer)).data.task.status, 'done');

  const briefing = await call('GET', '/api/v1/projects/garage-door', writer);
  assert.equal(briefing.data.project.memory, '# Goal\nLocal control');
  assert.equal(briefing.data.decisions[0].decision, 'Use ESP32-S3');
  assert.equal(briefing.data.openTasks.length, 0);

  const hits = await call('GET', '/api/v1/search?q=esp32&project=garage', writer);
  assert.equal(hits.data.length, 2);
});

test('errors map to HTTP statuses with a machine-readable code', async () => {
  assert.equal((await call('GET', '/api/v1/items/nope', reader)).status, 404);
  assert.equal((await call('POST', '/api/v1/items', writer, '{not json')).status, 400);
  assert.equal((await call('POST', '/api/v1/items', writer, { type: 'video' })).data.error.code, 'invalid');
  assert.equal((await call('POST', '/api/v1/items', writer, { type: 'note', body: 7 })).data.error.message, '"body" must be a string.');
  assert.equal((await call('POST', '/api/v1/projects', writer, { name: 'Garage Door' })).status, 409);
  assert.equal((await call('GET', '/api/v1/nowhere', reader)).status, 404);
});

test('MCP over HTTP honors the token and its scopes, in both protocol eras', async () => {
  const connect = async (token: string, mode: 'legacy' | 'auto' = 'legacy') => {
    const client = new Client({ name: 'remote-agent', version: '1.0.0' }, { versionNegotiation: { mode } });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    return client;
  };
  const saveNote = async (client: Client, text: string) => {
    const result = await client.callTool({ name: 'save_note', arguments: { text } });
    return JSON.parse((result.content as { text: string }[])[0]!.text) as { id: string };
  };

  const readClient = await connect(reader);
  const tools = (await readClient.listTools()).tools.map((t) => t.name);
  assert.ok(tools.includes('search'));
  assert.equal(tools.includes('save_note'), false);
  await readClient.close();

  // Stateless 2025-era HTTP requests don't repeat clientInfo, so attribution falls back to the token's name.
  const legacy = await connect(writer);
  assert.equal(memory.items.get((await saveNote(legacy, 'Saved over legacy HTTP MCP')).id).source, 'mcp:phone');
  await legacy.close();

  const modern = await connect(writer, 'auto');
  assert.equal(memory.items.get((await saveNote(modern, 'Saved over 2026 HTTP MCP')).id).source, 'mcp:remote-agent');
  await modern.close();

  await assert.rejects(connect('em_forged'));
});

test('pairing links carry the server, token and device name', () => {
  const link = new URL(pairingLink('http://192.168.1.20:49231', 'em_abc', 'Isaac\'s iPhone'));
  assert.equal(link.protocol, 'enve-memory:');
  assert.equal(link.searchParams.get('url'), 'http://192.168.1.20:49231');
  assert.equal(link.searchParams.get('token'), 'em_abc');
  assert.equal(link.searchParams.get('name'), "Isaac's iPhone");
});
