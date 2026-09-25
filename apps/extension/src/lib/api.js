export const DEFAULT_SERVER_URL = 'http://127.0.0.1:49231';
export const TOKEN_COMMAND = 'enve-memory clients add "Browser" --scope read,capture';
export const SERVE_COMMAND = 'enve-memory serve';

export const INTENTS = ['read', 'watch', 'buy', 'revisit'];

const RETRYABLE = new Set(['offline', 'timeout', 'locked', 'in_progress']);
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

/** Failures worth retrying later with the same Idempotency-Key: the server is away, busy, or still handling the first try. */
export function isRetryable(error) {
  return error instanceof ApiError && RETRYABLE.has(error.code);
}

/** Builds a `/capture` body, dropping empty fields so the server applies its own defaults. */
export function buildCapturePayload({ url, title, selection, note, project, tags, intent, remind, pinned, createdAt } = {}) {
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
  if (INTENTS.includes(intent)) payload.intent = intent;
  if (remind) payload.remind = remind;
  if (pinned) payload.pinned = true;
  if (createdAt) payload.createdAt = createdAt;
  return payload;
}

/** Query string from a params object, skipping empty values. */
export function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
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
    case 'locked':
      return 'Enve Memory is busy with an import or restore. Try again in a moment.';
    case 'in_progress':
      return 'Enve Memory is still handling this save. Try again in a moment.';
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
  async function request(method, path, { body, auth = true, idempotencyKey } = {}) {
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
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

  const item = (id, action) => `/items/${encodeURIComponent(id)}/${action}`;

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
    item: (id) => request('GET', `/items/${encodeURIComponent(id)}`),
    lookup: async (url) => (await request('GET', `/lookup${queryString({ url })}`)).item,
    related: (url, q, limit = 6) => request('GET', `/related${queryString({ url, q, limit })}`),
    search: (q, { project, limit = 20 } = {}) => request('GET', `/search${queryString({ q, project, limit })}`),
    /** Shelves: `{pinned, intent, unopened, reminders, project, limit}`. */
    items: (filter = {}) => request('GET', `/items${queryString(filter)}`),
    dueReminders: () => request('GET', '/reminders?due=true'),
    capture: (payload, { idempotencyKey } = {}) => request('POST', '/capture', { body: payload, idempotencyKey }),
    captureBatch: (items, { idempotencyKey } = {}) => request('POST', '/capture/batch', { body: { items }, idempotencyKey }),
    opened: (id) => request('POST', item(id, 'opened')),
    reminded: (id) => request('POST', item(id, 'reminded')),
    pin: (id, pinned) => request('POST', item(id, 'pin'), { body: { pinned } }),
    setIntent: (id, intent) => request('PUT', item(id, 'intent'), { body: { intent } }),
    setReminder: (id, at) => request('PUT', item(id, 'reminder'), { body: { at } }),
    accept: (id) => request('POST', item(id, 'accept')),
  };
}
