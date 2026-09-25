import { type EnveMemory, type ItemDetail, isPlainText } from '@enve-memory/core';
import { type FetchOptions, IngestError, fetchSource } from './fetch.ts';
import { type Extracted, extractHtml } from './html.ts';
import { extractPdf } from './pdf.ts';

export const INGEST_ACTOR = 'ingest';

/**
 * Fetches or reads an item's source and stores the extracted text. Failures are recorded on the item
 * (metadata.ingest.status = 'failed') rather than thrown, so saving never depends on the network.
 */
export async function ingestItem(memory: EnveMemory, id: string, options: FetchOptions = {}): Promise<ItemDetail> {
  const item = memory.items.get(id);
  const at = new Date().toISOString();
  try {
    const extracted = await extract(memory, item, options);
    return memory.withActor(INGEST_ACTOR, () =>
      memory.items.setSource(id, {
        title: extracted.title,
        content: extracted.content,
        metadata: { ...extracted.metadata, ingest: { status: 'done', at } },
      }),
    );
  } catch (error) {
    const message = error instanceof IngestError ? error.message : `Extraction failed: ${(error as Error).message}`;
    return memory.withActor(INGEST_ACTOR, () =>
      memory.items.setSource(id, { metadata: { ingest: { status: 'failed', at, error: message } } }),
    );
  }
}

/** Works through saved-but-unprocessed items a few at a time. Returns how many were processed. */
export async function processPending(
  memory: EnveMemory,
  { limit = 20, concurrency = 3, ...options }: FetchOptions & { limit?: number; concurrency?: number } = {},
): Promise<number> {
  const queue = memory.items.pendingIngest(limit);
  const total = queue.length;
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) await ingestItem(memory, id, options);
  });
  await Promise.all(workers);
  return total;
}

async function extract(memory: EnveMemory, item: ItemDetail, options: FetchOptions): Promise<Extracted & { finalUrl?: string }> {
  if (item.attachments.length > 0) {
    const { attachment, data } = memory.files.read(item.id);
    return extractBytes(data, attachment.mimeType, `file:///${encodeURIComponent(attachment.filename)}`);
  }
  if (!item.url) throw new IngestError('Nothing to fetch: the item has no URL or file.');
  const source = await fetchSource(item.url, options);
  const extracted = await extractBytes(source.bytes, source.contentType, source.finalUrl);
  if (source.finalUrl !== item.url) extracted.metadata.finalUrl = source.finalUrl;
  return extracted;
}

async function extractBytes(bytes: Uint8Array, mimeType: string, url: string): Promise<Extracted> {
  if (mimeType === 'application/pdf') return extractPdf(bytes);
  const text = Buffer.from(bytes).toString('utf8');
  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml' || (!mimeType && /<html[\s>]/i.test(text))) {
    return extractHtml(text, url);
  }
  if (isPlainText(mimeType)) return { title: '', content: text.slice(0, 1024 * 1024), metadata: {} };
  throw new IngestError(`Can't extract text from ${mimeType || 'this kind of file'} yet.`);
}
