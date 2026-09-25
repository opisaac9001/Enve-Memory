export const REMIND_CHOICES = [
  { value: 'tonight', label: 'Tonight' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'next-week', label: 'Next week' },
];

const MORNING = 9;
const EVENING = 20;
const DAY_MS = 86_400_000;

function at(base, days, hour) {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/**
 * Resolves a remind-me chip to an ISO time when it's clicked, matching the server's reading of the same words, so a
 * capture that waits offline still reminds at the time the user meant.
 */
export function remindAt(choice, now = new Date()) {
  switch (choice) {
    case 'tonight':
      return (now.getHours() < EVENING ? at(now, 0, EVENING) : at(now, 1, EVENING)).toISOString();
    case 'tomorrow':
      return at(now, 1, MORNING).toISOString();
    case 'weekend':
      return at(now, (6 - now.getDay() + 7) % 7 || (now.getHours() < 10 ? 0 : 7), 10).toISOString();
    case 'next-week':
      return at(now, (1 - now.getDay() + 7) % 7 || 7, MORNING).toISOString();
    default:
      throw new Error(`Unknown reminder "${choice}".`);
  }
}

export const isDue = (iso, now = new Date()) => Boolean(iso) && Date.parse(iso) <= now.getTime();

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "Today 8:00 PM", "Tomorrow 9:00 AM", "Sat 10:00 AM", or a date further out. */
export function formatWhen(iso, now = new Date()) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  if (days > 1 && days < 7) return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
