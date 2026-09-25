# Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Product, architecture, data model, MCP, security, sync docs; agent rules | ✅ 2026-09-24 |
| 1 | SQLite schema + migrations, core services (items, projects, tags, tasks, decisions, relations, activity), FTS5 search, CLI, stdio MCP server, tests | ✅ 2026-09-24 |
| 1.5 | Dogfood with Claude Code and Codex on real projects; tune tool descriptions and briefing contents from real transcripts | Next |
| 2a | Local HTTP API + MCP over Streamable HTTP with hashed tokens, scopes, Host/Origin checks; `serve` and `clients` CLI; CI on macOS/Windows/Linux × Node 24/26 | ✅ 2026-09-24 |
| 3a | Link archiving (readable Markdown + metadata), PDFs/text/images as content-addressed attachments, background ingestion, file upload/download API, `save_file`/`get_file` MCP tools, `fetchLinks` setting | ✅ 2026-09-24 |
| 3b | Browser extension (Chrome/Edge/Firefox MV3: popup, context menus, shortcut, options; unit + Playwright e2e) | ✅ 2026-09-24 |
| 3c | Semantic search: local MiniLM embeddings, chunked vector index, hybrid RRF with a relevance floor, background indexer, `index` CLI, retrieval eval | ✅ 2026-09-24 |
| 2b | Desktop app (Electron 44): full library UI, MCP setup, devices and pairing, AI, sync, automations, import, backups; installers (mac arm64 + x64 dmg; Windows/Linux configured) | ✅ 2026-09-25 |
| 3 | Capture and understanding: URL ingestion (readable Markdown + metadata), browser extension (Chrome/Edge/Firefox/Safari), clipboard and drag-drop, PDFs and images as attachments, local embeddings, hybrid search | |
| 4 | Optional AI through BYO providers (Anthropic SDK, OpenAI-compatible, OpenRouter, Ollama, Gemini): summaries + tag/project suggestions with accept, background enrichment of new items only, cited `ask` over the library | ✅ 2026-09-24 |
| 5a | Backups (hourly/daily/monthly rotation, verified restore with undo, 30-day attachment trash), Export Everything (Markdown + JSON + files) | ✅ 2026-09-24 |
| 5b | Installers: mac dmgs built and verified (arm64), x64 built; Windows NSIS + Linux AppImage/deb configured, need building on those OSes; signing/notarization needs a Developer ID | Partly |
| 6 | iOS companion: SwiftUI app + share extension, offline outbox, shelves, reminders as local notifications | ✅ 2026-09-25 |
| 6b | AvanLink parity+: extension side panel, bookmark-tree import, offline queue; shelves, intents, reminders; related-to-page; automatic AI filing | ✅ 2026-09-25 |
| 7 | Folder sync between computers: per-device append-only segments, hybrid logical clocks, full-state LWW records, conflict notes for concurrent text edits, tombstones, content-addressed blobs (see SYNC.md) | ✅ 2026-09-24 |
| 8a | Importers (bookmarks HTML, Markdown/Obsidian, CSV, Enve export), automation rules, graph data API | ✅ 2026-09-24 |
| 8b | Third-party plugins (sandboxed), public sharing through a tunnel/relay | Later: both need a security design first |

Rules of thumb:

- Don't start a phase while the previous one's data paths are untested.
- Each phase ships something usable end to end, not a layer.
- Anything on the "not now" list in PRODUCT.md needs an explicit decision to pull forward.
