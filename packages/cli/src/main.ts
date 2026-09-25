#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ParseArgsConfig, parseArgs } from 'node:util';
import { EnveMemory, MemoryError, type Settings, defaultHome, listBackups, pathsFor, restoreBackup } from '@enve-memory/core';
import { attachLocalEmbedder, indexWorker } from '@enve-memory/embeddings';
import { ingestItem, processPending } from '@enve-memory/ingestion';
import { DEFAULT_PORT, createApiServer, lanUrls, pairingLink } from '@enve-memory/api';
import { SERVER_NAME, serveMemoryOverStdio } from '@enve-memory/mcp';
import pkg from '../package.json' with { type: 'json' };
import * as format from './format.ts';

const USAGE = `enve-memory ${pkg.version} — local memory for you and your AI tools

Usage: enve-memory <command> [options]

Capture
  note <text…>                 Save a note           [--title] [-p project] [-t tag]…
  link <url>                   Save and archive a link  [--title] [--note] [-p project] [-t tag]… [--no-fetch]
  file <path>…                 Save files (PDFs and text become searchable)  [--title] [--note] [-p project] [-t tag]…
  task add <title…>            Add a task            [-p project] [--due] [--priority high|normal|low] [--notes] [-t tag]…

Find
  search <query…>              Full-text search      [-p project] [--type] [-t tag] [--limit] [--all]
  list                         Recent items          [-p project] [--type] [-t tag] [--limit] [--all]
  show <id>                    One item in full      [--content] prints the archived text
  open <id>                    Open a link in the browser or a file in its app
  task list                    Tasks                 [-p project] [--status active|open|in_progress|done|cancelled|all]
  activity                     Recent changes        [-p project] [--limit]

Projects
  project new <name>           Create                [--description] [--instructions]
  project list                 List                  [--status active|paused|done|archived]
  project show <project>       Briefing: memory, decisions, open tasks, recent items
  project edit <project>       Change                [--name] [--description] [--instructions] [--status]
  project memory <project>     Print the memory document; --set FILE replaces it (- reads stdin)
  decide <project> <text…>     Record a decision     [--reason] [--supersedes id]…

Organize
  edit <id>                    Change an item        [--title] [--body] [--url] [-p project | --no-project]
  task edit <id>               Change a task         [--title] [--notes] [--status] [--due] [--priority] [-p project]
  task done <id>               Complete a task
  tag <id>                     Retag                 [--add tag]… [--remove tag]…
  relate <from> <kind> <to>    Link two items        kind: related_to|references|derived_from|depends_on
  archive <id> / unarchive <id>
  delete <id> --yes            Permanently delete

AI clients and devices
  mcp                          Run the MCP server on stdio
  connect                      Print setup for Claude Code, Codex and other MCP clients
  serve                        Run the local HTTP API + MCP-over-HTTP  [--port 49231] [--lan]
  clients add <name>           Create an API token   --scope read|capture|write (repeat or comma-separate)
  clients pair <device>        Create a read+write token for a phone and print its pairing link  [--port]
  clients list                 List API clients
  clients revoke <id>          Revoke a token immediately

Your data
  export <folder>              Write everything as Markdown + JSON (plus original files)
  backup                       Take a snapshot now
  backups                      List snapshots (taken automatically while the app or \`serve\` runs)
  restore <file|latest> --yes  Replace the library with a snapshot; the current state is snapshotted first.
                               Quit the desktop app, \`serve\` and AI clients first.

Other
  ingest                       Fetch and extract anything still pending  [--retry] also retries failures
  index                        Build the semantic search index (downloads a ~23 MB model once)
  settings [key] [value]       Show or change settings (fetchLinks, semanticSearch: true|false)
  info                         Library location and stats

Global options: --home DIR (default $ENVE_MEMORY_HOME or the platform data folder), --json, -h, -v`;

class UsageError extends Error {}

const { values: opts, positionals } = parseCommandLine({
  allowPositionals: true,
  options: {
    home: { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    project: { type: 'string', short: 'p' },
    'no-project': { type: 'boolean' },
    tag: { type: 'string', short: 't', multiple: true },
    add: { type: 'string', multiple: true },
    remove: { type: 'string', multiple: true },
    title: { type: 'string' },
    body: { type: 'string' },
    url: { type: 'string' },
    note: { type: 'string' },
    notes: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    instructions: { type: 'string' },
    status: { type: 'string' },
    type: { type: 'string' },
    due: { type: 'string' },
    priority: { type: 'string' },
    reason: { type: 'string' },
    supersedes: { type: 'string', multiple: true },
    set: { type: 'string' },
    scope: { type: 'string', multiple: true },
    port: { type: 'string' },
    lan: { type: 'boolean' },
    'no-fetch': { type: 'boolean' },
    content: { type: 'boolean' },
    retry: { type: 'boolean' },
    limit: { type: 'string' },
    all: { type: 'boolean' },
    yes: { type: 'boolean' },
  },
});

function parseCommandLine<T extends ParseArgsConfig>(config: T): ReturnType<typeof parseArgs<T>> {
  try {
    return parseArgs(config);
  } catch (error) {
    console.error(`${(error as Error).message}\nRun \`enve-memory --help\` for usage.`);
    process.exit(2);
  }
}

const [command, ...rest] = positionals;

function arg(index: number, name: string): string {
  const value = rest[index];
  if (value === undefined) throw new UsageError(`Missing <${name}>.`);
  return value;
}

const text = (from: number, name: string) => {
  const joined = rest.slice(from).join(' ');
  if (!joined) throw new UsageError(`Missing <${name}>.`);
  return joined;
};

const limit = () => (opts.limit === undefined ? undefined : Number(opts.limit));

const filter = () => ({ project: opts.project, type: opts.type, tag: opts.tag?.[0], includeArchived: opts.all });

function emit(data: unknown, human: string): void {
  console.log(opts.json ? JSON.stringify(data, null, 2) : human);
}

async function run(memory: EnveMemory): Promise<void> {
  switch (command) {
    case 'note': {
      const item = memory.items.saveNote({ body: text(0, 'text'), title: opts.title, project: opts.project, tags: opts.tag });
      return emit(item, `Saved note ${item.id}`);
    }
    case 'link': {
      const saved = memory.items.saveLink({
        url: arg(0, 'url'), title: opts.title, note: opts.note, project: opts.project, tags: opts.tag,
        ...(opts['no-fetch'] ? { ingest: false } : {}),
      });
      const item = saved.item.metadata.ingest?.status === 'pending' ? await ingestItem(memory, saved.item.id) : saved.item;
      return emit({ item, created: saved.created }, `${saved.created ? 'Saved' : 'Already saved'}: ${format.savedLine(item)}`);
    }
    case 'file': {
      if (rest.length === 0) throw new UsageError('Missing <path>.');
      const results = [];
      for (const path of rest) {
        const saved = memory.files.saveFromPath(path, { title: rest.length === 1 ? opts.title : undefined, note: opts.note, project: opts.project, tags: opts.tag });
        const item = saved.item.metadata.ingest?.status === 'pending' ? await ingestItem(memory, saved.item.id) : saved.item;
        results.push({ item, created: saved.created });
      }
      return emit(results, results.map((r) => `${r.created ? 'Saved' : 'Already saved'}: ${format.savedLine(r.item)}`).join('\n'));
    }
    case 'open': {
      const item = memory.items.get(arg(0, 'id'));
      let target = item.url;
      if (item.attachments.length > 0) {
        const { attachment, path } = memory.files.primary(item.id);
        const dir = join(tmpdir(), 'enve-memory', item.id);
        mkdirSync(dir, { recursive: true });
        target = join(dir, attachment.filename);
        copyFileSync(path, target);
      }
      if (!target) throw new UsageError('That item has no link or file to open.');
      openExternal(target);
      return emit({ opened: target }, `Opened ${target}`);
    }
    case 'index': {
      const embedder = attachLocalEmbedder(memory);
      if (!embedder) throw new UsageError('Semantic search is off. Turn it on with `enve-memory settings semanticSearch true`.');
      let total = 0;
      const { pending } = memory.embeddings.status(embedder.model);
      if (pending && !opts.json) process.stderr.write(`Indexing ${pending} item${pending === 1 ? '' : 's'} with ${embedder.model}…\n`);
      for (let batch = await memory.embeddings.indexPending(embedder, 25); batch > 0; batch = await memory.embeddings.indexPending(embedder, 25)) {
        total += batch;
        if (!opts.json) process.stderr.write(`  ${total}/${pending}\r`);
      }
      if (total && !opts.json) process.stderr.write('\n');
      const status = memory.embeddings.status(embedder.model);
      return emit({ added: total, ...status }, `${total ? `Indexed ${total}. ` : ''}${status.indexed} items, ${status.chunks} passages in the semantic index.`);
    }
    case 'ingest': {
      const retried = opts.retry ? memory.items.retryFailedIngest() : 0;
      const processed = await processPending(memory, { limit: 200 });
      return emit({ processed, retried }, processed ? `Processed ${processed} item${processed === 1 ? '' : 's'}.` : 'Nothing pending.');
    }
    case 'settings': {
      const [key, value] = rest;
      if (key && value !== undefined) {
        if (value !== 'true' && value !== 'false') throw new UsageError('Setting values are true or false.');
        memory.settings.set(key as keyof Settings, value === 'true');
      }
      const settings = memory.settings.all();
      return emit(settings, Object.entries(settings).map(([k, v]) => `${k.padEnd(14)}${v}`).join('\n'));
    }
    case 'search': {
      attachLocalEmbedder(memory);
      const hits = await memory.search.hybrid(text(0, 'query'), filter(), limit());
      return emit(hits, hits.length ? hits.map(format.hitLine).join('\n') : 'No matches.');
    }
    case 'list': {
      const items = memory.items.list(filter(), limit());
      return emit(items, items.length ? items.map(format.itemLine).join('\n') : 'Nothing saved yet.');
    }
    case 'show': {
      const item = memory.items.get(arg(0, 'id'));
      return emit(item, opts.content ? item.content || '(no archived text)' : format.itemDetail(item));
    }
    case 'edit': {
      const item = memory.items.update(arg(0, 'id'), {
        title: opts.title, body: opts.body, url: opts.url, project: opts['no-project'] ? null : opts.project,
      });
      return emit(item, format.itemDetail(item));
    }
    case 'tag': {
      const item = memory.items.tag(arg(0, 'id'), { add: opts.add, remove: opts.remove });
      return emit(item, item.tags.length ? item.tags.map((t) => `#${t}`).join(' ') : '(no tags)');
    }
    case 'relate': {
      const item = memory.items.relate(arg(0, 'from'), arg(2, 'to'), arg(1, 'kind'));
      return emit(item, format.itemDetail(item));
    }
    case 'archive':
    case 'unarchive': {
      const id = arg(0, 'id');
      const item = command === 'archive' ? memory.items.archive(id) : memory.items.unarchive(id);
      return emit(item, `${command === 'archive' ? 'Archived' : 'Restored'} ${item.id}`);
    }
    case 'delete': {
      const id = arg(0, 'id');
      if (!opts.yes) throw new UsageError('Deleting is permanent. Re-run with --yes, or use `archive` to hide it instead.');
      memory.items.delete(id);
      return emit({ deleted: id }, `Deleted ${id}`);
    }
    case 'decide': {
      const decision = memory.decisions.record({
        project: arg(0, 'project'), decision: text(1, 'decision'), reason: opts.reason, supersedes: opts.supersedes,
      });
      return emit(decision, format.decisionLine(decision));
    }
    case 'activity': {
      const changes = memory.activity.recent({ project: opts.project }, limit());
      return emit(changes, changes.map(format.changeLine).join('\n') || 'No activity yet.');
    }
    case 'clients':
      return runClients(memory);
    case 'export': {
      const summary = memory.exports.write(resolve(text(0, 'folder')));
      return emit(summary, `Exported ${summary.items} items, ${summary.projects} projects and ${summary.files} files to ${summary.path}`);
    }
    case 'backup': {
      const backup = memory.backups.create('manual');
      return emit(backup, `Snapshot saved: ${backup.path}`);
    }
    case 'backups': {
      const backups = memory.backups.list();
      return emit(backups, backups.map((b) => `${b.createdAt}  ${b.kind.padEnd(13)} ${(b.size / 1024 / 1024).toFixed(1)} MB  ${b.file}`).join('\n') || 'No snapshots yet.');
    }
    case 'task':
      return runTask(memory);
    case 'project':
      return runProject(memory);
    case 'info': {
      const info = {
        version: pkg.version,
        home: memory.paths?.home,
        database: memory.paths?.database,
        schemaVersion: memory.schemaVersion,
        deviceId: memory.deviceId,
        ...memory.stats(),
        semanticIndex: (() => {
          const embedder = attachLocalEmbedder(memory);
          if (!embedder) return 'off';
          const { indexed, pending } = memory.embeddings.status(embedder.model);
          return `${indexed} indexed, ${pending} pending (${embedder.model})`;
        })(),
      };
      return emit(info, Object.entries(info).map(([k, v]) => `${k.padEnd(14)}${v}`).join('\n'));
    }
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
}

function runClients(memory: EnveMemory): void {
  const [sub] = rest;
  switch (sub) {
    case 'add': {
      const scopes = (opts.scope ?? []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
      const { client, token } = memory.clients.create(text(1, 'name'), scopes);
      return emit({ client, token }, `Created ${client.name} (${client.scopes.join(', ')})\n\n  ${token}\n\nThis token is shown once. Store it in the client now.`);
    }
    case 'pair': {
      const { client, token } = memory.clients.create(text(1, 'device'), ['read', 'write']);
      const port = opts.port === undefined ? DEFAULT_PORT : Number(opts.port);
      const links = lanUrls(port).map((url) => pairingLink(url, token, client.name));
      return emit(
        { client, token, links },
        `Paired ${client.name}. Start the server with \`enve-memory serve --lan\`, then open one of these on the device:\n\n${links.map((l) => `  ${l}`).join('\n') || '  (no network address found; connect to Wi-Fi or Tailscale)'}\n\nThe link contains the token and is shown once.`,
      );
    }
    case 'list': {
      const clients = memory.clients.list();
      return emit(clients, clients.map(format.clientLine).join('\n') || 'No API clients.');
    }
    case 'revoke': {
      const client = memory.clients.revoke(arg(1, 'id'));
      return emit(client, `Revoked ${client.name}`);
    }
    default:
      throw new UsageError('Usage: clients add|list|revoke');
  }
}

async function serve(): Promise<void> {
  const memory = EnveMemory.open({ home: opts.home, actor: 'api' });
  const port = opts.port === undefined ? DEFAULT_PORT : Number(opts.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`Invalid port "${opts.port}".`);
  const embedder = attachLocalEmbedder(memory);
  const indexer = embedder ? indexWorker(memory, embedder) : null;
  const api = createApiServer(memory, { version: pkg.version, port, lan: opts.lan, afterWrite: () => indexer?.kick() });
  const url = await api.listen();
  api.ingest.kick();
  indexer?.kick();
  const backup = () => {
    try {
      memory.backups.runSchedule();
    } catch (error) {
      console.error('backup:', error);
    }
  };
  backup();
  const backupTimer = setInterval(backup, 10 * 60_000);
  console.error(`Enve Memory API listening on ${url}${opts.lan ? ' (also reachable from your network)' : ''}\nREST: ${url}/api/v1   MCP: ${url}/mcp`);
  const stop = async () => {
    clearInterval(backupTimer);
    await api.close();
    await indexer?.idle();
    memory.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

function runTask(memory: EnveMemory): void {
  const [sub] = rest;
  const shift = rest.slice(1);
  switch (sub) {
    case 'add': {
      const task = memory.tasks.create({
        title: shift.join(' '), notes: opts.notes, project: opts.project, due: opts.due, priority: opts.priority, tags: opts.tag,
      });
      return emit(task, `Added ${format.itemLine(task)}`);
    }
    case 'list': {
      const tasks = memory.tasks.list({ project: opts.project, status: opts.status, tag: opts.tag?.[0] }, limit());
      return emit(tasks, tasks.length ? tasks.map(format.itemLine).join('\n') : 'No tasks.');
    }
    case 'done': {
      const task = memory.tasks.complete(arg(1, 'id'));
      return emit(task, format.itemLine(task));
    }
    case 'edit': {
      const task = memory.tasks.update(arg(1, 'id'), {
        title: opts.title, notes: opts.notes, status: opts.status, due: opts.due, priority: opts.priority,
        project: opts['no-project'] ? null : opts.project,
      });
      return emit(task, format.itemLine(task));
    }
    default:
      throw new UsageError('Usage: task add|list|done|edit');
  }
}

function runProject(memory: EnveMemory): void {
  const [sub] = rest;
  switch (sub) {
    case 'new': {
      const project = memory.projects.create({ name: text(1, 'name'), description: opts.description, instructions: opts.instructions });
      return emit(project, `Created ${format.projectLine(project)}`);
    }
    case 'list': {
      const projects = memory.projects.list(opts.status);
      return emit(projects, projects.length ? projects.map(format.projectLine).join('\n') : 'No projects yet.');
    }
    case 'show': {
      const briefing = memory.briefing(text(1, 'project'));
      return emit(briefing, format.briefing(briefing));
    }
    case 'edit': {
      const project = memory.projects.update(text(1, 'project'), {
        name: opts.name, description: opts.description, instructions: opts.instructions, status: opts.status,
      });
      return emit(project, format.projectLine(project));
    }
    case 'memory': {
      const ref = text(1, 'project');
      if (opts.set === undefined) {
        const project = memory.projects.resolve(ref);
        return emit({ project: project.name, memory: project.memory }, project.memory || '(empty)');
      }
      const content = readFileSync(opts.set === '-' ? 0 : opts.set, 'utf8');
      const project = memory.projects.setMemory(ref, content);
      return emit({ project: project.name, saved: true }, `Updated memory for ${project.name}`);
    }
    default:
      throw new UsageError('Usage: project new|list|show|edit|memory');
  }
}

function connectInstructions(): string {
  const node = process.execPath;
  const script = fileURLToPath(import.meta.url);
  const args = [script, 'mcp', ...(opts.home ? ['--home', opts.home] : [])];
  const quoted = [node, ...args].map((a) => JSON.stringify(a)).join(' ');
  return `Claude Code:
  claude mcp add --scope user ${SERVER_NAME} -- ${quoted}

Codex (~/.codex/config.toml):
  [mcp_servers.${SERVER_NAME}]
  command = ${JSON.stringify(node)}
  args = ${JSON.stringify(args)}

Claude Desktop, Cursor and other JSON-configured clients:
  ${JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: node, args } } })}

Clients that connect over HTTP (remote agents, other machines):
  1. enve-memory serve            (the desktop app runs this for you)
  2. enve-memory clients add "My agent" --scope read,write
  3. Point the client at http://127.0.0.1:${DEFAULT_PORT}/mcp with header  Authorization: Bearer <token>`;
}

async function main(): Promise<number> {
  if (opts.version) {
    console.log(pkg.version);
    return 0;
  }
  if (opts.help || !command) {
    console.log(USAGE);
    return command || opts.help ? 0 : 2;
  }
  if (command === 'connect') {
    console.log(connectInstructions());
    return 0;
  }
  if (command === 'serve') {
    await serve();
    return 0;
  }
  if (command === 'restore') {
    const paths = pathsFor(opts.home ?? defaultHome());
    const target = arg(0, 'file|latest');
    const snapshot = target === 'latest' ? listBackups(paths.backups).find((b) => b.kind !== 'pre-restore')?.path : resolve(target);
    if (!snapshot) throw new UsageError('There are no snapshots to restore.');
    if (!opts.yes) throw new UsageError(`This replaces your library with ${snapshot}. Quit the desktop app, \`serve\` and AI clients, then re-run with --yes.`);
    const { saved } = restoreBackup(paths, snapshot);
    emit({ restored: snapshot, saved }, `Restored ${snapshot}.\nThe previous state was saved as ${saved}; restore that file to undo.`);
    return 0;
  }
  if (command === 'mcp') {
    // Stays open for the life of the process; stdio EOF ends it.
    serveMemoryOverStdio(EnveMemory.open({ home: opts.home, actor: 'mcp' }), pkg.version);
    return 0;
  }

  const memory = EnveMemory.open({ home: opts.home, actor: 'cli' });
  try {
    await run(memory);
    return 0;
  } finally {
    memory.close();
  }
}

function openExternal(target: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [target]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', target]]
    : ['xdg-open', [target]];
  spawn(cmd, args as string[], { detached: true, stdio: 'ignore' }).unref();
}

function fail(error: unknown): void {
  if (error instanceof UsageError) {
    console.error(`${error.message}\nRun \`enve-memory --help\` for usage.`);
    process.exitCode = 2;
  } else if (error instanceof MemoryError) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  } else if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error('error: that port is already in use. Is Enve Memory already running? Use --port to pick another.');
    process.exitCode = 1;
  } else {
    throw error;
  }
}

main().then((code) => {
  process.exitCode = code;
}, fail);
