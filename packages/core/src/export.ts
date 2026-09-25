import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { blobPath } from './blobs.ts';
import { type Context, slugify } from './context.ts';
import { invalid } from './errors.ts';
import type { ItemService } from './items.ts';
import type { ProjectService } from './projects.ts';
import type { DecisionService } from './decisions.ts';
import type { ItemDetail, Project } from './types.ts';

export const EXPORT_FORMAT = 'enve-memory-export';
export const EXPORT_VERSION = 1;

export interface ExportSummary {
  path: string;
  projects: number;
  items: number;
  files: number;
}

const INBOX = { slug: 'inbox', name: 'Inbox' };

/**
 * Writes the whole library as plain files: Markdown people can read and any notes app can open, plus a complete
 * metadata.json that a future Enve Memory (or anything else) can import. Useful even if this app disappears.
 */
export class ExportService {
  private readonly ctx: Context;
  private readonly items: ItemService;
  private readonly projects: ProjectService;
  private readonly decisions: DecisionService;

  constructor(ctx: Context, items: ItemService, projects: ProjectService, decisions: DecisionService) {
    this.ctx = ctx;
    this.items = items;
    this.projects = projects;
    this.decisions = decisions;
  }

  write(destination: string): ExportSummary {
    if (existsSync(destination)) throw invalid(`${destination} already exists. Choose a new folder for the export.`);
    mkdirSync(destination, { recursive: true });

    const projects = this.ctx.all<{ id: string }>(`SELECT id FROM projects ORDER BY name`).map((p) => this.projects.resolve(p.id));
    const ids = this.ctx.all<{ id: string }>(`SELECT id FROM items ORDER BY seq`).map((r) => r.id);
    const items = ids.map((id) => this.items.get(id));
    let files = 0;

    // Slugs and filenames can come from other devices through sync: re-derive them so nothing escapes the export folder.
    const groups: { slug: string; name: string; project: Project | null }[] = [
      ...projects.map((project) => ({ slug: slugify(project.slug) || 'project', name: project.name, project })),
      { ...INBOX, project: null },
    ];
    for (const group of groups) {
      const members = items.filter((item) => (item.project?.id ?? null) === (group.project?.id ?? null));
      if (!group.project && members.length === 0) continue;
      const dir = join(destination, 'projects', group.slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'README.md'), projectReadme(group.name, group.project));
      if (group.project) {
        const log = this.decisions.list(group.project.id, 10_000);
        if (log.length) {
          writeFileSync(join(dir, 'decisions.md'), `# Decisions: ${group.name}\n\n${log.map((d) =>
            `## ${d.createdAt.slice(0, 10)}: ${d.decision}${d.supersededBy ? ' _(superseded)_' : ''}\n\n${d.reason ? `${d.reason}\n\n` : ''}<sub>${d.id} · ${d.source}</sub>\n`).join('\n')}`);
        }
      }
      const tasks = members.filter((i) => i.type === 'task');
      if (tasks.length) {
        writeFileSync(join(dir, 'tasks.md'), `# Tasks: ${group.name}\n\n${tasks.map((t) => {
          const done = t.task?.status === 'done' ? 'x' : ' ';
          const extra = [t.task?.dueAt && `due ${t.task.dueAt}`, t.task?.priority !== 'normal' && t.task?.priority, t.task?.status === 'cancelled' && 'cancelled']
            .filter(Boolean).join(', ');
          return `- [${done}] ${t.title}${extra ? ` (${extra})` : ''}${t.body ? `\n  ${t.body.replace(/\n/g, '\n  ')}` : ''}`;
        }).join('\n')}\n`);
      }
      const links = members.filter((i) => i.type === 'bookmark');
      if (links.length) {
        writeFileSync(join(dir, 'links.md'), `# Links: ${group.name}\n\n${links.map((l) =>
          `- [${l.title || l.url}](${l.url})${l.body ? `: ${l.body.replace(/\n+/g, ' ')}` : ''}${l.content ? ` · [archived copy](archive/${fileSlug(l)}.md)` : ''}`).join('\n')}\n`);
      }
      const names = new Set<string>();
      for (const item of members) {
        if (item.type === 'note') writeUnique(join(dir, 'notes'), `${fileSlug(item)}.md`, names, document(item, item.body));
        if (item.type === 'bookmark' && item.content) writeUnique(join(dir, 'archive'), `${fileSlug(item)}.md`, names, document(item, item.content));
        for (const attachment of item.attachments) {
          const source = blobPath(this.ctx, attachment.sha256);
          if (!existsSync(source)) continue;
          const target = uniqueName(join(dir, 'files'), basename(attachment.filename) || 'file', names);
          mkdirSync(join(dir, 'files'), { recursive: true });
          copyFileSync(source, target);
          files++;
        }
      }
    }

    const tags = this.ctx.all<{ name: string }>(`SELECT name FROM tags ORDER BY name`).map((t) => t.name);
    const relations = this.ctx.all(`SELECT from_id AS "from", to_id AS "to", kind, created_at AS createdAt FROM relations ORDER BY created_at`);
    writeFileSync(join(destination, 'metadata.json'), JSON.stringify({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: this.ctx.now(),
      deviceId: this.ctx.deviceId,
      projects,
      items,
      tags,
      relations,
    }, null, 2));
    writeFileSync(join(destination, 'README.md'), exportReadme(projects.length, items.length));
    return { path: destination, projects: projects.length, items: items.length, files };
  }
}

function projectReadme(name: string, project: Project | null): string {
  if (!project) return `# ${name}\n\nItems that aren't filed under a project.\n`;
  const parts = [`# ${name}`];
  if (project.description) parts.push(project.description);
  if (project.instructions) parts.push(`## Instructions\n\n${project.instructions}`);
  if (project.memory) parts.push(`## Memory\n\n${project.memory}`);
  parts.push(`<sub>${project.id} · ${project.status} · created ${project.createdAt}</sub>`);
  return `${parts.join('\n\n')}\n`;
}

function document(item: ItemDetail, text: string): string {
  const front: Record<string, string | string[] | undefined> = {
    id: item.id,
    type: item.type,
    title: item.title || undefined,
    url: item.url ?? undefined,
    created: item.createdAt,
    updated: item.updatedAt,
    source: item.source,
    tags: item.tags.length ? item.tags : undefined,
  };
  const yaml = Object.entries(front)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map((t) => JSON.stringify(t)).join(', ')}]` : JSON.stringify(v)}`)
    .join('\n');
  const heading = item.title ? `# ${item.title}\n\n` : '';
  const note = item.type === 'bookmark' && item.body ? `> ${item.body.replace(/\n/g, '\n> ')}\n\n` : '';
  return `---\n${yaml}\n---\n\n${heading}${note}${text}\n`;
}

function fileSlug(item: ItemDetail): string {
  const base = slugify(item.title || item.body.slice(0, 60) || item.url || '') || item.type;
  return `${item.createdAt.slice(0, 10)}-${base.slice(0, 80)}`;
}

function uniqueName(dir: string, name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let candidate = name;
  for (let n = 2; taken.has(join(dir, candidate)); n++) candidate = `${stem}-${n}${ext}`;
  taken.add(join(dir, candidate));
  return join(dir, candidate);
}

function writeUnique(dir: string, name: string, taken: Set<string>, text: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(uniqueName(dir, name, taken), text);
}

function exportReadme(projects: number, items: number): string {
  return `# Enve Memory export

${projects} projects and ${items} items, exported ${new Date().toISOString()}.

- \`projects/<name>/README.md\`: the project's description, standing instructions and memory document.
- \`decisions.md\`, \`tasks.md\` and \`links.md\` in each project folder: the decision log, the task list and the bookmarks.
- \`notes/\`: one Markdown file per note, with YAML front matter.
- \`archive/\`: the readable text saved from each bookmarked page.
- \`files/\`: the original files and images.
- \`projects/inbox/\`: everything that isn't in a project.
- \`metadata.json\`: everything above as structured data, including ids, tags, relations and timestamps, for re-importing.
`;
}
