import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatWhen, isDue, remindAt } from '../src/lib/when.js';

// Local times, so the expectations hold in any time zone.
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

test('remindAt resolves each chip to a local time, like the server reads the same words', () => {
  const wednesdayMorning = local(2026, 9, 23, 8);
  assert.equal(remindAt('tonight', wednesdayMorning), local(2026, 9, 23, 20).toISOString());
  assert.equal(remindAt('tonight', local(2026, 9, 23, 21)), local(2026, 9, 24, 20).toISOString());
  assert.equal(remindAt('tomorrow', wednesdayMorning), local(2026, 9, 24, 9).toISOString());
  assert.equal(remindAt('weekend', wednesdayMorning), local(2026, 9, 26, 10).toISOString());
  assert.equal(remindAt('weekend', local(2026, 9, 26, 8)), local(2026, 9, 26, 10).toISOString());
  assert.equal(remindAt('weekend', local(2026, 9, 26, 11)), local(2026, 10, 3, 10).toISOString());
  assert.equal(remindAt('next-week', wednesdayMorning), local(2026, 9, 28, 9).toISOString());
  assert.equal(remindAt('next-week', local(2026, 9, 28, 8)), local(2026, 10, 5, 9).toISOString());
  assert.throws(() => remindAt('someday'), /Unknown reminder/);
});

test('isDue and formatWhen', () => {
  const now = local(2026, 9, 23, 12);
  assert.ok(isDue(local(2026, 9, 23, 11).toISOString(), now));
  assert.ok(!isDue(local(2026, 9, 23, 13).toISOString(), now));
  assert.ok(!isDue(null, now));
  assert.match(formatWhen(local(2026, 9, 23, 20).toISOString(), now), /^Today /);
  assert.match(formatWhen(local(2026, 9, 24, 9).toISOString(), now), /^Tomorrow /);
  assert.match(formatWhen(local(2026, 9, 22, 9).toISOString(), now), /^Yesterday /);
  assert.doesNotMatch(formatWhen(local(2026, 11, 2, 9).toISOString(), now), /2026/);
  assert.match(formatWhen(local(2027, 1, 2, 9).toISOString(), now), /2027/);
});
