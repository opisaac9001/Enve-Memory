import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Embedder, EnveMemory, chunkText } from '@enve-memory/core';

const CONCEPTS: Record<string, number> = {
  garage: 0, door: 0, opener: 0, motor: 0, chamberlain: 0, liftmaster: 0,
  relay: 1, coil: 1, switch: 1, contact: 1,
  sourdough: 2, bread: 2, starter: 2, yeast: 2,
};
const DIMENSIONS = 16;

/** Words in the same concept land on the same axis, so paraphrases are "near" without a real model. */
class ConceptEmbedder implements Embedder {
  readonly model: string;
  calls = 0;

  constructor(model = 'test:concepts') {
    this.model = model;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    return texts.map((text) => {
      const vector = new Float32Array(DIMENSIONS);
      for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
        const axis = CONCEPTS[word] ?? 3 + ([...word].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % (DIMENSIONS - 3));
        vector[axis]! += 1;
      }
      const norm = Math.hypot(...vector) || 1;
      return vector.map((v) => v / norm);
    });
  }
}

function library(embedder = new ConceptEmbedder()) {
  const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
  memory.search.embedder = embedder;
  return { memory, embedder };
}

test('chunks break on natural boundaries, overlap, and are capped', () => {
  assert.deepEqual(chunkText('  \n '), []);
  assert.deepEqual(chunkText('One short note.'), ['One short note.']);
  const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'lorem ipsum '.repeat(10)}.`).join('\n\n');
  const chunks = chunkText(paragraphs);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((c) => c.length <= 1000));
  assert.ok(chunks[0]!.includes(chunks[1]!.slice(0, 50)), 'consecutive chunks overlap');
  assert.equal(chunkText('word '.repeat(100_000)).length, 48);
});

test('indexing covers every active item and re-embeds edited ones', async () => {
  const { memory, embedder } = library();
  const note = memory.items.saveNote({ body: 'Chamberlain opener wiring' });
  memory.items.saveNote({ body: 'Sourdough starter feeding schedule' });
  const archived = memory.items.saveNote({ body: 'old relay idea' });
  memory.items.archive(archived.id);

  assert.equal(await memory.embeddings.indexPending(embedder), 2);
  assert.deepEqual(memory.embeddings.status(embedder.model), { indexed: 2, pending: 0, chunks: 2 });
  assert.equal(await memory.embeddings.indexPending(embedder), 0);

  memory.items.update(note.id, { body: 'Chamberlain opener wiring, revised' });
  assert.deepEqual(memory.embeddings.pending(embedder.model), [note.id]);
  memory.items.tag(note.id, { add: ['x'] });
  assert.equal(memory.embeddings.pending(embedder.model).length, 1, 'tagging does not change embedded text');
});

test('hybrid search finds paraphrases that keyword search misses', async () => {
  const { memory, embedder } = library();
  const opener = memory.items.saveNote({ title: 'Wall button', body: 'The LiftMaster needs a dry contact across the terminals' });
  const bread = memory.items.saveNote({ body: 'Feed the sourdough starter twice a day' });
  await memory.embeddings.indexPending(embedder);

  assert.deepEqual(memory.search.query('garage motor').map((h) => h.id), []);
  const hits = await memory.search.hybrid('garage motor');
  assert.equal(hits[0]?.id, opener.id);
  assert.equal(hits[0]?.match, 'semantic');
  assert.match(hits[0]!.snippet, /LiftMaster/);

  const both = await memory.search.hybrid('liftmaster opener');
  assert.equal(both[0]?.id, opener.id);
  assert.equal(both[0]?.match, 'both');
  assert.equal((await memory.search.hybrid('bread yeast'))[0]?.id, bread.id);
});

test('filters and archiving apply to meaning-based hits too', async () => {
  const { memory, embedder } = library();
  memory.projects.create({ name: 'Garage' });
  memory.projects.create({ name: 'Kitchen' });
  const inGarage = memory.items.saveNote({ body: 'opener relay', project: 'garage' });
  const inKitchen = memory.items.saveNote({ body: 'mixer relay', project: 'kitchen' });
  const archived = memory.items.saveNote({ body: 'chamberlain opener', project: 'garage' });
  await memory.embeddings.indexPending(embedder);
  memory.items.archive(archived.id);

  const garageOnly = await memory.search.hybrid('motor coil', { project: 'garage' });
  assert.deepEqual(garageOnly.map((h) => h.id), [inGarage.id]);
  const all = (await memory.search.hybrid('motor coil')).map((h) => h.id);
  assert.ok(all.includes(inKitchen.id));
  assert.equal(all.includes(archived.id), false);
});

test('without an embedder or an index, hybrid is plain keyword search', async () => {
  const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
  memory.items.saveNote({ body: 'relay wiring' });
  assert.equal((await memory.search.hybrid('relay'))[0]?.match, 'keyword');

  const embedder = new ConceptEmbedder();
  memory.search.embedder = embedder;
  assert.equal((await memory.search.hybrid('relay'))[0]?.match, 'keyword');
  assert.equal(embedder.calls, 0, 'no model call until something is indexed');
  await assert.rejects(memory.search.hybrid('?!'), /at least one word/);
});

test('vectors written by another process are picked up; switching models prunes the old ones', async () => {
  const home = mkdtempSync(join(tmpdir(), 'enve-memory-vectors-'));
  const reader = EnveMemory.open({ home, actor: 'reader' });
  const writer = EnveMemory.open({ home, actor: 'writer' });
  const embedder = new ConceptEmbedder();
  reader.search.embedder = embedder;

  const first = writer.items.saveNote({ body: 'garage opener' });
  await writer.embeddings.indexPending(embedder);
  assert.equal((await reader.search.hybrid('motor'))[0]?.id, first.id);

  const second = writer.items.saveNote({ body: 'sourdough bread' });
  await writer.embeddings.indexPending(embedder);
  assert.equal((await reader.search.hybrid('yeast'))[0]?.id, second.id);

  const next = new ConceptEmbedder('test:concepts-v2');
  writer.embeddings.prune(next.model);
  assert.equal(writer.embeddings.hasIndex(embedder.model), false);
  assert.equal(writer.embeddings.pending(next.model).length, 2);
  reader.close();
  writer.close();
});

test('an item that changes while it is being embedded is indexed again', async () => {
  const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
  const link = memory.items.saveLink({ url: 'https://example.com/page', title: 'Page', ingest: false }).item;
  let first = true;
  const racing: Embedder = {
    model: 'test:racing',
    async embed(texts) {
      // The page's archived text lands while the model is still working on the title.
      if (first) memory.items.setSource(link.id, { content: 'archived text arrives mid-embedding', metadata: {} });
      first = false;
      return texts.map(() => new Float32Array([1, 0]));
    },
  };
  await memory.embeddings.indexPending(racing);
  assert.deepEqual(memory.embeddings.pending(racing.model), [link.id], 'stale vectors are not kept');
  await memory.embeddings.indexPending(racing);
  assert.deepEqual(memory.embeddings.pending(racing.model), []);
});

test('archiving and AI suggestions do not move an item in "recently updated"', async () => {
  const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
  const link = memory.items.saveLink({ url: 'https://example.com/a', ingest: false, createdAt: '2026-01-01T00:00:00.000Z' }).item;
  memory.items.setSource(link.id, { content: 'text', metadata: {} });
  memory.items.suggest(link.id, { status: 'done', at: new Date().toISOString(), model: 't', summary: 's', tags: [], project: null });
  assert.equal(memory.items.get(link.id).updatedAt, '2026-01-01T00:00:00.000Z');
});
