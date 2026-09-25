import {
  DEFAULT_SERVER_URL,
  TOKEN_COMMAND,
  canCapture,
  createClient,
  describeError,
  normalizeServerUrl,
  originPattern,
} from './lib/api.js';
import { ext } from './lib/browser.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { renderMessage } from './lib/ui.js';

const $ = (id) => document.getElementById(id);

async function init() {
  const { serverUrl, token } = await loadSettings();
  $('server-url').value = serverUrl;
  $('token').value = token;

  $('reveal').addEventListener('click', () => {
    const hidden = $('token').type === 'password';
    $('token').type = hidden ? 'text' : 'password';
    $('reveal').textContent = hidden ? 'Hide' : 'Show';
    $('reveal').setAttribute('aria-pressed', String(hidden));
  });
  $('settings').addEventListener('submit', (event) => {
    event.preventDefault();
    connect(true);
  });
  $('test').addEventListener('click', () => connect(false));

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
function connect(persist) {
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
      showResult('error', `Access to ${new URL(serverUrl).host} wasn’t granted.`, 'The extension needs it to reach Enve Memory there.');
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
    return showResult('error', `${prefix}Enve Memory isn’t reachable.`, describeError(error, serverUrl));
  }
  if (!token) {
    return showResult('warn', `${prefix}Enve Memory ${status.version} is running.`, `Add an access token to save pages. Create one with \`${TOKEN_COMMAND}\`.`);
  }
  let me;
  try {
    me = await client.whoami();
  } catch (error) {
    return showResult('error', `${prefix}Enve Memory ${status.version} is running, but the token didn’t work.`, describeError(error, serverUrl));
  }
  if (!canCapture(me.scopes)) {
    return showResult(
      'warn',
      `${prefix}Connected as ${me.name}, but this token can’t save.`,
      `It has ${me.scopes.join(', ')}. Create one with \`${TOKEN_COMMAND}\`.`,
    );
  }
  showResult('ok', `${prefix}Connected as ${me.name}`, `Scopes: ${me.scopes.join(', ')} · Enve Memory ${status.version}`);
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

void init();
