import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookmarkEntries, chunk, folderTag, importEntries } from '../src/lib/bookmarks.js';
import { ApiError } from '../src/lib/api.js';

// The shape chrome.bookmarks.getTree() returns: an untitled root whose children are the browser's own folders.
const TREE = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bookmarks bar',
        children: [
          { id: '10', title: 'Enve', url: 'https://envemedia.com', dateAdded: Date.UTC(2019, 4, 1) },
          {
            id: '11',
            title: 'Garage Door',
            children: [
              { id: '12', title: 'Security+ 2.0', url: 'https://example.com/secplus', dateAdded: Date.UTC(2024, 0, 2) },
              { id: '13', title: 'ESP32 Library', children: [{ id: '14', title: '  ratgdo  ', url: 'https://github.com/ratgdo' }] },
              { id: '15', title: 'bookmarklet', url: 'javascript:alert(1)' },
            ],
          },
        ],
      },
      {
        id: '2',
        title: 'Other bookmarks',
        children: [
          { id: '20', title: 'Café Réseau 📚', children: [{ id: '21', title: '', url: 'https://example.com/secplus', dateAdded: Date.UTC(2023, 6, 3) }] },
          { id: '22', title: '📚', children: [{ id: '23', title: 'Emoji folder', url: 'http://example.org/' }] },
          { id: '24', title: 'Settings', url: 'chrome://settings/' },
        ],
      },
    ],
  },
];

test('folderTag matches the server tag normalization', () => {
  assert.equal(folderTag('Garage Door'), 'garage-door');
  assert.equal(folderTag('Café Réseau 📚'), 'cafe-reseau');
  assert.equal(folderTag('📚'), '');
  assert.equal(folderTag('x'.repeat(70)).length, 64);
  assert.equal(folderTag(`${'a'.repeat(63)} b`), 'a'.repeat(63));
});

test('bookmarkEntries maps folders to tags and dateAdded to createdAt, skips browser roots and non-web links, and merges duplicates', () => {
  assert.deepEqual(bookmarkEntries(TREE), [
    { url: 'https://envemedia.com/', title: 'Enve', createdAt: '2019-05-01T00:00:00.000Z' },
    { url: 'https://example.com/secplus', title: 'Security+ 2.0', tags: ['garage-door', 'cafe-reseau'], createdAt: '2023-07-03T00:00:00.000Z' },
    { url: 'https://github.com/ratgdo', title: 'ratgdo', tags: ['garage-door', 'esp32-library'] },
    { url: 'http://example.org/', title: 'Emoji folder' },
  ]);
  assert.deepEqual(bookmarkEntries([{ id: '0', title: '', children: [] }]), []);
});

test('chunk splits into fixed-size pieces', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 500), []);
});

test('importEntries sends chunks with one Idempotency-Key each and sums the results', async () => {
  const calls = [];
  const client = {
    captureBatch: async (items, { idempotencyKey }) => {
      calls.push({ size: items.length, idempotencyKey });
      return {
        created: items.length - 1,
        skipped: 1,
        failed: 0,
        results: items.map((_, i) => (i === 0 ? { id: 'x', created: false } : { id: `n${i}`, created: true })),
      };
    },
  };
  const entries = Array.from({ length: 1201 }, (_, i) => ({ url: `https://a.test/${i}` }));
  const progress = [];
  const totals = await importEntries(client, entries, { runId: 'run', onProgress: (t) => progress.push(t.done) });
  assert.deepEqual(calls, [
    { size: 500, idempotencyKey: 'import-run-0' },
    { size: 500, idempotencyKey: 'import-run-1' },
    { size: 201, idempotencyKey: 'import-run-2' },
  ]);
  assert.deepEqual(progress, [500, 1000, 1201]);
  assert.deepEqual({ ...totals, errors: totals.errors.length }, { total: 1201, done: 1201, created: 1198, skipped: 3, failed: 0, errors: 0 });
});

test('importEntries stops at a failed request and reports what got through', async () => {
  let call = 0;
  const client = {
    captureBatch: async (items) => {
      if (call++ === 1) throw new ApiError('offline', 'Could not connect.');
      return { created: 1, skipped: 0, failed: 1, results: [{ id: 'a', created: true }, { error: 'Tag "x" is longer than 64 characters.' }] };
    },
  };
  const entries = [{ url: 'https://a.test/1' }, { url: 'https://a.test/2' }, { url: 'https://a.test/3' }];
  const totals = await importEntries(client, entries, { size: 2 });
  assert.equal(totals.done, 2);
  assert.equal(totals.error.code, 'offline');
  assert.deepEqual(totals.errors, [{ url: 'https://a.test/2', message: 'Tag "x" is longer than 64 characters.' }]);
});
