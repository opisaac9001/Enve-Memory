import type { Embedder } from '@enve-memory/core';
import { type FeatureExtractionPipeline, env, pipeline } from '@huggingface/transformers';

export interface LocalModel {
  /** Hugging Face repo with ONNX weights. */
  repo: string;
  pooling: 'cls' | 'mean';
  /** Retrieval models trained with an instruction prefix on queries. */
  queryPrefix: string;
  /** Cosine similarity below which a hit is noise for this model. */
  minScore: number;
}

// MiniLM spreads scores widely (related ≈0.25+, unrelated ≈0.05), so an absolute floor can say "nothing relevant";
// bge-small ranked slightly better but packs everything into 0.4–0.7, which lets unrelated items crowd in.
export const DEFAULT_LOCAL_MODEL: LocalModel = {
  repo: 'Xenova/all-MiniLM-L6-v2',
  pooling: 'mean',
  queryPrefix: '',
  minScore: 0.18,
};

/**
 * Runs a small embedding model on this machine (ONNX, int8). The weights (~23 MB) download once into
 * `cacheDir` and every later run is offline.
 */
export class LocalEmbedder implements Embedder {
  readonly model: string;
  readonly minScore: number;
  private readonly spec: LocalModel;
  private readonly cacheDir: string;
  private extractor: Promise<FeatureExtractionPipeline> | null = null;

  constructor(cacheDir: string, spec: LocalModel = DEFAULT_LOCAL_MODEL) {
    this.spec = spec;
    this.cacheDir = cacheDir;
    this.model = `local:${spec.repo}`;
    this.minScore = spec.minScore;
  }

  async embed(texts: string[], kind: 'document' | 'query'): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extract = await this.load();
    const inputs = kind === 'query' ? texts.map((t) => this.spec.queryPrefix + t) : texts;
    const output = await extract(inputs, { pooling: this.spec.pooling, normalize: true });
    const [rows, dimensions] = output.dims as [number, number];
    const data = output.data as Float32Array;
    return Array.from({ length: rows }, (_, i) => data.slice(i * dimensions, (i + 1) * dimensions));
  }

  private load(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      env.cacheDir = this.cacheDir;
      this.extractor = pipeline('feature-extraction', this.spec.repo, { dtype: 'q8' }).catch((error: unknown) => {
        this.extractor = null;
        throw error;
      }) as Promise<FeatureExtractionPipeline>;
    }
    return this.extractor;
  }
}
