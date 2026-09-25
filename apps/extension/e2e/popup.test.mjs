import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { docsPath, selectText, startEnvironment, until } from './support/environment.mjs';

describe('popup, Settings and instant saves in Chromium', () => {
  let env;

  before(async () => {
    env = await startEnvironment();
  });
  after(() => env?.stop());

  const badge = (tabId) => env.worker.evaluate((tabId) => chrome.action.getBadgeText(tabId === undefined ? {} : { tabId }), tabId);
  const dispatchMenu = (info, tabId) =>
    env.worker.evaluate(async ({ info, tabId }) => chrome.contextMenus.onClicked.dispatch(info, await chrome.tabs.get(tabId)), { info, tabId });

  test('first run opens Settings and the popup asks for a token', async () => {
    const options = await until(() => env.context.pages().find((p) => p.url().endsWith('/options.html')), 'options page on install');
    await options.close();

    const popup = await env.openExtensionPage('popup.html');
    await popup.locator('#setup').waitFor();
    assert.match(await popup.locator('#setup').innerText(), /clients add "Browser" --scope read,capture/);
    await popup.close();
  });

  test('Settings reports a bad token, then saves a good one', async () => {
    const options = await env.openExtensionPage('options.html', { width: 900, height: 900 });
    await options.fill('#server-url', env.server.url);

    await options.fill('#token', 'em_wrong');
    await options.click('#test');
    await options.locator('#result.error').waitFor();
    assert.match(await options.locator('#result').innerText(), /token didn’t work[\s\S]*clients add "Browser"/);

    await options.fill('#token', env.token);
    await options.click('#save');
    await options.locator('#result.ok').waitFor();
    assert.match(await options.locator('#result-title').innerText(), /Saved\. Connected as Chrome/);
    assert.match(await options.locator('#result-detail').innerText(), /read, capture/);

    const stored = await env.worker.evaluate(() => chrome.storage.local.get(['serverUrl', 'token']));
    assert.deepEqual(stored, { serverUrl: env.server.url, token: env.token });
    await options.close();
  });

  test('popup saves the page with title, project, intent, reminder, tags, note and selection', async () => {
    const article = await env.openTab('/article.html');
    await selectText(article, '#quote');

    const popup = await env.openExtensionPage('popup.html', { tabId: await env.tabIdFor(env.siteUrl('/article.html')) });
    assert.equal(await popup.inputValue('#title'), 'Security+ 2.0 protocol notes');
    await popup.locator('#selection-field').waitFor();
    assert.equal(await popup.inputValue('#selection'), 'Security+ 2.0 uses a rolling code on a single-wire bus.');
    await until(async () => (await popup.locator('#project option').count()) === 3, 'projects');

    await popup.selectOption('#project', { label: 'Garage Door' });
    await popup.click('#intent button:text("Read")');
    await popup.click('#remind button:text("Tomorrow")');
    await popup.fill('#tag-input', 'esp32, protocol');
    await popup.press('#tag-input', 'Enter');
    await popup.fill('#note', 'Needed for the bench-test rig.');
    assert.deepEqual(await popup.locator('.chip').allTextContents(), ['#esp32×', '#protocol×']);
    await popup.locator('body').screenshot({ path: docsPath('popup.png') });

    await popup.press('#note', 'ControlOrMeta+Enter');
    await popup.locator('#done').waitFor();
    assert.equal(await popup.locator('#done-title').innerText(), 'Saved');
    assert.match(await popup.locator('#done-detail').innerText(), /Garage Door · #esp32 · #protocol/);

    const item = await env.api.lookup(env.siteUrl('/article.html'));
    assert.equal(item.title, 'Security+ 2.0 protocol notes');
    assert.equal(item.project.id, env.projects.garage.id);
    assert.equal(item.intent, 'read');
    assert.ok(Date.parse(item.remindAt) > Date.now());
    assert.deepEqual(item.tags, ['esp32', 'protocol']);
    assert.equal(item.body, 'Needed for the bench-test rig.\n\n> Security+ 2.0 uses a rolling code on a single-wire bus.');

    const { lastProject } = await env.worker.evaluate(() => chrome.storage.local.get('lastProject'));
    assert.deepEqual(lastProject, { id: env.projects.garage.id, name: 'Garage Door' });
    await popup.close();
    await article.evaluate(() => getSelection().removeAllRanges());
  });

  test('popup recognises a saved page, appends to it, and offers AI suggestion tags', async () => {
    const article = await env.api.lookup(env.siteUrl('/article.html'));
    await env.server.suggest(article.id, { summary: 'How Security+ 2.0 openers talk over one wire.', tags: ['rolling-code', 'esp32'] });

    const popup = await env.openExtensionPage('popup.html', { tabId: await env.tabIdFor(env.siteUrl('/article.html')) });
    await popup.locator('#existing').waitFor();
    assert.match(await popup.locator('#existing').innerText(), /Already saved on .+\s+Garage Door · #esp32 · #protocol/);
    assert.equal(await popup.locator('#save').innerText(), 'Update');
    assert.ok(await popup.locator('#title-field').isHidden());
    assert.ok(await popup.locator('#project-field').isHidden());
    assert.ok(await popup.locator('#intent button').first().isDisabled(), 'intent edits need the write scope');
    assert.match(await popup.locator('#reminder-set').innerText(), /Set for Tomorrow/);

    await popup.locator('#ai').waitFor();
    assert.match(await popup.locator('#ai').innerText(), /one wire/);
    assert.equal(await popup.locator('#ai button:text("Accept suggestions")').count(), 0);
    await popup.click('#ai button:text("+ #rolling-code")');
    await popup.fill('#note', 'Wall button uses it too.');
    await popup.click('#save');
    await popup.locator('#done').waitFor();
    assert.equal(await popup.locator('#done-title').innerText(), 'Updated');

    const item = await env.api.lookup(env.siteUrl('/article.html'));
    assert.deepEqual(item.tags, ['esp32', 'protocol', 'rolling-code']);
    assert.match(item.body, /Wall button uses it too\.$/);
    await popup.close();
  });

  test('context menus and the shortcut quick-save through the service worker', async () => {
    await env.worker.evaluate(() => Promise.all(['page', 'selection', 'link'].map((id) => chrome.contextMenus.update(id, {}))));
    const articleTab = await env.tabIdFor(env.siteUrl('/article.html'));
    const linkUrl = env.siteUrl('/esp32-library.html');

    await dispatchMenu({ menuItemId: 'link', linkUrl, pageUrl: env.siteUrl('/article.html'), frameId: 0, editable: false }, articleTab);
    const link = await until(() => env.api.lookup(linkUrl), 'link bookmark');
    assert.equal(link.title, 'ESP32 garage door library');
    assert.equal(link.project.name, 'Garage Door');
    await until(async () => (await badge(articleTab)) === '✓', 'success badge');

    const article = env.context.pages().find((p) => p.url() === env.siteUrl('/article.html'));
    await selectText(article, '#second');
    await dispatchMenu(
      { menuItemId: 'selection', selectionText: 'The wall button speaks the same protocol as the opener.', pageUrl: env.siteUrl('/article.html'), frameId: 0, editable: false },
      articleTab,
    );
    await until(
      async () => (await env.api.lookup(env.siteUrl('/article.html'))).body.endsWith('> The wall button speaks the same protocol as the opener.'),
      'selection appended',
    );

    await env.openTab('/bench.html');
    const benchTab = await env.tabIdFor(env.siteUrl('/bench.html'));
    await env.worker.evaluate(async (tabId) => chrome.commands.onCommand.dispatch('quick-save', await chrome.tabs.get(tabId)), benchTab);
    const saved = await until(() => env.api.lookup(env.siteUrl('/bench.html')), 'shortcut bookmark');
    assert.equal(saved.title, 'Bench simulator ideas');
    assert.equal(saved.project.name, 'Garage Door');
  });

  test('offline: saves queue with a badge count and sync when Enve Memory is back', async () => {
    await env.openTab('/offline.html');
    const offlineTab = await env.tabIdFor(env.siteUrl('/offline.html'));
    await env.server.pause();
    try {
      await dispatchMenu({ menuItemId: 'page', pageUrl: env.siteUrl('/offline.html'), frameId: 0, editable: false }, offlineTab);
      await until(async () => (await badge()) === '1', 'queued count on the badge');

      const popup = await env.openExtensionPage('popup.html', { tabId: offlineTab });
      await popup.locator('#sync').waitFor();
      assert.equal(await popup.locator('#sync-text').innerText(), '1 waiting to sync');
      assert.match(await popup.locator('#error').innerText(), /Offline: saves will sync/);
      await popup.close();
    } finally {
      await env.server.resume();
    }

    await env.worker.evaluate(() => chrome.alarms.onAlarm.dispatch({ name: 'outbox', scheduledTime: Date.now() }));
    const synced = await until(() => env.api.lookup(env.siteUrl('/offline.html')), 'queued capture synced');
    assert.equal(synced.title, 'Written on a plane');
    await until(async () => (await badge()) === '', 'badge cleared');
    assert.ok(await env.worker.evaluate(() => chrome.alarms.get('outbox')), 'the outbox alarm is scheduled');
  });
});
