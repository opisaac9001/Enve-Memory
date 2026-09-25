import { ext } from './browser.js';

/** Opens the browser's side panel. Must be called straight from a click: both browsers require the user gesture. */
export function openSidePanel(windowId) {
  return ext.sidePanel ? ext.sidePanel.open({ windowId }) : ext.sidebarAction.open();
}
