export const DEFAULT_SERVER_URL = 'http://127.0.0.1:49231';
export const TOKEN_COMMAND = 'enve-memory clients add "Browser" --scope read,capture';
export const SERVE_COMMAND = 'enve-memory serve';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const REQUEST_TIMEOUT_MS = 8000;

/** `code` is the server's error code, or `offline` / `timeout` / `not_enve` / `bad_response` for client-side failures. */
export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** Returns the origin for a user-typed server URL (scheme optional), or null when it isn't usable. */
export function normalizeServerUrl(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isLoopback(serverUrl) {
  return LOOPBACK_HOSTS.has(new URL(serverUrl).hostname);
}

/** Host-permission match pattern for a server. Match patterns ignore the port, so one grant covers every port on that host. */
export function originPattern(serverUrl) {
  const { protocol, hostname } = new URL(serverUrl);
  return `${protocol}//${hostname}/*`;
}

/** Only web pages make useful bookmarks; anything else (chrome://, about:, file:) is captured as a note. */
export function isCapturableUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

export function parseTags(input) {
  const seen = new Set();
  const tags = [];
  for (const raw of String(input ?? '').split(',')) {
    const tag = raw.trim().replace(/^#+/, '').trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

/** `write` implies `capture`, matching the server's scope check. */
export function canCapture(scopes) {
  return scopes.includes('capture') || scopes.includes('write');
}

/** Builds a `/capture` body, dropping empty fields so the server applies its own defaults. */
export function buildCapturePayload({ url, title, selection, note, project, tags } = {}) {
  const payload = {};
  if (isCapturableUrl(url)) payload.url = url;
  const trimmedTitle = title?.trim();
  if (trimmedTitle) payload.title = trimmedTitle;
  if (selection?.trim()) payload.selection = selection;
  const trimmedNote = note?.trim();
  if (trimmedNote) payload.note = trimmedNote;
  if (project) payload.project = project;
  const tagList = Array.isArray(tags) ? parseTags(tags.join(',')) : parseTags(tags);
  if (tagList.length) payload.tags = tagList;
  return payload;
}

/** Maps a non-2xx response to an ApiError, keeping the server's `{error:{code,message}}` when present. */
export function toApiError(status, body) {
  const code = body?.error?.code;
  const message = body?.error?.message;
  if (typeof code === 'string' && typeof message === 'string') return new ApiError(code, message, status);
  return new ApiError('bad_response', `Unexpected response (HTTP ${status}).`, status);
}

/** A human message for any failure, with the next step to take. */
export function describeError(error, serverUrl = DEFAULT_SERVER_URL) {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  switch (error.code) {
    case 'offline':
      return `Can't reach Enve Memory at ${serverUrl}. Start Enve Memory or run \`${SERVE_COMMAND}\`.`;
    case 'timeout':
      return `Enve Memory at ${serverUrl} didn't answer in time. Check that it's running.`;
    case 'not_enve':
      return `Something other than Enve Memory is answering at ${serverUrl}. Check the server URL.`;
    case 'unauthorized':
      return `The token was rejected. Create one with \`${TOKEN_COMMAND}\` and paste it in Settings.`;
    case 'insufficient_scope':
      return `${error.message} Create a token with \`${TOKEN_COMMAND}\`.`;
    case 'forbidden_host':
      return `Enve Memory only accepts localhost connections. To connect from another address, run \`${SERVE_COMMAND} --lan\`.`;
    case 'forbidden_origin':
      return 'Enve Memory refused this browser extension. Update Enve Memory and try again.';
    case 'too_large':
      return 'That is too much to save at once. Try a shorter selection.';
    case 'invalid':
    case 'not_found':
    case 'conflict':
      return error.message;
    default:
      return error.status >= 500
        ? 'Enve Memory hit an internal error. Try again, and check its logs if it keeps happening.'
        : error.message;
  }
}

export function createClient({ serverUrl, token, fetch = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  async function request(method, path, { body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(`${serverUrl}/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') throw new ApiError('timeout', 'Request timed out.');
      throw new ApiError('offline', 'Could not connect.');
    }
    const data = await response.json().catch(() => undefined);
    if (!response.ok) throw toApiError(response.status, data);
    if (data === undefined) throw new ApiError('bad_response', 'Response was not JSON.', response.status);
    return data;
  }

  return {
    async status() {
      const data = await request('GET', '/status', { auth: false }).catch((error) => {
        throw error.code === 'bad_response' ? new ApiError('not_enve', error.message, error.status) : error;
      });
      if (data?.name !== 'enve-memory') throw new ApiError('not_enve', 'Not an Enve Memory server.');
      return data;
    },
    whoami: () => request('GET', '/whoami'),
    projects: () => request('GET', '/projects'),
    lookup: async (url) => (await request('GET', `/lookup?url=${encodeURIComponent(url)}`)).item,
    capture: (payload) => request('POST', '/capture', { body: payload }),
  };
}
