import { ext } from './browser.js';
import { openItem } from './items.js';
import { notify } from './quick-save.js';
import { connect } from './settings.js';

export const REMINDER_PREFIX = 'reminder:';

let checking = null;

/**
 * Shows a notification per due reminder, then tells Enve Memory it was delivered so neither this browser nor the
 * desktop app shows it again. Overlapping checks (an alarm and a settings change) share one run.
 */
export function checkReminders() {
  checking ??= (async () => {
    const { settings, client } = await connect();
    if (!settings.notifyReminders || !client) return [];
    const due = await client.dueReminders().catch(() => []);
    for (const item of due) {
      const where = item.project?.name ?? (item.url ? new URL(item.url).hostname : 'Note');
      await notify(`Reminder: ${item.title || item.url || 'Saved note'}`, where, REMINDER_PREFIX + item.id);
      await client.reminded(item.id).catch(() => {});
    }
    return due;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

export async function openReminder(notificationId) {
  const { client } = await connect();
  await ext.notifications.clear(notificationId);
  if (!client) return;
  const item = await client.item(notificationId.slice(REMINDER_PREFIX.length)).catch(() => null);
  if (item) await openItem(client, item);
}
