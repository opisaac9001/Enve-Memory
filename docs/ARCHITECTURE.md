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
| `packages/api` | Local HTTP server: REST (`/api/v1`) + MCP over Streamable HTTP (`/mcp`), with token auth, scopes and Host/Origin guards. |
| `packages/cli` | The `enve-memory` binary: human and `--json` commands, `mcp` (stdio), `serve` (HTTP), `clients` (tokens) and `connect` (client setup snippets). |

Planned: `packages/ingestion` (URL/PDF/image extractors), `packages/embeddings` (vector index abstraction), `packages/ai` (provider interface), `apps/desktop`, `apps/extension`, and an `apps/ios` SwiftUI companion.

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

- **Now:** SQLite FTS5 over `title`, `body` and `url`, with the porter stemmer and unicode61 tokenizer with diacritics removed. Ranking is bm25 with column weights 10 / 1 / 2. User text is tokenized and every term quoted, so FTS syntax in input is inert. Terms are OR'd so partial matches still surface, and the last term is a prefix match.
- **Phase 3:** local embeddings, chunked content, and a `VectorIndex` interface (`add / update / remove / search / rebuild`). The first implementation will be sqlite-vec. It's pre-1.0, which is why it sits behind our own abstraction.
- **Hybrid:** combine vector, keyword, project and recency scores. The weights will be tuned against a fixture corpus, not guessed.

## Ingestion (Phase 3)

`input → type detect → extract → normalize → store → index → embed → optional AI enrichment`. Deterministic steps never depend on AI. A bookmark keeps its URL plus cleaned Markdown (and optionally the original HTML), so it outlives the page. Capture clients such as the browser extension and the share sheet send only `{url, title, selection, note}`. All extraction logic lives once, in the desktop process.

## AI providers (Phase 4)

One interface (`complete`, `stream`, `embed`, `models`) with OpenAI, Anthropic, Gemini, Ollama and OpenAI-compatible implementations. Secrets go in the OS credential store. "None" is a first-class choice.
