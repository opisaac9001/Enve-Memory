import { DEFAULT_SERVER_URL } from './api.js';
import { ext } from './browser.js';

/** @returns {Promise<{serverUrl: string, token: string, lastProject: {id: string, name: string} | null}>} */
export async function loadSettings() {
  const stored = await ext.storage.local.get(['serverUrl', 'token', 'lastProject']);
  return {
    serverUrl: stored.serverUrl || DEFAULT_SERVER_URL,
    token: stored.token || '',
    lastProject: stored.lastProject ?? null,
  };
}

export function saveSettings(changes) {
  return ext.storage.local.set(changes);
}
