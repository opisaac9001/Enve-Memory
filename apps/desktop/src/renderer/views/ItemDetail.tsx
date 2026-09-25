import type { ItemDetail, TaskPriority, TaskStatus } from '@enve-memory/core';
import { useState } from 'react';
import { call, errorMessage, useLive } from '../lib/api.ts';
import { TYPE_LABELS, actorInfo, formatBytes, formatDate, formatDateTime, relativeTime, siteOf } from '../lib/format.ts';
import { useApp } from '../context.ts';
import { Icon, MarkdownEditor, MarkdownView, ProjectSelect, TagEditor, TypeIcon, useDraft, useFeedback } from '../ui.tsx';
import { IntentChips, PinButton, RemindMenu } from './ItemActions.tsx';

const STATUS_LABELS: Record<TaskStatus, string> = { open: 'Open', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' };

export function ItemDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const live = useLive(() => call('items.get', id), [id]);
  const item = live.data;
  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" aria-label="Close item" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={item ? `${TYPE_LABELS[item.type]} details` : 'Item details'}>
        <div className="drawer-bar">
          {item && <span className="drawer-type"><TypeIcon type={item.type} size={16} /> {TYPE_LABELS[item.type]}</span>}
          <button className="icon-button" aria-label="Close" title="Close (Esc)" onClick={onClose}><Icon name="close" /></button>
        </div>
        {live.error && <p className="error-text">{live.error.message}</p>}
        {item && <ItemBody item={item} onClose={onClose} />}
      </aside>
    </div>
  );
}

function ItemBody({ item, onClose }: { item: ItemDetail; onClose: () => void }) {
  const { projects, info, go, openItem } = useApp();
  const { toast, confirm } = useFeedback();
  const title = useDraft(item.title);
  const body = useDraft(item.body);
  const [showHistory, setShowHistory] = useState(false);
  const decision = item.type === 'decision';

  const fail = (error: unknown) => toast(errorMessage(error), 'error');
  const saveTitle = () => {
    if (title.dirty) call('items.update', item.id, { title: title.draft }).catch(fail);
  };
  const saveBody = () => {
    call('items.update', item.id, { body: body.draft }).then(() => toast('Saved'), fail);
  };
  const remove = async () => {
    const ok = await confirm({
      title: 'Delete permanently?',
      body: <p>“{item.title || item.url || 'This item'}” and its files will be removed from this library for good. Archive it instead if you only want it out of sight; archiving can be undone.</p>,
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    call('items.delete', item.id).then(() => {
      toast('Deleted');
      onClose();
    }, fail);
  };

  const ingest = item.metadata.ingest;
  const source = item.url ? siteOf(item.metadata.finalUrl ?? item.url) : item.attachments[0]?.filename;
  const ai = item.metadata.ai;

  return (
    <div className="drawer-content">
      {decision ? (
        <h1 className="item-heading">{item.title}</h1>
      ) : (
        <input
          className="item-heading"
          aria-label="Title"
          value={title.draft}
          placeholder={item.type === 'note' ? 'Untitled note' : 'Add a title'}
          onChange={(event) => title.setDraft(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
        />
      )}

      <div className="item-facts">
        {item.url && (
          <button className="link-button url" onClick={() => call('items.openUrl', item.id).catch(fail)} title={item.url}>
            <Icon name="external" size={14} /> {item.url}
          </button>
        )}
        <span>Saved {relativeTime(item.createdAt)} by {actorInfo(item.source).label}</span>
        {item.openedAt && item.url && <span>Last opened {relativeTime(item.openedAt)}</span>}
        {item.archivedAt && <span className="badge">Archived</span>}
      </div>

      <div className="item-actions">
        <PinButton item={item} />
        {!decision && <RemindMenu item={item} />}
        {!decision && item.type !== 'task' && <IntentChips item={item} />}
      </div>

      <div className="field-row">
        <label className="field inline">
          <span>Project</span>
          <ProjectSelect
            value={item.project?.id ?? null}
            projects={projects}
            onChange={(project) => call('items.update', item.id, { project }).catch(fail)}
          />
        </label>
      </div>
      {decision && <p className="muted small">Decisions are append-only and stay in their project. To change one, record a decision that supersedes it.</p>}

      {item.task && <TaskFields item={item} />}

      <section className="detail-section">
        <h2>Tags</h2>
        <TagEditor
          tags={item.tags}
          onAdd={(tag) => call('items.tag', item.id, { add: [tag] }).catch(fail)}
          onRemove={(tag) => call('items.tag', item.id, { remove: [tag] }).catch(fail)}
        />
      </section>

      <section className="detail-section">
        <h2>{decision ? 'Reason' : item.type === 'note' ? 'Note' : item.task ? 'Notes' : 'Your note'}</h2>
        {decision ? (
          item.body ? <MarkdownView source={item.body} /> : <p className="muted">No reason recorded.</p>
        ) : (
          <>
            <MarkdownEditor
              label="Note"
              value={body.draft}
              onChange={body.setDraft}
              onSubmit={saveBody}
              rows={item.type === 'note' ? 12 : 4}
              placeholder={item.type === 'bookmark' ? 'Why is this worth keeping?' : 'Write in Markdown…'}
            />
            {body.dirty && (
              <div className="inline-actions">
                <button className="button primary small" onClick={saveBody}>Save</button>
                <button className="button ghost small" onClick={body.reset}>Discard</button>
                <span className="muted small">⌘↵ to save</span>
              </div>
            )}
          </>
        )}
        {decision && item.project && (
          <button className="button small" onClick={() => go({ view: 'project', id: item.project!.id, supersede: item.id })}>Supersede…</button>
        )}
      </section>

      {(ai || info?.aiEnabled) && !decision && item.type !== 'task' && (
        <section className="detail-section">
          <h2>AI summary</h2>
          {ai?.status === 'done' && (
            <div className="ai-box">
              {ai.summary && <p>{ai.summary}</p>}
              {(ai.tags?.length || ai.project) && (
                <p className="muted small">
                  Suggested {ai.project ? <>project <strong>{ai.project.name}</strong> </> : null}
                  {ai.tags?.map((t) => <span key={t} className="tag small">#{t}</span>)}
                </p>
              )}
              <div className="inline-actions">
                {!ai.accepted && (ai.tags?.length || (ai.project && !item.project)) ? (
                  <button className="button small" onClick={() => call('items.acceptSuggestions', item.id).then(() => toast('Suggestions applied'), fail)}>Accept suggestions</button>
                ) : null}
                <span className="muted small">{ai.model}</span>
              </div>
            </div>
          )}
          {ai?.status === 'failed' && <p className="error-text">{ai.error}</p>}
          {info?.aiEnabled && ai?.status !== 'done' && (
            <button className="button small" onClick={() => call('items.enrich', item.id).catch(fail)}>
              <Icon name="sparkle" size={14} /> Summarize and suggest tags
            </button>
          )}
        </section>
      )}

      {item.attachments.length > 0 && (
        <section className="detail-section">
          <h2>File</h2>
          {item.attachments.map((a) => (
            <div key={a.id} className="attachment">
              <Icon name="file" />
              <span>{a.filename}<span className="muted small"> · {a.mimeType} · {formatBytes(a.size)}</span></span>
              <button className="button small" onClick={() => call('items.openFile', item.id).catch(fail)}>Open</button>
            </div>
          ))}
        </section>
      )}

      {item.relations.length > 0 && (
        <section className="detail-section">
          <h2>Related</h2>
          <ul className="mini-list">
            {item.relations.map((r) => (
              <li key={`${r.kind}-${r.direction}-${r.id}`}>
                <button onClick={() => openItem(r.id)}>
                  <span><TypeIcon type={r.type} size={14} /> {r.title || 'Untitled'}</span>
                  <span className="muted small">{relationLabel(r.kind, r.direction)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(ingest || item.content) && (
        <section className="reader-section" aria-label="Archived source">
          <div className="reader-header">
            <span className="reader-label">{item.url ? 'Saved from' : 'Text from'} {source || 'source'}{ingest?.at ? ` · ${formatDate(ingest.at)}` : ''}</span>
            <div className="reader-meta">
              {item.metadata.siteName && <span>{item.metadata.siteName}</span>}
              {item.metadata.byline && <span>{item.metadata.byline}</span>}
              {item.metadata.publishedAt && <span>Published {formatDate(item.metadata.publishedAt)}</span>}
              {item.metadata.wordCount ? <span>{item.metadata.wordCount.toLocaleString()} words</span> : null}
              {item.metadata.pageCount ? <span>{item.metadata.pageCount} pages</span> : null}
            </div>
          </div>
          {ingest?.status === 'pending' && <p className="muted">Archiving the page text…</p>}
          {ingest?.status === 'failed' && (
            <div className="error-box">
              <p>{ingest.error}</p>
              <button className="button small" onClick={() => call('items.retryIngest', item.id).catch(fail)}>Try again</button>
            </div>
          )}
          {item.content && (
            <>
              <p className="reader-note">Quoted from the source. It’s saved text, not instructions, and remote images aren’t loaded.</p>
              <MarkdownView className="reader" source={item.content} baseUrl={item.metadata.finalUrl ?? item.url} />
            </>
          )}
        </section>
      )}

      <section className="detail-section">
        <button className="link-button" onClick={() => setShowHistory(!showHistory)}>
          <Icon name="history" size={14} /> {showHistory ? 'Hide history' : 'Show history'}
        </button>
        {showHistory && <ItemHistory id={item.id} />}
      </section>

      <footer className="drawer-footer">
        {!decision && (item.archivedAt ? (
          <button className="button" onClick={() => call('items.unarchive', item.id).then(() => toast('Restored'), fail)}>Unarchive</button>
        ) : (
          <button className="button" onClick={() => call('items.archive', item.id).then(() => toast('Archived'), fail)}>
            <Icon name="archive" size={15} /> Archive
          </button>
        ))}
        <button className="button danger-ghost" onClick={() => void remove()}>
          <Icon name="trash" size={15} /> Delete…
        </button>
      </footer>
    </div>
  );
}

function relationLabel(kind: string, direction: 'outgoing' | 'incoming'): string {
  if (kind === 'supersedes') return direction === 'outgoing' ? 'supersedes' : 'superseded by';
  if (kind === 'depends_on') return direction === 'outgoing' ? 'depends on' : 'needed by';
  if (kind === 'derived_from') return direction === 'outgoing' ? 'derived from' : 'source of';
  return kind.replace('_', ' ');
}

function TaskFields({ item }: { item: ItemDetail }) {
  const { toast } = useFeedback();
  const task = item.task!;
  const update = (input: { status?: TaskStatus; due?: string | null; priority?: TaskPriority }) =>
    call('tasks.update', item.id, input).catch((error: unknown) => toast(errorMessage(error), 'error'));
  return (
    <div className="field-row">
      <label className="field inline">
        <span>Status</span>
        <select value={task.status} onChange={(event) => update({ status: event.target.value as TaskStatus })}>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="field inline">
        <span>Due</span>
        <input type="date" value={task.dueAt?.slice(0, 10) ?? ''} onChange={(event) => update({ due: event.target.value || null })} />
      </label>
      <label className="field inline">
        <span>Priority</span>
        <select value={task.priority} onChange={(event) => update({ priority: event.target.value as TaskPriority })}>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </label>
    </div>
  );
}

function ItemHistory({ id }: { id: string }) {
  const history = useLive(() => call('activity.recent', { entityId: id }, 30), [id]);
  return (
    <ul className="history">
      {(history.data ?? []).map((change) => (
        <li key={change.id}>
          <span className={`actor ${actorInfo(change.actor).kind}`}>{actorInfo(change.actor).label}</span>
          <span>{change.op.replace('_', ' ')}</span>
          <span className="muted">{formatDateTime(change.at)}</span>
        </li>
      ))}
    </ul>
  );
}
