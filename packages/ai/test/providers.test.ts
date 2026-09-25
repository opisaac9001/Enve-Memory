import assert from 'node:assert/strict';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { AiError, createProvider, parseJsonReply } from '@enve-memory/ai';

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown> | null;
}

let seen: Seen[] = [];
let reply: (req: Seen) => { status?: number; body: unknown } = () => ({ body: {} });

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const request = { method: req.method!, path: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : null };
  seen.push(request);
  const { status = 200, body } = reply(request);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };

function expect(handler: typeof reply) {
  seen = [];
  reply = handler;
}

test('Anthropic: SDK request with structured output, low effort and server-side refusal fallbacks', async () => {
  expect(() => ({
    body: {
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 5, output_tokens: 3 },
    },
  }));
  const provider = createProvider({ provider: 'anthropic', model: '', apiKey: 'sk-test', baseUrl: base });
  assert.equal(provider.model, 'claude-opus-5');
  assert.equal(await provider.complete({ system: 'sys', prompt: 'hi', schema: SCHEMA }), '{"ok":true}');

  const [request] = seen;
  assert.equal(request!.path, '/v1/messages?beta=true');
  assert.equal(request!.headers['x-api-key'], 'sk-test');
  assert.match(String(request!.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.equal(request!.body!.fallbacks, 'default');
  assert.deepEqual(request!.body!.output_config, { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } });
  assert.equal(request!.body!.system, 'sys');
});

test('Anthropic: a refusal and a bad key become readable errors', async () => {
  const provider = createProvider({ provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-test', baseUrl: base });
  expect(() => ({
    body: {
      id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: 'refusal', stop_sequence: null,
      content: [], usage: { input_tokens: 5, output_tokens: 0 },
    },
  }));
  await assert.rejects(provider.complete({ system: 's', prompt: 'p' }), /declined/);
  expect(() => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
  await assert.rejects(provider.complete({ system: 's', prompt: 'p' }), /rejected the API key/);
});

test('OpenAI-compatible: chat completions with a JSON schema and bearer auth', async () => {
  expect((req) => req.path === '/v1/models'
    ? { body: { data: [{ id: 'model-b' }, { id: 'model-a' }] } }
    : { body: { choices: [{ message: { content: '{"ok":true}' } }] } });
  const provider = createProvider({ provider: 'openrouter', model: 'some/model', apiKey: 'or-key', baseUrl: `${base}/v1` });
  assert.equal(await provider.complete({ system: 'sys', prompt: 'hi', schema: SCHEMA }), '{"ok":true}');
  const [request] = seen;
  assert.equal(request!.path, '/v1/chat/completions');
  assert.equal(request!.headers.authorization, 'Bearer or-key');
  assert.deepEqual(request!.body!.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }]);
  assert.deepEqual(request!.body!.response_format, { type: 'json_schema', json_schema: { name: 'result', schema: SCHEMA, strict: true } });
  assert.deepEqual(await provider.listModels(), ['model-a', 'model-b']);
});

test('Ollama: native chat with format = schema, no key needed', async () => {
  expect((req) => req.path === '/api/tags'
    ? { body: { models: [{ name: 'qwen3:4b' }, { name: 'llama3.2:3b' }] } }
    : { body: { message: { role: 'assistant', content: '{"ok":true}' } } });
  const provider = createProvider({ provider: 'ollama', model: 'qwen3:4b', baseUrl: base });
  assert.equal(await provider.complete({ system: 's', prompt: 'p', schema: SCHEMA }), '{"ok":true}');
  assert.deepEqual(seen[0]!.body!.format, SCHEMA);
  assert.equal(seen[0]!.body!.stream, false);
  assert.deepEqual(seen[0]!.body!.options, { num_ctx: 5120, num_predict: 4096 });
  await provider.complete({ system: 's', prompt: 'x'.repeat(30_000), maxTokens: 1000 });
  assert.deepEqual(seen[1]!.body!.options, { num_ctx: 11264, num_predict: 1000 });
  assert.deepEqual(await provider.listModels(), ['llama3.2:3b', 'qwen3:4b']);
});

test('Gemini: generateContent with a JSON schema and the key in a header', async () => {
  expect((req) => req.path === '/models'
    ? { body: { models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed-y', supportedGenerationMethods: ['embedContent'] }] } }
    : { body: { candidates: [{ content: { parts: [{ text: '{"ok":' }, { text: 'true}' }] } }] } });
  const provider = createProvider({ provider: 'gemini', model: 'gemini-x', apiKey: 'g-key', baseUrl: base });
  assert.equal(await provider.complete({ system: 's', prompt: 'p', schema: SCHEMA }), '{"ok":true}');
  assert.equal(seen[0]!.path, '/models/gemini-x:generateContent');
  assert.equal(seen[0]!.headers['x-goog-api-key'], 'g-key');
  assert.equal((seen[0]!.body!.generationConfig as Record<string, unknown>).responseMimeType, 'application/json');
  assert.deepEqual(await provider.listModels(), ['gemini-x']);
});

test('reasoning models: thinking is stripped and structured output is read from reasoning_content', async () => {
  const provider = createProvider({ provider: 'openai-compatible', model: 'qwen', baseUrl: `${base}/v1` });
  expect(() => ({ body: { choices: [{ message: { content: '', reasoning_content: '{"ok":true}' } }] } }));
  assert.equal(await provider.complete({ system: 's', prompt: 'p', schema: SCHEMA }), '{"ok":true}');
  expect(() => ({ body: { choices: [{ message: { content: '<think>hmm</think>\nThe answer [1].' } }] } }));
  assert.equal(await provider.complete({ system: 's', prompt: 'p' }), 'The answer [1].');
});

test('configuration mistakes are explained up front', () => {
  assert.throws(() => createProvider({ provider: 'openai', model: 'x' }), /needs an API key \(set OPENAI_API_KEY\)/);
  assert.throws(() => createProvider({ provider: 'ollama', model: '' }), /Choose a model/);
  assert.throws(() => createProvider({ provider: 'none', model: '' }), AiError);
});

test('JSON replies are recovered from fences and prose', () => {
  assert.deepEqual(parseJsonReply('Sure!\n```json\n{"a": [1, {"b": 2}]}\n```\nDone.'), { a: [1, { b: 2 }] });
  assert.throws(() => parseJsonReply('no json here'), /did not return JSON/);
});
