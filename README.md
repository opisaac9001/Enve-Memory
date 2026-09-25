# Enve Memory

**An open, local memory layer for you and your AI tools.**

Save links, notes, tasks and decisions once. Find them yourself, or let Claude, Codex, Cursor or any other MCP client find and use them. Every assistant reads and writes the same library, and that library is a single SQLite file on your computer. No account, no subscription, no cloud.

> Status: early. The core, CLI, MCP server, local HTTP API, link archiving, semantic search and the browser extension work. The desktop app is next. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Try it

Requires Node 24+.

```bash
npm install
npm run cli -- project new "Garage Door" --instructions "Must work without internet."
npm run cli -- link https://example.com/security-plus --title "Security+ 2.0 protocol" -p garage
npm run cli -- note "Need a bench rig before touching the real opener" -p garage
npm run cli -- decide garage "Use ESP32-S3" --reason "USB host support"
npm run cli -- project show garage
npm run cli -- search opener protocol
```

## Connect your AI

```bash
npm run cli -- connect
```

This prints ready-to-paste setup for Claude Code, Codex and JSON-configured clients such as Claude Desktop and Cursor. Then ask your assistant *"What do we know about my garage door project?"*

The server exposes 20 tools: search, briefings, notes, links, tasks, project memory, and an append-only decision log. None of them can delete anything. See [docs/MCP.md](docs/MCP.md).

## Where your data lives

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/Enve Memory/` |
| Windows | `%APPDATA%\Enve Memory\` |
| Linux | `~/.config/Enve Memory/` |

Override it with `--home DIR` or `ENVE_MEMORY_HOME`. Before any schema upgrade, a snapshot is written to `backups/`.

## Docs

[Product](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [MCP](docs/MCP.md) · [Security](docs/SECURITY.md) · [Sync](docs/SYNC.md) · [Roadmap](docs/ROADMAP.md) · [Agent rules](AGENTS.md)

## License

[AGPL-3.0-only](LICENSE.md). Plugins and clients that talk to Enve Memory over MCP or its API are separate programs.
