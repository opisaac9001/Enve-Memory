import { homedir } from 'node:os';
import { join } from 'node:path';

export interface MemoryPaths {
  home: string;
  database: string;
  backups: string;
  attachments: string;
  models: string;
}

/** Matches Electron's `app.getPath('userData')` for "Enve Memory" so the CLI and desktop app share one library. */
export function defaultHome(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.ENVE_MEMORY_HOME) return env.ENVE_MEMORY_HOME;
  switch (platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Enve Memory');
    case 'win32':
      return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Enve Memory');
    default:
      return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Enve Memory');
  }
}

export function pathsFor(home: string): MemoryPaths {
  return { home, database: join(home, 'memory.sqlite'), backups: join(home, 'backups'), attachments: join(home, 'attachments'), models: join(home, 'models') };
}
