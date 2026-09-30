import { homedir } from 'node:os';
import { join } from 'node:path';

export interface MemoryPaths {
  home: string;
  database: string;
  backups: string;
  attachments: string;
  /** Shared by every library on the machine and safe to delete: models re-download on demand. */
  models: string;
}

// Keep the original data directory so existing libraries remain available after the app rename.
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

/** Platform cache folder: not backed up, and the OS may clear it. */
export function cacheDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.ENVE_MEMORY_CACHE) return env.ENVE_MEMORY_CACHE;
  switch (platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Caches', 'Enve Memory');
    case 'win32':
      return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Enve Memory', 'Cache');
    default:
      return join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'enve-memory');
  }
}

export function pathsFor(home: string): MemoryPaths {
  return {
    home,
    database: join(home, 'memory.sqlite'),
    backups: join(home, 'backups'),
    attachments: join(home, 'attachments'),
    models: join(cacheDir(), 'models'),
  };
}
