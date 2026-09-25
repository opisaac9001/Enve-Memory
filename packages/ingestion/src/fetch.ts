import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

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
const MAX_REDIRECTS = 5;

// Link-local ranges hold cloud metadata endpoints and nothing a person bookmarks. Pages on the user's own network
// stay fetchable on purpose (see SECURITY.md).
const LINK_LOCAL = new BlockList();
LINK_LOCAL.addSubnet('169.254.0.0', 16, 'ipv4');
LINK_LOCAL.addSubnet('fe80::', 10, 'ipv6');
LINK_LOCAL.addAddress('fd00:ec2::254', 'ipv6');
const BLOCKED_NAMES = new Set(['metadata.google.internal', 'metadata']);

/** Checks the scheme and every address the host resolves to; runs again on each redirect hop. */
async function assertFetchable(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new IngestError('Only http and https links can be fetched.');
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (BLOCKED_NAMES.has(host)) throw new IngestError(`${host} is not fetchable.`);
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new IngestError(`Couldn't find ${host}.`);
  }
  if (addresses.some((address) => LINK_LOCAL.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4'))) {
    throw new IngestError(`${host} is not fetchable.`);
  }
}

/** Plain GET without cookies or credentials, with a time and size budget. Redirects are followed by hand so each hop is checked. */
export async function fetchSource(url: string, { timeoutMs = 15_000, maxBytes = 15 * 1024 * 1024 }: FetchOptions = {}): Promise<FetchedSource> {
  let current = new URL(url);
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response | undefined;
  for (let hop = 0; ; hop++) {
    await assertFetchable(current);
    try {
      response = await fetch(current, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8' },
        redirect: 'manual',
        credentials: 'omit',
        signal,
      });
    } catch (error) {
      const reason = (error as Error).name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000}s` : (error as Error).message;
      throw new IngestError(`Couldn't reach ${current.host}: ${reason}.`);
    }
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) break;
    await response.body?.cancel();
    if (hop === MAX_REDIRECTS) throw new IngestError('Too many redirects.');
    current = new URL(location, current);
  }
  const parsed = current;
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
    finalUrl: parsed.href,
    contentType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(),
    bytes: Buffer.concat(chunks),
  };
}
