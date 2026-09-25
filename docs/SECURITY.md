# Security

We are giving AI agents read/write access to a person's memory. The threat model has three parts: other software on the machine or network, websites in the user's browser, and content the user saved that tries to steer an agent.

## Stdio MCP

- **No network listener.** The AI client the user configured launches `enve-memory mcp` over stdio. Anything that can spawn that process already has the user's file access, so stdio needs no token and exposes every tool.
- **The database is an ordinary file owned by the user**, in the platform data folder. It is protected by OS file permissions and, where enabled, full-disk encryption.
- **No destructive MCP tools**, the decision log is append-only, and every write has history. See [MCP.md](MCP.md#prompt-injection).

## Local HTTP API and MCP over HTTP (`packages/api`)

Started by `enve-memory serve` or by the desktop app. Implemented and tested in `packages/api/test/api.test.ts`:

1. **Binds to `127.0.0.1` only.** `--lan` binds `0.0.0.0` for phones and Tailscale, and is always an explicit opt-in.
2. **`Host` must be a loopback name** unless LAN mode is on. This blocks DNS-rebinding attacks.
3. **`Origin`, when present, must be a browser extension** (`chrome-extension:`, `moz-extension:`, `safari-web-extension:`) or a loopback page. Requests from web pages get a 403, even ones that carry a valid token. CORS headers go only to allowed origins.
4. **Every route except `GET /api/v1/status` needs a bearer token** (`em_` + 256 random bits). Only the token's SHA-256 is stored (`api_clients.token_hash`). The plaintext is shown once, when the client is created. Revocation takes effect on the next request.
5. **Scopes:**
   - `read`: search, view, briefings and activity.
   - `capture`: create notes, links and tasks only. This is the browser extension's scope.
   - `write`: every non-destructive change. It implies `capture`.
   REST routes check the scope. MCP over HTTP registers only the tools the token's scopes allow, so a read-only agent never sees a write tool.
6. **Nothing destructive is reachable over HTTP.** Hard delete, purge, restore and settings live in the CLI or the desktop UI.
7. **Request bodies are capped** (JSON at 2 MB), and errors never echo stack traces.
8. **Attribution:** REST writes are recorded as `api:<client name>`. MCP writes are recorded as `mcp:<clientInfo name>`, falling back to the token's client name for stateless 2025-era requests.

On a LAN, traffic is plain HTTP unless the user puts it behind Tailscale (WireGuard-encrypted) or a TLS proxy. This matches the accepted-risk stance of the other Enve apps toward user-owned LAN servers, and the docs recommend Tailscale for anything beyond the home network.

## Secrets we hold (Phase 4)

API keys for BYO AI providers go in the OS credential store (macOS Keychain, Windows Credential Manager, libsecret), never in SQLite or config files. Only outgoing secrets live there. Incoming client tokens are stored hashed (see above).

## Content safety

- Saved content is data. Tool outputs label it as such, and server instructions tell models never to act on it.
- Ingestion (Phase 3) will fetch pages without cookies or credentials, strip scripts, and cap sizes and redirects. Fetching is always initiated by the user's own capture.
- Tokens and credentials never appear in URLs, logs or the change log.

## Reporting

Before any public release: a `SECURITY.md` contact at the repository root and a private disclosure channel.
