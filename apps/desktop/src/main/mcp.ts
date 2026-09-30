import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { McpSetup } from '../shared/ipc.ts';

export const SERVER_NAME = 'petty-memory';

export interface LaunchContext {
  isPackaged: boolean;
  /** The app executable (Electron in dev, the packaged binary otherwise); run as plain Node via ELECTRON_RUN_AS_NODE. */
  execPath: string;
  resourcesPath: string;
  repoRoot: string;
  /** Set only when the library isn't in the default folder, so the MCP server opens the same one. */
  home: string | null;
}

export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** How an AI client should start the stdio MCP server: the app's own runtime, so users need no separate Node install. */
export function mcpLaunch(ctx: LaunchContext): McpLaunch {
  // Dev runs the TypeScript CLI directly (Electron 44's Node strips types); packaged apps ship the bundled cli.mjs.
  const script = ctx.isPackaged ? join(ctx.resourcesPath, 'cli.mjs') : join(ctx.repoRoot, 'packages', 'cli', 'src', 'main.ts');
  return {
    command: ctx.execPath,
    args: [script, 'mcp', ...(ctx.home ? ['--home', ctx.home] : [])],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

export function claudeAddArgs(launch: McpLaunch): string[] {
  const env = Object.entries(launch.env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return ['mcp', 'add', '--scope', 'user', SERVER_NAME, ...env, '--', launch.command, ...launch.args];
}

export function shellQuote(arg: string, platform: string = process.platform): string {
  if (/^[\w@%+=:,./-]+$/.test(arg)) return arg;
  if (platform === 'win32') return `"${arg.replace(/"/g, '\\"')}"`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function setupSnippets(launch: McpLaunch, httpUrl: string, platform: string = process.platform): Omit<McpSetup, 'claudeAvailable'> {
  const env = Object.entries(launch.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(', ');
  return {
    ...launch,
    claudeCode: ['claude', ...claudeAddArgs(launch)].map((a) => shellQuote(a, platform)).join(' '),
    codex: [
      `[mcp_servers.${SERVER_NAME}]`,
      `command = ${JSON.stringify(launch.command)}`,
      `args = [${launch.args.map((a) => JSON.stringify(a)).join(', ')}]`,
      `env = { ${env} }`,
    ].join('\n'),
    json: JSON.stringify({ mcpServers: { [SERVER_NAME]: launch } }, null, 2),
    httpUrl: `${httpUrl}/mcp`,
  };
}

/** GUI apps on macOS start with a minimal PATH, so also look where installers usually put the Claude Code CLI. */
export function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string | null {
  const home = homedir();
  const dirs = [
    ...(env.PATH ?? '').split(delimiter),
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter(Boolean);
  const names = platform === 'win32' ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const dir of dirs) {
    for (const file of names) {
      const candidate = join(dir, file);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}
