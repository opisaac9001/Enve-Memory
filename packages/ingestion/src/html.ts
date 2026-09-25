import { Readability } from '@mozilla/readability';
import type { ItemMetadata } from '@enve-memory/core';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

export interface Extracted {
  title: string;
  content: string;
  metadata: ItemMetadata;
}

const MAX_CONTENT = 1024 * 1024;

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button']);

/** Readable article as Markdown plus page metadata. Never executes page scripts. */
export function extractHtml(html: string, url: string): Extracted {
  const { document } = parseHTML(html);
  const meta = (...names: string[]) => {
    for (const name of names) {
      const value = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content')?.trim();
      if (value) return value;
    }
    return undefined;
  };
  const absolute = (value: string | undefined) => {
    if (!value) return undefined;
    try {
      return new URL(value, url).href;
    } catch {
      return undefined;
    }
  };

  const metaTitle = meta('og:title', 'twitter:title') ?? document.querySelector('title')?.textContent?.trim();
  const published = meta('article:published_time', 'datePublished', 'date', 'DC.date.issued')
    ?? document.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined;
  const lang = document.documentElement?.getAttribute('lang') ?? undefined;

  // linkedom documents have no base URL, so Readability can't absolutize links itself.
  for (const [selector, attribute] of [['a[href]', 'href'], ['img[src]', 'src']] as const) {
    for (const element of document.querySelectorAll(selector)) {
      const resolved = absolute(element.getAttribute(attribute) ?? undefined);
      if (resolved) element.setAttribute(attribute, resolved);
    }
  }
  for (const img of document.querySelectorAll('img[srcset]')) img.removeAttribute('srcset');

  // Readability mutates the document, so metadata is read first.
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 200 }).parse();
  const bodyHtml = article?.content ?? document.body?.innerHTML ?? '';
  const content = turndown.turndown(bodyHtml).replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CONTENT);
  const text = article?.textContent ?? content;

  const metadata: ItemMetadata = {
    siteName: article?.siteName ?? meta('og:site_name', 'application-name'),
    byline: article?.byline ?? meta('author', 'article:author'),
    excerpt: meta('og:description', 'description', 'twitter:description') ?? article?.excerpt ?? undefined,
    publishedAt: normalizeDate(published ?? article?.publishedTime ?? undefined),
    image: absolute(meta('og:image', 'twitter:image')),
    lang: lang || article?.lang || undefined,
    ogType: meta('og:type'),
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
  return { title: (article?.title || metaTitle || '').trim(), content, metadata: prune(metadata) };
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function prune(metadata: ItemMetadata): ItemMetadata {
  return Object.fromEntries(Object.entries(metadata).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as ItemMetadata;
}
