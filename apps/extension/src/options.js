import {
  DEFAULT_SERVER_URL,
  TOKEN_COMMAND,
  canCapture,
  createClient,
  describeError,
  normalizeServerUrl,
  originPattern,
} from './lib/api.js';
import { bookmarkEntries, importEntries } from './lib/bookmarks.js';
import { ext } from './lib/browser.js';
import { discardFailed, flushOutbox, isOutboxKey, listOutbox, retryFailed, summarize } from './lib/outbox.js';
import { connect as connectClient, loadSettings, saveSettings } from './lib/settings.js';
import { renderMessage } from './lib/ui.js';

const $ = (id) => document.getElementById(id);

async function init() {
  const settings = await loadSettings();
  $('server-url').value = settings.serverUrl;
  $('token').value = settings.token;

  $('reveal').addEventListener('click', () => {
    const hidden = $('token').type === 'password';
    $('token').type = hidden ? 'text' : 'password';
    $('reveal').textContent = hidden ? 'Hide' : 'Show';
    $('reveal').setAttribute('aria-pressed', String(hidden));
  });
  $('settings').addEventListener('submit', (event) => {
    event.preventDefault();
    connectServer(true);
  });
  $('test').addEventListener('click', () => connectServer(false));

  for (const radio of document.querySelectorAll('input[name="action-opens"]')) {
    radio.checked = radio.value === settings.actionOpens;
    radio.addEventListener('change', () => saveSettings({ actionOpens: radio.value }));
  }
  $('track-visits').checked = settings.trackVisits;
  $('track-visits').addEventListener('change', toggleVisitTracking);
  $('notify-reminders').checked = settings.notifyReminders;
  $('notify-reminders').addEventListener('change', () => saveSettings({ notifyReminders: $('notify-reminders').checked }));
  $('import').addEventListener('click', startImport);
  wireOutbox();

  const commands = await ext.commands.getAll();
  $('shortcuts').replaceChildren(
    ...commands.flatMap((command) => {
      const key = document.createElement('dt');
      key.textContent = command.shortcut || 'Not set';
      const description = document.createElement('dd');
      description.textContent = command.description || 'Open the save popup';
      return [key, description];
    }),
  );
}

/** Runs synchronously up to the permission request: Firefox drops the click's user gesture at the first await. */
function connectServer(persist) {
  const serverUrl = normalizeServerUrl($('server-url').value || DEFAULT_SERVER_URL);
  const token = $('token').value.trim();
  if (!serverUrl) {
    showResult('error', 'That server address isn’t valid.', `Use something like ${DEFAULT_SERVER_URL}.`);
    return;
  }
  $('server-url').value = serverUrl;
  const granted = ext.permissions.request({ origins: [originPattern(serverUrl)] });
  void finishConnect(granted, serverUrl, token, persist);
}

async function finishConnect(granted, serverUrl, token, persist) {
  setBusy(true);
  try {
    if (!(await granted.catch(() => false))) {
      showResult('error', `Access to ${new URL(serverUrl).host} wasn’t granted.`, 'The extension needs it to reach Petty Memory there.');
      return;
    }
    if (persist) await saveSettings({ serverUrl, token });
    await testConnection(serverUrl, token, persist);
  } finally {
    setBusy(false);
  }
}

async function testConnection(serverUrl, token, saved) {
  const prefix = saved ? 'Saved. ' : '';
  showResult('pending', 'Connecting…', serverUrl);
  const client = createClient({ serverUrl, token });
  let status;
  try {
    status = await client.status();
  } catch (error) {
    return showResult('error', `${prefix}Petty Memory isn’t reachable.`, describeError(error, serverUrl));
  }
  if (!token) {
    return showResult('warn', `${prefix}Petty Memory ${status.version} is running.`, `Add an access token to save pages. Create one with \`${TOKEN_COMMAND}\`.`);
  }
  let me;
  try {
    me = await client.whoami();
  } catch (error) {
    return showResult('error', `${prefix}Petty Memory ${status.version} is running, but the token didn’t work.`, describeError(error, serverUrl));
  }
  if (!canCapture(me.scopes)) {
    return showResult(
      'warn',
      `${prefix}Connected as ${me.name}, but this token can’t save.`,
      `It has ${me.scopes.join(', ')}. Create one with \`${TOKEN_COMMAND}\`.`,
    );
  }
  showResult('ok', `${prefix}Connected as ${me.name}`, `Scopes: ${me.scopes.join(', ')} · Petty Memory ${status.version}`);
}

function showResult(kind, title, detail) {
  $('result').className = `message ${kind}`;
  $('result-title').textContent = title;
  renderMessage($('result-detail'), detail);
  $('result').hidden = false;
}

function setBusy(busy) {
  $('save').disabled = busy;
  $('test').disabled = busy;
}

function toggleVisitTracking() {
  if (!$('track-visits').checked) {
    void saveSettings({ trackVisits: false });
    return;
  }
  // Requested inside the change handler, before any await, so the browser still sees the user gesture.
  void ext.permissions.request({ permissions: ['tabs'] }).then(async (granted) => {
    $('track-visits').checked = granted;
    await saveSettings({ trackVisits: granted });
  });
}

function startImport() {
  void runImport(ext.permissions.request({ permissions: ['bookmarks'] }));
}

async function runImport(granted) {
  if (!(await granted.catch(() => false))) {
    return showImport('error', 'Bookmarks access wasn’t granted.', 'The import needs it to read your bookmarks.');
  }
  const { settings, client } = await connectClient();
  if (!client) return showImport('error', 'Connect first.', 'Add an access token above and save, then import.');
  const entries = bookmarkEntries(await ext.bookmarks.getTree());
  if (!entries.length) return showImport('warn', 'No bookmarks to import.', 'Only web pages (http and https) are imported.');

  $('import').disabled = true;
  $('import-result').hidden = true;
  $('import-progress').hidden = false;
  const progress = ({ done, total }) => {
    $('import-bar').style.width = `${Math.round((done / total) * 100)}%`;
    $('import-count').textContent = `${done.toLocaleString()} of ${total.toLocaleString()}`;
  };
  progress({ done: 0, total: entries.length });
  const totals = await importEntries(client, entries, { onProgress: progress });
  $('import').disabled = false;

  const counts = `${totals.created.toLocaleString()} new · ${totals.skipped.toLocaleString()} already saved · ${totals.failed.toLocaleString()} failed`;
  const failures = totals.errors.slice(0, 3).map((e) => `${e.url}: ${e.message}`);
  if (totals.error) {
    return showImport(
      'error',
      `Stopped after ${totals.done.toLocaleString()} of ${totals.total.toLocaleString()}.`,
      [counts, describeError(totals.error, settings.serverUrl), 'Run the import again to finish; saved bookmarks are skipped.'].join(' '),
    );
  }
  showImport(totals.failed ? 'warn' : 'ok', `Imported ${totals.total.toLocaleString()} bookmarks.`, [counts, ...failures].join(' · '));
}

function showImport(kind, title, detail) {
  $('import-result').className = `message ${kind}`;
  $('import-title').textContent = title;
  renderMessage($('import-detail'), detail);
  $('import-result').hidden = false;
}

function wireOutbox() {
  const sync = async () => {
    const { settings, client } = await connectClient();
    if (client) await flushOutbox(client, settings.serverUrl).catch(() => {});
  };
  $('outbox-sync').addEventListener('click', sync);
  $('outbox-retry').addEventListener('click', async () => {
    await retryFailed();
    await sync();
  });
  $('outbox-discard').addEventListener('click', discardFailed);
  ext.storage.onChanged.addListener((changes, area) => area === 'local' && Object.keys(changes).some(isOutboxKey) && renderOutbox());
  void renderOutbox();
}

async function renderOutbox() {
  const entries = await listOutbox();
  const { waiting, failed } = summarize(entries);
  $('outbox-panel').hidden = !entries.length;
  $('outbox-summary').textContent = [waiting && `${waiting} waiting to sync.`, failed && `${failed} couldn’t be saved:`].filter(Boolean).join(' ');
  $('outbox-failed').replaceChildren(
    ...entries
      .filter((entry) => entry.error)
      .map((entry) => Object.assign(document.createElement('li'), { textContent: `${entry.payload.title || entry.payload.url || 'Note'}: ${entry.error}` })),
  );
  $('outbox-sync').hidden = !waiting;
  $('outbox-retry').hidden = $('outbox-discard').hidden = !failed;
}

void init();
