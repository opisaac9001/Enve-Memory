import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectCapture } from '../src/renderer/lib/capture.ts';

test('a pasted URL becomes a link', () => {
  assert.deepEqual(detectCapture('https://example.com/article?id=1'), { kind: 'link', url: 'https://example.com/article?id=1', note: '' });
  assert.deepEqual(detectCapture('  http://localhost:8080/docs  '), { kind: 'link', url: 'http://localhost:8080/docs', note: '' });
});

test('text after the URL becomes the link note', () => {
  assert.deepEqual(detectCapture('https://esp32.example/lib read the timing section\nlater'), {
    kind: 'link', url: 'https://esp32.example/lib', note: 'read the timing section\nlater',
  });
});

test('www. addresses get https and trailing punctuation is dropped', () => {
  assert.equal((detectCapture('www.example.com/page') as { url: string }).url, 'https://www.example.com/page');
  assert.equal((detectCapture('https://example.com/x.') as { url: string }).url, 'https://example.com/x');
});

test('everything else is a note', () => {
  assert.deepEqual(detectCapture('Need a bench-test rig for the opener'), { kind: 'note', body: 'Need a bench-test rig for the opener' });
  assert.equal(detectCapture('see https://example.com later')?.kind, 'note');
  assert.equal(detectCapture('notes.txt')?.kind, 'note');
  assert.equal(detectCapture('ftp://example.com/file')?.kind, 'note');
  assert.equal(detectCapture('javascript:alert(1)')?.kind, 'note');
  assert.equal(detectCapture('https://')?.kind, 'note');
});

test('blank input captures nothing', () => {
  assert.equal(detectCapture(''), null);
  assert.equal(detectCapture('   \n  '), null);
});
