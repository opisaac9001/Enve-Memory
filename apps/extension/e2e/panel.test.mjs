import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { docsPath, startEnvironment, until } from './support/environment.mjs';

describe('side panel, import, reminders and opens in Chromium', () => {
  let env;
  let articleUrl;

  before(async () => {
    env = await startEnvironment();
    await env.configure();
    articleUrl = env.siteUrl('/article.html');
    await env.api.capture({
      url: articleUrl,
      title: 'Security+ 2.0 protocol notes',
      selection: 'Security+ 2.0 uses a rolling code on a single-wire bus.',
      project: env.projects.garage.id,
      tags: ['esp32'],
      intent: 'revisit',
    });
    await env.api.capture({ url: 'https://example.com/wall-button', title: 'Security+ wall button protocol', project: env.projects.garage.id, intent: 'revisit' });
    await env.api.capture({ url: 'https://example.com/novel', title: 'A novel to read', project: env.projects.reading.id, intent: 'read' });
  });
  after(() => env?.stop());

  const openPanel = async (tabId, width = 400) => {
    const panel = await env.openExtensionPage('sidepanel.html', { tabId, width, height: 1100 });
    await panel.locator('#page-status').filter({ hasText: /\S/ }).waitFor();
    return panel;
  };
  const rowTitles = (panel, list) => panel.locator(`${list} .row-title`).allTextContents();

  test('This page: saved state, suggestions, intent, reminder and pin with a capture-only token', async () => {
    const article = await env.api.lookup(articleUrl);
    await env.server.suggest(article.id, { summary: 'How Security+ 2.0 openers talk over one wire.', tags: ['rolling-code', 'esp32'] });
    await env.openTab('/article.html');
    const panel = await openPanel(await env.tabIdFor(articleUrl));

    assert.match(await panel.locator('#page-status').innerText(), /^Saved .+ · Garage Door · #esp32$/);
    assert.equal(await panel.locator('#page-save').innerText(), 'Update');
    assert.ok(await panel.locator('#page-project').isHidden(), 'already filed');
    assert.match(await panel.locator('#page-ai').innerText(), /one wire/);
    assert.equal(await panel.locator('#page-ai button:text("Accept suggestions")').count(), 0);

    await panel.click('#page-ai button:text("+ #rolling-code")');
    await panel.fill('#page-note', 'Check the bus timing.');
    await panel.press('#page-note', 'ControlOrMeta+Enter');
    await until(async () => (await env.api.lookup(articleUrl)).tags.includes('rolling-code'), 'suggested tag saved');
    assert.match((await env.api.lookup(articleUrl)).body, /Check the bus timing\./);

    await panel.click('#page-intent button:text("Watch")');
    await until(async () => (await env.api.lookup(articleUrl)).intent === 'watch', 'intent changed by re-saving');
    await panel.locator('#page-intent button:text("Watch")[aria-pressed="true"]').waitFor();
    await panel.click('#page-intent button:text("Watch")');
    await panel.waitForTimeout(300);
    assert.equal((await env.api.lookup(articleUrl)).intent, 'watch', 'clearing an intent needs write');
    await panel.click('#page-intent button:text("Revisit")');
    await until(async () => (await env.api.lookup(articleUrl)).intent === 'revisit', 'intent restored');

    await panel.click('#page-remind button:text("Tomorrow")');
    await panel.locator('#page-reminder').filter({ hasText: 'Tomorrow' }).waitFor();
    await panel.click('#pin');
    await until(async () => (await env.api.lookup(articleUrl)).pinnedAt, 'pinned');
    await panel.locator('#pin[aria-pressed="true"]').waitFor();
    assert.ok(await panel.locator('#pin').isDisabled(), 'unpinning needs write');
    await panel.close();
  });

  test('related items, search, shelves, scoping, opening and a quick note', async () => {
    const panel = await openPanel(await env.tabIdFor(articleUrl));
    await panel.locator('#related .row').first().waitFor();
    assert.deepEqual(await rowTitles(panel, '#related'), ['Security+ wall button protocol']);

    await panel.keyboard.press('/');
    assert.equal(await panel.evaluate(() => document.activeElement.id), 'search');
    await panel.keyboard.type('rolling');
    await panel.locator('#results .row-snippet mark').first().waitFor();
    assert.deepEqual(await rowTitles(panel, '#results'), ['Security+ 2.0 protocol notes']);
    assert.equal(await panel.locator('#results .match').first().innerText(), 'keyword');
    await panel.press('#search', 'Escape');

    const shelf = async (name) => {
      await panel.click(`#shelves button:text-is("${name}")`);
      await until(async () => (await panel.getAttribute(`#shelves button:text-is("${name}")`, 'aria-selected')) === 'true', name);
      await panel.waitForTimeout(150);
      return rowTitles(panel, '#results');
    };
    assert.deepEqual(await shelf('Pinned'), ['Security+ 2.0 protocol notes']);
    assert.deepEqual(await shelf('Read'), ['A novel to read']);
    assert.deepEqual(await shelf('Unopened'), []);
    assert.equal(await panel.locator('#results-empty').innerText(), 'Every link from the last month has been opened.');
    assert.deepEqual(await shelf('Reminders'), ['Security+ 2.0 protocol notes']);
    assert.match(await panel.locator('#results .row-meta').first().innerText(), /Tomorrow/);
    await panel.focus('#shelves button[aria-selected="true"]');
    await panel.keyboard.press('ArrowLeft');
    assert.equal(await panel.getAttribute('#shelves button:text-is("Unopened")', 'aria-selected'), 'true');

    await shelf('Recent');
    await panel.selectOption('#scope', { label: 'Reading List' });
    await until(async () => (await rowTitles(panel, '#results')).join() === 'A novel to read', 'scoped shelf');
    await panel.fill('#quick-note', 'Ask the library for the sequel.');
    await panel.press('#quick-note', 'ControlOrMeta+Enter');
    await panel.locator('#note-status').filter({ hasText: 'Saved to Reading List' }).waitFor();
    await until(async () => (await rowTitles(panel, '#results')).includes('Ask the library for the sequel.'), 'note in shelf');
    await panel.selectOption('#scope', { label: 'All projects' });

    await shelf('Pinned');
    const [opened] = await Promise.all([env.context.waitForEvent('page'), panel.click('#results a.row')]);
    await opened.waitForLoadState();
    assert.equal(opened.url(), articleUrl);
    await until(async () => (await env.api.lookup(articleUrl)).openedAt, 'open recorded');
    await opened.close();

    await panel.selectOption('#scope', { label: 'All projects' });
    await shelf('Recent');
    await panel.screenshot({ path: docsPath('sidepanel-dark.png'), fullPage: true });
    // Reload so form controls pick up the light scheme from the start, as a light-mode browser would render them.
    await panel.emulateMedia({ colorScheme: 'light' });
    await panel.reload();
    await panel.locator('#related .row').first().waitFor();
    await panel.locator('#results .row').first().waitFor();
    await panel.screenshot({ path: docsPath('sidepanel-light.png'), fullPage: true });
    await panel.close();
  });

  test('the panel follows tab switches and saves a new page with intent, reminder and pin', async () => {
    const panel = await openPanel(await env.tabIdFor(articleUrl));
    await env.openTab('/unsaved.html');
    await until(async () => (await panel.inputValue('#page-title')) === 'Bench rig wiring', 'panel follows the new tab');
    assert.equal(await panel.locator('#page-status').innerText(), 'Not saved yet');
    assert.equal(await panel.locator('#page-save').innerText(), 'Save');

    await panel.bringToFront();
    await panel.click('#page-intent button:text("Watch")');
    await panel.click('#page-remind button:text("Tonight")');
    await panel.click('#pin');
    await panel.fill('#page-tag-input', 'bench');
    await panel.fill('#page-note', 'Relay board and a 12V supply.');
    await panel.press('#page-note', 'ControlOrMeta+Enter');
    await panel.locator('#page-status').filter({ hasText: 'Saved' }).waitFor();

    const item = await env.api.lookup(env.siteUrl('/unsaved.html'));
    assert.equal(item.title, 'Bench rig wiring');
    assert.equal(item.intent, 'watch');
    assert.ok(item.pinnedAt);
    assert.ok(Date.parse(item.remindAt) > Date.now());
    assert.deepEqual(item.tags, ['bench']);
    assert.equal(item.body, 'Relay board and a 12V supply.');
    await panel.close();
  });

  test('with a write token: Accept, clearing an intent, unpinning and clearing a reminder', async () => {
    const writeToken = await env.server.token('Chrome (write)', 'read,write');
    await env.worker.evaluate((token) => chrome.storage.local.set({ token }), writeToken);
    try {
      const saved = await env.api.lookup(env.siteUrl('/unsaved.html'));
      await env.server.suggest(saved.id, { summary: 'A relay-driven bench rig.', tags: ['relay'] });
      const panel = await openPanel(await env.tabIdFor(env.siteUrl('/unsaved.html')));
      await panel.click('#page-ai button:text("Accept suggestions")');
      await until(async () => (await env.api.lookup(env.siteUrl('/unsaved.html'))).tags.includes('relay'), 'accepted');
      assert.equal((await env.api.lookup(env.siteUrl('/unsaved.html'))).metadata.ai.accepted, true);

      await panel.click('#page-intent button:text("Read")');
      await until(async () => (await env.api.lookup(env.siteUrl('/unsaved.html'))).intent === 'read', 'intent changed');
      await panel.locator('#page-intent button:text("Read")[aria-pressed="true"]').waitFor();
      await panel.click('#page-intent button:text("Read")');
      await until(async () => (await env.api.lookup(env.siteUrl('/unsaved.html'))).intent === null, 'intent cleared with write');
      await panel.click('#pin');
      await until(async () => (await env.api.lookup(env.siteUrl('/unsaved.html'))).pinnedAt === null, 'unpinned');
      await panel.click('#clear-reminder');
      await until(async () => (await env.api.lookup(env.siteUrl('/unsaved.html'))).remindAt === null, 'reminder cleared');
      await panel.close();
    } finally {
      await env.configure();
    }
  });

  test('Options imports the browser bookmark tree in one click', async () => {
    await env.worker.evaluate(
      async ({ articleUrl, extra }) => {
        const bar = (await chrome.bookmarks.getTree())[0].children[0].id;
        const garage = await chrome.bookmarks.create({ parentId: bar, title: 'Garage Door' });
        await chrome.bookmarks.create({ parentId: garage.id, title: 'Security+ notes', url: articleUrl });
        const esp = await chrome.bookmarks.create({ parentId: garage.id, title: 'ESP32' });
        await chrome.bookmarks.create({ parentId: esp.id, title: 'ratgdo', url: 'https://github.com/ratgdo/esphome-ratgdo' });
        await chrome.bookmarks.create({ parentId: bar, title: 'Enve', url: 'https://envemedia.com/' });
        await chrome.bookmarks.create({ parentId: bar, title: 'Flags', url: 'chrome://flags/' });
        for (let i = 0; i < extra; i++) await chrome.bookmarks.create({ parentId: bar, title: `Reading ${i}`, url: `https://example.org/${i}` });
      },
      { articleUrl, extra: 520 },
    );

    const added = await env.worker.evaluate(async () => {
      const [ratgdo] = await chrome.bookmarks.search({ url: 'https://github.com/ratgdo/esphome-ratgdo' });
      return new Date(ratgdo.dateAdded).toISOString();
    });
    const articleCreated = (await env.api.lookup(articleUrl)).createdAt;

    const options = await env.openExtensionPage('options.html', { width: 900, height: 1400 });
    await options.click('#import');
    await options.locator('#import-result.ok').waitFor({ timeout: 20_000 });
    assert.equal(await options.locator('#import-title').innerText(), 'Imported 523 bookmarks.');
    assert.equal(await options.locator('#import-detail').innerText(), '522 new · 1 already saved · 0 failed');
    assert.equal(await options.locator('#import-count').innerText(), '523 of 523');

    assert.deepEqual((await env.api.lookup('https://github.com/ratgdo/esphome-ratgdo')).tags, ['esp32', 'garage-door']);
    assert.deepEqual((await env.api.lookup('https://envemedia.com/')).tags, []);
    assert.equal((await env.api.lookup('https://github.com/ratgdo/esphome-ratgdo')).createdAt, added, 'keeps the bookmark date');
    assert.equal((await env.api.lookup(articleUrl)).createdAt, articleCreated, 'an existing item keeps its own date');
    assert.ok((await env.api.lookup(articleUrl)).tags.includes('garage-door'), 'existing bookmark gains the folder tag');
    await options.close();
  });

  test('Options switches the toolbar button to the side panel and back', async () => {
    const options = await env.openExtensionPage('options.html', { width: 900, height: 900 });
    const behavior = () =>
      env.worker.evaluate(async () => ({
        popup: await chrome.action.getPopup({}),
        panel: (await chrome.sidePanel.getPanelBehavior()).openPanelOnActionClick,
      }));
    await options.check('input[value="panel"]');
    await until(async () => (await behavior()).panel === true, 'panel behavior');
    assert.equal((await behavior()).popup, '');
    await options.check('input[value="popup"]');
    await until(async () => (await behavior()).panel === false, 'popup behavior');
    assert.match((await behavior()).popup, /popup\.html$/);
    await options.close();
  });

  test('reminder notifications (opt-in): one per due item, handed off as delivered, and clicking opens it', async () => {
    const { item } = await env.api.capture({ url: env.siteUrl('/remind.html'), title: 'Opener firmware changelog', remind: new Date(Date.now() - 60_000).toISOString() });
    const notificationIds = () => env.worker.evaluate(async () => Object.keys(await chrome.notifications.getAll()));
    await env.worker.evaluate(() => chrome.storage.local.set({ notifyReminders: true }));
    await until(async () => (await notificationIds()).includes(`reminder:${item.id}`), 'reminder notification');
    assert.ok(await env.worker.evaluate(() => chrome.alarms.get('reminders')), 'reminder alarm scheduled');

    await until(async () => !(await env.api.dueReminders()).some((due) => due.id === item.id), 'marked delivered on the server');

    await env.worker.evaluate((id) => chrome.notifications.clear(id), `reminder:${item.id}`);
    await env.worker.evaluate(() => chrome.alarms.onAlarm.dispatch({ name: 'reminders', scheduledTime: Date.now() }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(!(await notificationIds()).includes(`reminder:${item.id}`), 'shown once');

    const [opened] = await Promise.all([
      env.context.waitForEvent('page'),
      env.worker.evaluate((id) => chrome.notifications.onClicked.dispatch(id), `reminder:${item.id}`),
    ]);
    await opened.waitForLoadState();
    assert.equal(opened.url(), env.siteUrl('/remind.html'));
    await until(async () => (await env.api.item(item.id)).openedAt, 'open recorded');

    await env.worker.evaluate(() => chrome.storage.local.set({ notifyReminders: false }));
    await until(async () => !(await env.worker.evaluate(() => chrome.alarms.get('reminders'))), 'alarm cleared');
  });

  test('visit tracking is off by default and, when on, marks saved links opened', async () => {
    const ignored = (await env.api.capture({ url: env.siteUrl('/not-tracked.html') })).item;
    await env.openTab('/not-tracked.html');
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal((await env.api.item(ignored.id)).openedAt, null);

    const tracked = (await env.api.capture({ url: env.siteUrl('/visited.html') })).item;
    await env.worker.evaluate(() => chrome.storage.local.set({ trackVisits: true }));
    try {
      await env.openTab('/visited.html');
      await until(async () => (await env.api.item(tracked.id)).openedAt, 'visit recorded');
    } finally {
      await env.worker.evaluate(() => chrome.storage.local.set({ trackVisits: false }));
    }
  });

});
