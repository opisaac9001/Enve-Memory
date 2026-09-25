# Contributing to Enve Memory

Thanks for helping. Enve Memory is a local-first memory layer shared by a person and their AI tools, so the bar is simple: **never lose data, never phone home, and keep it useful without AI.**

## Setup

Requires Node 24 or newer (26 recommended).

```bash
npm install
npm run check          # typecheck + every package's tests + extension and desktop unit tests
npm run demo -- /tmp/em-demo                             # a realistic demo library to play with
npm run cli -- --home /tmp/em-demo project show garage
```

Node runs the TypeScript sources directly; there's no build step for the engine. Each app has its own README:

| Part | Where | Run |
|---|---|---|
| Engine, CLI, MCP, API | `packages/*` | `npm run check` |
| Desktop app (Electron) | `apps/desktop` | `npm --prefix apps/desktop run dev`, `run test:e2e`, `run dist:mac` |
| Browser extension | `apps/extension` | `npm --prefix apps/extension test`, `run test:e2e` |
| iOS app | `apps/ios` | `xcodegen generate` and Xcode; `xcrun swift test` in `Packages/EnveMemoryKit` |

To try semantic search locally, run `npm run models` to cache the embedding model once in `.cache/models`. Tests never download anything.

## Before you open a pull request

- Read [AGENTS.md](AGENTS.md). It lists the invariants that keep libraries safe: append-only migrations, every write in the change log, no destructive MCP tools, saved content treated as data.
- `npm run check` passes. If you changed an app, its own tests pass too.
- New behaviour has a test. Anything touching migrations, sync, backups or the API's security needs one.
- Keep changes focused: one concern per pull request.
- Comments explain *why*, not *what*.

## Reporting bugs and ideas

Use the issue templates. For security problems, see [SECURITY.md](SECURITY.md) and don't open a public issue.

## License

Contributions are licensed under [AGPL-3.0-only](LICENSE.md), like the rest of the project.
