import { isCapturableUrl } from './lib/api.js';
import { showOutboxCount } from './lib/badge.js';
import { ext } from './lib/browser.js';
import { flushOutbox, isOutboxKey } from './lib/outbox.js';
import { quickSave } from './lib/quick-save.js';
import { REMINDER_PREFIX, checkReminders, openReminder } from './lib/reminders.js';
import { connect, loadSettings } from './lib/settings.js';

const MENUS = [
  { id: 'page', title: 'Save page to Petty Memory', contexts: ['page', 'frame'] },
  { id: 'selection', title: 'Save selection to Petty Memory', contexts: ['selection'] },
  { id: 'link', title: 'Save link to Petty Memory', contexts: ['link'] },
];
const OUTBOX_ALARM = 'outbox';
const REMINDER_ALARM = 'reminders';

ext.runtime.onInstalled.addListener(async ({ reason }) => {
  await ext.contextMenus.removeAll();
  for (const menu of MENUS) ext.contextMenus.create(menu);
  await start();
  if (reason === 'install') await ext.runtime.openOptionsPage();
});
ext.runtime.onStartup.addListener(start);

async function start() {
  const settings = await loadSettings();
  await applyActionBehavior(settings.actionOpens);
  await scheduleReminders(settings.notifyReminders);
  await ext.alarms.create(OUTBOX_ALARM, { periodInMinutes: 1 });
  await showOutboxCount();
  await flush();
}

async function flush() {
  const { settings, client } = await connect();
  if (client) await flushOutbox(client, settings.serverUrl).catch(() => {});
}

async function applyActionBehavior(mode) {
  const panel = mode === 'panel';
  await ext.action.setPopup({ popup: panel ? '' : 'popup.html' });
  await ext.sidePanel?.setPanelBehavior({ openPanelOnActionClick: panel });
}

async function scheduleReminders(enabled) {
  if (enabled) await ext.alarms.create(REMINDER_ALARM, { delayInMinutes: 0.5, periodInMinutes: 5 });
  else await ext.alarms.clear(REMINDER_ALARM);
}

ext.alarms.onAlarm.addListener(({ name }) => {
  if (name === OUTBOX_ALARM) return flush();
  if (name === REMINDER_ALARM) return checkReminders();
});

ext.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some(isOutboxKey)) await showOutboxCount();
  if (changes.actionOpens) await applyActionBehavior(changes.actionOpens.newValue);
  if (changes.notifyReminders) {
    await scheduleReminders(changes.notifyReminders.newValue);
    if (changes.notifyReminders.newValue) await checkReminders();
  }
  if (changes.token || changes.serverUrl) await flush();
});

ext.contextMenus.onClicked.addListener((info, tab) => quickSave(String(info.menuItemId), info, tab));

ext.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'open-panel') {
    // Must run before any await: opening the side panel needs the shortcut's user gesture.
    ext.sidePanel?.open({ windowId: tab.windowId });
    return;
  }
  if (command !== 'quick-save') return;
  const target = tab ?? (await ext.tabs.query({ active: true, currentWindow: true }))[0];
  await quickSave('page', {}, target);
});

// Firefox has no openPanelOnActionClick; with the popup cleared, the button click arrives here instead.
ext.action.onClicked.addListener(() => ext.sidebarAction?.toggle());

ext.notifications.onClicked.addListener((id) => {
  if (id.startsWith(REMINDER_PREFIX)) return openReminder(id);
});

// Opt-in: marks a saved link opened when its tab comes up. The URL goes only to Petty Memory's /lookup.
const reportedVisits = new Set();
async function reportVisit(tabId, url) {
  if (!isCapturableUrl(url) || reportedVisits.has(`${tabId} ${url}`)) return;
  const { settings, client } = await connect();
  if (!settings.trackVisits || !client) return;
  reportedVisits.add(`${tabId} ${url}`);
  const item = await client.lookup(url).catch(() => null);
  if (item) await client.opened(item.id).catch(() => {});
}

ext.tabs.onActivated.addListener(async ({ tabId }) => reportVisit(tabId, (await ext.tabs.get(tabId)).url));
ext.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' && tab.active) return reportVisit(tabId, tab.url);
});
