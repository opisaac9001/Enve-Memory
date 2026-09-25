import { DrainWorker, type EnveMemory } from '@enve-memory/core';
import { LocalEmbedder, localEmbeddingsSupported } from './local.ts';

/**
 * Gives a library the local embedding model when semantic search is on. Cheap: the model loads on first use,
 * and hybrid search only calls it once something has been indexed.
 */
export function attachLocalEmbedder(memory: EnveMemory): LocalEmbedder | null {
  if (!memory.paths || !memory.settings.get('semanticSearch') || !localEmbeddingsSupported()) {
    memory.search.embedder = null;
    return null;
  }
  const embedder = new LocalEmbedder(memory.paths.models);
  memory.search.embedder = embedder;
  memory.embeddings.prune(embedder.model);
  return embedder;
}

const BATCH = 20;

/** Keeps the vector index current in a long-running process. */
export function indexWorker(memory: EnveMemory, embedder: LocalEmbedder): DrainWorker {
  return new DrainWorker('index', () => memory.embeddings.indexPending(embedder, BATCH));
}
