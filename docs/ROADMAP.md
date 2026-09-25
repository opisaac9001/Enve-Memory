# Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Product, architecture, data model, MCP, security, sync docs; agent rules | ✅ 2026-09-24 |
| 1 | SQLite schema + migrations, core services (items, projects, tags, tasks, decisions, relations, activity), FTS5 search, CLI, stdio MCP server, tests | ✅ 2026-09-24 |
| 1.5 | Dogfood with Claude Code and Codex on real projects; tune tool descriptions and briefing contents from real transcripts | Next |
| 2a | Local HTTP API + MCP over Streamable HTTP with hashed tokens, scopes, Host/Origin checks; `serve` and `clients` CLI; CI on macOS/Windows/Linux × Node 24/26 | ✅ 2026-09-24 |
| 3a | Link archiving (readable Markdown + metadata), PDFs/text/images as content-addressed attachments, background ingestion, file upload/download API, `save_file`/`get_file` MCP tools, `fetchLinks` setting | ✅ 2026-09-24 |
| 2b | Desktop shell (Electron vs Tauri decided here) with Home, Inbox, Library, Projects, Tasks, Search, Settings, Connected clients | |
| 3 | Capture and understanding: URL ingestion (readable Markdown + metadata), browser extension (Chrome/Edge/Firefox/Safari), clipboard and drag-drop, PDFs and images as attachments, local embeddings, hybrid search | |
| 4 | Optional AI enrichment through BYO providers: summaries, tag and project suggestions, relationship suggestions. "None" stays first-class | |
| 5 | Backups (hourly/daily/monthly rotation), Export Everything (Markdown + JSON), installers for macOS/Windows/Linux | |
| 6 | iOS companion: SwiftUI app + share extension, capture and search first | |
| 7 | Sync (see SYNC.md) | |
| 8 | Ecosystem: plugins (importers, exporters, extractors, providers, tools), automations, graph view, public sharing through a tunnel/relay, remote access via Tailscale | |

Rules of thumb:

- Don't start a phase while the previous one's data paths are untested.
- Each phase ships something usable end to end, not a layer.
- Anything on the "not now" list in PRODUCT.md needs an explicit decision to pull forward.
