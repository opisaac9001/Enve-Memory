// Smoke-tests a packaged macOS app against a throwaway library:
//   node scripts/verify-dist.mjs ["/path/to/Enve Memory.app"]
// 1. the bundled CLI runs under the app's own runtime (ELECTRON_RUN_AS_NODE) and serves MCP over stdio,
// 2. the app starts, answers /api/v1/status on a free port, and quits cleanly,
// 3. if the embedding model is already cached, the app's semantic indexer (onnxruntime-node) runs in the packaged app.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { root } from './bundle.mjs';

const app = resolve(process.argv[2] ?? join(root, 'release', 'mac-arm64', 'Enve Memory.app'));
const executable = join(app, 'Contents', 'MacOS', 'Enve Memory');
const cli = join(app, 'Contents', 'Resources', 'cli.mjs');
const home = mkdtempSync(join(tmpdir(), 'enve-dist-'));
const cache = [join(root, '..', '..', '.cache'), join(homedir(), 'Library', 'Caches', 'Enve Memory')]
  .find((dir) => existsSync(join(dir, 'models', 'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model_quantized.onnx')));
const env = { ...process.env, ENVE_MEMORY_HOME: home, ...(cache ? { ENVE_MEMORY_CACHE: cache } : {}) };
const nodeEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' };
const runCli = (...args) => JSON.parse(execFileSync(executable, [cli, '--home', home, '--json', ...args], { env: nodeEnv, encoding: 'utf8' }));

const freePort = () => new Promise((done) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => done(port));
  });
});

async function waitFor(check, what, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check().catch(() => undefined);
    if (value) return value;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

try {
  runCli('settings', 'fetchLinks', 'false');
  runCli('settings', 'semanticSearch', cache ? 'true' : 'false');
  console.log(`library ${home}; semantic search ${cache ? `on (model cache ${cache})` : 'off (no cached model)'}`);

  const client = new Client({ name: 'dist-check', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: executable, args: [cli, 'mcp'], env: nodeEnv, stderr: 'pipe' }));
  const info = client.getServerVersion();
  assert.equal(info?.name, 'enve-memory');
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(tools.includes('save_note') && tools.includes('search'));
  await client.callTool({ name: 'save_note', arguments: { text: 'The garage door opener uses rolling codes so a recorded press cannot be replayed.' } });
  const found = JSON.parse((await client.callTool({ name: 'search', arguments: { query: 'rolling codes' } })).content[0].text);
  assert.ok(JSON.stringify(found).includes('garage door opener'));
  await client.close();
  console.log(`✔ packaged MCP server: initialize as ${info.name} ${info.version}, ${tools.length} tools, save_note + search`);

  const port = await freePort();
  const child = spawn(executable, [], { env: { ...env, ENVE_MEMORY_PORT: String(port), ENVE_MEMORY_NO_GLOBAL_SHORTCUT: '1' }, stdio: 'ignore' });
  const exited = new Promise((done) => child.once('exit', done));
  const status = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/status`);
    return response.ok && response.json();
  }, 'the API');
  assert.equal(status.name, 'enve-memory');
  console.log(`✔ packaged app: /api/v1/status on port ${port} → ${JSON.stringify(status)}`);

  if (cache) {
    const indexed = await waitFor(async () => {
      const { semanticIndex } = runCli('info');
      return /^[1-9]\d* indexed/.test(semanticIndex) && semanticIndex;
    }, 'the app to index the note', 60_000);
    console.log(`✔ packaged app loaded onnxruntime-node and indexed: ${indexed}`);
    const hits = runCli('search', 'replaying', 'a', 'captured', 'remote', 'signal');
    assert.ok(hits.some((hit) => hit.match !== 'keyword'), 'a paraphrase matches on meaning');
    console.log(`✔ packaged CLI semantic search: ${hits.map((h) => `${h.match}`).join(', ')}`);
  }

  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/v1/status`));
  console.log('✔ packaged app quit cleanly and released its port');
} finally {
  rmSync(home, { recursive: true, force: true });
}
