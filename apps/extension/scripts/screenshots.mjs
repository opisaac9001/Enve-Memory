// Captures the extension screenshots for the repository page from a fresh demo library: `npm run screenshots`.
// Needs `npm run build -- --pregranted` first (the npm script does it) and, for semantic related items, the embedding
// model cached in the repo's .cache (`npm run models` at the repo root). Writes to docs/screenshots/extension/.
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const extension = join(root, 'apps', 'extension', 'dist', 'chrome-pregranted');
const out = join(root, 'docs', 'screenshots', 'extension');
const cliPath = join(root, 'packages', 'cli', 'src', 'main.ts');
const serverEnv = { ...process.env, ENVE_MEMORY_CACHE: join(root, '.cache') };
const run = promisify(execFile);

const SITE = 'https://docs.example.org';
const PANEL = { width: 400, height: 900 };

const article = ({ title, section, lead, body }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  :root { color-scheme: light dark; --bg: #fbfaf8; --text: #1d1b19; --muted: #6b655d; --line: #e7e2da; --accent: #2f6fd6; --code: #f1eee9; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141312; --text: #ece7e0; --muted: #9c948a; --line: #2a2724; --accent: #7aa7ff; --code: #201e1c; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  header { display: flex; align-items: center; gap: 24px; padding: 14px 32px; border-bottom: 1px solid var(--line); font-size: 14px; }
  header strong { font-size: 15px; }
  header nav { display: flex; gap: 18px; color: var(--muted); }
  .layout { display: grid; grid-template-columns: 220px minmax(0, 680px); gap: 48px; padding: 32px; }
  aside { font-size: 14px; color: var(--muted); line-height: 2; }
  aside b { display: block; color: var(--text); margin-top: 8px; }
  aside .on { color: var(--accent); font-weight: 600; }
  .crumbs { color: var(--muted); font-size: 13px; }
  h1 { font-size: 34px; line-height: 1.2; margin: 6px 0 12px; letter-spacing: -0.01em; }
  .lead { font-size: 18px; color: var(--muted); margin: 0 0 24px; }
  h2 { font-size: 21px; margin: 28px 0 8px; }
  code { background: var(--code); border-radius: 5px; padding: 1px 5px; font-size: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 12px 0; }
  td, th { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); }
</style></head>
<body>
<header><strong>Automation Handbook</strong><nav><span>Guides</span><span>Integrations</span><span>Reference</span><span>Community</span></nav></header>
<div class="layout">
<aside><b>Entities</b><span>Binary sensors</span><br><span>Buttons</span><br><span class="on">Covers</span><br><span>Lights</span><br><span>Switches</span>
<b>Devices</b><span>Garage doors</span><br><span>Blinds and shades</span><br><span>Gates</span></aside>
<main><div class="crumbs">Reference › ${section}</div><h1>${title}</h1><p class="lead">${lead}</p>${body}</main>
</div></body></html>`;

const PAGES = {
  '/home-assistant-covers': article({
    title: 'Home Assistant cover entities',
    section: 'Entities',
    lead: 'A cover is anything that opens and closes: garage doors, gates, blinds and awnings. This page explains the states, services and device classes a cover exposes.',
    body: `<h2>States</h2><p>A cover reports <code>open</code>, <code>closed</code>, <code>opening</code> or <code>closing</code>. Covers that know their position also report <code>current_position</code> from 0 (closed) to 100 (open).</p>
      <h2>Services</h2><table><tr><th>Service</th><th>What it does</th></tr><tr><td><code>cover.open_cover</code></td><td>Opens fully</td></tr><tr><td><code>cover.close_cover</code></td><td>Closes fully</td></tr><tr><td><code>cover.stop_cover</code></td><td>Stops a moving cover</td></tr></table>
      <h2>Garage doors</h2><p id="garage">Use the <code>garage</code> device class so dashboards show the right icon. If the opener can't report position reliably, pair the cover with a separate door sensor and use it as the source of truth.</p>`,
  }),
  '/garage-door-sensors': article({
    title: 'Choosing a garage door position sensor',
    section: 'Devices › Garage doors',
    lead: 'Your automation is only as good as its idea of whether the door is open. Here is how the common sensors compare.',
    body: `<h2>Reed switches</h2><p id="reed">A reed switch on the top rail and a magnet on the door is the most reliable option: no batteries, no line of sight, and it can't drift out of sync with the opener after someone pulls the manual release.</p>
      <h2>Tilt sensors</h2><p>Tilt sensors mount on the top panel and report the angle. They are easy to fit but run on batteries and can miss a half-open door.</p>
      <h2>Time-of-flight</h2><p>A ceiling-mounted distance sensor sees the door and the car, but needs a clear view and a power supply.</p>`,
  }),
};

const BOOKMARKS = {
  'Garage Door': [
    ['How Security+ 2.0 openers talk', 'https://docs.example.org/security-plus-2'],
    ['esphome-garage: local Security+ control', 'https://github.com/example/esphome-garage'],
    ['Garage door sensor wiring', 'https://forum.example.net/t/garage-door-sensor-wiring'],
    ['ESPHome cover component', 'https://docs.example.org/esphome-cover'],
    ['12 V to 3.3 V: level shifting basics', 'https://learn.example.com/level-shifting'],
  ],
  'Home Lab': [
    ['A backup strategy for a one-box home lab', 'https://blog.example.net/proxmox-backup-strategy'],
    ['Proxmox VE release notes', 'https://wiki.example.org/proxmox/roadmap'],
    ['Subnet routers explained', 'https://docs.example.com/subnet-routers'],
    ['ZFS for the impatient', 'https://blog.example.net/zfs-quick-start'],
  ],
  Kitchen: [
    ['No-knead focaccia', 'https://cooking.example.com/focaccia'],
    ['Weeknight dal', 'https://cooking.example.com/weeknight-dal'],
    ['Cast iron care', 'https://cooking.example.com/cast-iron'],
  ],
  Travel: [
    ['Lisbon in three days', 'https://travel.example.com/lisbon'],
    ['Packing list for a carry-on week', 'https://travel.example.com/carry-on'],
  ],
};
const READING = Array.from({ length: 30 }, (_, i) => [`Longread ${i + 1}`, `https://essays.example.com/archive/${i + 1}`]);

async function serve(home) {
  const server = spawn(process.execPath, [cliPath, '--home', home, 'serve', '--port', '0'], { env: serverEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    server.stderr.on('data', (chunk) => {
      output += chunk;
      const match = /listening on (http:\/\/\S+)/.exec(output);
      if (match) resolve(match[1]);
    });
    server.once('exit', (code) => reject(new Error(`enve-memory serve exited with ${code}:\n${output}`)));
  });
  return { server, url };
}

async function waitFor(check, what) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Frames an article screenshot and a panel screenshot as one browser window, drawn with HTML in the same browser. */
async function composeWindow(context, { page, panel, address }) {
  const canvas = await context.newPage();
  await canvas.setViewportSize({ width: 1440, height: 956 });
  const src = (png) => `data:image/png;base64,${png.toString('base64')}`;
  await canvas.setContent(`<!doctype html><style>
    body { margin: 0; background: transparent; font: 13px -apple-system, BlinkMacSystemFont, sans-serif; }
    .window { width: 1440px; height: 956px; border-radius: 12px; overflow: hidden; background: #1f1d1b; box-shadow: 0 0 0 1px #3a3632; }
    .top { height: 56px; display: flex; align-items: center; gap: 16px; padding: 0 16px; background: #2a2724; color: #cfc8bf; }
    .lights { display: flex; gap: 8px; } .lights i { width: 12px; height: 12px; border-radius: 50%; display: block; }
    .address { flex: 1; height: 32px; border-radius: 16px; background: #1a1816; display: flex; align-items: center; padding: 0 16px; color: #ece7e0; }
    .address span { color: #8d857b; }
    .icon { width: 22px; height: 22px; border-radius: 6px; background: #f5921a; color: #1b1105; font-weight: 700; display: grid; place-items: center; }
    .body { display: flex; height: 900px; }
    .body img { display: block; height: 900px; }
    .body .panel { border-left: 1px solid #3a3632; }
  </style><div class="window"><div class="top"><div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
    <div class="address">${address.replace(/^https:\/\/([^/]+)(.*)$/, '$1<span>$2</span>')}</div><div class="icon">M</div></div>
    <div class="body"><img src="${src(page)}" width="1039"><img class="panel" src="${src(panel)}" width="400"></div></div>`);
  const png = await canvas.locator('.window').screenshot({ omitBackground: true });
  await canvas.close();
  return png;
}

async function main() {
  const work = await mkdtemp(join(tmpdir(), 'enve-memory-screenshots-'));
  const home = join(work, 'library');
  await mkdir(out, { recursive: true });
  let server;
  let context;
  try {
    await run(process.execPath, [join(root, 'scripts', 'demo-library.ts'), home], { cwd: root, env: serverEnv });
    const { stdout } = await run(process.execPath, [cliPath, '--home', home, '--json', 'clients', 'add', 'Chrome', '--scope', 'read,write'], { env: serverEnv });
    const { token } = JSON.parse(stdout);
    let serverUrl;
    ({ server, url: serverUrl } = await serve(home));

    context = await chromium.launchPersistentContext(join(work, 'profile'), {
      channel: 'chromium',
      headless: true,
      colorScheme: 'dark',
      deviceScaleFactor: 2,
      viewport: { width: 1039, height: 900 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    // Pages load from https://docs.example.org so the panel and popup show a real-looking address.
    await context.route(`${SITE}/**`, (route) => {
      const html = PAGES[new URL(route.request().url()).pathname];
      return route.fulfill({ status: html ? 200 : 404, contentType: 'text/html; charset=utf-8', body: html ?? 'Not found' });
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const base = worker.url().replace(/\/background\.js$/, '');
    await waitFor(() => context.pages().some((p) => p.url().endsWith('/options.html')), 'the first-run Settings page');
    for (const p of context.pages()) if (p.url().startsWith(base)) await p.close();
    await worker.evaluate((settings) => chrome.storage.local.set(settings), { serverUrl, token });
    const tabId = (url) => worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, url);

    // The side panel beside the saved Home Assistant article: suggestions, related items and shelves.
    const covers = await context.newPage();
    await covers.goto(`${SITE}/home-assistant-covers`);
    const coversTab = await tabId(`${SITE}/home-assistant-covers`);
    const openPanel = async (scheme) => {
      const panel = await context.newPage();
      await panel.setViewportSize(PANEL);
      await panel.emulateMedia({ colorScheme: scheme });
      await panel.goto(`${base}/sidepanel.html?tab=${coversTab}`);
      await panel.locator('#page-ai button:text("Accept suggestions")').waitFor();
      await panel.locator('#related .row').first().waitFor();
      // A short shelf keeps the full-height shot readable; the whole library would run to thousands of pixels.
      await panel.click('#shelves button:text-is("Reminders")');
      await panel.locator('#results .row').first().waitFor();
      return panel;
    };
    const dark = await openPanel('dark');
    await dark.click('#page-remind button:text("Tomorrow")');
    await dark.locator('#page-reminder').filter({ hasText: 'Tomorrow' }).waitFor();
    await dark.locator('body').click({ position: { x: 1, y: 1 } });
    const panelPng = await dark.screenshot();
    await dark.screenshot({ path: join(out, 'sidepanel.png'), fullPage: true });
    await dark.close();

    const light = await openPanel('light');
    await light.screenshot({ path: join(out, 'sidepanel-light.png'), fullPage: true });
    await light.close();

    await covers.bringToFront();
    const pagePng = await covers.screenshot();
    const windowPng = await composeWindow(context, { page: pagePng, panel: panelPng, address: `${SITE}/home-assistant-covers` });
    await writeFile(join(out, 'panel-in-browser.png'), windowPng);

    // The popup saving a new page with a project, intent, tags and the selected paragraph.
    const sensors = await context.newPage();
    await sensors.goto(`${SITE}/garage-door-sensors`);
    await sensors.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#reed'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 800 });
    await popup.goto(`${base}/popup.html?tab=${await tabId(`${SITE}/garage-door-sensors`)}`);
    await popup.locator('#selection-field').waitFor();
    await waitFor(async () => (await popup.locator('#project option').count()) > 1, 'projects');
    await popup.selectOption('#project', { label: 'Garage Door Controller' });
    await popup.click('#intent button:text("Read")');
    await popup.fill('#tag-input', 'sensors, reed-switch,');
    await popup.fill('#note', 'Matches our decision: reed switch on the top rail.');
    await popup.locator('#note').blur();
    await popup.locator('body').screenshot({ path: join(out, 'popup.png') });
    await popup.close();

    // Options after importing a bookmark tree that overlaps the library.
    await worker.evaluate(
      async ({ folders, reading }) => {
        const bar = (await chrome.bookmarks.getTree())[0].children[0].id;
        for (const [folder, links] of Object.entries(folders)) {
          const { id } = await chrome.bookmarks.create({ parentId: bar, title: folder });
          for (const [title, url] of links) await chrome.bookmarks.create({ parentId: id, title, url });
        }
        const other = (await chrome.bookmarks.getTree())[0].children[1].id;
        const { id } = await chrome.bookmarks.create({ parentId: other, title: 'Reading' });
        for (const [title, url] of reading) await chrome.bookmarks.create({ parentId: id, title, url });
      },
      { folders: BOOKMARKS, reading: READING },
    );
    const options = await context.newPage();
    await options.setViewportSize({ width: 760, height: 1400 });
    await options.goto(`${base}/options.html`);
    await options.click('#import');
    await options.locator('#import-result.ok').waitFor();
    await options.waitForTimeout(400); // let the progress bar finish its transition
    await options.locator('section.panel', { has: options.locator('#import') }).screenshot({ path: join(out, 'import.png') });
    console.log(`Screenshots written to ${out}`);
  } finally {
    await context?.close();
    server?.kill('SIGTERM');
    await rm(work, { recursive: true, force: true });
  }
}

await main();
