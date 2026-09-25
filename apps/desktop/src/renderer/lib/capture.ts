export type Capture = { kind: 'link'; url: string; note: string } | { kind: 'note'; body: string };

/** A single http(s) URL (or `www.` address), optionally followed by a note. Anything else is a note. */
export function detectCapture(input: string): Capture | null {
  const text = input.trim();
  if (!text) return null;
  const first = text.split(/\s/, 1)[0]!;
  const url = asUrl(first);
  if (url) return { kind: 'link', url, note: text.slice(first.length).trim() };
  return { kind: 'note', body: text };
}

function asUrl(token: string): string | null {
  const cleaned = token.replace(/[.,;:!?)\]>'"]+$/, '');
  const candidate = /^www\.[^\s/]+\.[a-z]{2,}/i.test(cleaned) ? `https://${cleaned}` : cleaned;
  if (!/^https?:\/\/[^\s]/i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.hostname ? url.href : null;
  } catch {
    return null;
  }
}
