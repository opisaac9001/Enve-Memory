import { ext } from './browser.js';
import { flushOutbox, isOutboxKey, listOutbox, summarize } from './outbox.js';

/** "N waiting to sync" with a Sync now button; hidden when nothing is queued. Stays live as the queue changes. */
export function syncStrip({ strip, text, button }, { client, serverUrl }) {
  const render = async () => {
    const { waiting, failed } = summarize(await listOutbox());
    strip.hidden = !waiting && !failed;
    text.textContent = [waiting && `${waiting} waiting to sync`, failed && `${failed} couldn't sync (see Settings)`].filter(Boolean).join(' · ');
    button.hidden = !waiting;
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    await flushOutbox(client, serverUrl).catch(() => {});
    button.disabled = false;
  });
  ext.storage.onChanged.addListener((changes, area) => area === 'local' && Object.keys(changes).some(isOutboxKey) && render());
  return render();
}

