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

On a LAN, traffic is plain HTTP unless the user puts it behind Tailscale (WireGuard-encrypted) or a TLS proxy. Use Tailscale for anything beyond the home network.

## The sync folder is untrusted input

Another machine writes to the shared folder, and so does anyone who can reach it. Every record is shape-checked before it's applied:

- ids, device ids and clock stamps must match strict patterns
- attachment hashes must be 64 hex characters
- filenames must be bare names
- project slugs must be canonical

Each record applies under its own savepoint, so a malformed one is counted as `rejected` and skipped rather than blocking sync. Fetched blobs are re-hashed and must match their name. With encryption, each file's name is bound in as GCM associated data, so sealed files can't be swapped between names. `blobPath` refuses anything that isn't a hash, and export re-derives slugs and filenames, so no value from the folder can reach a path outside the library or the export.

## Secrets

The desktop app encrypts API keys for BYO AI providers with Electron's `safeStorage` (macOS Keychain, Windows DPAPI, libsecret) into `desktop-secrets.json` (mode 0600) in the library folder. If the OS has no credential store, the key isn't saved. The CLI reads keys from environment variables. Keys never go into SQLite, so backups, exports and sync never carry them. Incoming client tokens are stored hashed (see above).

## Content safety

- Saved content is data. Tool outputs label it as such, and server instructions tell models never to act on it.
- Ingestion fetches with no cookies or credentials, a 15 s timeout and a 15 MB cap, and never executes page scripts (linkedom parses, it doesn't run). The result is stored as `content`, apart from the user's `body`.
- It follows redirects by hand, at most 5. Before every hop it resolves the host and refuses link-local addresses (`169.254.0.0/16`, `fe80::/10`, including IPv4-mapped forms) and known metadata names. That blocks cloud-metadata endpoints even through a redirect or a DNS name. A DNS answer that changes between the check and the connection (rebinding) isn't covered.
- A token with `capture` can make this machine fetch a URL, and with `read` too it can read the result. Pages on the user's own network are therefore reachable by anyone holding a `read` + `capture` token, which is why tokens belong only to the user's own devices and agents. The `fetchLinks` setting turns fetching off entirely.
- `save_file` over stdio accepts a local path, because the stdio client already runs as the user. Over HTTP the `path` parameter doesn't exist, so a remote token holder can't make the server read arbitrary files.
- Tokens and credentials never appear in URLs, logs or the change log.

## Reporting

See [SECURITY.md](../SECURITY.md) at the repository root for how to report a vulnerability privately.
