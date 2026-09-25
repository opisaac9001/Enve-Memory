import type { Context } from './context.ts';
import { invalid } from './errors.ts';

/** Turns text into unit-length vectors. Implementations live outside core (local ONNX model, Ollama, OpenAI-compatible APIs). */
export interface Embedder {
  /** Stable id stored beside every vector, e.g. `local:Xenova/bge-small-en-v1.5`. Changing it re-indexes everything. */
  readonly model: string;
  /** Similarity below which a vector hit is treated as unrelated. */
  readonly minScore?: number;
  embed(texts: string[], kind: 'document' | 'query'): Promise<Float32Array[]>;
}

export interface VectorHit {
  itemId: string;
  score: number;
  chunk: string;
}

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS_PER_ITEM = 48;
const EMBED_BATCH = 16;

/** Splits on paragraph, then sentence, then word boundaries, with overlap so an idea split across chunks stays findable. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < MAX_CHUNKS_PER_ITEM) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start + CHUNK_SIZE / 2, end);
      const breakAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
      const fallback = window.lastIndexOf(' ');
      const cut = breakAt >= 0 ? breakAt + 1 : fallback;
      if (cut >= 0) end = start + CHUNK_SIZE / 2 + cut;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter(Boolean);
}

interface LoadedIndex {
  signature: string;
  itemIds: string[];
  chunkIds: number[];
  dimensions: number;
  matrix: Float32Array;
}

export class EmbeddingService {
  private readonly ctx: Context;
  private cache = new Map<string, LoadedIndex>();

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  /** Items whose text changed or that were never embedded with this model. */
  pending(model: string, limit = 50): string[] {
    return this.ctx
      .all<{ id: string }>(
        `SELECT i.id FROM items i
         WHERE i.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM embedded_items e WHERE e.item_id = i.id AND e.model = ?)
         ORDER BY i.seq DESC LIMIT ?`,
        model, limit,
      )
      .map((r) => r.id);
  }

  status(model: string): { indexed: number; pending: number; chunks: number } {
    const indexed = this.ctx.get<{ n: number }>(`SELECT count(*) AS n FROM embedded_items WHERE model = ?`, model)!.n;
    const total = this.ctx.get<{ n: number }>(`SELECT count(*) AS n FROM items WHERE archived_at IS NULL`)!.n;
    const chunks = this.ctx.get<{ n: number }>(`SELECT count(*) AS n FROM chunks WHERE model = ?`, model)!.n;
    return { indexed, pending: Math.max(total - indexed, 0), chunks };
  }

  hasIndex(model: string): boolean {
    return this.ctx.get(`SELECT 1 FROM chunks WHERE model = ? LIMIT 1`, model) !== undefined;
  }

  /** Embeds up to `limit` pending items. Returns how many were indexed. */
  async indexPending(embedder: Embedder, limit = 50): Promise<number> {
    const ids = this.pending(embedder.model, limit);
    for (const id of ids) {
      const row = this.ctx.get<{ title: string; body: string; content: string; version: number | null }>(
        `SELECT title, body, content, (SELECT max(seq) FROM changes WHERE entity = 'item' AND entity_id = items.id) AS version
         FROM items WHERE id = ?`, id,
      );
      if (!row) continue;
      const chunks = chunkText([row.title, row.body, row.content].filter(Boolean).join('\n\n'));
      const vectors: Float32Array[] = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        vectors.push(...(await embedder.embed(chunks.slice(i, i + EMBED_BATCH), 'document')));
      }
      this.ctx.tx(() => {
        // Any change to the item while the model ran (it has a change-log entry) means these vectors may be stale; the next pass redoes it.
        const current = this.ctx.get<{ version: number | null }>(
          `SELECT (SELECT max(seq) FROM changes WHERE entity = 'item' AND entity_id = items.id) AS version FROM items WHERE id = ?`, id,
        );
        if (!current || current.version !== row.version) return;
        this.ctx.run(`DELETE FROM chunks WHERE item_id = ? AND model = ?`, id, embedder.model);
        chunks.forEach((text, ordinal) => {
          this.ctx.run(
            `INSERT INTO chunks (item_id, model, ordinal, text, vector) VALUES (?, ?, ?, ?, ?)`,
            id, embedder.model, ordinal, text, toBlob(vectors[ordinal]!),
          );
        });
        this.ctx.run(
          `INSERT INTO embedded_items (item_id, model, embedded_at) VALUES (?, ?, ?)
           ON CONFLICT (item_id, model) DO UPDATE SET embedded_at = excluded.embedded_at`,
          id, embedder.model, this.ctx.now(),
        );
      });
    }
    return ids.length;
  }

  /** Nearest items by their best-matching chunk. Brute force over normalized vectors: fast enough for a personal library. */
  nearest(model: string, query: Float32Array, limit: number, allowed?: Set<string>, minScore = -1): VectorHit[] {
    const index = this.load(model);
    if (!index || index.itemIds.length === 0) return [];
    if (query.length !== index.dimensions) throw invalid(`Query vector has ${query.length} dimensions; the index has ${index.dimensions}.`);
    const best = new Map<string, { score: number; chunkId: number }>();
    for (let row = 0; row < index.itemIds.length; row++) {
      const itemId = index.itemIds[row]!;
      if (allowed && !allowed.has(itemId)) continue;
      let score = 0;
      const offset = row * index.dimensions;
      for (let d = 0; d < index.dimensions; d++) score += index.matrix[offset + d]! * query[d]!;
      const current = best.get(itemId);
      if (!current || score > current.score) best.set(itemId, { score, chunkId: index.chunkIds[row]! });
    }
    return [...best.entries()]
      .filter(([, hit]) => hit.score >= minScore)
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([itemId, { score, chunkId }]) => ({
        itemId,
        score,
        chunk: this.ctx.get<{ text: string }>(`SELECT text FROM chunks WHERE id = ?`, chunkId)!.text,
      }));
  }

  /** Drops vectors for models other than `keep`, e.g. after switching models. */
  prune(keep: string): void {
    if (!this.ctx.get(`SELECT 1 FROM embedded_items WHERE model != ? LIMIT 1`, keep)) return;
    this.ctx.tx(() => {
      this.ctx.run(`DELETE FROM chunks WHERE model != ?`, keep);
      this.ctx.run(`DELETE FROM embedded_items WHERE model != ?`, keep);
    });
    this.cache.clear();
  }

  private load(model: string): LoadedIndex | undefined {
    // Other processes (the desktop app, a CLI run) write chunks too, so the cache is keyed on the table's state.
    const { n, max } = this.ctx.get<{ n: number; max: number | null }>(
      `SELECT count(*) AS n, max(id) AS max FROM chunks WHERE model = ?`, model,
    )!;
    const signature = `${n}:${max}`;
    const cached = this.cache.get(model);
    if (cached?.signature === signature) return cached;
    const rows = this.ctx.all<{ id: number; item_id: string; vector: Uint8Array }>(
      `SELECT c.id, c.item_id, c.vector FROM chunks c JOIN items i ON i.id = c.item_id WHERE c.model = ? AND i.archived_at IS NULL`,
      model,
    );
    if (rows.length === 0) return undefined;
    const dimensions = rows[0]!.vector.byteLength / 4;
    const matrix = new Float32Array(rows.length * dimensions);
    rows.forEach((row, i) => matrix.set(fromBlob(row.vector), i * dimensions));
    const index = { signature, itemIds: rows.map((r) => r.item_id), chunkIds: rows.map((r) => r.id), dimensions, matrix };
    this.cache.set(model, index);
    return index;
  }
}

const toBlob = (vector: Float32Array) => new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
const fromBlob = (blob: Uint8Array) => new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
