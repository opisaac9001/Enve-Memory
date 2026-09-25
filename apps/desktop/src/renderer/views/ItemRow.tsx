import type { Item } from '@enve-memory/core';
import type { ReactNode } from 'react';
import { call, errorMessage } from '../lib/api.ts';
import { INTENT_LABELS, TYPE_LABELS, displayTitle, formatReminder, relativeTime, siteOf } from '../lib/format.ts';
import { Icon, TypeIcon, useFeedback } from '../ui.tsx';
import { OpenLinkButton, PinButton, RemindMenu } from './ItemActions.tsx';

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

export function ItemRow({ item, onOpen, children, showProject = true }: {
  item: Item;
  onOpen: (id: string) => void;
  children?: ReactNode;
  showProject?: boolean;
}) {
  const site = item.type === 'bookmark' ? siteOf(item.url) : '';
  const organizable = item.type !== 'decision';
  return (
    <div className={`item-row ${item.archivedAt ? 'archived' : ''}`}>
      <button className="item-main" onClick={() => onOpen(item.id)}>
        <TypeIcon type={item.type} />
        <span className="item-text">
          <span className="item-title">{displayTitle(item)}</span>
          <span className="item-meta">
            {item.pinnedAt && <span className="meta-flag" title="Pinned"><Icon name="pin" size={12} /></span>}
            <span>{TYPE_LABELS[item.type]}</span>
            {item.intent && <span className="intent-chip">{INTENT_LABELS[item.intent]}</span>}
            {site && <span>{site}</span>}
            {showProject && item.project && <span className="project-chip">{item.project.name}</span>}
            {item.tags.map((tag) => <span key={tag} className="tag small">#{tag}</span>)}
            {item.remindAt && <span className="meta-flag"><Icon name="bell" size={12} /> {formatReminder(item.remindAt)}</span>}
            {item.archivedAt && <span>Archived</span>}
            <span>{relativeTime(item.updatedAt)}</span>
          </span>
        </span>
      </button>
      <IngestBadge item={item} />
      {organizable && (
        <div className={`row-quick ${item.pinnedAt || item.remindAt ? 'has-state' : ''}`}>
          <OpenLinkButton item={item} />
          <PinButton item={item} compact />
          <RemindMenu item={item} compact />
        </div>
      )}
      {children && <div className="row-actions">{children}</div>}
    </div>
  );
}
