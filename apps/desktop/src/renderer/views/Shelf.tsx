import type { Shelf } from '../../shared/ipc.ts';
import { UNOPENED_DAYS } from '../../shared/ipc.ts';
import { call, useLive } from '../lib/api.ts';
import { useApp } from '../context.ts';
import { Empty } from '../ui.tsx';
import { ItemRow } from './ItemRow.tsx';

export const SHELF_COPY: Record<Shelf, { title: string; intro: string; empty: string }> = {
  pinned: { title: 'Pinned', intro: 'What you want within reach, newest pin first.', empty: 'Pin anything from its row or its detail view to keep it here.' },
  read: { title: 'Read', intro: 'Articles and documents you saved to read.', empty: 'Links to articles land here automatically; set Read on anything else.' },
  watch: { title: 'Watch', intro: 'Videos and talks you meant to get to.', empty: 'Video links land here automatically.' },
  buy: { title: 'Buy', intro: 'Things you were thinking of buying.', empty: 'Product pages land here automatically.' },
  revisit: { title: 'Revisit', intro: 'Things worth coming back to.', empty: 'Mark an item Revisit from its detail view.' },
  unopened: {
    title: 'Unopened',
    intro: `Links saved more than ${UNOPENED_DAYS} days ago that you haven’t opened from Enve Memory yet.`,
    empty: 'Nothing forgotten. Links you open from here drop off this shelf.',
  },
};

export function ShelfView({ shelf }: { shelf: Shelf }) {
  const { openItem } = useApp();
  const items = useLive(() => call('shelves.list', shelf), [shelf]);
  const copy = SHELF_COPY[shelf];
  return (
    <div className="page">
      <header className="page-header">
        <h1>{copy.title}</h1>
        <p className="subtitle">{copy.intro}</p>
      </header>
      {items.data?.length === 0 && <Empty title="Nothing here">{copy.empty}</Empty>}
      <div className="rows">{(items.data ?? []).map((item) => <ItemRow key={item.id} item={item} onOpen={openItem} />)}</div>
    </div>
  );
}
