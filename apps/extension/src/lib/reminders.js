import { ext } from './browser.js';
import { openItem } from './items.js';
import { notify } from './quick-save.js';
import { connect } from './settings.js';

export const REMINDER_PREFIX = 'reminder:';

const shownKey = (item) => `${item.id}@${item.remindAt}`;

/**
 * Due reminders not shown yet. Keyed by item and time, so a rescheduled reminder shows again. `/reminders?due=true`
 * doesn't mark anything delivered (the desktop app does that), so the extension remembers what it has shown.
 */
export function unshownReminders(due, shown) {
  const seen = new Set(shown);
  return due.filter((item) => !seen.has(shownKey(item)));
}

export async function checkReminders() {
  const { settings, client } = await connect();
  if (!settings.notifyReminders || !client) return [];
  const due = await client.dueReminders().catch(() => null);
  if (!due) return [];
  const { remindersShown = [] } = await ext.storage.local.get('remindersShown');
  const fresh = unshownReminders(due, remindersShown);
  for (const item of fresh) {
    const where = item.project?.name ?? (item.url ? new URL(item.url).hostname : 'Note');
    await notify(`Reminder: ${item.title || item.url || 'Saved note'}`, where, REMINDER_PREFIX + item.id);
  }
  // Only keys still due are kept, so the list stays as small as the reminders themselves.
  const stillDue = new Set(due.map(shownKey));
  await ext.storage.local.set({ remindersShown: [...remindersShown.filter((key) => stillDue.has(key)), ...fresh.map(shownKey)] });
  return fresh;
}

export async function openReminder(notificationId) {
  const { client } = await connect();
  await ext.notifications.clear(notificationId);
  if (!client) return;
  const item = await client.item(notificationId.slice(REMINDER_PREFIX.length)).catch(() => null);
  if (item) await openItem(client, item);
}
