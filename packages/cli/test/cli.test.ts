import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

const tempHome = () => mkdtempSync(join(tmpdir(), 'enve-memory-cli-'));

function cli(home: string, args: string[], input?: string) {
  const result = spawnSync(process.execPath, [MAIN, '--home', home, ...args], { encoding: 'utf8', input });
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

const json = (home: string, args: string[]) => {
  const result = cli(home, [...args, '--json']);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test('capture, organize and find from the command line', () => {
  const home = tempHome();
  json(home, ['project', 'new', 'Garage Door', '--instructions', 'Offline only.']);
  const note = json(home, ['note', 'Garage', 'opener', 'uses', 'Security+', '2.0', '-p', 'garage door', '-t', 'protocol']);
  assert.equal(note.body, 'Garage opener uses Security+ 2.0');
  assert.deepEqual(note.tags, ['protocol']);

  const task = json(home, ['task', 'add', 'Order', 'ESP32', '-p', 'garage', '--due', '2026-10-01']);
  assert.equal(json(home, ['task', 'done', task.id]).task.status, 'done');

  const hits = json(home, ['search', 'security', 'opener']);
  assert.deepEqual(hits.map((h: { id: string }) => h.id), [note.id]);

  const memory = cli(home, ['project', 'memory', 'garage', '--set', '-'], '# Goal\nLocal control\n');
  assert.equal(memory.code, 0, memory.stderr);
  assert.match(cli(home, ['project', 'show', 'garage']).stdout, /## Instructions\nOffline only\.[\s\S]*## Memory\n# Goal/);
});

test('errors are reported with distinct exit codes', () => {
  const home = tempHome();
  assert.equal(cli(home, ['show', 'nope']).code, 1);
  assert.equal(cli(home, ['frobnicate']).code, 2);
  assert.equal(cli(home, ['--nonsense']).code, 2);

  const note = json(home, ['note', 'temporary']);
  const refused = cli(home, ['delete', note.id]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /--yes/);
  assert.equal(cli(home, ['show', note.id]).code, 0);
  assert.equal(cli(home, ['delete', note.id, '--yes']).code, 0);
  assert.equal(cli(home, ['show', note.id]).code, 1);
});

test('connect prints a working command for each client', () => {
  const { stdout } = cli(tempHome(), ['connect']);
  assert.match(stdout, /claude mcp add --scope user enve-memory -- /);
  assert.match(stdout, /\[mcp_servers\.enve-memory\]/);
  assert.ok(stdout.includes(JSON.stringify(MAIN)));
});

test('an MCP client over stdio shares the same library as the CLI', async () => {
  const home = tempHome();
  json(home, ['project', 'new', 'Garage Door']);
  json(home, ['link', 'https://example.com/ratgdo', '--title', 'ratgdo firmware', '-p', 'garage']);

  const client = new Client({ name: 'claude-code', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [MAIN, 'mcp', '--home', home], stderr: 'pipe' }));
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      return JSON.parse((result.content as { text: string }[])[0]!.text);
    };
    const briefing = await call('get_project', { project: 'Garage Door' });
    assert.equal(briefing.recentItems[0].title, 'ratgdo firmware');
    await call('create_task', { project: 'Garage Door', title: 'Build Security+ 2.0 bench simulator' });
  } finally {
    await client.close();
  }

  const [task] = json(home, ['task', 'list', '-p', 'garage']);
  assert.equal(task.title, 'Build Security+ 2.0 bench simulator');
  assert.equal(task.source, 'mcp:claude-code');
});

test('serve exposes the library over HTTP to token holders', async () => {
  const home = tempHome();
  const { token, client } = json(home, ['clients', 'add', 'Phone', '--scope', 'read,capture']);
  assert.deepEqual(client.scopes, ['read', 'capture']);
  assert.match(cli(home, ['clients', 'list']).stdout, /Phone {2}\(read, capture\) {2}em_/);

  const server = spawn(process.execPath, [MAIN, '--home', home, 'serve', '--port', '0']);
  try {
    let log = '';
    server.stderr.setEncoding('utf8');
    while (!/listening on (\S+)/.test(log)) log += (await once(server.stderr, 'data'))[0];
    const base = /listening on (\S+)/.exec(log)![1]!;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const saved = await fetch(`${base}/api/v1/capture`, { method: 'POST', headers, body: JSON.stringify({ selection: 'from the phone' }) });
    assert.equal(saved.status, 201);
    const hits = (await (await fetch(`${base}/api/v1/search?q=phone`, { headers })).json()) as { snippet: string }[];
    assert.equal(hits[0]?.snippet, '> from the [phone]');
  } finally {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
  assert.equal(json(home, ['list'])[0].source, 'api:Phone');
});
