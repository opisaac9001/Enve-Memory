import type { Item } from '@enve-memory/core';
import type { ReactNode } from 'react';
import { call, errorMessage } from '../lib/api.ts';
import { TYPE_LABELS, displayTitle, relativeTime, siteOf } from '../lib/format.ts';
import { TypeIcon, useFeedback } from '../ui.tsx';

export function IngestBadge({ item }: { item: Item }) {
  const { toast } = useFeedback();
  const status = item.metadata.ingest?.status;
  if (status === 'pending') return <span className="badge pending">Archiving…</span>;
  if (status !== 'failed') return null;
  return (
    <span className="badge failed" title={item.metadata.ingest?.error}>
      Archive failed
      <button
        className="link-button"
        onClick={(event) => {
          event.stopPropagation();
          call('items.retryIngest', item.id).then(
            (updated) => toast(updated.metadata.ingest?.status === 'done' ? 'Archived' : updated.metadata.ingest?.error ?? 'Still failing', updated.metadata.ingest?.status === 'done' ? 'info' : 'error'),
            (error: unknown) => toast(errorMessage(error), 'error'),
          );
        }}
      >
        Retry
      </button>
    </span>
  );
}

export function ItemRow({ item, tags, onOpen, children, showProject = true }: {
  item: Item;
  tags?: string[];
  onOpen: (id: string) => void;
  children?: ReactNode;
  showProject?: boolean;
}) {
  const site = item.type === 'bookmark' ? siteOf(item.url) : '';
  return (
    <div className={`item-row ${item.archivedAt ? 'archived' : ''}`}>
      <button className="item-main" onClick={() => onOpen(item.id)}>
        <TypeIcon type={item.type} />
        <span className="item-text">
          <span className="item-title">{displayTitle(item)}</span>
          <span className="item-meta">
            <span>{TYPE_LABELS[item.type]}</span>
            {site && <span>{site}</span>}
            {showProject && item.project && <span className="project-chip">{item.project.name}</span>}
            {tags?.map((tag) => <span key={tag} className="tag small">#{tag}</span>)}
            {item.archivedAt && <span>Archived</span>}
            <span>{relativeTime(item.updatedAt)}</span>
          </span>
        </span>
      </button>
      <IngestBadge item={item} />
      {children && <div className="row-actions">{children}</div>}
    </div>
  );
}
