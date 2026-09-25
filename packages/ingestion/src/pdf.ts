import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import type { Extracted } from './html.ts';

const MAX_CONTENT = 2 * 1024 * 1024;

export async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const { info } = await getMeta(pdf);
    const content = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CONTENT);
    const title = typeof info?.Title === 'string' ? info.Title.trim() : '';
    const author = typeof info?.Author === 'string' ? info.Author.trim() : '';
    return {
      title,
      content,
      metadata: {
        pageCount: totalPages,
        wordCount: content.split(/\s+/).filter(Boolean).length,
        ...(author ? { byline: author } : {}),
      },
    };
  } finally {
    await pdf.cleanup();
  }
}
