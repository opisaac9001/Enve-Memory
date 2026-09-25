import { createReadStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type ApiClient, type ClientScope, DrainWorker, type EnveMemory, INTENTS, MemoryError, parseWhen } from '@enve-memory/core';
import { processPending } from '@enve-memory/ingestion';
import { createServer as createMcpServer } from '@enve-memory/mcp';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { type AuthInfo, createMcpHandler } from '@modelcontextprotocol/server';
import { HttpError } from './errors.ts';
import { type Route, routes } from './routes.ts';

export const DEFAULT_PORT = 49231;
const MAX_JSON_BODY = 2 * 1024 * 1024;
const MAX_FILE_BODY = 200 * 1024 * 1024;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const EXTENSION_PROTOCOLS = new Set(['chrome-extension:', 'moz-extension:', 'safari-web-extension:']);

export interface ApiServerOptions {
  version: string;
  port?: number;
  /** Accept connections from other devices (phone, Tailscale). Tokens are still required. */
  lan?: boolean;
  /** Called after every write and every finished ingestion pass, e.g. to kick the embedding indexer. */
  afterWrite?: () => void;
}

export interface ApiServer {
  readonly server: Server;
  readonly ingest: DrainWorker;
  listen(): Promise<string>;
  close(): Promise<void>;
}

const STATUS_FOR: Record<MemoryError['code'], number> = { not_found: 404, invalid: 400, conflict: 409, schema: 500, locked: 423 };

export function createApiServer(memory: EnveMemory, options: ApiServerOptions): ApiServer {
  const inFlight = new Set<string>();
  const ingest = new DrainWorker('ingest', () => processPending(memory), options.afterWrite);
  const changed = () => {
    ingest.kick();
    options.afterWrite?.();
  };
  const mcp = createMcpHandler((ctx) => {
    const auth = ctx.authInfo!;
    return createMcpServer(memory, options.version, {
      scopes: auth.scopes as ClientScope[],
      transport: 'http',
      clientName: auth.extra?.name as string,
    });
  });
  const mcpNode = toNodeHandler(mcp, { onerror: (error) => console.error('mcp:', error) });

  const server = createServer(async (req, res) => {
    try {
      const origin = checkOrigin(req, options.lan ?? false);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, Mcp-Session-Id, Mcp-Protocol-Version, X-Filename, X-Title, X-Note, X-Project, X-Tags, X-Remind, X-Intent, X-Pinned',
          'Access-Control-Max-Age': '600',
        });
        return res.end();
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/v1/status' && req.method === 'GET') {
        return send(res, 200, { name: 'enve-memory', version: options.version, api: 1 });
      }

      const client = authenticate(memory, req);
      if (url.pathname === '/mcp') {
        (req as IncomingMessage & { auth?: AuthInfo }).auth = {
          token: '', clientId: client.id, scopes: client.scopes, extra: { name: client.name },
        };
        return await mcpNode(req, res);
      }

      const rawKey = req.method === 'GET' || req.method === 'HEAD' ? undefined : idempotencyKeyOf(req);
      // Bound to the method and path, so one key can't replay a different endpoint's answer.
      const idempotencyKey = rawKey && `${req.method} ${url.pathname} ${rawKey}`;
      // A client retrying after a lost response gets the original answer instead of a second copy.
      const replay = idempotencyKey ? memory.clients.recall(client.id, idempotencyKey) : null;
      const inFlightKey = idempotencyKey && `${client.id} ${idempotencyKey}`;
      if (inFlightKey && !replay) {
        if (inFlight.has(inFlightKey)) throw new HttpError(409, 'in_progress', 'A request with this Idempotency-Key is still being processed.');
        inFlight.add(inFlightKey);
        res.once('close', () => inFlight.delete(inFlightKey));
      }
      const respond = (status: number, result: unknown) => {
        if (idempotencyKey && status < 300) memory.clients.remember(client.id, idempotencyKey, status, JSON.stringify(result));
        send(res, status, result);
      };

      if (url.pathname === '/api/v1/files' && req.method === 'POST') {
        requireScope(client, 'capture');
        if (replay) return replayResponse(res, replay);
        const data = await readBody(req, MAX_FILE_BODY);
        const remind = header(req, 'x-remind');
        const intent = header(req, 'x-intent');
        // Checked before anything is saved, so a bad header never leaves a half-applied upload behind.
        if (remind) parseWhen(remind);
        if (intent && !(INTENTS as readonly string[]).includes(intent)) throw new HttpError(400, 'invalid', `X-Intent must be one of ${INTENTS.join(', ')}.`);
        const result = memory.withActor(`api:${client.name}`, () => {
          const saved = memory.files.save({
          data,
          filename: header(req, 'x-filename') ?? '',
          mimeType: req.headers['content-type'],
          title: header(req, 'x-title'),
          note: header(req, 'x-note'),
          project: header(req, 'x-project'),
          tags: header(req, 'x-tags')?.split(',').map((t) => t.trim()).filter(Boolean),
          });
          if (remind) memory.items.setReminder(saved.item.id, remind);
          if (intent) memory.items.setIntent(saved.item.id, intent);
          if (header(req, 'x-pinned') === 'true') memory.items.pin(saved.item.id, true);
          return remind || intent || header(req, 'x-pinned') === 'true' ? { item: memory.items.get(saved.item.id), created: saved.created } : saved;
        });
        changed();
        return respond(201, result);
      }
      const download = /^\/api\/v1\/items\/([^/]+)\/file$/.exec(url.pathname);
      if (download && (req.method === 'GET' || req.method === 'HEAD')) {
        requireScope(client, 'read');
        const { attachment, path } = memory.files.primary(decodePart(download[1]!));
        // An attachment row can arrive through sync before its bytes do.
        if (!existsSync(path)) throw new HttpError(404, 'not_found', "This file's contents haven't arrived on this device yet.");
        res.writeHead(200, {
          'Content-Type': attachment.mimeType,
          'Content-Length': attachment.size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=31536000, immutable',
        });
        if (req.method === 'HEAD') return void res.end();
        return void pipeline(createReadStream(path), res, (error) => {
          if (error) res.destroy();
        });
      }

      const match = matchRoute(req.method ?? 'GET', url.pathname);
      if (!match) throw new HttpError(404, 'not_found', `No route for ${req.method} ${url.pathname}.`);
      if (match.route.scope) requireScope(client, match.route.scope);
      if (replay) return replayResponse(res, replay);
      const body = req.method === 'GET' ? undefined : await readJson(req);
      const route = match.route;
      const result = await memory.withActor(`api:${client.name}`, () =>
        route.handle({ memory, client, params: match.params, query: url.searchParams, body }));
      if (req.method !== 'GET') changed();
      respond(match.route.status ?? 200, result);
    } catch (error) {
      sendError(res, error);
    }
  });

  return {
    server,
    ingest,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? DEFAULT_PORT, options.lan ? '0.0.0.0' : '127.0.0.1', () => {
          const { port } = server.address() as AddressInfo;
          resolve(`http://127.0.0.1:${port}`);
        });
      }),
    close: async () => {
      await ingest.idle();
      await mcp.close();
      if (!server.listening) return;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

/** Blocks DNS rebinding (Host) and cross-site requests from web pages (Origin). Returns an origin to echo for CORS. */
function checkOrigin(req: IncomingMessage, lan: boolean): string | undefined {
  const host = req.headers.host?.replace(/:\d+$/, '') ?? '';
  if (!lan && !LOOPBACK_HOSTS.has(host)) throw new HttpError(403, 'forbidden_host', 'Requests must be addressed to localhost.');
  const origin = req.headers.origin;
  if (!origin) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(403, 'forbidden_origin', 'Invalid Origin header.');
  }
  const loopbackPage = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && LOOPBACK_HOSTS.has(parsed.hostname === '::1' ? '[::1]' : parsed.hostname);
  if (!EXTENSION_PROTOCOLS.has(parsed.protocol) && !loopbackPage) {
    throw new HttpError(403, 'forbidden_origin', 'Web pages cannot call the Enve Memory API.');
  }
  return origin;
}

function authenticate(memory: EnveMemory, req: IncomingMessage): ApiClient {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const client = token ? memory.clients.authenticate(token) : null;
  if (!client) throw new HttpError(401, 'unauthorized', 'A valid bearer token is required. Create one with `enve-memory clients add`.');
  return client;
}

function requireScope(client: ApiClient, scope: ClientScope): void {
  const ok = client.scopes.includes(scope) || (scope === 'capture' && client.scopes.includes('write'));
  if (!ok) throw new HttpError(403, 'insufficient_scope', `This client lacks the "${scope}" scope.`);
}

function matchRoute(method: string, path: string): { route: Route; params: string[] } | undefined {
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(path);
    if (m) return { route, params: m.slice(1).map(decodePart) };
  }
  return undefined;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'too_large', 'Request body is too large.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** File metadata travels in headers, percent-encoded so any UTF-8 survives. */
function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value !== 'string' || !value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'invalid', `Header ${name} must be percent-encoded UTF-8.`);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req, MAX_JSON_BODY);
  if (raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object.');
  }
}

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new HttpError(400, 'invalid', 'Malformed percent-encoding in the path.');
  }
}

function idempotencyKeyOf(req: IncomingMessage): string | undefined {
  const value = req.headers['idempotency-key'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new HttpError(400, 'invalid', 'Idempotency-Key must be 1–128 characters.');
  }
  return value.trim();
}

function replayResponse(res: ServerResponse, stored: { status: number; body: string }): void {
  res.writeHead(stored.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Idempotent-Replayed': 'true' });
  res.end(stored.body);
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) return void res.end();
  if (error instanceof HttpError) {
    if (error.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    return send(res, error.status, { error: { code: error.code, message: error.message } });
  }
  if (error instanceof MemoryError) {
    return send(res, STATUS_FOR[error.code], { error: { code: error.code, message: error.message } });
  }
  console.error(error);
  send(res, 500, { error: { code: 'internal', message: 'Internal error.' } });
}
