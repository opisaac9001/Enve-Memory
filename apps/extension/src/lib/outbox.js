import { describeError, isRetryable } from './api.js';
import { ext } from './browser.js';

// One storage key per entry, so pages queuing and the service worker flushing never overwrite each other.
const PREFIX = 'outbox:';
const PER_ENTRY = new Set(['invalid', 'invalid_json', 'not_found', 'too_large', 'conflict']);

export const isOutboxKey = (key) => key.startsWith(PREFIX);

export function summarize(entries) {
  const failed = entries.filter((entry) => entry.error).length;
  return { waiting: entries.length - failed, failed };
}

/**
 * Sends entries oldest first. An error about one entry (bad project, too large) marks it failed and moves on; anything
 * else (server away, bad token) stops, leaving the rest queued.
 */
export async function drain(entries, send) {
  const sent = [];
  const failed = [];
  for (const entry of entries) {
    if (entry.error) continue;
    try {
      await send(entry);
      sent.push(entry.key);
    } catch (error) {
      if (!PER_ENTRY.has(error?.code)) return { sent, failed, stoppedBy: error };
      failed.push({ key: entry.key, error });
    }
  }
  return { sent, failed, stoppedBy: null };
}

export async function listOutbox() {
  const stored = await ext.storage.local.get(null);
  return Object.entries(stored)
    .filter(([key]) => isOutboxKey(key))
    .map(([, entry]) => entry)
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export function enqueue(payload, key) {
  return ext.storage.local.set({ [PREFIX + key]: { key, payload, queuedAt: new Date().toISOString() } });
}

let flushing = null;

/** Sends everything queued. Safe to call from any context: repeats reuse each entry's Idempotency-Key. */
export function flushOutbox(client, serverUrl) {
  flushing ??= (async () => {
    const entries = await listOutbox();
    const result = await drain(entries, (entry) => client.capture(entry.payload, { idempotencyKey: entry.key }));
    await ext.storage.local.remove(result.sent.map((key) => PREFIX + key));
    if (result.failed.length) {
      const byKey = new Map(entries.map((entry) => [entry.key, entry]));
      await ext.storage.local.set(
        Object.fromEntries(result.failed.map(({ key, error }) => [PREFIX + key, { ...byKey.get(key), error: describeError(error, serverUrl) }])),
      );
    }
    return result;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/**
 * Sends a capture now, or queues it when Enve Memory can't be reached. The key sent now is the key reused on retry, so
 * a save that landed just before the connection dropped isn't duplicated.
 */
export async function saveCapture(client, payload, serverUrl) {
  const key = crypto.randomUUID();
  try {
    const result = await client.capture(payload, { idempotencyKey: key });
    void flushOutbox(client, serverUrl).catch(() => {});
    return { queued: false, ...result };
  } catch (error) {
    if (!isRetryable(error)) throw error;
    await enqueue(payload, key);
    return { queued: true };
  }
}

export async function retryFailed() {
  const failed = (await listOutbox()).filter((entry) => entry.error);
  await ext.storage.local.set(Object.fromEntries(failed.map(({ error, ...entry }) => [PREFIX + entry.key, entry])));
}

export async function discardFailed() {
  const failed = (await listOutbox()).filter((entry) => entry.error);
  await ext.storage.local.remove(failed.map((entry) => PREFIX + entry.key));
}
