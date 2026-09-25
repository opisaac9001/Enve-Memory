import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createClient } from '../src/lib/api.js';
import { startScratchServer } from '../test/support/scratch-server.mjs';

const EXTENSION = fileURLToPath(new URL('../dist/chrome', import.meta.url));
const SCREENSHOT = fileURLToPath(new URL('../docs/popup.png', import.meta.url));

const PAGES = {
  '/article.html': `<!doctype html><title>Security+ 2.0 protocol notes</title>
    <h1>Security+ 2.0</h1>
    <p id="quote">Security+ 2.0 uses a rolling code on a single-wire bus.</p>
    <p id="second">The wall button speaks the same protocol as the opener.</p>
    <p><a href="/esp32-library.html">ESP32 garage door library</a></p>`,
  '/esp32-library.html': '<!doctype html><title>ESP32 library</title><p>Library</p>',
  '/bench.html': '<!doctype html><title>Bench simulator ideas</title><p>Bench</p>',
};

async function until(check, message) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('extension in Chromium', () => {
  let server;
  let pages;
  let pageBase;
  let profile;
  let context;
  let worker;
  let extensionUrl;
  let token;
  let api;
  let project;

  before(async () => {
    server = await startScratchServer();
    project = await server.cli('project', 'new', 'Garage Door');
    await server.cli('project', 'new', 'Reading List');
    token = await server.token('Chrome', 'read,capture');
    api = createClient({ serverUrl: server.url, token });

    pages = createServer((req, res) => {
      const html = PAGES[req.url];
      res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html ?? 'not found');
    });
    await new Promise((resolve) => pages.listen(0, '127.0.0.1', resolve));
    pageBase = `http://127.0.0.1:${pages.address().port}`;

    profile = await mkdtemp(join(tmpdir(), 'enve-memory-chromium-'));
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      colorScheme: 'dark',
      deviceScaleFactor: 2,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    extensionUrl = worker.url().replace(/\/background\.js$/, '');
  });

  after(async () => {
    await context?.close();
    await new Promise((resolve) => (pages ? pages.close(resolve) : resolve()));
    await server?.stop();
    if (profile) await rm(profile, { recursive: true, force: true });
  });

  const tabIdFor = (url) => worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, url);

  async function openPopupFor(tabId) {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 640 });
    await popup.goto(`${extensionUrl}/popup.html?tab=${tabId}`);
    return popup;
  }

  test('first run opens Settings and the popup asks for a token', async () => {
    const options = await until(() => context.pages().find((p) => p.url().endsWith('/options.html')), 'options page on install');
    await options.close();

    const popup = await context.newPage();
    await popup.goto(`${extensionUrl}/popup.html`);
    await popup.locator('#setup').waitFor();
    assert.match(await popup.locator('#setup').innerText(), /clients add "Browser" --scope read,capture/);
    await popup.close();
  });

  test('Settings reports a bad token, then saves a good one', async () => {
    const options = await context.newPage();
    await options.goto(`${extensionUrl}/options.html`);
    await options.fill('#server-url', server.url);

    await options.fill('#token', 'em_wrong');
    await options.click('#test');
    await options.locator('#result.error').waitFor();
    assert.match(await options.locator('#result').innerText(), /token didn’t work[\s\S]*clients add "Browser"/);

    await options.fill('#token', token);
    await options.click('#save');
    await options.locator('#result.ok').waitFor();
    assert.match(await options.locator('#result-title').innerText(), /Saved\. Connected as Chrome/);
    assert.match(await options.locator('#result-detail').innerText(), /read, capture/);

    const stored = await worker.evaluate(() => chrome.storage.local.get(['serverUrl', 'token']));
    assert.deepEqual(stored, { serverUrl: server.url, token });
    await options.close();
  });

  test('popup saves the page with title, project, tags, note and selection', async () => {
    const article = await context.newPage();
    await article.goto(`${pageBase}/article.html`);
    await article.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#quote'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });

    const popup = await openPopupFor(await tabIdFor(`${pageBase}/article.html`));
    assert.equal(await popup.inputValue('#title'), 'Security+ 2.0 protocol notes');
    await popup.locator('#selection-field').waitFor();
    assert.equal(await popup.inputValue('#selection'), 'Security+ 2.0 uses a rolling code on a single-wire bus.');
    await until(async () => (await popup.locator('#project option').count()) === 3, 'projects');

    await popup.selectOption('#project', { label: 'Garage Door' });
    await popup.fill('#tag-input', 'esp32, protocol');
    await popup.press('#tag-input', 'Enter');
    await popup.fill('#note', 'Needed for the bench-test rig.');
    assert.deepEqual(await popup.locator('.chip').allTextContents(), ['#esp32×', '#protocol×']);
    await popup.locator('body').screenshot({ path: SCREENSHOT });

    await popup.press('#note', 'ControlOrMeta+Enter');
    await popup.locator('#done').waitFor();
    assert.equal(await popup.locator('#done-title').innerText(), 'Saved');
    assert.match(await popup.locator('#done-detail').innerText(), /Garage Door · #esp32 · #protocol/);

    const item = await api.lookup(`${pageBase}/article.html`);
    assert.equal(item.title, 'Security+ 2.0 protocol notes');
    assert.equal(item.project.id, project.id);
    assert.deepEqual(item.tags, ['esp32', 'protocol']);
    assert.equal(item.body, 'Needed for the bench-test rig.\n\n> Security+ 2.0 uses a rolling code on a single-wire bus.');

    const { lastProject } = await worker.evaluate(() => chrome.storage.local.get('lastProject'));
    assert.deepEqual(lastProject, { id: project.id, name: 'Garage Door' });
    await popup.close();
    await article.evaluate(() => getSelection().removeAllRanges());
  });

  test('popup recognises a saved page and appends to it', async () => {
    const popup = await openPopupFor(await tabIdFor(`${pageBase}/article.html`));
    await popup.locator('#existing').waitFor();
    assert.match(await popup.locator('#existing').innerText(), /Already saved on .+\s+Garage Door · #esp32 · #protocol/);
    assert.equal(await popup.locator('#save').innerText(), 'Update');
    assert.ok(await popup.locator('#title-field').isHidden());

    await popup.fill('#tag-input', 'garage');
    await popup.fill('#note', 'Wall button uses it too.');
    await popup.click('#save');
    await popup.locator('#done').waitFor();
    assert.equal(await popup.locator('#done-title').innerText(), 'Updated');

    const item = await api.lookup(`${pageBase}/article.html`);
    assert.deepEqual(item.tags, ['esp32', 'garage', 'protocol']);
    assert.match(item.body, /Wall button uses it too\.$/);
    await popup.close();
  });

  test('context menus and the shortcut quick-save through the service worker', async () => {
    await worker.evaluate(() => Promise.all(['page', 'selection', 'link'].map((id) => chrome.contextMenus.update(id, {}))));
    const articleTab = await tabIdFor(`${pageBase}/article.html`);
    const linkUrl = `${pageBase}/esp32-library.html`;

    await worker.evaluate(
      async ({ tabId, linkUrl, pageUrl }) => {
        const tab = await chrome.tabs.get(tabId);
        chrome.contextMenus.onClicked.dispatch({ menuItemId: 'link', linkUrl, pageUrl, frameId: 0, editable: false }, tab);
      },
      { tabId: articleTab, linkUrl, pageUrl: `${pageBase}/article.html` },
    );
    const link = await until(() => api.lookup(linkUrl), 'link bookmark');
    assert.equal(link.title, 'ESP32 garage door library');
    assert.equal(link.project.name, 'Garage Door');
    await until(async () => (await worker.evaluate((tabId) => chrome.action.getBadgeText({ tabId }), articleTab)) === '✓', 'success badge');

    const article = context.pages().find((p) => p.url() === `${pageBase}/article.html`);
    await article.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#second'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await worker.evaluate(async ({ tabId, pageUrl }) => {
      const tab = await chrome.tabs.get(tabId);
      chrome.contextMenus.onClicked.dispatch(
        { menuItemId: 'selection', selectionText: 'The wall button speaks the same protocol as the opener.', pageUrl, frameId: 0, editable: false },
        tab,
      );
    }, { tabId: articleTab, pageUrl: `${pageBase}/article.html` });
    await until(
      async () => (await api.lookup(`${pageBase}/article.html`)).body.endsWith('> The wall button speaks the same protocol as the opener.'),
      'selection appended',
    );

    const bench = await context.newPage();
    await bench.goto(`${pageBase}/bench.html`);
    const benchTab = await tabIdFor(`${pageBase}/bench.html`);
    await worker.evaluate(async (tabId) => chrome.commands.onCommand.dispatch('quick-save', await chrome.tabs.get(tabId)), benchTab);
    const saved = await until(() => api.lookup(`${pageBase}/bench.html`), 'shortcut bookmark');
    assert.equal(saved.title, 'Bench simulator ideas');
    assert.equal(saved.project.name, 'Garage Door');
  });

  test('a quick save that fails shows the error badge', async () => {
    const benchTab = await tabIdFor(`${pageBase}/bench.html`);
    await worker.evaluate(() => chrome.storage.local.set({ serverUrl: 'http://127.0.0.1:9' }));
    try {
      await worker.evaluate(async (tabId) => {
        const tab = await chrome.tabs.get(tabId);
        chrome.contextMenus.onClicked.dispatch({ menuItemId: 'page', pageUrl: tab.url, frameId: 0, editable: false }, tab);
      }, benchTab);
      await until(async () => (await worker.evaluate((tabId) => chrome.action.getBadgeText({ tabId }), benchTab)) === '!', 'error badge');
    } finally {
      await worker.evaluate((url) => chrome.storage.local.set({ serverUrl: url }), server.url);
    }
  });
});
