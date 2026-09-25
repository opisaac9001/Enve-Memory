# Local HTTP API

Served by the desktop app or `enve-memory serve` at `http://127.0.0.1:49231` (add `--lan` to reach it from other devices). Implementation: [`packages/api/src`](../packages/api/src). The security model is in [SECURITY.md](SECURITY.md).

## Authentication

Create a token with `enve-memory clients add "<name>" --scope read,capture` (or in Settings → Devices), or pair a phone with `enve-memory clients pair "<device>"`. Send it as `Authorization: Bearer em_…`.

| Scope | Allows |
|---|---|
| `read` | Search, view, briefings, activity, downloads |
| `capture` | Create notes, links, tasks and files |
| `write` | Every non-destructive change; implies `capture` |

Web pages can't call the API. Requests carrying a web `Origin` get a 403. Extension origins (`chrome-extension:`, `moz-extension:`, `safari-web-extension:`) and loopback pages are allowed and get CORS headers.

Errors are `{"error": {"code", "message"}}` with the status: `401 unauthorized`, `403 insufficient_scope | forbidden_origin | forbidden_host`, `400 invalid | invalid_json`, `404 not_found`, `409 conflict`, `413 too_large`.

**Safe retries:** send `Idempotency-Key: <1–128 chars>` on any write. Repeating a key within 24 hours (per client) returns the original response with `Idempotent-Replayed: true` instead of writing again.

## Endpoints (prefix `/api/v1`)

| Method & path | Scope | Notes |
|---|---|---|
| `GET /status` | none | `{name: "enve-memory", version, api: 1}` |
| `GET /whoami` | any token | The calling client: name, scopes, last used |
| `GET /search?q=&project=&type=&tag=&limit=&archived=` | read | Hybrid keyword + semantic hits: `{id, type, title, url, project, snippet, match, taskStatus, updatedAt}` |
| `GET /items?project=&type=&tag=&inbox=true&limit=&before=` | read | Newest first. The next page is `before=<updatedAt>,<id>` of the last item. |
| `GET /items/:id` | read | Full item with `content`, `attachments`, `tags`, `task`, `relations` and `metadata` |
| `GET` or `HEAD /items/:id/file` | read | The file's bytes with `Content-Type` and `Content-Disposition` |
| `GET /lookup?url=` | read | `{item}` if the URL is already bookmarked, else `{item: null}` |
| `POST /capture` | capture | `{url?, title?, note?, selection?, project?, tags?}` → `{item, created}`. A URL becomes a bookmark (re-saving merges the note and tags); otherwise it's a note. The selection is stored as a quote. |
| `POST /items` | capture | `{type: note \| bookmark \| task, title, body, url, project, tags, due, priority}` |
| `POST /files` | capture | Raw body. Headers: `Content-Type`, `X-Filename`, and optionally `X-Title`, `X-Note`, `X-Project`, `X-Tags` (comma list), all percent-encoded UTF-8. Up to 200 MB. |
| `PATCH /items/:id` | write | `{title?, body?, url?, project? (null = unfile)}` |
| `POST /items/:id/archive` and `/unarchive` | write | |
| `POST /items/:id/tags` | write | `{add?, remove?}` |
| `GET /projects?status=` | read | |
| `POST /projects` | write | `{name, description?, instructions?}` |
| `GET /projects/:ref` | read | Briefing: `{project, decisions, openTasks, recentItems}`. `:ref` is an id, slug, name or unique slug prefix. |
| `PATCH /projects/:ref` | write | `{name?, description?, instructions?, status?}` |
| `PUT /projects/:ref/memory` | write | `{memory}`; every earlier version is kept |
| `GET /projects/:ref/decisions` | read | Oldest first |
| `POST /projects/:ref/decisions` | write | `{decision, reason?, supersedes?: [id]}` |
| `GET /tasks?project=&status=active\|open\|in_progress\|done\|cancelled\|all&tag=&limit=&offset=` | read | Due date, then priority |
| `PATCH /tasks/:id` | write | `{title?, notes?, status?, due? (null clears), priority?, project?}` |
| `POST /tasks/:id/complete` | write | |
| `GET /activity?project=&limit=` | read | Newest first, with the acting client |

Nothing is deleted over HTTP. Links saved through the API are fetched and archived in the background.

## MCP over HTTP

`POST /mcp` (Streamable HTTP, MCP 2026-07-28 with 2025 fallback), using the same bearer token. The tools offered follow the token's scopes. See [MCP.md](MCP.md).

## Pairing links

`enve-memory://pair?url=<base URL>&token=<token>&name=<device name>`: shown as a QR code by the desktop app and printed by `enve-memory clients pair`.
