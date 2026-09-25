import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ApiError,
  DEFAULT_SERVER_URL,
  buildCapturePayload,
  canCapture,
  createClient,
  describeError,
  isCapturableUrl,
  isLoopback,
  normalizeServerUrl,
  originPattern,
  parseTags,
  toApiError,
} from '../src/lib/api.js';

describe('server URLs and permissions', () => {
  test('normalizeServerUrl keeps only the origin and defaults to http', () => {
    assert.equal(normalizeServerUrl(' http://127.0.0.1:49231/ '), 'http://127.0.0.1:49231');
    assert.equal(normalizeServerUrl('localhost:49231/api/v1'), 'http://localhost:49231');
    assert.equal(normalizeServerUrl('https://memory.tail1234.ts.net'), 'https://memory.tail1234.ts.net');
    assert.equal(normalizeServerUrl('HTTP://Desk.local:8080'), 'http://desk.local:8080');
  });

  test('normalizeServerUrl rejects empty, malformed and non-http input', () => {
    for (const input of ['', '   ', undefined, 'http://', 'ftp://host', 'file:///etc', 'chrome-extension://abc']) {
      assert.equal(normalizeServerUrl(input), null, String(input));
    }
  });

  test('isLoopback recognises every loopback name the server accepts', () => {
    assert.ok(isLoopback(DEFAULT_SERVER_URL));
    assert.ok(isLoopback('http://localhost:49231'));
    assert.ok(isLoopback('http://[::1]:49231'));
    assert.ok(!isLoopback('http://192.168.1.20:49231'));
    assert.ok(!isLoopback('https://memory.tail1234.ts.net'));
  });

  test('originPattern drops the port so it matches the manifest host permissions', () => {
    assert.equal(originPattern('http://127.0.0.1:49231'), 'http://127.0.0.1/*');
    assert.equal(originPattern('http://localhost:1234'), 'http://localhost/*');
    assert.equal(originPattern('https://memory.tail1234.ts.net'), 'https://memory.tail1234.ts.net/*');
    assert.equal(originPattern('http://[::1]:49231'), 'http://[::1]/*');
  });
});

describe('capture payloads', () => {
  test('isCapturableUrl accepts only web pages', () => {
    assert.ok(isCapturableUrl('https://example.com/a'));
    assert.ok(isCapturableUrl('http://127.0.0.1:8080/'));
    for (const url of ['chrome://newtab/', 'about:blank', 'file:///Users/me/a.html', 'moz-extension://x/popup.html', '', undefined]) {
      assert.ok(!isCapturableUrl(url), String(url));
    }
  });

  test('parseTags splits on commas, strips #, trims and dedupes case-insensitively', () => {
    assert.deepEqual(parseTags(' esp32, #Bench Rig ,,esp32, ##ESP32 , garage'), ['esp32', 'Bench Rig', 'garage']);
    assert.deepEqual(parseTags(''), []);
    assert.deepEqual(parseTags(undefined), []);
  });

  test('buildCapturePayload sends a full bookmark', () => {
    assert.deepEqual(
      buildCapturePayload({
        url: 'https://example.com/doc',
        title: '  Security+ 2.0  ',
        selection: 'line one\nline two',
        note: ' read this ',
        project: 'proj-id',
        tags: ['esp32', 'bench', 'ESP32'],
      }),
      {
        url: 'https://example.com/doc',
        title: 'Security+ 2.0',
        selection: 'line one\nline two',
        note: 'read this',
        project: 'proj-id',
        tags: ['esp32', 'bench'],
      },
    );
  });

  test('buildCapturePayload drops empty fields and accepts a comma string of tags', () => {
    assert.deepEqual(buildCapturePayload({ url: 'https://a.test/', title: ' ', selection: ' \n ', note: '', project: '', tags: 'x, y' }), {
      url: 'https://a.test/',
      tags: ['x', 'y'],
    });
    assert.deepEqual(buildCapturePayload(), {});
  });

  test('buildCapturePayload turns an unbookmarkable page into a note', () => {
    assert.deepEqual(buildCapturePayload({ url: 'chrome://settings/', title: 'Settings', note: 'remember this' }), {
      title: 'Settings',
      note: 'remember this',
    });
  });

  test('canCapture honours write implying capture', () => {
    assert.ok(canCapture(['read', 'capture']));
    assert.ok(canCapture(['write']));
    assert.ok(!canCapture(['read']));
  });
});

describe('errors', () => {
  test('toApiError keeps the server error shape', () => {
    const error = toApiError(403, { error: { code: 'insufficient_scope', message: 'This client lacks the "capture" scope.' } });
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'insufficient_scope');
    assert.equal(error.status, 403);
  });

  test('toApiError falls back for unexpected bodies', () => {
    for (const body of [undefined, 'Not Found', { error: 'nope' }, {}]) {
      const error = toApiError(404, body);
      assert.equal(error.code, 'bad_response');
      assert.match(error.message, /HTTP 404/);
    }
  });

  test('describeError gives the next step for each failure', () => {
    const url = 'http://127.0.0.1:49231';
    const cases = [
      [new ApiError('offline', ''), /Can't reach Enve Memory at http:\/\/127\.0\.0\.1:49231\. Start Enve Memory or run `enve-memory serve`/],
      [new ApiError('timeout', ''), /didn't answer in time/],
      [new ApiError('not_enve', ''), /Something other than Enve Memory/],
      [new ApiError('unauthorized', 'x', 401), /`enve-memory clients add "Browser" --scope read,capture`/],
      [new ApiError('insufficient_scope', 'This client lacks the "capture" scope.', 403), /lacks the "capture" scope\. Create a token/],
      [new ApiError('forbidden_host', 'x', 403), /--lan/],
      [new ApiError('forbidden_origin', 'x', 403), /refused this browser extension/],
      [new ApiError('too_large', 'x', 413), /shorter selection/],
      [new ApiError('not_found', 'No project matches "garage".', 404), /^No project matches "garage"\.$/],
      [new ApiError('internal', 'Internal error.', 500), /internal error/],
      [new ApiError('bad_response', 'Unexpected response (HTTP 418).', 418), /HTTP 418/],
    ];
    for (const [error, pattern] of cases) assert.match(describeError(error, url), pattern, error.code);
    assert.match(describeError(new TypeError('boom')), /Something went wrong/);
  });
});

describe('client over a fake fetch', () => {
  const respond = (status, body) => async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  test('sends the bearer token, JSON body and API prefix', async () => {
    const calls = [];
    const client = createClient({
      serverUrl: 'http://127.0.0.1:1',
      token: 'em_secret',
      fetch: async (url, init) => {
        calls.push({ url, init });
        return respond(201, { item: { id: 'i1' }, created: true })();
      },
    });
    const result = await client.capture({ url: 'https://a.test/' });
    assert.deepEqual(result, { item: { id: 'i1' }, created: true });
    assert.equal(calls[0].url, 'http://127.0.0.1:1/api/v1/capture');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer em_secret');
    assert.equal(calls[0].init.body, '{"url":"https://a.test/"}');
    assert.equal(calls[0].init.credentials, 'omit');
  });

  test('status is unauthenticated and lookup encodes the URL', async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, init });
      return url.endsWith('/status') ? respond(200, { name: 'enve-memory', version: '0.1.0', api: 1 })() : respond(200, { item: null })();
    };
    const client = createClient({ serverUrl: 'http://127.0.0.1:1', token: 'em_x', fetch });
    await client.status();
    assert.equal(await client.lookup('https://a.test/?q=1&b=2#x'), null);
    assert.equal(calls[0].init.headers.Authorization, undefined);
    assert.equal(calls[1].url, 'http://127.0.0.1:1/api/v1/lookup?url=https%3A%2F%2Fa.test%2F%3Fq%3D1%26b%3D2%23x');
  });

  test('maps network failures, timeouts and foreign servers', async () => {
    const offline = createClient({ serverUrl: 'http://127.0.0.1:1', token: 't', fetch: async () => { throw new TypeError('Failed to fetch'); } });
    await assert.rejects(offline.whoami(), { code: 'offline' });

    const slow = createClient({
      serverUrl: 'http://127.0.0.1:1',
      token: 't',
      timeoutMs: 10,
      fetch: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    });
    await assert.rejects(slow.projects(), { code: 'timeout' });

    const html = createClient({ serverUrl: 'http://127.0.0.1:1', token: 't', fetch: respond(200, '<!doctype html>') });
    await assert.rejects(html.status(), { code: 'not_enve' });
    const other = createClient({ serverUrl: 'http://127.0.0.1:1', token: 't', fetch: respond(200, { name: 'something-else' }) });
    await assert.rejects(other.status(), { code: 'not_enve' });
    const missing = createClient({ serverUrl: 'http://127.0.0.1:1', token: 't', fetch: respond(404, 'Not Found') });
    await assert.rejects(missing.status(), { code: 'not_enve' });
  });

  test('surfaces server errors as ApiError', async () => {
    const client = createClient({
      serverUrl: 'http://127.0.0.1:1',
      token: 't',
      fetch: respond(401, { error: { code: 'unauthorized', message: 'A valid bearer token is required.' } }),
    });
    await assert.rejects(client.whoami(), (error) => error instanceof ApiError && error.code === 'unauthorized' && error.status === 401);
  });
});
