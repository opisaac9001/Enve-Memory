import { createHash, randomBytes } from 'node:crypto';
import { type Context, newId, oneOf, required } from './context.ts';
import { invalid, notFound } from './errors.ts';
import { CLIENT_SCOPES, type ApiClient, type ClientScope } from './types.ts';

interface ClientRow {
  id: string;
  name: string;
  token_hash: string;
  token_hint: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const TOKEN_PREFIX = 'em_';
const LAST_USED_RESOLUTION_MS = 60_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const toClient = (row: ClientRow): ApiClient => ({
  id: row.id,
  name: row.name,
  tokenHint: row.token_hint,
  scopes: JSON.parse(row.scopes) as ClientScope[],
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
});

/** Credentials for local HTTP clients (browser extension, phone, remote MCP clients). */
export class ClientService {
  private readonly ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  /** The plaintext token is returned exactly once and never stored. */
  create(name: string, scopes: string[]): { client: ApiClient; token: string } {
    const clientName = required(name, 'Client name');
    if (scopes.length === 0) throw invalid(`A client needs at least one scope: ${CLIENT_SCOPES.join(', ')}.`);
    const validScopes = [...new Set(scopes.map((s) => oneOf(s, CLIENT_SCOPES, 'scope')))];
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const id = newId();
    this.ctx.run(
      `INSERT INTO api_clients (id, name, token_hash, token_hint, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      id, clientName, hashToken(token), `${token.slice(0, 7)}…`, JSON.stringify(validScopes), this.ctx.now(),
    );
    return { client: this.get(id), token };
  }

  list(): ApiClient[] {
    return this.ctx.all<ClientRow>(`SELECT * FROM api_clients ORDER BY created_at`).map(toClient);
  }

  get(id: string): ApiClient {
    const row = this.ctx.get<ClientRow>(`SELECT * FROM api_clients WHERE id = ?`, id);
    if (!row) throw notFound(`No client with id "${id}".`);
    return toClient(row);
  }

  revoke(id: string): ApiClient {
    const client = this.get(id);
    if (!client.revokedAt) this.ctx.run(`UPDATE api_clients SET revoked_at = ? WHERE id = ?`, this.ctx.now(), id);
    return this.get(id);
  }

  /** Returns the active client for a bearer token, or null. */
  authenticate(token: string): ApiClient | null {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    const row = this.ctx.get<ClientRow>(`SELECT * FROM api_clients WHERE token_hash = ?`, hashToken(token));
    if (!row || row.revoked_at) return null;
    const now = Date.now();
    if (!row.last_used_at || now - Date.parse(row.last_used_at) > LAST_USED_RESOLUTION_MS) {
      this.ctx.run(`UPDATE api_clients SET last_used_at = ? WHERE id = ?`, new Date(now).toISOString(), row.id);
    }
    return toClient(row);
  }
}
