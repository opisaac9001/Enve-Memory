// Builds a realistic demo library for screenshots and trying the apps: `node scripts/demo-library.ts <home>`.
// Everything is fictional and nothing is fetched; archived page text is written directly.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnveMemory } from '@enve-memory/core';
import { LocalEmbedder } from '@enve-memory/embeddings';

const home = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node scripts/demo-library.ts <empty folder>');
if (existsSync(home) && readdirSync(home).length > 0) throw new Error(`${home} is not empty.`);
mkdirSync(home, { recursive: true });

const memory = EnveMemory.open({ home, actor: 'desktop' });
memory.settings.set('fetchLinks', false);
const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const as = <T>(actor: string, fn: () => T): T => memory.withActor(actor, fn);

// Projects
memory.projects.create({
  name: 'Garage Door Controller',
  description: 'Replace the dead opener logic board with an ESP32 that speaks Security+ 2.0, with local control from Home Assistant.',
  instructions: 'Must keep working with the internet down. Never send the opener a code it did not generate. Test on the bench rig before touching the real opener.',
  createdAt: days(21),
});
memory.projects.setMemory('garage', `# Garage Door Controller

## Goal
A local controller for a Chamberlain yellow-learn-button opener: open, close, stop, light, and a door-position sensor that doesn't depend on the opener.

## Current state
- Bench rig wired: ESP32-S3 DevKit, level shifter, a spare wall console.
- Rolling-code sync works on the rig; not yet on the real opener.
- Home Assistant sees the entity through ESPHome.

## Constraints
- 12 V wall-console bus; the data line idles high.
- No cloud dependency, no port forwarding.

## Open questions
- Reed switch or time-of-flight sensor for door position?
- Enclosure: 3D-printed or a DIN box?`);
memory.projects.create({
  name: 'Home Lab',
  description: 'The rack in the closet: Proxmox, backups, Plex and the monitoring that keeps it honest.',
  instructions: 'Changes go through the runbook. Snapshot before upgrades.',
  createdAt: days(40),
});
memory.projects.setMemory('home lab', '# Home Lab\n\n## Goal\nOne quiet box that runs everything and backs itself up.\n\n## State\nProxmox 9 on the N100; Plex in an LXC; nightly backups to the NAS.\n');
memory.projects.create({ name: 'Reading List', description: 'Long reads worth finishing.', createdAt: days(60) });

// Decisions, with one superseded
const esp32 = as('mcp:claude-code', () => memory.decisions.record({ project: 'garage', decision: 'Use an ESP32 for the controller', reason: 'Cheap, well supported by ESPHome, and has Wi-Fi.', createdAt: days(18) }));
as('mcp:codex', () => memory.decisions.record({ project: 'garage', decision: 'Switch to the ESP32-S3', reason: 'Native USB for flashing on the bench, and more GPIO for the sensor.', supersedes: [esp32.id], createdAt: days(9) }));
as('desktop', () => memory.decisions.record({ project: 'garage', decision: 'Door position comes from a reed switch, not the opener', reason: 'The opener\'s own state goes stale after a manual pull.', createdAt: days(4) }));
as('mcp:claude-code', () => memory.decisions.record({ project: 'home lab', decision: 'Back up to the NAS nightly, weekly offsite', reason: '3-2-1 without paying for cloud storage.', createdAt: days(12) }));

// Links with archived text
function link(input: { url: string; title: string; note?: string; project?: string; tags?: string[]; site: string; excerpt: string; text: string; ago: number; actor: string }) {
  const { item } = as(input.actor, () => memory.items.saveLink({ url: input.url, title: input.title, note: input.note, project: input.project, tags: input.tags, ingest: false }));
  memory.withActor('ingest', () => memory.items.setSource(item.id, {
    content: input.text,
    metadata: { siteName: input.site, excerpt: input.excerpt, wordCount: input.text.split(/\s+/).length, ingest: { status: 'done', at: days(input.ago) } },
  }));
  return item;
}

const secplus = link({
  url: 'https://docs.example.org/security-plus-2', title: 'How Security+ 2.0 openers talk', site: 'Opener Notes',
  note: 'The clearest explanation of the wall-console protocol I have found.', project: 'garage', tags: ['protocol', 'rolling-code'],
  excerpt: 'The wall console and the motor unit share one data line and exchange rolling codes on every press.',
  text: '# How Security+ 2.0 openers talk\n\nSecurity+ 2.0 openers share a single data wire between the wall console and the motor unit. Every command carries a rolling code: a counter that advances on each press, encrypted so a recorded packet is useless later.\n\n## Why replay fails\nThe receiver keeps a window of acceptable counter values. A replayed code is behind the window and is ignored.\n\n## Emulating a wall button\nA controller on the same pair must generate its own codes and stay in sync with the opener.',
  ago: 16, actor: 'api:Chrome extension',
});
link({
  url: 'https://github.com/example/esphome-garage', title: 'esphome-garage: local Security+ control', site: 'GitHub', project: 'garage', tags: ['esp32', 'firmware'],
  excerpt: 'ESPHome component that emulates a Security+ 2.0 wall console.',
  text: '# esphome-garage\n\nAn ESPHome component that sits on the wall-console wires of a Security+ 2.0 opener and gives Home Assistant open, close, stop and light control without the cloud.',
  ago: 14, actor: 'api:Chrome extension',
});
link({
  url: 'https://www.youtube.com/watch?v=bench-rig', title: 'Building a garage opener bench rig', site: 'YouTube', project: 'garage', tags: ['bench-rig'],
  excerpt: 'Wiring a spare wall console to a microcontroller on the desk.', text: 'Video: wiring a spare wall console, a 12 V supply and a logic analyzer on the bench.',
  ago: 6, actor: 'api:iPhone',
});
link({
  url: 'https://shop.example.com/products/level-shifter-4ch', title: '4-channel logic level shifter', site: 'Parts Shop', project: 'garage', tags: ['parts'],
  excerpt: 'Bidirectional 3.3 V ↔ 5 V shifter.', text: '4-channel bidirectional level shifter, 3.3 V to 5 V, BSS138 based.', ago: 5, actor: 'api:Chrome extension',
});
link({
  url: 'https://en.wikipedia.org/wiki/Reed_switch', title: 'Reed switch', site: 'Wikipedia', project: 'garage', tags: ['sensors'],
  excerpt: 'An electrical switch operated by an applied magnetic field.', text: 'A reed switch is an electrical switch operated by an applied magnetic field. It consists of a pair of contacts on ferromagnetic metal reeds in a hermetically sealed glass envelope.',
  ago: 4, actor: 'mcp:claude-code',
});
link({
  url: 'https://blog.example.net/proxmox-backup-strategy', title: 'A backup strategy for a one-box home lab', site: 'Homelab Journal', project: 'home lab', tags: ['backups', 'proxmox'],
  excerpt: 'Snapshots are not backups: nightly to the NAS, weekly offsite.', text: '# A backup strategy for a one-box home lab\n\nSnapshots protect you from yourself, not from a dead disk. Back up nightly to a NAS and weekly somewhere else.',
  ago: 12, actor: 'api:Chrome extension',
});
link({
  url: 'https://www.youtube.com/watch?v=plex-hw-transcode', title: 'Plex hardware transcoding on an N100', site: 'YouTube', project: 'home lab', tags: ['plex'],
  excerpt: 'Quick Sync passthrough into an LXC.', text: 'Video: passing the N100 iGPU into a Plex LXC for hardware transcoding.', ago: 9, actor: 'api:iPhone',
});
const essay = link({
  url: 'https://essays.example.com/the-long-now-of-software', title: 'The long now of software', site: 'Essays', project: 'reading list', tags: ['essay'],
  excerpt: 'Why the tools we build should outlive the companies that build them.', text: 'Software rots when it depends on services it does not control. The durable tools keep their data in formats you can read without them.',
  ago: 45, actor: 'api:Chrome extension',
});
link({
  url: 'https://www.example-store.com/dp/B0DESKMAT', title: 'Felt desk mat, 90 × 40 cm', site: 'Store', tags: ['desk'],
  excerpt: 'Wool felt desk mat.', text: 'Wool felt desk mat, 90 × 40 cm, charcoal.', ago: 2, actor: 'api:iPhone',
});

// Notes and a file
as('mcp:claude-code', () => memory.items.saveNote({ project: 'garage', title: 'Wall console measurements', body: 'Measured the wall console: 12 V supply, and the data line idles high at 12 V. It needs a divider or level shifter before the ESP32 pin.', tags: ['measurements', 'wiring'] }));
as('mcp:codex', () => memory.items.saveNote({ project: 'garage', title: 'Bench-test plan', body: 'Simulate the Security+ 2.0 rolling code on the bench rig first. Only move to the real opener once open, close, stop and light all work five times in a row.', tags: ['bench-rig'] }));
as('desktop', () => memory.items.saveNote({ project: 'home lab', title: 'Upgrade runbook', body: '1. Snapshot the host.\n2. Upgrade Proxmox.\n3. Check the Plex LXC still sees /dev/dri.\n4. Run a restore test from the NAS.' }));
as('api:iPhone', () => memory.items.saveNote({ body: 'Idea: a "door left open" notification after 10 minutes, but only at night.' }));
memory.files.save({ data: new TextEncoder().encode('GPIO4  → console data (via shifter)\nGPIO5  → reed switch (pull-up)\nGPIO6  → light relay\n3V3/GND → shifter low side\n'), filename: 'pinout.txt', project: 'garage', tags: ['wiring'] });

// Tasks
const bench = as('mcp:claude-code', () => memory.tasks.create({ title: 'Build the Security+ 2.0 bench simulator', project: 'garage', priority: 'high', due: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) }));
as('mcp:codex', () => memory.tasks.create({ title: 'Order a 4-channel level shifter', project: 'garage', due: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) }));
as('desktop', () => memory.tasks.create({ title: 'Print the enclosure test fit', project: 'garage', priority: 'low' }));
const restore = as('desktop', () => memory.tasks.create({ title: 'Run a restore test from the NAS', project: 'home lab' }));
memory.tasks.complete(restore.id);
as('mcp:claude-code', () => memory.tasks.create({ title: 'Move Plex to hardware transcoding', project: 'home lab', priority: 'high' }));

// Relations, shelves, reminders and AI suggestions
memory.items.relate(bench.id, secplus.id, 'references');
memory.items.pin(secplus.id, true);
memory.items.setReminder(secplus.id, 'tomorrow');
memory.items.setReminder(essay.id, 'this weekend');
memory.items.markOpened(essay.id);
memory.items.suggest(essay.id, {
  status: 'done', at: days(1), model: 'ollama:qwen2.5:1.5b',
  summary: 'An argument for software that keeps your data in open formats so it outlives its makers.',
  tags: ['local-first', 'essay'], project: null,
});
const inbox = as('api:Chrome extension', () => memory.items.saveLink({ url: 'https://docs.example.org/home-assistant-covers', title: 'Home Assistant cover entities', ingest: false }).item);
memory.withActor('ingest', () => memory.items.setSource(inbox.id, {
  content: '# Home Assistant cover entities\n\nA cover is anything that opens and closes: garage doors, gates, blinds. It reports open, closed, opening or closing, and offers open, close and stop services. For a garage door opener, pair the cover with a separate door-position sensor such as a reed switch.',
  metadata: { siteName: 'Automation Handbook', excerpt: 'Covers model garage doors, gates and blinds with open, close and stop.', ingest: { status: 'done', at: days(0) } },
}));
memory.items.suggest(inbox.id, {
  status: 'done', at: days(0), model: 'ollama:qwen2.5:1.5b',
  summary: 'How Home Assistant models garage doors as cover entities with open, close and stop.',
  tags: ['home-assistant', 'integration'], project: { id: memory.projects.resolve('garage').id, name: 'Garage Door Controller' },
});
memory.rules.create({ name: 'GitHub links', conditions: { domains: ['github.com'] }, actions: { tags: ['code'] } });

// Local semantic index, when the model is already cached in the repo (npm run models); never downloads.
const models = join(fileURLToPath(new URL('..', import.meta.url)), '.cache', 'models');
if (existsSync(models)) {
  const embedder = new LocalEmbedder(models);
  while ((await memory.embeddings.indexPending(embedder, 50)) > 0);
}

memory.close();
console.log(`Demo library ready at ${home}`);
