import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnveMemory, detectIntent, parseWhen } from '@enve-memory/core';

const open = () => {
  const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
  memory.settings.set('fetchLinks', false);
  return memory;
};

test('reminder times are understood in plain words, in local time', () => {
  const now = new Date(2026, 8, 24, 15, 30); // Thursday 24 Sep 2026, 3:30pm local
  const local = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  assert.equal(local(parseWhen('tonight', now)), '9/24 20:00');
  assert.equal(local(parseWhen('Tomorrow', now)), '9/25 9:00');
  assert.equal(local(parseWhen('tomorrow evening', now)), '9/25 20:00');
  assert.equal(local(parseWhen('this weekend', now)), '9/26 10:00');
  assert.equal(local(parseWhen('next week', now)), '9/28 9:00');
  assert.equal(local(parseWhen('friday', now)), '9/25 9:00');
  assert.equal(local(parseWhen('thursday', now)), '10/1 9:00', 'the same weekday means next week');
  assert.equal(local(parseWhen('in 2 hours', now)), '9/24 17:30');
  assert.equal(local(parseWhen('2026-10-03', now)), '10/3 9:00');
  assert.equal(parseWhen('2026-10-03T12:00:00Z', now), '2026-10-03T12:00:00.000Z');
  assert.throws(() => parseWhen('whenever', now), /Couldn't understand "whenever"/);
});

test('intent is guessed from the address and the page type', () => {
  assert.equal(detectIntent('https://www.youtube.com/watch?v=x'), 'watch');
  assert.equal(detectIntent('https://www.instagram.com/reel/abc/'), 'watch');
  assert.equal(detectIntent('https://www.amazon.co.uk/dp/B000'), 'buy');
  assert.equal(detectIntent('https://shop.example.com/products/keyboard'), 'buy');
  assert.equal(detectIntent('https://blog.example.com/post'), 'read');
  assert.equal(detectIntent('https://example.com/clip', 'video.other'), 'watch');
  assert.equal(detectIntent('https://example.com/thing', 'product'), 'buy');
});

test('links get a guessed intent that archiving can sharpen, but never over the user', () => {
  const memory = open();
  const video = memory.items.saveLink({ url: 'https://youtu.be/abc' }).item;
  assert.equal(video.intent, 'watch');
  const page = memory.items.saveLink({ url: 'https://example.com/demo' }).item;
  assert.equal(page.intent, 'read');
  assert.equal(memory.items.setSource(page.id, { metadata: { ogType: 'video.other' } }).intent, 'watch');

  const chosen = memory.items.saveLink({ url: 'https://example.com/other', intent: 'revisit' }).item;
  assert.equal(memory.items.setSource(chosen.id, { metadata: { ogType: 'product' } }).intent, 'revisit');
  memory.items.setIntent(page.id, 'read');
  assert.equal(memory.items.setSource(page.id, { metadata: { ogType: 'video.other' } }).intent, 'read');
  assert.throws(() => memory.items.setIntent(page.id, 'maybe'), /Unknown intent/);
  assert.equal(memory.items.saveNote({ body: 'notes have none' }).intent, null);
});

test('pins, opens and reminders never reorder "recently updated"', async () => {
  const memory = open();
  const older = memory.items.saveNote({ body: 'older' });
  await new Promise((r) => setTimeout(r, 5));
  const newer = memory.items.saveNote({ body: 'newer' });
  memory.items.pin(older.id, true);
  memory.items.markOpened(older.id);
  memory.items.setReminder(older.id, 'tomorrow');
  assert.deepEqual(memory.items.list().map((i) => i.id), [newer.id, older.id]);
  assert.ok(memory.items.get(older.id).pinnedAt);
  assert.ok(memory.items.get(older.id).openedAt);
});

test('shelves: pinned, by intent, unopened for a month, and reminders soonest first', (t) => {
  const memory = open();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-08-01T12:00:00Z') });
  const stale = memory.items.saveLink({ url: 'https://example.com/old-article' }).item;
  const opened = memory.items.saveLink({ url: 'https://example.com/read-it' }).item;
  memory.items.markOpened(opened.id);
  t.mock.timers.setTime(Date.parse('2026-09-24T12:00:00Z'));
  const fresh = memory.items.saveLink({ url: 'https://youtube.com/watch?v=1' }).item;

  assert.deepEqual(memory.items.list({ unopenedDays: 30 }).map((i) => i.id), [stale.id]);
  assert.deepEqual(memory.items.list({ intent: 'watch' }).map((i) => i.id), [fresh.id]);

  memory.items.pin(stale.id, true);
  assert.deepEqual(memory.items.list({ pinned: true }).map((i) => i.id), [stale.id]);
  memory.items.pin(stale.id, false);
  assert.deepEqual(memory.items.list({ pinned: true }), []);

  memory.items.setReminder(fresh.id, '2026-09-26T10:00:00Z');
  memory.items.setReminder(stale.id, '2026-09-25T10:00:00Z');
  assert.deepEqual(memory.items.list({ reminders: true }).map((i) => i.id), [stale.id, fresh.id]);

  assert.deepEqual(memory.items.dueReminders(new Date('2026-09-25T11:00:00Z')).map((i) => i.id), [stale.id]);
  memory.items.markReminded(stale.id);
  assert.deepEqual(memory.items.dueReminders(new Date('2026-09-27T00:00:00Z')).map((i) => i.id), [fresh.id], 'each reminder fires once');
  memory.items.setReminder(stale.id, '2026-09-26T09:00:00Z');
  assert.equal(memory.items.dueReminders(new Date('2026-09-27T00:00:00Z')).length, 2, 'rescheduling re-arms it');
  memory.items.setReminder(stale.id, null);
  assert.equal(memory.items.get(stale.id).remindAt, null);
});
