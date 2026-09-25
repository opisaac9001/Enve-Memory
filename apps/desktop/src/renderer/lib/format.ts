import type { ItemType } from '@enve-memory/core';

export function firstLine(text: string, max = 120): string {
  const line = text.split('\n').map((l) => l.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, '').trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function displayTitle(item: { title: string; body?: string; url?: string | null; type?: string }): string {
  return item.title || firstLine(item.body ?? '') || item.url || 'Untitled';
}

export function siteOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(iso, now);
}

export function formatDate(iso: string, now = Date.now()): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function dueInfo(due: string | null, now = new Date()): { label: string; tone: 'overdue' | 'soon' | 'later' } | null {
  if (!due) return null;
  const today = localDay(now);
  const day = due.length === 10 ? due : localDay(new Date(due));
  const tomorrow = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const week = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  if (day < today) return { label: `Overdue · ${formatDate(day)}`, tone: 'overdue' };
  if (day === today) return { label: 'Today', tone: 'soon' };
  if (day === tomorrow) return { label: 'Tomorrow', tone: 'soon' };
  return { label: formatDate(day), tone: day <= week ? 'soon' : 'later' };
}

export function isDueSoon(due: string | null, now = new Date()): boolean {
  const info = dueInfo(due, now);
  return info !== null && info.tone !== 'later';
}

export const TYPE_LABELS: Record<ItemType, string> = {
  note: 'Note', bookmark: 'Link', task: 'Task', decision: 'Decision', file: 'File', image: 'Image',
};

/** `mcp:claude-code` → "claude-code" via MCP. */
export function actorInfo(actor: string): { label: string; kind: 'ai' | 'device' | 'you' | 'background' } {
  const [source, ...rest] = actor.split(':');
  const name = rest.join(':');
  switch (source) {
    case 'mcp':
      return { label: name ? `${name} · MCP` : 'MCP client', kind: 'ai' };
    case 'api':
      return { label: name ? `${name} · API` : 'API client', kind: 'device' };
    case 'desktop':
      return { label: 'You · desktop', kind: 'you' };
    case 'cli':
      return { label: 'You · CLI', kind: 'you' };
    case 'ingest':
      return { label: 'Archiver', kind: 'background' };
    case 'ai':
      return { label: 'AI suggestions', kind: 'background' };
    case 'rule':
      return { label: name ? `Automation · ${name}` : 'Automation', kind: 'background' };
    case 'import':
      return { label: name ? `Import · ${name}` : 'Import', kind: 'you' };
    default:
      return { label: actor, kind: 'background' };
  }
}

/** FTS snippets mark matches as `[term]`; split them so the UI can highlight without HTML. */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  const pattern = /\[([^[\]]+)\]/g;
  let last = 0;
  for (let m = pattern.exec(snippet); m; m = pattern.exec(snippet)) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), match: false });
    parts.push({ text: m[1]!, match: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), match: false });
  return parts;
}
