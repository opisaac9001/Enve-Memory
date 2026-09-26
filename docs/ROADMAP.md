# Roadmap

## In 0.1

The whole local product: the library (notes, links, files, images, tasks, decisions, projects), link and PDF archiving, keyword and semantic search, the MCP server, the local HTTP API, optional AI enrichment and cited answers, backups and export, importers, automation rules, encrypted folder sync, the desktop app, the browser extension and the iOS app. See the [changelog](../CHANGELOG.md) for details.

## Next

- **Signed and notarized macOS builds**, so the app opens without the right-click workaround.
- **Windows and Linux installers** built and tested on those systems, published with each release.
- **Store listings** for the browser extension (Chrome Web Store, Firefox Add-ons) and the iOS app.
- **Better briefings for AI tools**, tuned from real use: tool descriptions, what `get_project` returns, and how much context each call costs.
- **Semantic search on Intel Macs**, once the embedding runtime ships an Intel build.

## Later

These need a security design before any code:

- Third-party plugins, sandboxed.
- Sharing an item or project publicly through a tunnel or relay.

## Not planned

Accounts, cloud hosting, teams, social features, analytics and a custom model. The local product stays complete and free; if a paid tier ever exists, it will cover only optional services such as hosted encrypted sync.
