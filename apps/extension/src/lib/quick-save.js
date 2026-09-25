import { buildCapturePayload, createClient, describeError } from './api.js';
import { ext } from './browser.js';
import { readLinkText, readSelection } from './page.js';
import { loadSettings } from './settings.js';

const BADGE_MS = 2000;
const OK_COLOR = '#F5921A';
const ERROR_COLOR = '#D93A2B';

/**
 * Saves without opening the popup. `kind` is `page`, `selection` or `link`; `info` is the context-menu click data
 * (or `{}` for the keyboard command).
 */
export async function quickSave(kind, info, tab) {
  const { serverUrl, token, lastProject } = await loadSettings();
  if (!token) {
    await flashBadge(tab?.id, '!', ERROR_COLOR);
    await ext.runtime.openOptionsPage();
    return;
  }
  try {
    const payload = buildCapturePayload({ ...(await captureFields(kind, info, tab)), project: lastProject?.id });
    const { item, created } = await createClient({ serverUrl, token }).capture(payload);
    await flashBadge(tab?.id, '✓', OK_COLOR);
    notify(created ? 'Saved' : 'Updated', `${item.title || item.url || 'Note'} · ${item.project?.name ?? 'Inbox'}`);
  } catch (error) {
    await flashBadge(tab?.id, '!', ERROR_COLOR);
    notify("Couldn't save", describeError(error, serverUrl));
  }
}

async function captureFields(kind, info, tab) {
  const frameId = info.frameId ?? 0;
  switch (kind) {
    case 'link': {
      // Firefox reports the link text; Chrome only gives the URL, so read it from the page.
      const text = info.linkText || (tab?.id === undefined ? '' : await readLinkText(tab.id, frameId, info.linkUrl));
      return { url: info.linkUrl, title: text || undefined };
    }
    case 'selection': {
      // selectionText collapses line breaks; the page's own selection keeps them.
      const selection = (tab?.id === undefined ? '' : await readSelection(tab.id, frameId)) || info.selectionText;
      return { url: info.pageUrl ?? tab?.url, title: tab?.title, selection };
    }
    default:
      return { url: info.pageUrl ?? tab?.url, title: tab?.title };
  }
}

async function flashBadge(tabId, text, color) {
  if (tabId === undefined) return;
  await ext.action.setBadgeBackgroundColor({ tabId, color });
  await ext.action.setBadgeTextColor({ tabId, color: '#FFFFFF' });
  await ext.action.setBadgeText({ tabId, text });
  setTimeout(() => ext.action.setBadgeText({ tabId, text: '' }).catch(() => {}), BADGE_MS);
}

function notify(title, message) {
  ext.notifications.create({ type: 'basic', iconUrl: ext.runtime.getURL('icons/icon-128.png'), title, message }).catch(() => {});
}
