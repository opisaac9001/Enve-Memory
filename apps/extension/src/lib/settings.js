import { DEFAULT_SERVER_URL, createClient, isRetryable } from './api.js';
import { ext } from './browser.js';

const DEFAULTS = {
  serverUrl: DEFAULT_SERVER_URL,
  token: '',
  /** {id, name} of the project last picked in the popup or panel; instant saves go there. */
  lastProject: null,
  /** What the toolbar button opens: 'popup' or 'panel'. */
  actionOpens: 'popup',
  trackVisits: false,
  notifyReminders: false,
};

export async function loadSettings() {
  const stored = await ext.storage.local.get(Object.keys(DEFAULTS));
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key, stored[key] || fallback]));
}

export function saveSettings(changes) {
  return ext.storage.local.set(changes);
}

/** Settings plus a client, or no client when no token is configured yet. */
export async function connect() {
  const settings = await loadSettings();
  return { settings, client: settings.token ? createClient(settings) : null };
}

/** Projects from the server, falling back to the last list seen so saving to a project works offline. */
export async function loadProjects(client) {
  try {
    const projects = await client.projects();
    await ext.storage.local.set({ projectsCache: projects.map(({ id, name }) => ({ id, name })) });
    return { projects, offline: false };
  } catch (error) {
    if (!isRetryable(error)) throw error;
    const { projectsCache = [] } = await ext.storage.local.get('projectsCache');
    return { projects: projectsCache, offline: true, error };
  }
}
