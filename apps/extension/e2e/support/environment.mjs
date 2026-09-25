import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createClient } from '../../src/lib/api.js';
import { startScratchServer } from '../../test/support/scratch-server.mjs';

// Built by `npm run test:e2e` with the optional permissions pre-granted: nothing can click the browser's prompt.
const EXTENSION = fileURLToPath(new URL('../../dist/chrome-e2e', import.meta.url));
export const docsPath = (name) => fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));

const page = (title, body = '') => `<!doctype html><title>${title}</title><h1>${title}</h1>${body}`;
const PAGES = {
  '/article.html': page(
    'Security+ 2.0 protocol notes',
    `<p id="quote">Security+ 2.0 uses a rolling code on a single-wire bus.</p>
     <p id="second">The wall button speaks the same protocol as the opener.</p>
     <p><a href="/esp32-library.html">ESP32 garage door library</a></p>`,
  ),
  '/esp32-library.html': page('ESP32 library'),
  '/bench.html': page('Bench simulator ideas'),
  '/unsaved.html': page('Bench rig wiring'),
  '/offline.html': page('Written on a plane'),
  '/remind.html': page('Opener firmware changelog'),
  '/visited.html': page('Wall button teardown'),
  '/not-tracked.html': page('Remote pairing guide'),
};

export async function until(check, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export const selectText = (tab, selector) =>
  tab.evaluate((selector) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(selector));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, selector);

/** A scratch Enve Memory, a local site to save pages from, and Chromium with the extension loaded. */
export async function startEnvironment() {
  const server = await startScratchServer();
  const projects = {
    garage: await server.cli('project', 'new', 'Garage Door'),
    reading: await server.cli('project', 'new', 'Reading List'),
  };
  const token = await server.token('Chrome', 'read,capture');
  const api = createClient({ serverUrl: server.url, token });

  const site = createServer((req, res) => {
    const html = PAGES[req.url];
    res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html ?? 'not found');
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const siteUrl = (path) => `http://127.0.0.1:${site.address().port}${path}`;

  const profile = await mkdtemp(join(tmpdir(), 'enve-memory-chromium-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    colorScheme: 'dark',
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionUrl = worker.url().replace(/\/background\.js$/, '');

  const env = {
    server,
    projects,
    token,
    api,
    siteUrl,
    context,
    worker,
    extensionUrl,
    tabIdFor: (url) => worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, url),
    async openTab(path) {
      const tab = await context.newPage();
      await tab.goto(siteUrl(path));
      return tab;
    },
    /** Opens an extension page (popup.html, sidepanel.html…) as a tab aimed at `tabId`, like the real popup or panel. */
    async openExtensionPage(file, { tabId, width = 360, height = 640 } = {}) {
      const tab = await context.newPage();
      await tab.setViewportSize({ width, height });
      await tab.goto(`${extensionUrl}/${file}${tabId ? `?tab=${tabId}` : ''}`);
      return tab;
    },
    async configure() {
      await worker.evaluate((settings) => chrome.storage.local.set(settings), { serverUrl: server.url, token });
    },
    async stop() {
      await context.close();
      await new Promise((resolve) => site.close(resolve));
      await server.stop();
      await rm(profile, { recursive: true, force: true });
    },
  };
  return env;
}
