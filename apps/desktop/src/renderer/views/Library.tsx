import { useEffect, useState } from 'react';
import type { ItemPage, ListedItem } from '../../shared/ipc.ts';
import { call, errorMessage, useLive } from '../lib/api.ts';
import { useApp, type LibraryType } from '../context.ts';
import { Empty, useFeedback } from '../ui.tsx';
import { ItemRow } from './ItemRow.tsx';

const PAGE_SIZE = 100;

const TITLES: Record<LibraryType | 'all', { title: string; empty: string }> = {
  all: { title: 'Library', empty: 'Everything you and your AI tools save shows up here.' },
  bookmark: { title: 'Links', empty: 'Paste a URL into the capture bar on Home, or use the browser extension.' },
  note: { title: 'Notes', empty: 'Jot a note from Home, or press ⌘N anywhere.' },
  file: { title: 'Files', empty: 'Drop PDFs and documents onto this window to save them. Their text becomes searchable.' },
  image: { title: 'Images', empty: 'Drop images onto this window to keep them with your notes.' },
};

export function Library({ type }: { type?: LibraryType }) {
  const { info, openItem } = useApp();
  const { toast } = useFeedback();
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<'updated' | 'created'>('updated');
  const [archived, setArchived] = useState(false);
  const [pages, setPages] = useState(1);
  useEffect(() => setPages(1), [type, tag, archived]);
  const list = useLive(async () => {
    const filter = { type, tag: tag || undefined, includeArchived: archived };
    const loaded: ListedItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < pages; page++) {
      const result: ItemPage = await call('items.page', filter, cursor, PAGE_SIZE);
      loaded.push(...result.items);
      cursor = result.next;
      if (!cursor) break;
    }
    return { items: loaded, more: cursor !== null };
  }, [type, tag, archived, pages]);
  const items = (list.data?.items ?? [])
    .filter((item) => type || (item.type !== 'task' && item.type !== 'decision'))
    .sort((a, b) => (sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));
  const failed = items.filter((item) => item.metadata.ingest?.status === 'failed').length;
  const copy = TITLES[type ?? 'all'];

  return (
    <div className="page">
      <header className="page-header">
        <h1>{copy.title}</h1>
      </header>
      <div className="toolbar">
        <select aria-label="Filter by tag" value={tag} onChange={(event) => setTag(event.target.value)}>
          <option value="">All tags</option>
          {(info?.stats.tagNames ?? []).map((name) => <option key={name} value={name}>#{name}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as 'updated' | 'created')}>
          <option value="updated">Recently changed</option>
          <option value="created">Recently saved</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /> Show archived
        </label>
        {failed > 0 && (
          <button
            className="button small"
            onClick={() => call('items.retryFailed').then((n) => toast(`Retrying ${n} failed archive${n === 1 ? '' : 's'}`), (error: unknown) => toast(errorMessage(error), 'error'))}
          >
            Retry {failed} failed
          </button>
        )}
      </div>
      {list.data && items.length === 0 && <Empty title={tag ? `Nothing tagged #${tag}` : 'Nothing here yet'}>{tag ? undefined : copy.empty}</Empty>}
      <div className="rows">
        {items.map((item) => <ItemRow key={item.id} item={item} tags={item.tags} onOpen={openItem} />)}
      </div>
      {list.data?.more && (
        <div className="load-more">
          <button className="button" onClick={() => setPages(pages + 1)}>Load more</button>
        </div>
      )}
    </div>
  );
}
