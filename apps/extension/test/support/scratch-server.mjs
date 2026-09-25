import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const CLI = fileURLToPath(new URL('../../../../packages/cli/src/main.ts', import.meta.url));

/** Runs a real `enve-memory serve` on a free port against a throwaway library, with link fetching off. */
export async function startScratchServer() {
  const home = await mkdtemp(join(tmpdir(), 'enve-memory-ext-'));
  const cli = async (...args) => {
    const { stdout } = await promisify(execFile)(process.execPath, [CLI, '--home', home, '--json', ...args]);
    return JSON.parse(stdout);
  };
  // Keeps tests offline: the server would otherwise fetch every captured URL to archive it.
  await cli('settings', 'fetchLinks', 'false');
  const server = spawn(process.execPath, [CLI, '--home', home, 'serve', '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    server.stderr.on('data', (chunk) => {
      output += chunk;
      const match = /listening on (http:\/\/\S+)/.exec(output);
      if (match) resolve(match[1]);
    });
    server.once('exit', (code) => reject(new Error(`enve-memory serve exited with ${code}:\n${output}`)));
  });
  const token = async (name, scope) => (await cli('clients', 'add', name, '--scope', scope)).token;
  const stop = async () => {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise((resolve) => server.once('exit', resolve));
    }
    await rm(home, { recursive: true, force: true });
  };
  return { url, home, cli, token, stop };
}
