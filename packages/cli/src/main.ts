#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type ParseArgsConfig, parseArgs } from 'node:util';
import { EnveMemory, MemoryError } from '@enve-memory/core';
import { SERVER_NAME, serveMemoryOverStdio } from '@enve-memory/mcp';
import pkg from '../package.json' with { type: 'json' };
import * as format from './format.ts';

const USAGE = `enve-memory ${pkg.version} — local memory for you and your AI tools

Usage: enve-memory <command> [options]

Capture
  note <text…>                 Save a note           [--title] [-p project] [-t tag]…
  link <url>                   Save a link           [--title] [--note] [-p project] [-t tag]…
  task add <title…>            Add a task            [-p project] [--due] [--priority high|normal|low] [--notes] [-t tag]…

Find
  search <query…>              Full-text search      [-p project] [--type] [-t tag] [--limit] [--all]
  list                         Recent items          [-p project] [--type] [-t tag] [--limit] [--all]
  show <id>                    One item in full
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

AI clients
  mcp                          Run the MCP server on stdio
  connect                      Print setup for Claude Code, Codex and other MCP clients

Other
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

function run(memory: EnveMemory): void {
  switch (command) {
    case 'note': {
      const item = memory.items.saveNote({ body: text(0, 'text'), title: opts.title, project: opts.project, tags: opts.tag });
      return emit(item, `Saved note ${item.id}`);
    }
    case 'link': {
      const { item, created } = memory.items.saveLink({
        url: arg(0, 'url'), title: opts.title, note: opts.note, project: opts.project, tags: opts.tag,
      });
      return emit({ item, created }, `${created ? 'Saved' : 'Already saved'}: ${item.id}`);
    }
    case 'search': {
      const hits = memory.search.query(text(0, 'query'), filter(), limit());
      return emit(hits, hits.length ? hits.map(format.hitLine).join('\n') : 'No matches.');
    }
    case 'list': {
      const items = memory.items.list(filter(), limit());
      return emit(items, items.length ? items.map(format.itemLine).join('\n') : 'Nothing saved yet.');
    }
    case 'show': {
      const item = memory.items.get(arg(0, 'id'));
      return emit(item, format.itemDetail(item));
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
      };
      return emit(info, Object.entries(info).map(([k, v]) => `${k.padEnd(14)}${v}`).join('\n'));
    }
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
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
  ${JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: node, args } } })}`;
}

function main(): number {
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
  if (command === 'mcp') {
    // Stays open for the life of the process; stdio EOF ends it.
    serveMemoryOverStdio(EnveMemory.open({ home: opts.home, actor: 'mcp' }), pkg.version);
    return 0;
  }

  const memory = EnveMemory.open({ home: opts.home, actor: 'cli' });
  try {
    run(memory);
    return 0;
  } finally {
    memory.close();
  }
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`${error.message}\nRun \`enve-memory --help\` for usage.`);
    process.exitCode = 2;
  } else if (error instanceof MemoryError) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
