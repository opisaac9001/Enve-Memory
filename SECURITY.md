# Security policy

Enve Memory holds a person's notes, links and project history, and gives AI agents access to them. We take reports seriously.

## Reporting a vulnerability

Please report privately, not in a public issue: use **Report a vulnerability** on the repository's [Security tab](https://github.com/opisaac9001/Enve-Memory/security/advisories/new). Include:

- what an attacker can do, and under which setup (stdio MCP, the local HTTP API with or without `--lan`, the browser extension, sync)
- steps or a proof of concept
- the version or commit

We'll acknowledge within a week, keep you informed, and credit you in the release notes unless you'd rather not be named.

## Scope

In scope: the engine and CLI (`packages/`), the local HTTP API and MCP servers, the desktop app, the browser extension, the iOS app, and the sync format.

Especially interesting:

- ways around token scopes or the Host/Origin checks
- reading or writing outside the library folder, whether through the API, sync or importers
- saved content that causes an AI client or the app to take an action
- loss or corruption of library data

The design and its accepted trade-offs are documented in [docs/SECURITY.md](docs/SECURITY.md).

## Supported versions

Enve Memory is pre-1.0; fixes land on `main` and in the next release.
