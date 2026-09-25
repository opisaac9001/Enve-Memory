import { buildCapturePayload, describeError } from './api.js';
import { ERROR_COLOR, OK_COLOR, flashBadge } from './badge.js';
import { ext } from './browser.js';
import { saveCapture } from './outbox.js';
import { readLinkText, readSelection } from './page.js';
import { connect } from './settings.js';

/**
 * Saves without opening the popup. `kind` is `page`, `selection` or `link`; `info` is the context-menu click data
 * (or `{}` for the keyboard command).
 */
export async function quickSave(kind, info, tab) {
  const { settings, client } = await connect();
  if (!client) {
    await flashBadge(tab?.id, '!', ERROR_COLOR);
    await ext.runtime.openOptionsPage();
    return;
  }
  try {
    const payload = buildCapturePayload({ ...(await captureFields(kind, info, tab)), project: settings.lastProject?.id });
    const result = await saveCapture(client, payload, settings.serverUrl);
    await flashBadge(tab?.id, '✓', OK_COLOR);
    if (result.queued) notify('Saved offline', `${payload.title || payload.url || 'Note'} will sync when Enve Memory is back.`);
    else notify(result.created ? 'Saved' : 'Updated', `${result.item.title || result.item.url || 'Note'} · ${result.item.project?.name ?? 'Inbox'}`);
  } catch (error) {
    await flashBadge(tab?.id, '!', ERROR_COLOR);
    notify("Couldn't save", describeError(error, settings.serverUrl));
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

export function notify(title, message, id) {
  const options = { type: 'basic', iconUrl: ext.runtime.getURL('icons/icon-128.png'), title, message };
  return (id ? ext.notifications.create(id, options) : ext.notifications.create(options)).catch(() => {});
}
