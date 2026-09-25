import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { type ElectronApplication, type Page, _electron as electron } from 'playwright';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(appDir, '..', '..');
const cli = join(repo, 'packages', 'cli', 'src', 'main.ts');
const shots = join(appDir, 'docs');
const home = mkdtempSync(join(tmpdir(), 'enve-desktop-e2e-'));
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const runCli = (...args: string[]) => execFileSync(process.execPath, [cli, '--home', home, ...args], { encoding: 'utf8' });

const ARTICLE = `<!doctype html><html><head><title>Rolling codes, explained</title>
<meta property="og:site_name" content="Garage Lab"><meta name="author" content="Ada Wrench"></head>
<body><article><h1>Rolling codes, explained</h1>
<p>Security+ 2.0 openers never send the same code twice. Each press advances a counter, and the receiver accepts a window of future codes so a missed press doesn't lock you out.</p>
<p>A replay attack records one transmission and plays it back later. Because the receiver has already moved past that counter value, the replayed code is rejected.</p>
<img src="/pixel.gif" alt="tracking pixel">
<h2>Bench testing</h2>
<p>To test a controller without the real motor, build a simulator that speaks the same serial protocol. An ESP32 with a level shifter is enough, and it lets you replay captured traffic safely on the bench.</p>
<p>Read the <a href="/protocol">full protocol notes</a> before wiring anything to the wall console.</p>
</article></body></html>`;

let app: ElectronApplication;
let page: Page;
let server: Server;
let articleUrl = '';
let pixelHits = 0;

async function shot(name: string): Promise<void> {
  const toasts = (visibility: string) => page.evaluate((v) => {
    const el = document.querySelector<HTMLElement>('.toasts');
    if (el) el.style.visibility = v;
  }, visibility);
  await toasts('hidden');
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(shots, `${name}.png`) });
  await toasts('');
}

/** Writes through core from a separate process, the way an MCP server or the AI worker would. */
function seedSuggestion(): void {
  const core = pathToFileURL(join(repo, 'packages', 'core', 'src', 'index.ts')).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { EnveMemory } from ${JSON.stringify(core)};
    const memory = EnveMemory.open({ home: ${JSON.stringify(home)}, actor: 'mcp:claude-code' });
    const project = memory.projects.resolve('garage-door');
    const note = memory.items.saveNote({ body: 'Measured the wall console: 12 V supply, and the data line idles high between presses.' });
    memory.withActor('ai', () => memory.items.suggest(note.id, {
      status: 'done', at: new Date().toISOString(), model: 'ollama:qwen2.5:1.5b',
      summary: 'Voltage measurements from the garage door wall console, useful for designing the replacement controller.',
      tags: ['wiring', 'measurements'], project: { id: project.id, name: project.name },
    }));
    memory.close();
  `]);
}

/** Replaces native dialogs in the main process so tests never block on a picker, open Finder or launch a browser. */
async function stubDialogs(folder: string): Promise<void> {
  await app.evaluate(({ dialog, shell }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
    shell.showItemInFolder = () => {};
    shell.openExternal = async () => {};
  }, folder);
}

/** Sidebar entries carry a count after their label ("Inbox 3"), so match the label exactly with an optional number. */
async function nav(label: string | RegExp): Promise<void> {
  const name = typeof label === 'string' ? new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\d+)?$`) : label;
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).first().click();
}

async function settings(section: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click();
}

const call = (method: string, ...args: unknown[]) =>
  page.evaluate(async ([m, a]) => window.enve.call(m as string, ...(a as unknown[])), [method, args] as const);

describe('Enve Memory desktop', { timeout: 180_000 }, () => {
  before(async () => {
    mkdirSync(shots, { recursive: true });
    runCli('settings', 'semanticSearch', 'false');
    runCli('settings', 'fetchLinks', 'false');
    writeFileSync(join(home, 'desktop.json'), JSON.stringify({ theme: 'dark' }));

    server = createServer((req, res) => {
      if (req.url === '/pixel.gif') {
        pixelHits += 1;
        res.writeHead(200, { 'Content-Type': 'image/gif' });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ARTICLE);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    articleUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rolling-codes`;

    app = await electron.launch({
      args: [appDir, '--use-mock-keychain'],
      colorScheme: null as never,
      env: {
        ...process.env,
        ENVE_MEMORY_HOME: home,
        ENVE_MEMORY_PORT: '0',
        ENVE_MEMORY_NO_GLOBAL_SHORTCUT: '1',
      },
    });
    page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 820));
  });

  after(async () => {
    server?.close();
    rmSync(home, { recursive: true, force: true });
  });

  test('first launch teaches the product', async () => {
    await page.getByText('Save a link, jot a note, or connect Claude Code.').waitFor();
    assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), true);
  });

  test('the local API answers on its port', async () => {
    const status = await call('api.status') as { ok: true; value: { running: boolean; url: string } };
    assert.equal(status.value.running, true);
    const response = await fetch(`${status.value.url}/api/v1/status`);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { name: string }).name, 'enve-memory');
  });

  test('captures a note and a link from Home', async () => {
    const capture = page.getByLabel('Capture a note or link');
    await capture.fill('Bench-test rig: simulate the Security+ 2.0 rolling code so we never touch the real opener');
    await capture.press('Enter');
    await page.getByTestId('saved-chip').getByText(/Saved: Bench-test rig/).waitFor();

    await capture.fill('https://example.com/esp32-garage-library');
    await capture.press('Enter');
    await page.getByTestId('saved-chip').getByText('Saved: https://example.com/esp32-garage-library').waitFor();
    await page.getByRole('heading', { name: 'Recent' }).waitFor();
  });

  test('creates a project and files an item into it from the Inbox', async () => {
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Name').fill('Garage Door');
    await page.getByLabel(/What is it/).fill('Replace the dead opener controller with an ESP32.');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByLabel('Project name').waitFor();
    assert.equal(await page.getByLabel('Project name').inputValue(), 'Garage Door');

    await nav(/^Inbox/);
    await page.getByRole('heading', { name: 'Inbox' }).waitFor();
    const note = page.locator('.inbox-entry').filter({ hasText: 'Bench-test rig' });
    await note.getByRole('combobox').selectOption({ label: 'Garage Door' });
    await page.getByText('Filed into Garage Door').waitFor();
    await note.waitFor({ state: 'detached' });
    await page.locator('.inbox-entry').filter({ hasText: 'esp32-garage-library' }).waitFor();

    seedSuggestion();
    const suggested = page.locator('.inbox-entry').filter({ hasText: 'Measured the wall console' });
    await suggested.getByText('Voltage measurements from the garage door wall console').waitFor({ timeout: 6000 });
    await shot('inbox-dark');
    await suggested.getByRole('button', { name: 'Accept' }).click();
    await page.getByText('Suggestions applied').waitFor();
    await suggested.waitFor({ state: 'detached' });
  });

  test('edits the project memory and records a decision', async () => {
    await nav('Garage Door');
    await page.getByRole('button', { name: 'Write the first version' }).click();
    await page.getByRole('textbox', { name: 'Memory document' }).fill('## Goal\n\nA replacement controller that speaks **Security+ 2.0**.\n\n## Open questions\n\n- Which relay board?');
    await page.getByRole('button', { name: 'Save memory' }).click();
    await page.locator('.memory .markdown').getByRole('heading', { name: 'Goal' }).waitFor();
    await page.getByText('Earlier versions are kept.', { exact: false }).waitFor();

    await page.getByRole('button', { name: 'Record decision' }).click();
    await page.getByLabel('Decision', { exact: true }).fill('Use an ESP32-C3 for the controller');
    await page.getByLabel(/^Why/).fill('Cheap, and it has the radio we need.');
    await page.locator('form.record-decision').getByRole('button', { name: 'Record decision' }).click();
    await page.locator('.timeline').getByText('Use an ESP32-C3 for the controller').waitFor();

    await page.getByRole('button', { name: 'History' }).click();
    await page.locator('.memory-history').getByText('Current').waitFor();
  });

  test('adds and completes a task', async () => {
    await page.getByLabel('New task').fill('Build the bench simulator');
    await page.getByLabel('New task').press('Enter');
    const check = page.getByRole('checkbox', { name: 'Complete Build the bench simulator' });
    await check.waitFor();
    await page.getByLabel('New task').fill('Order a level shifter');
    await page.getByLabel('New task').press('Enter');
    await page.getByRole('checkbox', { name: 'Complete Order a level shifter' }).waitFor();
    await shot('project-dark');

    await check.click();
    await check.waitFor({ state: 'detached' });
    await nav('Tasks');
    await page.getByRole('tab', { name: 'Done' }).click();
    await page.getByRole('checkbox', { name: 'Reopen Build the bench simulator' }).waitFor();
    await page.getByRole('tab', { name: 'Active' }).click();
    await page.getByRole('checkbox', { name: 'Complete Order a level shifter' }).waitFor();
  });

  test('searches with the keyboard and opens the result', async () => {
    await nav('Home');
    await page.keyboard.press(`${mod}+K`);
    const input = page.getByLabel('Search your library');
    await input.fill('rolling');
    const hit = page.getByRole('option').filter({ hasText: 'Bench-test rig' });
    await hit.waitFor();
    assert.equal(await hit.locator('mark').first().textContent(), 'rolling');
    await shot('search-dark');
    await input.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Note details' });
    await drawer.waitFor();
    assert.match(await drawer.getByRole('textbox', { name: 'Note', exact: true }).inputValue(), /Bench-test rig/);
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });
  });

  test('shows a write from the CLI within a few seconds', async () => {
    await nav('Home');
    runCli('note', 'from the CLI while the app is open');
    await page.getByText('from the CLI while the app is open').first().waitFor({ timeout: 6000 });
  });

  test('archives a page and shows it as sanitized reader text', async () => {
    await settings('Search');
    await page.getByRole('switch', { name: 'Archive saved links' }).click();
    await page.getByRole('switch', { name: 'Archive saved links', checked: true }).waitFor();
    await nav('Home');
    const capture = page.getByLabel('Capture a note or link');
    await capture.fill(`${articleUrl} the clearest write-up of the replay window`);
    await capture.press('Enter');
    const chip = page.getByTestId('saved-chip').getByText('Saved: Rolling codes, explained');
    await chip.waitFor({ timeout: 20_000 });
    await shot('home-dark');
    await chip.click();
    const drawer = page.getByRole('dialog', { name: 'Link details' });
    await drawer.locator('.reader').getByText('A replay attack records one transmission').waitFor();
    await drawer.getByText(/Saved from 127\.0\.0\.1/).waitFor();
    assert.equal(await drawer.locator('.reader img').count(), 0, 'remote images are not rendered');
    assert.equal(await drawer.locator('.reader a[href^="http://127.0.0.1"]').first().getAttribute('target'), '_blank');
    await page.waitForTimeout(500);
    assert.equal(pixelHits, 0, 'opening an archived page never contacts its server');
    await shot('item-detail-dark');
    await page.keyboard.press('Escape');
  });

  test('connect screens show MCP setup and a pairing QR code', async () => {
    await settings('AI tools');
    await page.getByText('claude mcp add --scope user enve-memory -e ELECTRON_RUN_AS_NODE=1', { exact: false }).waitFor();
    await page.getByText('[mcp_servers.enve-memory]', { exact: false }).waitFor();
    await shot('settings-ai-tools-dark');

    await settings('Devices & extensions');
    await page.getByRole('button', { name: 'Pair a phone' }).click();
    await page.locator('.qr-grid img').first().waitFor();
    await page.locator('.settings-section').evaluate((el) => el.closest('.main')!.scrollTo(0, 360));
    await shot('settings-devices-dark');
    await page.getByRole('button', { name: 'Done' }).click();
  });

  test('creates an API client and shows its token once', async () => {
    await settings('Devices & extensions');
    await page.getByLabel('Client name').fill('Test extension');
    await page.getByRole('button', { name: 'Create token' }).click();
    const token = await page.getByTestId('new-token').textContent();
    assert.match(token ?? '', /^em_[\w-]{40,}$/);

    const status = await call('api.status') as { ok: true; value: { url: string } };
    const whoami = await fetch(`${status.value.url}/api/v1/whoami`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(whoami.status, 200);

    await page.getByRole('button', { name: 'I’ve saved it' }).click();
    await page.getByTestId('new-token').waitFor({ state: 'detached' });
    await page.locator('.client-list').getByText('Test extension').waitFor();
    await settings('Library');
    await settings('Devices & extensions');
    assert.equal(await page.getByTestId('new-token').count(), 0);
    assert.equal(await page.getByText(token!).count(), 0, 'the token is never shown again');
  });

  test('saves dropped links and files', async () => {
    await nav('Home');
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/uri-list', 'https://example.org/dropped-datasheet');
      const target = document.querySelector('.app')!;
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    await page.getByText('Link saved').waitFor();

    const file = join(home, 'wiring-notes.txt');
    writeFileSync(file, 'Wall console pinout: red is 12 V, white is data, black is ground.');
    const saved = await call('files.save', [file]) as { ok: boolean };
    assert.equal(saved.ok, true);
    await nav('Files');
    await page.locator('.item-row').filter({ hasText: 'wiring-notes.txt' }).waitFor();
    await nav('Links');
    await page.locator('.item-row').filter({ hasText: 'dropped-datasheet' }).waitFor();
  });

  test('deletes only after confirmation', async () => {
    const row = page.locator('.item-row').filter({ hasText: 'dropped-datasheet' });
    await row.getByRole('button').first().click();
    const drawer = page.getByRole('dialog', { name: 'Link details' });
    await drawer.getByRole('button', { name: 'Delete…' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete permanently?' });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await confirm.waitFor({ state: 'detached' });
    await drawer.getByRole('button', { name: 'Delete…' }).click();
    await confirm.getByRole('button', { name: 'Delete permanently' }).click();
    await page.getByText('Deleted', { exact: true }).waitFor();
    await row.waitFor({ state: 'detached' });
  });

  test('quick capture window saves to the Inbox', async () => {
    const opened = app.waitForEvent('window', { predicate: (w) => w.url().endsWith('#capture') });
    await call('capture.open');
    const capture = await opened;
    await capture.getByLabel('Quick capture').fill('Quick thought: check the torsion spring before testing');
    await capture.getByLabel('Quick capture').press('Enter');
    await capture.getByText('Saved to Inbox').waitFor();
    await nav(/^Inbox/);
    await page.getByText('Quick thought: check the torsion spring before testing').waitFor();
  });

  test('syncs through a folder with an encryption passphrase', async () => {
    const folder = join(home, 'sync-folder');
    await stubDialogs(folder);
    await settings('Sync');
    await page.getByRole('button', { name: 'Choose folder…' }).click();
    await page.getByText(folder).waitFor();
    await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery');
    await page.getByLabel('Repeat').fill('correct horse battery');
    await page.getByRole('button', { name: 'Start syncing' }).click();
    await page.getByText('Encrypted', { exact: true }).waitFor();
    await page.getByText(/sent \d+, received \d+/).waitFor();
    assert.ok(existsSync(join(folder, 'devices')));
    await page.getByRole('button', { name: 'Sync now' }).click();
    await page.getByRole('button', { name: 'Stop syncing' }).click();
    await page.getByRole('alertdialog', { name: 'Stop syncing?' }).getByRole('button', { name: 'Stop syncing' }).click();
    await page.getByRole('button', { name: 'Choose folder…' }).waitFor();
    assert.ok(existsSync(join(folder, 'devices')), 'stopping never deletes the folder');
  });

  test('exports everything to a chosen folder', async () => {
    const folder = join(home, 'exports');
    mkdirSync(folder);
    await stubDialogs(folder);
    await settings('Export');
    await page.getByRole('button', { name: /Choose a folder and export/ }).click();
    await page.getByText(/Exported \d+ items/).waitFor();
    const [exported] = readdirSync(folder);
    assert.ok(existsSync(join(folder, exported!, 'metadata.json')));
  });

  test('restores a snapshot after a typed confirmation and reopens the library', async () => {
    await settings('Backups');
    await page.getByRole('button', { name: 'Snapshot now' }).click();
    await page.getByText('Snapshot saved').waitFor();
    runCli('note', 'written after the snapshot');
    await nav('Home');
    await page.getByText('written after the snapshot').first().waitFor({ timeout: 6000 });

    await settings('Backups');
    await page.locator('.backup-list li').filter({ hasText: 'manual' }).first().getByRole('button', { name: 'Restore…' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Restore this snapshot?' });
    const go = confirm.getByRole('button', { name: 'Restore snapshot' });
    assert.equal(await go.isDisabled(), true);
    await confirm.getByLabel('Confirmation word').fill('restore');
    await go.click();
    await page.getByText(/Restored\. The previous state was saved as pre-restore-/).waitFor({ timeout: 15_000 });
    await page.locator('.backup-list').getByText('pre-restore').waitFor();

    await nav('Home');
    await page.getByRole('heading', { name: 'Recent' }).waitFor();
    assert.equal(await page.getByText('written after the snapshot').count(), 0);
    const status = await call('api.status') as { ok: true; value: { running: boolean; url: string } };
    assert.equal(status.value.running, true);
    assert.equal((await fetch(`${status.value.url}/api/v1/status`)).status, 200);
  });

  test('asks the library with a real model (set ENVE_E2E_OLLAMA to run)', { skip: !process.env.ENVE_E2E_OLLAMA }, async () => {
    await settings('AI');
    await page.getByLabel('Provider').selectOption('ollama');
    await page.getByLabel(/Server address/).fill(process.env.ENVE_E2E_OLLAMA!);
    await page.getByLabel('Model').fill('qwen2.5:1.5b');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('AI settings saved').waitFor();
    await page.getByRole('button', { name: 'Test' }).click();
    await page.getByText(/^Replied:/).waitFor({ timeout: 90_000 });

    await nav('Ask');
    await page.getByLabel('Question').fill('How do rolling codes stop a replay attack?');
    await page.locator('form.ask-form').getByRole('button', { name: 'Ask' }).click();
    await page.locator('.answer .cite').first().waitFor({ timeout: 120_000 });
    await shot('ask-dark');
    await page.locator('.answer .cite').first().click();
    await page.getByRole('dialog', { name: /details/ }).waitFor();
    await page.keyboard.press('Escape');
  });

  test('automations tag and file new items', async () => {
    await settings('Automations');
    await page.getByLabel('Name', { exact: true }).fill('Code links');
    await page.getByLabel(/From sites/).fill('github.com');
    await page.getByLabel('Then add tags').fill('code');
    await page.getByLabel('And file into').selectOption({ label: 'Garage Door' });
    await page.getByRole('button', { name: 'Add automation' }).click();
    await page.getByText('When anything from github.com is saved: tag #code and file into Garage Door.').waitFor();

    await nav('Home');
    const capture = page.getByLabel('Capture a note or link');
    await capture.fill('https://github.com/example/secplus2-decoder');
    await capture.press('Enter');
    await page.getByTestId('saved-chip').click();
    const drawer = page.getByRole('dialog', { name: 'Link details' });
    await drawer.getByText('#code').waitFor();
    assert.equal(await drawer.getByLabel('Project').locator('option:checked').textContent(), 'Garage Door');
    await page.keyboard.press('Escape');
  });

  test('imports browser bookmarks', async () => {
    const file = join(home, 'bookmarks.html');
    writeFileSync(file, `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><H3>Hardware</H3><DL><p>
        <DT><A HREF="https://example.net/level-shifters">Level shifters, explained</A>
        <DT><A HREF="https://example.net/esp32-pinout">ESP32 pinout</A>
      </DL><p></DL>`);
    await stubDialogs(file);
    await settings('Import');
    await page.locator('.setting-row').filter({ hasText: 'Browser bookmarks' }).getByRole('button', { name: 'Choose file…' }).click();
    await page.getByText(/imported 2, skipped 0 already saved/).waitFor();
    await nav('Links');
    await page.locator('.item-row').filter({ hasText: 'ESP32 pinout' }).getByText('#hardware').waitFor();
  });

  test('pins, reminds and sorts items onto shelves', async () => {
    await stubDialogs(home);
    await nav('Links');
    const row = page.locator('.item-row').filter({ hasText: 'ESP32 pinout' });
    await row.hover();
    await row.getByRole('button', { name: 'Pin', exact: true }).click();
    await row.getByRole('button', { name: 'Unpin' }).waitFor();
    await nav('Pinned');
    await page.locator('.item-row').filter({ hasText: 'ESP32 pinout' }).waitFor();

    const pinned = page.locator('.item-row').filter({ hasText: 'ESP32 pinout' });
    await pinned.hover();
    await pinned.getByRole('button', { name: 'Remind me' }).click();
    await page.getByRole('menuitem', { name: 'Tomorrow' }).click();
    await page.getByText(/I’ll remind you tomorrow/).waitFor();
    await nav('Reminders');
    await page.getByRole('region', { name: 'Upcoming' }).getByText('ESP32 pinout').waitFor();

    await nav('Read');
    const level = page.locator('.item-row').filter({ hasText: 'Level shifters, explained' });
    await level.getByRole('button').first().click();
    const drawer = page.getByRole('dialog', { name: 'Link details' });
    await drawer.getByRole('group', { name: 'Intent' }).getByRole('button', { name: 'Watch' }).click();
    await drawer.getByRole('button', { name: 'Watch', pressed: true }).waitFor();
    await drawer.getByRole('button', { name: /example\.net\/level-shifters/ }).click();
    await drawer.getByText('Last opened just now').waitFor();
    await page.keyboard.press('Escape');
    await nav('Watch');
    await page.locator('.item-row').filter({ hasText: 'Level shifters, explained' }).waitFor();
    await nav('Read');
    await page.locator('.item-row').filter({ hasText: 'Rolling codes, explained' }).waitFor();
    assert.equal(await page.locator('.item-row').filter({ hasText: 'Level shifters, explained' }).count(), 0);
  });

  test('delivers a due reminder as a notification that opens the item', async () => {
    await app.evaluate(({ Notification }) => {
      const shown: unknown[] = [];
      (globalThis as { shownReminders?: unknown[] }).shownReminders = shown;
      Notification.prototype.show = function show(this: unknown) {
        shown.push(this);
      };
    });
    const list = await call('items.list', { type: 'bookmark' }, 200) as { ok: true; value: { id: string; title: string }[] };
    const target = list.value.find((item) => item.title === 'Level shifters, explained')!;
    await call('items.setReminder', target.id, new Date(Date.now() - 60_000).toISOString());

    let delivered: { title: string; body: string }[] = [];
    for (let i = 0; i < 30 && delivered.length === 0; i++) {
      delivered = await app.evaluate(() =>
        ((globalThis as { shownReminders?: { title: string; body: string }[] }).shownReminders ?? []).map((n) => ({ title: n.title, body: n.body })));
      if (!delivered.length) await page.waitForTimeout(200);
    }
    assert.deepEqual(delivered, [{ title: 'Time to watch', body: 'Level shifters, explained' }]);

    await nav('Home');
    await app.evaluate(() => (globalThis as { shownReminders?: { emit(e: string): void }[] }).shownReminders![0]!.emit('click'));
    await page.getByRole('dialog', { name: 'Link details' }).getByLabel('Title').and(page.locator('[value="Level shifters, explained"]')).waitFor();
    await page.keyboard.press('Escape');

    await nav('Reminders');
    const due = page.getByRole('region', { name: 'Due' });
    await due.getByText('Level shifters, explained').waitFor();
    await shot('reminders-dark');
    await due.getByRole('button', { name: 'Snooze' }).click();
    await page.getByRole('menuitem', { name: 'Next week' }).click();
    await page.getByRole('region', { name: 'Upcoming' }).getByText('Level shifters, explained').waitFor();
    assert.equal(await page.getByRole('region', { name: 'Due' }).count(), 0);
    const again = await app.evaluate(() => (globalThis as { shownReminders?: unknown[] }).shownReminders!.length);
    assert.equal(again, 1, 'a delivered reminder is not shown twice');
  });

  test('pages through a large library', async () => {
    const core = pathToFileURL(join(repo, 'packages', 'core', 'src', 'index.ts')).href;
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { EnveMemory } from ${JSON.stringify(core)};
      const memory = EnveMemory.open({ home: ${JSON.stringify(home)}, actor: 'cli' });
      for (let i = 1; i <= 110; i++) memory.items.saveNote({ body: 'Bulk note ' + i });
      memory.close();
    `]);
    await nav('Notes');
    await page.getByText('Bulk note 110', { exact: true }).waitFor({ timeout: 6000 });
    const before = await page.locator('.item-row').count();
    assert.equal(before, 100);
    await page.getByRole('button', { name: 'Load more' }).click();
    await page.getByText('Bulk note 1', { exact: true }).waitFor();
    assert.ok(await page.locator('.item-row').count() > 100);
  });

  test('draws the graph and opens a project from it', async () => {
    await nav('Graph');
    await page.getByLabel('Project', { exact: true }).selectOption({ label: 'Garage Door' });
    const canvas = page.getByRole('img', { name: /Graph of \d+ nodes/ });
    await canvas.waitFor();
    await page.waitForTimeout(5000);
    await shot('graph-dark');
    const box = (await canvas.boundingBox())!;
    assert.ok(box.width > 300 && box.height > 300);
    // Sweep a pointer over the canvas until it reports the project node under it, then click there.
    const spot = await page.evaluate(() => {
      const el = document.querySelector('canvas')!;
      const rect = el.getBoundingClientRect();
      for (let y = rect.top + 4; y < rect.bottom; y += 6) {
        for (let x = rect.left + 4; x < rect.right; x += 6) {
          el.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
          if (el.title === 'Garage Door') return { x, y };
        }
      }
      return null;
    });
    const found = spot !== null;
    if (spot) await page.mouse.click(spot.x, spot.y);
    assert.ok(found, 'the project node is on the canvas');
    await page.getByLabel('Project name').waitFor({ timeout: 2000 });
  });

  test('toggles the theme', async () => {
    await settings('Appearance');
    const dark = () => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const inkBackground = await background();
    await page.getByRole('radio', { name: 'Light' }).click();
    await page.waitForFunction(() => !matchMedia('(prefers-color-scheme: dark)').matches);
    assert.equal(await dark(), false);
    assert.notEqual(await background(), inkBackground);

    await nav('Home');
    await shot('home-light');
    await nav('Garage Door');
    await page.getByLabel('Project name').waitFor();
    await shot('project-light');

    await settings('Appearance');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.waitForFunction(() => matchMedia('(prefers-color-scheme: dark)').matches);
  });

  test('quits cleanly and releases the API port', async () => {
    const status = await call('api.status') as { ok: true; value: { url: string } };
    const child = app.process();
    const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
    await app.close();
    assert.equal(await exited, 0);
    await assert.rejects(fetch(`${status.value.url}/api/v1/status`));
  });
});
