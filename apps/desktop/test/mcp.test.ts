import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { claudeAddArgs, mcpLaunch, setupSnippets, shellQuote } from '../src/main/mcp.ts';

const repoRoot = '/src/Enve Memory';
const dev = { isPackaged: false, execPath: '/src/Enve Memory/node_modules/electron/dist/Electron', resourcesPath: '/unused', repoRoot, home: null };
const packaged = {
  isPackaged: true,
  execPath: '/Applications/Enve Memory.app/Contents/MacOS/Enve Memory',
  resourcesPath: '/Applications/Enve Memory.app/Contents/Resources',
  repoRoot: '/unused',
  home: null,
};

test('dev runs the TypeScript CLI with Electron as Node', () => {
  assert.deepEqual(mcpLaunch(dev), {
    command: dev.execPath,
    args: [join(repoRoot, 'packages', 'cli', 'src', 'main.ts'), 'mcp'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
});

test('packaged runs the bundled cli.mjs from resources', () => {
  assert.deepEqual(mcpLaunch(packaged), {
    command: packaged.execPath,
    args: [join(packaged.resourcesPath, 'cli.mjs'), 'mcp'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
});

test('a library outside the default folder is passed with --home', () => {
  assert.deepEqual(mcpLaunch({ ...packaged, home: '/Volumes/data/memory' }).args.slice(1), ['mcp', '--home', '/Volumes/data/memory']);
});

test('the Claude Code command sets the env var and quotes paths with spaces', () => {
  const launch = mcpLaunch(packaged);
  assert.deepEqual(claudeAddArgs(launch), [
    'mcp', 'add', '--scope', 'user', 'enve-memory', '-e', 'ELECTRON_RUN_AS_NODE=1', '--', packaged.execPath, join(packaged.resourcesPath, 'cli.mjs'), 'mcp',
  ]);
  const { claudeCode } = setupSnippets(launch, 'http://127.0.0.1:49231', 'darwin');
  assert.equal(
    claudeCode,
    `claude mcp add --scope user enve-memory -e ELECTRON_RUN_AS_NODE=1 -- '/Applications/Enve Memory.app/Contents/MacOS/Enve Memory' '${join(packaged.resourcesPath, 'cli.mjs')}' mcp`,
  );
});

test('Codex TOML and JSON configs carry the same command, args and env', () => {
  const launch = mcpLaunch(packaged);
  const setup = setupSnippets(launch, 'http://127.0.0.1:5000');
  assert.match(setup.codex, /^\[mcp_servers\.enve-memory\]$/m);
  assert.ok(setup.codex.includes(`command = ${JSON.stringify(launch.command)}`));
  assert.ok(setup.codex.includes(`args = [${launch.args.map((a) => JSON.stringify(a)).join(', ')}]`));
  assert.ok(setup.codex.includes('env = { ELECTRON_RUN_AS_NODE = "1" }'));
  assert.deepEqual(JSON.parse(setup.json), { mcpServers: { 'enve-memory': launch } });
  assert.equal(setup.httpUrl, 'http://127.0.0.1:5000/mcp');
});

test('shell quoting', () => {
  assert.equal(shellQuote('plain/path-1.0', 'darwin'), 'plain/path-1.0');
  assert.equal(shellQuote("it's here", 'linux'), `'it'\\''s here'`);
  assert.equal(shellQuote('C:\\Program Files\\Enve Memory\\Enve Memory.exe', 'win32'), '"C:\\Program Files\\Enve Memory\\Enve Memory.exe"');
});
