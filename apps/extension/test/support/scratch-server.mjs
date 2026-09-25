import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const CLI = fileURLToPath(new URL('../../../../packages/cli/src/main.ts', import.meta.url));
const CORE = new URL('../../../../packages/core/src/index.ts', import.meta.url).href;

function serve(home, port) {
  const server = spawn(process.execPath, [CLI, '--home', home, 'serve', '--port', String(port)], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = new Promise((resolve, reject) => {
    let output = '';
    server.stderr.on('data', (chunk) => {
      output += chunk;
      const match = /listening on (http:\/\/\S+)/.exec(output);
      if (match) resolve(match[1]);
    });
    server.once('exit', (code) => reject(new Error(`enve-memory serve exited with ${code}:\n${output}`)));
  });
  return { server, url };
}

/**
 * Runs a real `enve-memory serve` against a throwaway library, with fetching and indexing off. `pause()` stops the
 * process and `resume()` starts it again on the same port and library, for offline tests.
 */
export async function startScratchServer() {
  const home = await mkdtemp(join(tmpdir(), 'enve-memory-ext-'));
  const cli = async (...args) => {
    const { stdout } = await promisify(execFile)(process.execPath, [CLI, '--home', home, '--json', ...args]);
    return JSON.parse(stdout);
  };
  // Keeps tests offline: the server would otherwise fetch every captured URL and download the embedding model.
  await cli('settings', 'fetchLinks', 'false');
  await cli('settings', 'semanticSearch', 'false');

  let current = serve(home, 0);
  const url = await current.url;
  const pause = async () => {
    if (current.server.exitCode !== null) return;
    current.server.kill('SIGTERM');
    await new Promise((resolve) => current.server.once('exit', resolve));
  };
  const resume = async () => {
    current = serve(home, new URL(url).port);
    await current.url;
  };
  const token = async (name, scope) => (await cli('clients', 'add', name, '--scope', scope)).token;
  // Stands in for the AI enrichment worker, which needs a model: records suggestions the way it would.
  const suggest = async (id, suggestions) => {
    const { EnveMemory } = await import(CORE);
    const memory = EnveMemory.open({ home, actor: 'test' });
    try {
      memory.items.suggest(id, { status: 'done', at: new Date().toISOString(), model: 'test', ...suggestions });
    } finally {
      memory.close();
    }
  };
  const stop = async () => {
    await pause();
    await rm(home, { recursive: true, force: true });
  };
  return { url, home, cli, token, suggest, pause, resume, stop };
}
