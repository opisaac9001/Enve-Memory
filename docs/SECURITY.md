# Security

We are giving AI agents read/write access to a person's memory. The threat model has three parts: other software on the machine or network, websites in the user's browser, and content the user saved that tries to steer an agent.

## Today (stdio only)

- **No network listener.** MCP runs over stdio, launched by the client the user configured. Whoever can spawn the process already has the user's file access, so stdio needs no tokens.
- **The database is an ordinary user-owned file** in the platform data folder. It is protected by OS file permissions and, where the user has it, full-disk encryption.
- **No destructive MCP tools**, the append-only decision log, and history for every write. See [MCP.md](MCP.md#prompt-injection).

## HTTP API and MCP-over-HTTP (Phase 2): requirements

1. **Bind `127.0.0.1` only** by default, never `0.0.0.0`. LAN or Tailscale access is an explicit opt-in.
2. **Reject DNS rebinding and browser CSRF.** Any website can make the user's browser send requests to `127.0.0.1`. Validate `Host` against the loopback allowlist and `Origin` against an allowlist (the extension's origin, no origin for native clients) on every request. Reject preflighted cross-origin requests from unknown origins. The SDK ships `validateHostHeader` / `validateOriginHeader` / `localhostAllowedHostnames` for this.
3. **A bearer token per client** (`em_…`, 256-bit random). The server stores only a SHA-256 hash of each token in `api_clients`, like a password, so the database never holds a usable credential. The user sees the plaintext once, when connecting the client.
4. **Per-client scopes**: `search`, `read`, `write:capture` (save only), `write` (edit, tasks, memory, decisions), `admin`. Examples: the browser extension gets `write:capture`, and a third-party client can be search-only. The UI lists clients with last-used time, and revoking one is immediate.
5. **Destructive operations are never granted to a token.** Delete, purge, restore-from-backup and settings changes happen in the desktop UI, or go through an MCP elicitation (`input_required`) that the user confirms.
6. **Rate limiting and body size limits** on the local server.

## Secrets we hold (Phase 4)

API keys for BYO AI providers go in the OS credential store (macOS Keychain, Windows Credential Manager, libsecret), never in SQLite or config files. Only outgoing secrets live there. Incoming client tokens are stored hashed (see above).

## Content safety

- Saved content is data. Tool outputs label it as such, and server instructions tell models never to act on it.
- Ingestion (Phase 3) will fetch pages without cookies or credentials, strip scripts, and cap sizes and redirects. Fetching is always initiated by the user's own capture.
- Tokens and credentials never appear in URLs, logs or the change log.

## Reporting

Before any public release: a `SECURITY.md` contact at the repository root and a private disclosure channel.
