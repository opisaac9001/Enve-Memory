/** The first meaningful line of Markdown, without heading, quote or list markers. */
export function firstLine(text: string, max = 120): string {
  const line = text.split('\n').map((l) => l.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, '').trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** What to call an item that may have no title: its first line, then its URL. */
export function displayTitle(item: { title: string; body?: string; url?: string | null; type?: string }): string {
  return item.title || firstLine(item.body ?? '') || item.url || 'Untitled';
}
