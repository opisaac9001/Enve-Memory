import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EnveMemory } from '@enve-memory/core';
import { DEFAULT_LOCAL_MODEL, LocalEmbedder } from '@enve-memory/embeddings';

// The model is fetched by `npm run models`; tests never download.
const CACHE = fileURLToPath(new URL('../../../.cache/models', import.meta.url));
const available = existsSync(join(CACHE, ...DEFAULT_LOCAL_MODEL.repo.split('/')));

const CORPUS = [
  { key: 'secplus', title: 'Security+ 2.0 protocol', body: 'LiftMaster and Chamberlain openers exchange rolling codes with the wall button over a two-wire serial bus.' },
  { key: 'ratgdo', title: 'ratgdo board', body: 'An ESP32 board that sits on the wall-button wires and gives local control of the opener.' },
  { key: 'sourdough', title: 'Starter schedule', body: 'Feed the levain at 8am and 8pm with equal weights of flour and water.' },
  { key: 'plex', title: 'Transcoding', body: 'Plex converts 4K HDR files on the fly when the client cannot direct play them.' },
  { key: 'taxes', title: 'Quarterly estimates', body: 'File IRS form 1040-ES by the 15th of April, June, September and January.' },
  { key: 'relay', title: 'Dry contact wiring', body: 'Use a normally-open relay across the terminals so the controller simulates a button press.' },
  { key: 'tent', title: 'Camping checklist', body: 'Tent, sleeping bag, headlamp, water filter, stove and fuel canister.' },
  { key: 'epub', title: 'Readium notes', body: 'The navigator renders reflowable EPUB chapters in a web view and reports locator positions.' },
];

// Queries phrased the way people ask, sharing few or no words with the answer.
const QUERIES: [string, string][] = [
  ['how does the garage door remote talk to the motor', 'secplus'],
  ['baking bread with natural yeast', 'sourdough'],
  ['video server struggles with high resolution movies', 'plex'],
  ['government paperwork deadlines', 'taxes'],
  ['things to pack for a trip outdoors', 'tent'],
  ['e-book reader rendering', 'epub'],
];

test('hybrid search answers paraphrased questions the keyword index cannot', { skip: !available && 'model not cached; run `npm run models`' }, async () => {
  const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
  const ids = new Map<string, string>();
  for (const doc of CORPUS) ids.set(memory.items.saveNote({ title: doc.title, body: doc.body }).id, doc.key);
  const embedder = new LocalEmbedder(CACHE);
  memory.search.embedder = embedder;
  await memory.embeddings.indexPending(embedder);

  let keywordTop1 = 0;
  let hybridTop1 = 0;
  for (const [query, expected] of QUERIES) {
    const keyword = memory.search.query(query, {}, 3);
    const hybrid = await memory.search.hybrid(query, {}, 3);
    if (ids.get(keyword[0]?.id ?? '') === expected) keywordTop1++;
    if (ids.get(hybrid[0]?.id ?? '') === expected) hybridTop1++;
    const top2 = hybrid.slice(0, 2).map((h) => ids.get(h.id));
    assert.ok(top2.includes(expected), `"${query}" → ${top2.join(', ') || 'nothing'}; expected ${expected} in the top 2`);
  }
  // Baseline on 2026-09-24 with all-MiniLM-L6-v2: hybrid 5/6 at #1 (the garage question ranks the ratgdo board, also relevant, first), keyword 1/6.
  assert.ok(hybridTop1 >= 5, `hybrid got ${hybridTop1}/${QUERIES.length} at #1`);
  assert.ok(keywordTop1 <= 2, `keyword alone got ${keywordTop1}/${QUERIES.length}; the fixture should need semantic search`);

  const unrelated = await memory.search.hybrid('quantum chromodynamics lattice gauge theory');
  assert.deepEqual(unrelated, [], 'nothing relevant means no results, not the least-bad ones');
});

test('semantic search is off on platforms without an ONNX runtime build', async () => {
  const { localEmbeddingsSupported } = await import('@enve-memory/embeddings');
  assert.equal(localEmbeddingsSupported('darwin', 'x64'), false);
  assert.equal(localEmbeddingsSupported('darwin', 'arm64'), true);
  assert.equal(localEmbeddingsSupported('win32', 'x64'), true);
  assert.equal(localEmbeddingsSupported('linux', 'arm64'), true);
});
