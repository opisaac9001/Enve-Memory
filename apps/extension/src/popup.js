import { buildCapturePayload, createClient, describeError, isCapturableUrl, parseTags } from './lib/api.js';
import { ext } from './lib/browser.js';
import { readSelection } from './lib/page.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { renderMessage } from './lib/ui.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_ERRORS = new Set(['unauthorized', 'insufficient_scope', 'offline', 'not_enve', 'forbidden_host']);
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

let client;
let settings;
let tab;
let existing = null;
let tags = [];

const openSettings = () => ext.runtime.openOptionsPage().then(() => window.close());

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

  settings = await loadSettings();
  if (!settings.token) {
    $('setup').hidden = false;
    return;
  }
  client = createClient(settings);
  tab = await targetTab();
  wireForm();
  $('capture').hidden = false;

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
    const [projects, item] = await Promise.all([client.projects(), bookmarkable ? client.lookup(tab.url) : null]);
    fillProjects(projects);
    if (item) showExisting(item);
  } catch (error) {
    showError(error);
  }
}

function fillProjects(projects) {
  const select = $('project');
  for (const project of projects) select.add(new Option(project.name, project.id));
  if (projects.some((p) => p.id === settings.lastProject?.id)) select.value = settings.lastProject.id;
}

// Re-capturing a URL only appends the note and merges tags, so title and project aren't editable here.
function showExisting(item) {
  existing = item;
  $('existing-date').textContent = `on ${dateFormat.format(new Date(item.createdAt))}`;
  const meta = [item.project?.name ?? 'Inbox', ...item.tags.map((t) => `#${t}`)].join(' · ');
  $('existing-meta').textContent = meta;
  $('existing').hidden = false;
  $('title-field').hidden = true;
  $('project-field').hidden = true;
  $('tag-input').placeholder = 'Add more tags';
  $('save').textContent = 'Update';
}

function wireForm() {
  const input = $('tag-input');
  $('chips').addEventListener('click', (event) => event.target === event.currentTarget && input.focus());
  input.addEventListener('keydown', (event) => {
    // Plain Enter only commits a tag; saving from here takes Cmd/Ctrl+Enter, so a stray Enter can't save early.
    if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || event.key === ',') {
      event.preventDefault();
      commitTags();
    } else if (event.key === 'Backspace' && !input.value && tags.length) {
      tags = tags.slice(0, -1);
      renderChips();
    }
  });
  input.addEventListener('input', () => input.value.includes(',') && commitTags());
  input.addEventListener('blur', commitTags);

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

function commitTags() {
  const input = $('tag-input');
  const added = parseTags(input.value);
  input.value = '';
  if (!added.length) return;
  tags = parseTags([...tags, ...added].join(','));
  renderChips();
}

function renderChips() {
  const input = $('tag-input');
  const chips = tags.map((tag) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `#${tag}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${tag}`);
    remove.addEventListener('click', () => {
      tags = tags.filter((t) => t !== tag);
      renderChips();
      input.focus();
    });
    chip.append(remove);
    return chip;
  });
  $('chips').replaceChildren(...chips, input);
}

async function save() {
  if ($('save').disabled) return;
  commitTags();
  $('error').hidden = true;
  $('save').disabled = true;
  const label = $('save').textContent;
  $('save').textContent = 'Saving…';

  const select = $('project');
  const project = existing ? undefined : select.value || undefined;
  const payload = buildCapturePayload({
    url: tab.url,
    title: $('title').value,
    selection: $('selection-field').hidden ? '' : $('selection').value,
    note: $('note').value,
    project,
    tags,
  });

  try {
    const { item, created } = await client.capture(payload);
    if (!existing) await saveSettings({ lastProject: project ? { id: project, name: select.selectedOptions[0].text } : null });
    showDone(item, created);
  } catch (error) {
    showError(error);
    $('save').disabled = false;
    $('save').textContent = label;
  }
}

function showDone(item, created) {
  $('capture').hidden = true;
  $('done-title').textContent = created ? 'Saved' : 'Updated';
  $('done-detail').textContent = [item.project?.name ?? 'Inbox', ...item.tags.map((t) => `#${t}`)].join(' · ');
  $('done').hidden = false;
  $('done-close').focus();
}

function showError(error) {
  renderMessage($('error-text'), describeError(error, settings.serverUrl));
  $('error-settings').hidden = !SETTINGS_ERRORS.has(error?.code);
  $('error').hidden = false;
}

void init();
