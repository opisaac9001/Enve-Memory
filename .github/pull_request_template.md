## What and why

<!-- One concern per pull request. -->

## How it was tested

- [ ] `npm run check`
- [ ] App tests, if an app changed (`apps/desktop`, `apps/extension`, `apps/ios`)
- [ ] New or changed behaviour has a test (always, for migrations, sync, backups and API security)

## Invariants (see AGENTS.md)

- [ ] Every write goes through a core service and the change log
- [ ] Migrations are append-only
- [ ] No destructive MCP tools; saved content is treated as data
