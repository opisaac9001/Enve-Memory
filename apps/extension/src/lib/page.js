import { ext } from './browser.js';

// Injected functions run in the page, so they must be self-contained.
function selectedText() {
  const el = document.activeElement;
  if ((el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.selectionStart !== el.selectionEnd) {
    return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  }
  return window.getSelection()?.toString() ?? '';
}

function linkText(href) {
  const link = [...document.querySelectorAll('a[href]')].find((a) => a.href === href);
  return link?.innerText.replace(/\s+/g, ' ').trim() ?? '';
}

async function runInFrame(tabId, frameId, func, args = []) {
  try {
    const [result] = await ext.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func, args });
    return typeof result?.result === 'string' ? result.result : '';
  } catch {
    // Pages the browser protects (store, settings, PDF viewer) refuse injection.
    return '';
  }
}

export const readSelection = (tabId, frameId = 0) => runInFrame(tabId, frameId, selectedText);
export const readLinkText = (tabId, frameId, href) => runInFrame(tabId, frameId, linkText, [href]);
