import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EXPORT_FORMAT, type EnveMemory, type ItemDetail, type Project } from '@enve-memory/core';
import { type ImportResult, emptyResult, record } from './result.ts';

interface ExportFile {
  format: string;
  version: number;
  projects: Project[];
  items: ItemDetail[];
  relations: { from: string; to: string; kind: string }[];
}

/**
 * Restores a Petty Memory export (`petty-memory export`) into this library, keeping ids and dates, so moving to a
 * new computer or recovering from an export loses nothing. Anything already present (same id) is left alone.
 */
export function importEnveExport(memory: EnveMemory, dir: string): ImportResult {
  const path = join(dir, 'metadata.json');
  if (!existsSync(path)) throw new Error(`${dir} has no metadata.json; is it a Petty Memory export folder?`);
  const data = JSON.parse(readFileSync(path, 'utf8')) as ExportFile;
  if (data.format !== EXPORT_FORMAT) throw new Error(`${path} is not a Petty Memory export.`);
  const result = emptyResult();
  const files = indexFiles(dir);

  memory.withActor('import:enve', () => {
    for (const project of data.projects) {
      record(result, `project ${project.name}`, () => {
        if (projectExists(memory, project.id)) return false;
        memory.projects.create({ id: project.id, name: project.name, description: project.description, instructions: project.instructions, createdAt: project.createdAt });
        if (project.memory) memory.projects.setMemory(project.id, project.memory);
        if (project.status !== 'active') memory.projects.update(project.id, { status: project.status });
        return true;
      });
    }
    // Decisions first-to-last so supersedes links point at decisions that already exist.
    const ordered = [...data.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const item of ordered) {
      record(result, item.title || item.url || item.id, () => {
        if (itemExists(memory, item.id)) return false;
        const project = item.project && projectExists(memory, item.project.id) ? item.project.id : undefined;
        const common = { id: item.id, createdAt: item.createdAt, project, tags: item.tags };
        if (item.type === 'task') {
          memory.tasks.create({ ...common, title: item.title, notes: item.body, due: item.task?.dueAt ?? undefined, priority: item.task?.priority });
          if (item.task && item.task.status !== 'open') memory.tasks.update(item.id, { status: item.task.status });
        } else if (item.type === 'decision' && project) {
          const supersedes = item.relations.filter((r) => r.kind === 'supersedes' && r.direction === 'outgoing' && itemExists(memory, r.id)).map((r) => r.id);
          memory.decisions.record({ ...common, project, decision: item.title, reason: item.body, supersedes });
        } else if (item.attachments.length > 0 && files.has(item.attachments[0]!.sha256)) {
          const attachment = item.attachments[0]!;
          memory.files.save({
            data: readFileSync(files.get(attachment.sha256)!), filename: attachment.filename, mimeType: attachment.mimeType,
            title: item.title, note: item.body, ...common,
          });
        } else {
          memory.items.insert({ ...common, type: item.type, title: item.title, body: item.body, url: item.url, content: item.content, metadata: item.metadata });
        }
        if (item.archivedAt) memory.items.archive(item.id);
        return true;
      });
    }
    for (const relation of data.relations) {
      if (relation.kind === 'supersedes') continue;
      record(result, `relation ${relation.kind}`, () => {
        if (!itemExists(memory, relation.from) || !itemExists(memory, relation.to)) return false;
        const before = memory.items.get(relation.from).relations.length;
        return memory.items.relate(relation.from, relation.to, relation.kind).relations.length > before;
      });
    }
  });
  return result;
}

function projectExists(memory: EnveMemory, id: string): boolean {
  try {
    return memory.projects.resolve(id).id === id;
  } catch {
    return false;
  }
}

function itemExists(memory: EnveMemory, id: string): boolean {
  try {
    memory.items.get(id);
    return true;
  } catch {
    return false;
  }
}

/** Exports copy files under per-project names, so match them back by content. */
function indexFiles(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (full.includes(`${join('files', '')}`)) found.set(createHash('sha256').update(readFileSync(full)).digest('hex'), full);
    }
  };
  if (existsSync(join(dir, 'projects'))) walk(join(dir, 'projects'));
  return found;
}
