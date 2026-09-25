import type { Change, Decision, Item, ItemDetail, Project, ProjectBriefing, SearchHit, Task } from '@enve-memory/core';

const oneLine = (text: string, max = 80) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA');

const label = (item: Pick<Item, 'title' | 'url'> & { body?: string }) =>
  oneLine(item.title || item.body || item.url || '(untitled)');

const taskMark = (task: Task['task']) =>
  ({ open: '[ ]', in_progress: '[~]', done: '[x]', cancelled: '[-]' })[task.status];

export function itemLine(item: Item | Task): string {
  const mark = 'task' in item && item.task ? taskMark(item.task) : `${item.type}:`;
  const project = item.project ? `  (${item.project.name})` : '';
  const due = 'task' in item && item.task?.dueAt ? `  due ${item.task.dueAt}` : '';
  return `${mark} ${label(item)}${project}${due}\n    ${item.id}`;
}

export function hitLine(hit: SearchHit): string {
  const project = hit.project ? `  (${hit.project.name})` : '';
  const status = hit.taskStatus ? ` [${hit.taskStatus}]` : '';
  const heading = hit.title || hit.url;
  const lines = heading
    ? [`${hit.type}${status}: ${oneLine(heading)}${project}`, `    ${oneLine(hit.snippet, 120)}`]
    : [`${hit.type}${status}: ${oneLine(hit.snippet, 120)}${project}`];
  return [...lines, `    ${hit.id}`].join('\n');
}

export function projectLine(project: Project): string {
  const description = project.description ? ` — ${oneLine(project.description, 60)}` : '';
  const status = project.status === 'active' ? '' : ` [${project.status}]`;
  return `${project.name}${status}${description}\n    ${project.slug}  ${project.id}`;
}

export function itemDetail(item: ItemDetail): string {
  const lines = [`${item.type}: ${item.title || '(untitled)'}`, `id:      ${item.id}`];
  if (item.url) lines.push(`url:     ${item.url}`);
  if (item.project) lines.push(`project: ${item.project.name}`);
  if (item.task) {
    lines.push(`status:  ${item.task.status} (${item.task.priority} priority)`);
    if (item.task.dueAt) lines.push(`due:     ${item.task.dueAt}`);
  }
  if (item.tags.length) lines.push(`tags:    ${item.tags.map((t) => `#${t}`).join(' ')}`);
  lines.push(`saved:   ${item.createdAt} by ${item.source}`);
  if (item.archivedAt) lines.push(`archived: ${item.archivedAt}`);
  for (const r of item.relations) {
    lines.push(`${r.direction === 'outgoing' ? r.kind : `${r.kind} (from)`}: ${r.title || r.id}  ${r.id}`);
  }
  if (item.body) lines.push('', item.body);
  return lines.join('\n');
}

export function decisionLine(decision: Decision): string {
  const superseded = decision.supersededBy ? '  (superseded)' : '';
  const reason = decision.reason ? `\n    because: ${oneLine(decision.reason, 100)}` : '';
  return `${localDate(decision.createdAt)}  ${decision.decision}${superseded}${reason}\n    ${decision.id}`;
}

export function briefing({ project, decisions, openTasks, recentItems }: ProjectBriefing): string {
  const sections = [`# ${project.name}${project.status === 'active' ? '' : ` [${project.status}]`}`];
  if (project.description) sections.push(project.description);
  if (project.instructions) sections.push(`## Instructions\n${project.instructions}`);
  if (project.memory) sections.push(`## Memory\n${project.memory}`);
  if (decisions.length) sections.push(`## Decisions\n${decisions.map(decisionLine).join('\n')}`);
  if (openTasks.length) sections.push(`## Open tasks\n${openTasks.map(itemLine).join('\n')}`);
  if (recentItems.length) sections.push(`## Recent\n${recentItems.map(itemLine).join('\n')}`);
  return sections.join('\n\n');
}

export function changeLine(change: Change): string {
  const data = change.data ?? {};
  const subject = ['title', 'name', 'body', 'type'].map((k) => data[k]).find((v) => typeof v === 'string' && v) as string | undefined;
  return `${change.at}  ${change.actor}  ${change.op} ${change.entity}${subject ? `: ${oneLine(subject, 60)}` : ''}\n    ${change.entityId}`;
}
