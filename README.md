# Enve Memory

**An open, local memory layer for you and your AI tools.**

Save links, notes, files, tasks and decisions once. Find them yourself, or let Claude, Codex, ChatGPT, Cursor or any other MCP client find and use them. Every assistant reads and writes the same library, and that library is a single SQLite file on your computer. No account, no subscription, no cloud.

## What you get

- **Capture from anywhere.** The desktop app (quick-capture window, drag and drop), the browser extension (popup, side panel, right-click, one-click import of your browser bookmarks, offline queue), the iOS app and its share sheet, the CLI, and any AI tool over MCP.
- **Pages that outlive the web.** Saved links are fetched and stored as readable Markdown, and PDFs and text files are extracted, so everything stays searchable even after the original page disappears.
- **Search by words and by meaning.** Full-text search plus a local embedding model (no cloud), fused so both exact terms and paraphrases surface, with a relevance floor so irrelevant results don't crowd in.
- **Project memory for AI agents.** Each project has standing instructions, a living memory document (every version kept), an append-only decision log, tasks, and a briefing an agent reads in one call.
- **Shelves and reminders.** Pinned, Read, Watch, Buy, Revisit, "unopened for a month". Reminders take plain words ("tomorrow", "friday") and notify on the desktop, the phone or in the browser.
- **Optional AI, bring your own.** Ollama, OpenAI, Anthropic, Gemini, OpenRouter or any OpenAI-compatible server for summaries, tag and project suggestions (or automatic filing), and cited answers from your own library. Everything else works with AI off.
- **Automations.** For example, "links from github.com → #code, file into Development".
- **Sync between your computers** through a folder you already sync (iCloud Drive, Dropbox, Syncthing), with optional passphrase encryption. Concurrent edits never lose text.
- **Yours to keep.** Automatic hourly, daily and monthly backups; Export Everything to Markdown, JSON and the original files; importers for browser bookmarks, Markdown folders or Obsidian vaults, bookmark CSVs, and Enve exports.

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

The desktop app is in [`apps/desktop`](apps/desktop): `npm --prefix apps/desktop run dev`, or `run dist:mac` for the installers. The browser extension is in [`apps/extension`](apps/extension) and the iOS app in [`apps/ios`](apps/ios); each README explains setup.

## Connect your AI

```bash
npm run cli -- connect
```

This prints ready-to-paste setup for Claude Code, Codex and JSON-configured clients such as Claude Desktop and Cursor. The desktop app has the same setup under Settings → AI tools, with one-click "Add to Claude Code". Then ask your assistant *"What do we know about my garage door project?"*

The MCP server has about 25 tools: search, briefings, notes, links, files, tasks, project memory, decisions, reminders and shelves. None of them can delete anything, and saved content is always presented to the model as data, never instructions. See [docs/MCP.md](docs/MCP.md). Devices and remote agents use the local [HTTP API](docs/API.md) with scoped tokens.

## Where your data lives

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/Enve Memory/` |
| Windows | `%APPDATA%\Enve Memory\` |
| Linux | `~/.config/Enve Memory/` |

Override it with `--home DIR` or `ENVE_MEMORY_HOME`.

## Docs

[Product](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [MCP](docs/MCP.md) · [HTTP API](docs/API.md) · [Security](docs/SECURITY.md) · [Sync](docs/SYNC.md) · [Roadmap](docs/ROADMAP.md) · [Agent rules](AGENTS.md)

## License

[AGPL-3.0-only](LICENSE.md). Plugins and clients that talk to Enve Memory over MCP or its API are separate programs.
