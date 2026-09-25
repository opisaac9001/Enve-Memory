import { ext } from './browser.js';

/** Opens a saved link in a new tab and tells Enve Memory it was opened (drives the Unopened shelf). */
export async function openItem(client, item, { active = true } = {}) {
  if (!item.url) return;
  await ext.tabs.create({ url: item.url, active });
  await client.opened(item.id).catch(() => {});
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
