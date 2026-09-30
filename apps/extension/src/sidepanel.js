import { INTENTS, buildCapturePayload, describeError, isCapturableUrl, isRetryable } from './lib/api.js';
import { ext } from './lib/browser.js';
import { choiceChips, h, renderSuggestions, tagField } from './lib/components.js';
import { hostOf, openItem } from './lib/items.js';
import { saveCapture } from './lib/outbox.js';
import { connect, loadProjects, saveSettings } from './lib/settings.js';
import { syncStrip } from './lib/sync-strip.js';
import { renderMessage } from './lib/ui.js';
import { REMIND_CHOICES, formatDate, formatWhen, isDue, remindAt } from './lib/when.js';

const $ = (id) => document.getElementById(id);
const INTENT_CHOICES = INTENTS.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
const SHELVES = [
  { id: 'recent', label: 'Recent', filter: {}, empty: 'Nothing saved yet.' },
  { id: 'pinned', label: 'Pinned', filter: { pinned: true }, empty: 'Pin something to keep it here.' },
  { id: 'read', label: 'Read', filter: { intent: 'read' }, empty: 'Nothing waiting to be read.' },
  { id: 'watch', label: 'Watch', filter: { intent: 'watch' }, empty: 'Nothing waiting to be watched.' },
  { id: 'buy', label: 'Buy', filter: { intent: 'buy' }, empty: 'Nothing on the shopping list.' },
  { id: 'unopened', label: 'Unopened', filter: { unopened: 30 }, empty: 'Every link from the last month has been opened.' },
  { id: 'reminders', label: 'Reminders', filter: { reminders: true }, empty: 'No reminders set.' },
];
const MATCH_LABELS = { keyword: 'keyword', semantic: 'meaning', both: 'keyword + meaning' };
const SEARCH_DELAY_MS = 200;
const SOON_MS = 24 * 3_600_000;

let client;
let settings;
let scopes = [];
let windowId;
let tab = null;
let item = null;
let pageSeq = 0;
let dirty = false;
let pinned = false;
let shelf = SHELVES[0];
let scope = '';
let resultsSeq = 0;
let tags;
let intent;
let remind;

const canWrite = () => scopes.includes('write');
const isOwnPage = (candidate) => candidate?.url?.startsWith(ext.runtime.getURL(''));

async function init() {
  const openSettings = () => ext.runtime.openOptionsPage();
  $('open-settings').addEventListener('click', openSettings);
  $('setup-open').addEventListener('click', openSettings);
  for (const key of document.querySelectorAll('.mod-key')) key.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

  ({ settings, client } = await connect());
  if (!client) {
    $('setup').hidden = false;
    return;
  }
  $('main').hidden = false;
  windowId = (await ext.windows.getCurrent()).id;
  wirePage();
  wireLibrary();
  wireNote();
  void syncStrip({ strip: $('sync'), text: $('sync-text'), button: $('sync-now') }, { client, serverUrl: settings.serverUrl });

  const [me] = await Promise.all([client.whoami().catch(() => null), loadScopes()]);
  scopes = me?.scopes ?? [];
  await Promise.all([loadPage(await initialTab()), showShelf(shelf)]);
  followTabs();
}

async function initialTab() {
  // ?tab=<id> pins the starting tab when the panel is opened as a page (tests); it still follows tab switches after.
  const id = Number(new URLSearchParams(location.search).get('tab'));
  if (id) return ext.tabs.get(id);
  const [active] = await ext.tabs.query({ active: true, windowId });
  return active;
}

async function loadScopes() {
  try {
    const { projects, offline, error } = await loadProjects(client);
    if (offline) showConnection(describeError(error, settings.serverUrl) + ' Saves will sync when it’s back.');
    const { panelScope = '' } = await ext.storage.local.get('panelScope');
    for (const project of projects) {
      $('scope').add(new Option(project.name, project.id));
      $('page-project').add(new Option(project.name, project.id));
    }
    if (projects.some((p) => p.id === panelScope)) scope = $('scope').value = panelScope;
    if (projects.some((p) => p.id === settings.lastProject?.id)) $('page-project').value = settings.lastProject.id;
  } catch (error) {
    showConnection(describeError(error, settings.serverUrl));
  }
}

function showConnection(message) {
  renderMessage($('connection-text'), message);
  $('connection').hidden = false;
}

function followTabs() {
  ext.tabs.onActivated.addListener(async ({ tabId, windowId: activeWindow }) => {
    if (activeWindow !== windowId) return;
    const next = await ext.tabs.get(tabId);
    if (!isOwnPage(next)) await loadPage(next);
  });
  ext.tabs.onUpdated.addListener((tabId, change, next) => {
    if (tabId !== tab?.id) return;
    if (change.url && change.url !== tab.url) return loadPage(next);
    if (change.title && !item && !dirty) {
      tab = next;
      $('page-title').value = next.title;
    }
  });
}

// This page

function wirePage() {
  tags = tagField($('page-chips'), $('page-tag-input'));
  intent = choiceChips($('page-intent'), INTENT_CHOICES, {
    label: 'Save for',
    onChange: (value) => item && act(() => (value ? captureNow({ intent: value }) : client.setIntent(item.id, null))),
  });
  remind = choiceChips($('page-remind'), REMIND_CHOICES, {
    label: 'Remind me',
    onChange: (value) => item && value && act(() => captureNow({ remind: remindAt(value) })),
  });
  $('pin').addEventListener('click', () => {
    if (!item) return setPinned(!pinned);
    // Pinning rides on a capture, so a capture-only token can pin; unpinning is an edit and needs write.
    return act(() => (item.pinnedAt ? client.pin(item.id, false) : captureNow({ pinned: true })));
  });
  $('clear-reminder').addEventListener('click', () => act(() => client.setReminder(item.id, null)));
  $('grant-tabs').addEventListener('click', async () => {
    if (!(await ext.permissions.request({ permissions: ['tabs'] }))) return;
    const [active] = await ext.tabs.query({ active: true, windowId });
    await loadPage(active);
  });
  for (const field of [$('page-note'), $('page-tag-input'), $('page-title')]) field.addEventListener('input', () => (dirty = true));
  $('page').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      $('page').requestSubmit();
    }
  });
  $('page').addEventListener('submit', (event) => {
    event.preventDefault();
    void savePage();
  });
}

function setPinned(value) {
  pinned = value;
  $('pin').setAttribute('aria-pressed', String(value));
  $('pin').title = $('pin').ariaLabel = value ? 'Unpin' : 'Pin';
}

async function loadPage(next) {
  const seq = ++pageSeq;
  tab = next;
  item = null;
  dirty = false;
  $('page-error').hidden = true;
  $('page').hidden = $('page-access').hidden = $('page-unsupported').hidden = true;

  if (!isCapturableUrl(tab?.url)) {
    const canSeeTabs = await ext.permissions.contains({ permissions: ['tabs'] });
    if (seq !== pageSeq) return;
    $(tab?.url || canSeeTabs ? 'page-unsupported' : 'page-access').hidden = false;
    $('related-section').hidden = true;
    return;
  }

  $('page-title').value = tab.title ?? '';
  $('page-host').textContent = hostOf(tab.url);
  $('page-host').title = tab.url;
  $('page-note').value = '';
  tags.clear();
  remind.value = null;
  setPinned(false);
  const found = await client.lookup(tab.url).catch((error) => (isRetryable(error) ? null : Promise.reject(error))).catch(showPageError);
  if (seq !== pageSeq) return;
  item = found ?? null;
  renderPage();
  $('page').hidden = false;
  void loadRelated(seq);
}

function renderPage() {
  const saved = Boolean(item);
  $('page-title').readOnly = saved;
  if (saved) $('page-title').value = item.title || tab.title || '';
  $('page-status').className = `page-status${saved ? ' saved' : ''}`;
  $('page-status').textContent = saved
    ? [`Saved ${formatDate(item.createdAt)}`, item.project?.name ?? 'Inbox', ...item.tags.map((t) => `#${t}`)].join(' · ')
    : 'Not saved yet';

  intent.value = item?.intent ?? null;
  // Re-saving can set an intent or a pin, but clearing either is an edit, which needs the write scope.
  intent.required = saved && Boolean(item.intent) && !canWrite();
  setPinned(saved ? Boolean(item.pinnedAt) : pinned);
  $('pin').disabled = saved && Boolean(item.pinnedAt) && !canWrite();

  remind.value = null;
  const reminder = item?.remindAt;
  $('page-reminder').hidden = !reminder;
  if (reminder) {
    $('page-reminder').className = `page-reminder${isDue(reminder) ? ' due' : ''}`;
    $('page-reminder-text').textContent = `${isDue(reminder) ? 'Due' : 'Reminder'} · ${formatWhen(reminder)}`;
    $('clear-reminder').hidden = !canWrite();
  }

  $('page-project').hidden = Boolean(item?.project);
  $('page-save').textContent = saved ? 'Update' : 'Save';
  renderSuggestions($('page-ai'), item, {
    canAccept: canWrite(),
    onAddTag: (tag) => tags.add(tag),
    onAccept: () => act(() => client.accept(item.id)),
  });
}

/** Runs one change to the saved item right away, then shows the item as the server now has it. */
async function act(change) {
  $('page-error').hidden = true;
  try {
    const result = await change();
    if (result?.queued) return flashStatus('Saved offline. It will sync when Petty Memory is back.');
    item = result?.item ?? result;
    renderPage();
    void showShelf(shelf);
  } catch (error) {
    showPageError(error);
    renderPage();
  }
}

const captureNow = (fields) => saveCapture(client, { url: tab.url, ...fields }, settings.serverUrl);

async function savePage() {
  if ($('page-save').disabled) return;
  const tagList = tags.tags;
  const project = item?.project ? undefined : $('page-project').value || undefined;
  const payload = buildCapturePayload({
    url: tab.url,
    title: item ? undefined : $('page-title').value,
    note: $('page-note').value,
    project,
    tags: tagList,
    intent: item ? undefined : intent.value,
    remind: !item && remind.value ? remindAt(remind.value) : undefined,
    pinned: !item && pinned,
  });
  $('page-error').hidden = true;
  $('page-save').disabled = true;
  try {
    const result = await saveCapture(client, payload, settings.serverUrl);
    if (!item?.project) {
      const name = $('page-project').selectedOptions[0].text;
      await saveSettings({ lastProject: project ? { id: project, name } : null });
    }
    $('page-note').value = '';
    tags.clear();
    dirty = false;
    if (result.queued) return flashStatus('Saved offline. It will sync when Petty Memory is back.');
    item = result.item;
    renderPage();
    flashStatus(result.created ? 'Saved' : 'Updated');
    void showShelf(shelf);
    void loadRelated(pageSeq);
  } catch (error) {
    showPageError(error);
  } finally {
    $('page-save').disabled = false;
  }
}

function flashStatus(text) {
  $('page-status').className = 'page-status saved';
  $('page-status').textContent = text;
  setTimeout(() => item && renderPage(), 2500);
}

function showPageError(error) {
  renderMessage($('page-error-text'), describeError(error, settings.serverUrl));
  $('page-error').hidden = false;
  return null;
}

async function loadRelated(seq) {
  const hits = await client.related(tab.url, tab.title ?? '', 6).catch(() => null);
  if (seq !== pageSeq) return;
  $('related-section').hidden = !hits;
  if (hits) renderList($('related'), hits, { empty: 'Nothing related yet.' });
}

// Library: search and shelves

function wireLibrary() {
  const tabs = SHELVES.map((entry) =>
    h('button', {
      type: 'button',
      className: 'tab',
      id: `shelf-${entry.id}`,
      textContent: entry.label,
      role: 'tab',
      onclick: () => {
        $('search').value = '';
        void showShelf(entry);
      },
    }),
  );
  $('shelves').replaceChildren(...tabs);
  $('shelves').addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = tabs[(tabs.indexOf(document.activeElement) + step + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });

  let timer;
  $('search').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => ($('search').value.trim() ? search() : showShelf(shelf)), SEARCH_DELAY_MS);
  });
  $('search').addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !$('search').value) return;
    event.preventDefault();
    $('search').value = '';
    void showShelf(shelf);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.target.closest('input, textarea, select')) return;
    event.preventDefault();
    $('search').focus();
  });
  $('scope').addEventListener('change', async () => {
    scope = $('scope').value;
    await ext.storage.local.set({ panelScope: scope });
    await ($('search').value.trim() ? search() : showShelf(shelf));
  });
}

function selectTab(selected) {
  for (const entry of SHELVES) {
    const button = $(`shelf-${entry.id}`);
    const on = entry === selected;
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on || (!selected && entry === shelf) ? 0 : -1;
  }
}

async function showShelf(entry) {
  shelf = entry;
  selectTab(entry);
  const seq = ++resultsSeq;
  const items = await client.items({ ...entry.filter, project: scope || undefined, limit: 30 }).catch(showListError);
  if (seq === resultsSeq && items) renderList($('results'), items, { empty: entry.empty });
}

async function search() {
  selectTab(null);
  const seq = ++resultsSeq;
  const hits = await client.search($('search').value.trim(), { project: scope || undefined }).catch(showListError);
  if (seq === resultsSeq && hits) renderList($('results'), hits, { empty: 'No matches.' });
}

function showListError(error) {
  $('results').replaceChildren();
  renderMessage($('results-empty'), describeError(error, settings.serverUrl));
  $('results-empty').hidden = false;
  return null;
}

function renderList(list, entries, { empty }) {
  list.replaceChildren(...entries.map((entry) => h('li', {}, [row(entry)])));
  if (list === $('results')) {
    $('results-empty').textContent = empty;
    $('results-empty').hidden = entries.length > 0;
  } else if (!entries.length) {
    list.replaceChildren(h('li', { className: 'muted', textContent: empty }));
  }
}

function row(entry) {
  const title = entry.title || entry.preview || entry.snippet || entry.body || hostOf(entry.url) || 'Untitled';
  const meta = [];
  if (entry.url) meta.push(h('span', { textContent: hostOf(entry.url) }));
  if (entry.project && entry.project.id !== scope) meta.push(h('span', { textContent: entry.project.name }));
  if (entry.remindAt) {
    const due = isDue(entry.remindAt);
    const soon = !due && Date.parse(entry.remindAt) - Date.now() < SOON_MS;
    meta.push(h('span', { className: due ? 'due' : soon ? 'soon' : '', textContent: `${due ? 'Due ' : ''}${formatWhen(entry.remindAt)}` }));
  }
  if (entry.pinnedAt && shelf.id !== 'pinned') meta.push(h('span', { textContent: 'Pinned' }));
  if (entry.match) meta.push(h('span', { className: 'match', textContent: MATCH_LABELS[entry.match] ?? entry.match }));
  const children = [h('span', { className: 'row-title', textContent: title })];
  if (entry.match && entry.snippet && entry.snippet.replace(/[[\]]/g, '') !== title) {
    children.push(h('span', { className: 'row-snippet' }, highlight(entry.snippet)));
  }
  children.push(h('span', { className: 'row-meta' }, meta));

  if (!entry.url) return h('div', { className: 'row note' }, children);
  const link = h('a', { className: 'row', href: entry.url, title: entry.url }, children);
  link.addEventListener('click', (event) => {
    event.preventDefault();
    void openItem(client, entry, { active: !(event.metaKey || event.ctrlKey) });
  });
  link.addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    void openItem(client, entry, { active: false });
  });
  return link;
}

/** Search snippets mark matched terms as [term]. */
function highlight(snippet) {
  return snippet.split(/\[([^\]]*)\]/).map((part, i) => (i % 2 ? h('mark', { textContent: part }) : document.createTextNode(part)));
}

// Quick note

function wireNote() {
  $('quick-note').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      $('note-form').requestSubmit();
    }
  });
  $('note-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const note = $('quick-note').value;
    if (!note.trim()) return;
    try {
      const result = await saveCapture(client, buildCapturePayload({ note, project: scope || undefined }), settings.serverUrl);
      $('quick-note').value = '';
      $('note-status').textContent = result.queued
        ? 'Saved offline. It will sync later.'
        : `Saved to ${result.item.project?.name ?? 'Inbox'}`;
      if (!result.queued && !$('search').value.trim()) void showShelf(shelf);
    } catch (error) {
      renderMessage($('note-status'), describeError(error, settings.serverUrl));
    }
  });
}

void init();
