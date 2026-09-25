import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { type Cipher, SecretStore } from '../src/main/secrets.ts';

const dir = mkdtempSync(join(tmpdir(), 'enve-secrets-'));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Stands in for Electron's safeStorage: reversible, and never leaves the plaintext in the output. */
function fakeCipher(available = true): Cipher & { calls: number } {
  const cipher = {
    calls: 0,
    isEncryptionAvailable: () => available,
    encryptString: (plain: string) => Buffer.from(`sealed:${Buffer.from(plain).toString('base64').split('').reverse().join('')}`),
    decryptString: (sealed: Buffer) => {
      cipher.calls += 1;
      const text = sealed.toString();
      assert.ok(text.startsWith('sealed:'));
      return Buffer.from(text.slice(7).split('').reverse().join(''), 'base64').toString();
    },
  };
  return cipher;
}

test('keys round-trip through the cipher and survive a restart', () => {
  const file = join(dir, 'round-trip.json');
  const store = new SecretStore(file, fakeCipher());
  store.set('anthropic', 'sk-ant-secret-123');
  store.set('openai', 'sk-openai-456');
  assert.equal(store.get('anthropic'), 'sk-ant-secret-123');
  assert.deepEqual(store.names(), ['anthropic', 'openai']);

  const reopened = new SecretStore(file, fakeCipher());
  assert.equal(reopened.get('openai'), 'sk-openai-456');
  assert.equal(reopened.get('gemini'), undefined);
});

test('the file on disk holds only ciphertext, readable by the owner alone', () => {
  const file = join(dir, 'on-disk.json');
  new SecretStore(file, fakeCipher()).set('anthropic', 'sk-ant-visible?');
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes('sk-ant-visible?'));
  assert.ok(!raw.includes(Buffer.from('sk-ant-visible?').toString('base64')));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('decrypts once, then serves from memory', () => {
  const file = join(dir, 'cache.json');
  new SecretStore(file, fakeCipher()).set('ollama', 'k');
  const cipher = fakeCipher();
  const store = new SecretStore(file, cipher);
  store.get('ollama');
  store.get('ollama');
  assert.equal(cipher.calls, 1);
});

test('delete removes the key from memory and disk', () => {
  const file = join(dir, 'delete.json');
  const store = new SecretStore(file, fakeCipher());
  store.set('openrouter', 'or-key');
  store.delete('openrouter');
  assert.equal(store.get('openrouter'), undefined);
  assert.equal(new SecretStore(file, fakeCipher()).get('openrouter'), undefined);
});

test('refuses to store a key when the OS credential store is unavailable', () => {
  const file = join(dir, 'unavailable.json');
  const store = new SecretStore(file, fakeCipher(false));
  assert.equal(store.available, false);
  assert.throws(() => store.set('openai', 'sk'), /credential store/);
  assert.deepEqual(store.names(), []);
});
