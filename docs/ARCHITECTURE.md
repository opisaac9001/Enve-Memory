# Architecture

## Shape

```
 Desktop UI ─┐   Browser extension ─┐   iOS share sheet ─┐
             │                      │                    │
             │              HTTP API (Phase 2)  ◄────────┘
             ▼                      ▼
 CLI ─────► @enve-memory/core  ◄──── @enve-memory/mcp ◄──── Claude / Codex / Cursor / …
                    │
              node:sqlite (WAL)
                    │
     <data folder>/memory.sqlite  +  backups/  (+ attachments/, models/ later)
```

**Every client goes through core services.** Nothing outside `packages/core` touches SQLite. `createTask()` exists once, and the UI, the CLI, MCP and the future HTTP API all call it. Validation, change logging and invariants such as "decisions are append-only" live in core, so no client can bypass them.

## Packages

| Package | Role |
|---|---|
| `packages/core` | Schema and migrations, services (projects, items, tasks, decisions, search, activity), and the `EnveMemory` facade. No dependencies. |
| `packages/mcp` | MCP tool definitions over core, using the official TypeScript SDK v2 (`@modelcontextprotocol/server`, spec 2026-07-28). Thin: argument shaping and output trimming only. |
| `packages/ingestion` | Fetch (no cookies, time/size caps), readable-article extraction (Readability + linkedom → Markdown via Turndown), PDF text (unpdf), and `IngestWorker` for background draining. |
| `packages/embeddings` | `LocalEmbedder` (transformers.js), `attachLocalEmbedder`, and the background `indexWorker`. |
| `packages/api` | Local HTTP server: REST (`/api/v1`) + MCP over Streamable HTTP (`/mcp`), with token auth, scopes and Host/Origin guards. |
| `packages/cli` | The `enve-memory` binary: human and `--json` commands, `mcp` (stdio), `serve` (HTTP), `clients` (tokens) and `connect` (client setup snippets). |

Planned: `packages/embeddings` (vector index abstraction), `packages/ai` (provider interface), `apps/desktop`, `apps/extension`, and an `apps/ios` SwiftUI companion.

## Stack decisions

| Decision | Why |
|---|---|
| TypeScript on Node ≥ 24 (Electron 44 ships Node 24.21) | One codebase for macOS, Windows and Linux. The MCP SDK, parsers and browser tooling are all native to it. |
| `node:sqlite`, not better-sqlite3 | Built into Node, so there are no native modules to compile per OS or per Electron ABI. Supports FTS5 and loadable extensions (`allowExtension`), which sqlite-vec will need. |
| Node's built-in TypeScript type stripping | No build step in development. Code must stay within erasable syntax (`erasableSyntaxOnly`): no enums, namespaces or parameter properties. |
| npm workspaces | Ships with Node, so there's nothing extra to install. |
| `node:test` + `tsc --noEmit` (TypeScript 7) | Zero-dependency test runner. `npm run check` runs both. |
| UUIDv7 ids (`crypto.randomUUIDv7`) | Globally unique across devices and time-ordered. This is a precondition for sync. |
| Desktop shell: Electron vs Tauri | Undecided until Phase 2. The core doesn't care. Electron's `userData` path already matches our default data folder. |

Distribution will need a compile-to-JS step: Node refuses to strip types from files under `node_modules`, so a published npm package or an Electron bundle has to ship `.js`. That comes with the desktop shell.

## Data location

`$ENVE_MEMORY_HOME`, or the platform default. The default is the same as Electron's `userData` for "Enve Memory", so the CLI and the desktop app share one library:

- macOS: `~/Library/Application Support/Enve Memory/`
- Windows: `%APPDATA%\Enve Memory\`
- Linux: `$XDG_CONFIG_HOME/Enve Memory/` (default `~/.config/…`)

The folder contains `memory.sqlite` (with `-wal`/`-shm` files) and `backups/`.

## Concurrency

SQLite runs in WAL mode with a 5 s busy timeout. The desktop app, a CLI invocation and several MCP stdio servers (one per AI client) can all open the same file safely. Writes use `BEGIN IMMEDIATE`. Once the desktop app exists, it will host the HTTP/MCP endpoint and stdio servers remain an option.

## Search

- **Keyword:** SQLite FTS5 over `title`, `body`, `url` and `content`, with the porter stemmer and unicode61 tokenizer with diacritics removed. Ranking is bm25 with column weights 10 / 1.5 / 2 / 1. User text is tokenized, stopwords are dropped (unless they're the whole query), and every term is quoted so FTS syntax is inert. Terms are OR'd so partial matches still surface, and the last term is a prefix match.
- **Meaning:** items are chunked (≈1000 characters, 200 overlap, at most 48 per item) and embedded by an `Embedder`. The default is `LocalEmbedder`: all-MiniLM-L6-v2 through transformers.js and onnxruntime-node, int8, about 23 MB, downloaded once into `<home>/models`. Vectors live in `chunks` as float32 blobs and are searched brute-force in memory. That's fast enough for a personal library, and it avoids depending on pre-1.0 sqlite-vec. A trigger marks an item stale whenever its text changes, and the in-memory index reloads when another process writes vectors.
- **Hybrid:** reciprocal rank fusion (k = 60) of the two lists. Vector hits below the model's `minScore` (0.18 for MiniLM) are dropped, so an unrelated query returns nothing rather than the least-bad items. We chose MiniLM over bge-small because bge packs every score into 0.4–0.7, which makes a relevance floor impossible. `packages/embeddings/test/retrieval.test.ts` is the fixture eval: hybrid gets 5 of 6 paraphrased questions right at #1, keyword alone gets 1 of 6.
- Semantic search is on by default (`semanticSearch` setting). `serve` and the desktop app index in the background; `enve-memory index` does it on demand.

## Ingestion

`save → (pending) → fetch or read file → extract → setSource(title if empty, content, metadata) → index`. Saving never waits on the network: the CLI and MCP `save_link` wait up to 10 s so the user or model sees the real title, the API returns at once and a background `IngestWorker` finishes the job, and failures are recorded on the item (`metadata.ingest.status = failed`) for `enve-memory ingest --retry`. The `fetchLinks` setting turns all fetching off. Deterministic steps never depend on AI. A bookmark keeps its URL plus cleaned Markdown (and optionally the original HTML), so it outlives the page. Capture clients such as the browser extension and the share sheet send only `{url, title, selection, note}`. All extraction logic lives once, in the desktop process.

## AI providers (Phase 4)

One interface (`complete`, `stream`, `embed`, `models`) with OpenAI, Anthropic, Gemini, Ollama and OpenAI-compatible implementations. Secrets go in the OS credential store. "None" is a first-class choice.
