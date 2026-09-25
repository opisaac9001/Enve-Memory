import type { Answer } from '@enve-memory/ai';
import type { ApiClient, Change, Rule, Decision, Item, ItemDetail, Project, ProjectBriefing, SearchHit, Task } from '@enve-memory/core';

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
  const via = hit.match === 'semantic' ? '  ~' : '';
  const lines = heading
    ? [`${hit.type}${status}: ${oneLine(heading)}${project}${via}`, `    ${oneLine(hit.snippet, 120)}`]
    : [`${hit.type}${status}: ${oneLine(hit.snippet, 120)}${project}${via}`];
  return [...lines, `    ${hit.id}`].join('\n');
}

export function projectLine(project: Project): string {
  const description = project.description ? ` — ${oneLine(project.description, 60)}` : '';
  const status = project.status === 'active' ? '' : ` [${project.status}]`;
  return `${project.name}${status}${description}\n    ${project.slug}  ${project.id}`;
}

export function savedLine(item: ItemDetail): string {
  const ingest = item.metadata.ingest;
  const status = ingest?.status === 'failed' ? `  (couldn't archive: ${ingest.error})` : ingest?.status === 'pending' ? '  (archiving later)' : '';
  return `${label(item)}${status}\n    ${item.id}`;
}

const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function itemDetail(item: ItemDetail): string {
  const lines = [`${item.type}: ${item.title || '(untitled)'}`, `id:      ${item.id}`];
  if (item.url) lines.push(`url:     ${item.url}`);
  for (const file of item.attachments) lines.push(`file:    ${file.filename} (${file.mimeType}, ${size(file.size)})`);
  const { siteName, byline, publishedAt, excerpt, ingest } = item.metadata;
  const source = [siteName, byline, publishedAt && localDate(publishedAt)].filter(Boolean).join(' · ');
  if (source) lines.push(`source:  ${source}`);
  if (excerpt) lines.push(`excerpt: ${oneLine(excerpt, 200)}`);
  if (ingest?.status === 'failed') lines.push(`archive: failed — ${ingest.error}`);
  else if (ingest?.status === 'pending') lines.push('archive: pending');
  if (item.content) lines.push(`text:    ${item.content.length.toLocaleString()} characters archived (show --content)`);
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

export function clientLine(client: ApiClient): string {
  const state = client.revokedAt ? '  [revoked]' : client.lastUsedAt ? `  last used ${client.lastUsedAt}` : '  never used';
  return `${client.name}  (${client.scopes.join(', ')})  ${client.tokenHint}${state}\n    ${client.id}`;
}

export function suggestions(item: ItemDetail): string {
  const ai = item.metadata.ai;
  if (!ai || ai.status !== 'done') return 'No suggestions.';
  const lines = [`${label(item)}`, '', ai.summary ?? ''];
  if (ai.tags?.length) lines.push('', `Suggested tags:    ${ai.tags.map((t) => `#${t}`).join(' ')}`);
  if (ai.project) lines.push(`Suggested project: ${ai.project.name}`);
  lines.push('', `Apply with: enve-memory accept ${item.id}`);
  return lines.join('\n');
}

export function answer({ answer: text, sources }: Answer): string {
  if (sources.length === 0) return text;
  return `${text}\n\n${sources.map((s) => `[${s.n}] ${s.title || s.url || s.type}  ${s.id}`).join('\n')}`;
}

export function ruleLine(rule: Rule): string {
  const when = [
    rule.conditions.types && `type ${rule.conditions.types.join('/')}`,
    rule.conditions.domains && `from ${rule.conditions.domains.join(', ')}`,
    rule.conditions.keywords && `mentions ${rule.conditions.keywords.map((k) => `"${k}"`).join(' or ')}`,
    rule.conditions.source && `saved by ${rule.conditions.source}*`,
  ].filter(Boolean).join(' and ');
  const then = [rule.actions.tags && rule.actions.tags.map((t) => `#${t}`).join(' '), rule.actions.project && 'file into project'].filter(Boolean).join(', ');
  return `${rule.enabled ? '' : '[off] '}${rule.name}: when ${when} → ${then}\n    ${rule.id}`;
}
