import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createApiServer } from '@enve-memory/api';
import { EnveMemory } from '@enve-memory/core';

const memory = EnveMemory.open({ home: mkdtempSync(join(tmpdir(), 'enve-memory-api-files-')), actor: 'test' });
const api = createApiServer(memory, { version: '0.0.0-test', port: 0 });
const base = await api.listen();
const phone = memory.clients.create('phone', ['read', 'capture']).token;
const reader = memory.clients.create('reader', ['read']).token;

const site = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<html><head><title>Bench rig</title></head><body><article><p>${'Solder the optocoupler before powering the bench rig. '.repeat(8)}</p></article></body></html>`);
});
await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
after(async () => {
  site.close();
  await api.close();
});

const upload = (token: string, data: Uint8Array, headers: Record<string, string>) =>
  fetch(`${base}/api/v1/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body: data });

test('files upload with percent-encoded metadata and download byte-for-byte', async () => {
  memory.projects.create({ name: 'Garage' });
  const photo = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  const response = await upload(phone, photo, {
    'Content-Type': 'image/png',
    'X-Filename': encodeURIComponent('Tür-Öffner.png'),
    'X-Note': encodeURIComponent('Opener board, Rückseite'),
    'X-Project': 'garage',
    'X-Tags': 'photo, board',
  });
  assert.equal(response.status, 201);
  const { item, created } = (await response.json()) as { item: { id: string; type: string; title: string; body: string; tags: string[]; project: { name: string } }; created: boolean };
  assert.equal(created, true);
  assert.equal(item.type, 'image');
  assert.equal(item.title, 'Tür-Öffner.png');
  assert.equal(item.body, 'Opener board, Rückseite');
  assert.deepEqual(item.tags, ['board', 'photo']);
  assert.equal(item.project.name, 'Garage');

  const download = await fetch(`${base}/api/v1/items/${item.id}/file`, { headers: { Authorization: `Bearer ${reader}` } });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'image/png');
  assert.match(download.headers.get('content-disposition')!, /filename\*=UTF-8''T%C3%BCr-%C3%96ffner\.png/);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), photo);
});

test('uploading needs the capture scope', async () => {
  const response = await upload(reader, new Uint8Array([1]), { 'X-Filename': 'x.bin' });
  assert.equal(response.status, 403);
});

test('captured links are fetched in the background after the response', async () => {
  const response = await fetch(`${base}/api/v1/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${phone}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `http://127.0.0.1:${(site.address() as AddressInfo).port}/rig` }),
  });
  const { item } = (await response.json()) as { item: { id: string; metadata: { ingest: { status: string } } } };
  assert.equal(item.metadata.ingest.status, 'pending');
  await api.ingest.idle();
  const done = memory.items.get(item.id);
  assert.equal(done.title, 'Bench rig');
  assert.equal(done.metadata.ingest?.status, 'done');
  assert.match(done.content, /optocoupler/);
});

test('a file whose bytes have not arrived yet is a 404, not a crash', async () => {
  const saved = memory.files.save({ data: new TextEncoder().encode('bytes'), filename: 'gone.txt' }).item;
  const { rmSync } = await import('node:fs');
  rmSync(memory.files.primary(saved.id).path);
  const response = await fetch(`${base}/api/v1/items/${saved.id}/file`, { headers: { Authorization: `Bearer ${reader}` } });
  assert.equal(response.status, 404);
  const alive = await fetch(`${base}/api/v1/status`);
  assert.equal(alive.status, 200);
  assert.equal((await fetch(`${base}/api/v1/items/%E0%A4%A/file`, { headers: { Authorization: `Bearer ${reader}` } })).status, 400);
});
