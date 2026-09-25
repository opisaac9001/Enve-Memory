import { INTENTS, buildCapturePayload, describeError, isCapturableUrl, isRetryable } from './lib/api.js';
import { ext } from './lib/browser.js';
import { choiceChips, renderSuggestions, tagField } from './lib/components.js';
import { saveCapture } from './lib/outbox.js';
import { readSelection } from './lib/page.js';
import { openSidePanel } from './lib/panel.js';
import { connect, loadProjects, saveSettings } from './lib/settings.js';
import { syncStrip } from './lib/sync-strip.js';
import { renderMessage } from './lib/ui.js';
import { REMIND_CHOICES, formatDate, formatWhen, remindAt } from './lib/when.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_ERRORS = new Set(['unauthorized', 'insufficient_scope', 'offline', 'not_enve', 'forbidden_host']);
const INTENT_CHOICES = INTENTS.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

let client;
let settings;
let tab;
let scopes = [];
let existing = null;
let tags;
let intent;
let remind;

const openSettings = () => ext.runtime.openOptionsPage().then(() => window.close());
const canWrite = () => scopes.includes('write');

async function targetTab() {
  // ?tab=<id> targets a specific tab when the popup is opened as a page (tests, detached windows).
  const id = Number(new URLSearchParams(location.search).get('tab'));
  if (id) return ext.tabs.get(id);
  const [active] = await ext.tabs.query({ active: true, currentWindow: true });
  return active;
}

async function init() {
  $('open-settings').addEventListener('click', openSettings);
  $('setup-open').addEventListener('click', openSettings);
  $('error-settings').addEventListener('click', openSettings);
  $('done-close').addEventListener('click', () => window.close());
  $('mod-key').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

  ({ settings, client } = await connect());
  if (!client) {
    $('setup').hidden = false;
    return;
  }
  tab = await targetTab();
  $('open-panel').addEventListener('click', () => {
    openSidePanel(tab.windowId);
    window.close();
  });
  wireForm();
  $('capture').hidden = false;
  void syncStrip({ strip: $('sync'), text: $('sync-text'), button: $('sync-now') }, { client, serverUrl: settings.serverUrl });

  $('title').value = tab.title ?? '';
  const bookmarkable = isCapturableUrl(tab.url);
  $('url').textContent = bookmarkable ? tab.url : 'Not a web page, so this saves as a note.';
  $('url').title = tab.url ?? '';

  $('note').focus();
  await Promise.all([fillSelection(), loadLibrary(bookmarkable)]);
}

async function fillSelection() {
  const selection = await readSelection(tab.id);
  if (!selection.trim()) return;
  $('selection').value = selection;
  $('selection-field').hidden = false;
}

async function loadLibrary(bookmarkable) {
  try {
    const [{ projects, offline, error }, item, me] = await Promise.all([
      loadProjects(client),
      bookmarkable ? client.lookup(tab.url).catch(ignoreOffline) : null,
      client.whoami().catch(ignoreOffline),
    ]);
    fillProjects(projects);
    scopes = me?.scopes ?? [];
    if (offline) showError(error, 'Offline: saves will sync when Enve Memory is back.');
    if (item) showExisting(item);
  } catch (error) {
    showError(error);
  }
}

function ignoreOffline(error) {
  if (isRetryable(error)) return null;
  throw error;
}

function fillProjects(projects) {
  const select = $('project');
  for (const project of projects) select.add(new Option(project.name, project.id));
  if (projects.some((p) => p.id === settings.lastProject?.id)) select.value = settings.lastProject.id;
}

// Re-saving a URL appends the note, merges tags, sets a reminder and files it if it has no project; the title stays.
function showExisting(item) {
  existing = item;
  $('existing-date').textContent = `on ${formatDate(item.createdAt)}`;
  $('existing-meta').textContent = [item.project?.name ?? 'Inbox', ...item.tags.map((t) => `#${t}`)].join(' · ');
  $('existing').hidden = false;
  $('title-field').hidden = true;
  $('project-field').hidden = Boolean(item.project);
  $('tag-input').placeholder = 'Add more tags';
  $('save').textContent = 'Update';
  intent.value = item.intent;
  // Changing an existing item's intent is an edit, which needs the write scope.
  intent.disabled = !canWrite();
  if (item.remindAt) $('reminder-set').textContent = `Set for ${formatWhen(item.remindAt)}`;
  renderSuggestions($('ai'), item, {
    canAccept: canWrite(),
    onAddTag: (tag) => tags.add(tag),
    onAccept: async () => {
      try {
        showExisting(await client.accept(item.id));
      } catch (error) {
        showError(error);
      }
    },
  });
}

function wireForm() {
  tags = tagField($('chips'), $('tag-input'));
  intent = choiceChips($('intent'), INTENT_CHOICES, { label: 'Save for' });
  remind = choiceChips($('remind'), REMIND_CHOICES, { label: 'Remind me' });

  $('clear-selection').addEventListener('click', () => {
    $('selection').value = '';
    $('selection-field').hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      $('capture').requestSubmit();
    }
  });
  $('capture').addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
}

async function save() {
  if ($('save').disabled) return;
  const tagList = tags.tags;
  $('error').hidden = true;
  $('save').disabled = true;
  const label = $('save').textContent;
  $('save').textContent = 'Saving…';

  const select = $('project');
  const project = existing?.project ? undefined : select.value || undefined;
  const payload = buildCapturePayload({
    url: tab.url,
    title: existing ? undefined : $('title').value,
    selection: $('selection-field').hidden ? '' : $('selection').value,
    note: $('note').value,
    project,
    tags: tagList,
    intent: existing ? undefined : intent.value,
    remind: remind.value && remindAt(remind.value),
  });

  try {
    const result = await saveCapture(client, payload, settings.serverUrl);
    if (!existing?.project) await saveSettings({ lastProject: project ? { id: project, name: select.selectedOptions[0].text } : null });
    if (result.queued) return showDone('Saved offline', 'It will sync when Enve Memory is back.');
    let { item } = result;
    if (existing && canWrite() && intent.value !== existing.intent) item = await client.setIntent(item.id, intent.value);
    showDone(result.created ? 'Saved' : 'Updated', [item.project?.name ?? 'Inbox', ...item.tags.map((t) => `#${t}`)].join(' · '));
  } catch (error) {
    showError(error);
    $('save').disabled = false;
    $('save').textContent = label;
  }
}

function showDone(title, detail) {
  $('capture').hidden = true;
  $('done-title').textContent = title;
  $('done-detail').textContent = detail;
  $('done').hidden = false;
  $('done-close').focus();
}

function showError(error, message = describeError(error, settings.serverUrl)) {
  renderMessage($('error-text'), message);
  $('error-settings').hidden = !SETTINGS_ERRORS.has(error?.code) || isRetryable(error);
  $('error').className = `message alert ${isRetryable(error) ? 'warn' : 'error'}`;
  $('error').hidden = false;
}

void init();
