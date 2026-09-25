export class IngestError extends Error {}

export interface FetchedSource {
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; EnveMemory/0.1; +https://envemedia.com)';
// Cloud metadata endpoints; nothing a person bookmarks lives here.
const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', '[fd00:ec2::254]']);

/** Plain GET without cookies or credentials, with a time and size budget. */
export async function fetchSource(url: string, { timeoutMs = 15_000, maxBytes = 15 * 1024 * 1024 }: FetchOptions = {}): Promise<FetchedSource> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new IngestError(`Only http and https links can be fetched.`);
  if (BLOCKED_HOSTS.has(parsed.hostname)) throw new IngestError(`${parsed.hostname} is not fetchable.`);

  let response: Response;
  try {
    response = await fetch(parsed, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = (error as Error).name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000}s` : (error as Error).message;
    throw new IngestError(`Couldn't reach ${parsed.host}: ${reason}.`);
  }
  if (!response.ok) throw new IngestError(`${parsed.host} answered ${response.status}.`);
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new IngestError('The page is too large to archive.');

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  for (let chunk = await reader?.read(); chunk && !chunk.done; chunk = await reader?.read()) {
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader?.cancel();
      throw new IngestError('The page is too large to archive.');
    }
    chunks.push(chunk.value);
  }
  return {
    finalUrl: response.url || parsed.href,
    contentType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(),
    bytes: Buffer.concat(chunks),
  };
}
