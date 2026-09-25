import { invalid } from './errors.ts';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const UNITS: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
const MORNING = 9;
const EVENING = 20;

const at = (base: Date, days: number, hour: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};

/**
 * When to remind: an ISO timestamp, a date (9am local), or plain words: "tonight", "tomorrow", "tomorrow evening",
 * "this weekend", "next week", "friday", "in 3 days", "in 2 hours". Local time, returned as ISO UTC.
 */
export function parseWhen(text: string, now = new Date()): string {
  const input = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d, MORNING).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}t/.test(input) && !Number.isNaN(Date.parse(text))) return new Date(Date.parse(text)).toISOString();

  const relative = /^in (\d+) (minute|hour|day|week)s?$/.exec(input);
  if (relative) return new Date(now.getTime() + Number(relative[1]) * UNITS[relative[2]!]!).toISOString();

  switch (input) {
    case 'tonight':
      return (now.getHours() < EVENING ? at(now, 0, EVENING) : at(now, 1, EVENING)).toISOString();
    case 'tomorrow':
    case 'tomorrow morning':
      return at(now, 1, MORNING).toISOString();
    case 'tomorrow evening':
    case 'tomorrow night':
      return at(now, 1, EVENING).toISOString();
    case 'this weekend':
    case 'weekend': {
      const untilSaturday = (6 - now.getDay() + 7) % 7 || (now.getHours() < 10 ? 0 : 7);
      return at(now, untilSaturday, 10).toISOString();
    }
    case 'next week':
      return at(now, ((1 - now.getDay() + 7) % 7) || 7, MORNING).toISOString();
    case 'next month': {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1, MORNING);
      return d.toISOString();
    }
  }
  const weekday = DAYS.indexOf(input.replace(/^(next|on) /, ''));
  if (weekday >= 0) return at(now, ((weekday - now.getDay() + 7) % 7) || 7, MORNING).toISOString();
  throw invalid(`Couldn't understand "${text}" as a time. Try "tomorrow", "friday", "in 3 days" or a date like 2026-10-01.`);
}
