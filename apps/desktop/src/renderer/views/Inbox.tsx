import type { Item } from '@enve-memory/core';
import { call, errorMessage, useLive } from '../lib/api.ts';
import { useApp } from '../context.ts';
import { Empty, Icon, ProjectSelect, useFeedback } from '../ui.tsx';
import { ItemRow } from './ItemRow.tsx';

function Suggestions({ item }: { item: Item }) {
  const { toast } = useFeedback();
  const ai = item.metadata.ai;
  if (!ai || ai.status !== 'done' || ai.accepted) return null;
  const hasFiling = Boolean(ai.tags?.length || (ai.project && !item.project));
  return (
    <div className="suggestion">
      <Icon name="sparkle" size={15} />
      <div>
        {ai.summary && <p>{ai.summary}</p>}
        {hasFiling && (
          <p className="muted">
            Suggested{ai.project && !item.project ? <> project <strong>{ai.project.name}</strong></> : null}
            {ai.tags?.length ? <> tags {ai.tags.map((t) => <span key={t} className="tag small">#{t}</span>)}</> : null}
          </p>
        )}
      </div>
      {hasFiling && (
        <button
          className="button small"
          onClick={() => call('items.acceptSuggestions', item.id).then(() => toast('Suggestions applied'), (error: unknown) => toast(errorMessage(error), 'error'))}
        >
          Accept
        </button>
      )}
    </div>
  );
}

export function Inbox() {
  const { projects, openItem } = useApp();
  const { toast } = useFeedback();
  const inbox = useLive(() => call('items.inbox'), []);
  const items = inbox.data ?? [];

  const file = (item: Item, project: string | null) => {
    if (!project) return;
    call('items.update', item.id, { project }).then(
      (updated) => toast(`Filed into ${updated.project?.name}`),
      (error: unknown) => toast(errorMessage(error), 'error'),
    );
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Inbox</h1>
        <p className="subtitle">Everything saved without a project. File it, or archive what you don’t need to see again.</p>
      </header>
      {inbox.data && items.length === 0 && (
        <Empty title="Inbox zero">New notes, links and files land here until you file them into a project.</Empty>
      )}
      <div className="rows">
        {items.map((item) => (
          <div key={item.id} className="inbox-entry">
            <ItemRow item={item} onOpen={openItem} showProject={false}>
              <ProjectSelect value={null} onChange={(project) => file(item, project)} projects={projects} emptyLabel="File into…" label={`File ${item.title || 'item'} into project`} />
              <button
                className="icon-button"
                title="Archive"
                aria-label="Archive"
                onClick={() => call('items.archive', item.id).then(() => toast('Archived'), (error: unknown) => toast(errorMessage(error), 'error'))}
              >
                <Icon name="archive" size={16} />
              </button>
            </ItemRow>
            <Suggestions item={item} />
          </div>
        ))}
      </div>
    </div>
  );
}
