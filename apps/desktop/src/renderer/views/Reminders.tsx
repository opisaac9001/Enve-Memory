import type { Item } from '@enve-memory/core';
import { call, errorMessage, useLive } from '../lib/api.ts';
import { useApp } from '../context.ts';
import { Empty, useFeedback } from '../ui.tsx';
import { RemindMenu } from './ItemActions.tsx';
import { ItemRow } from './ItemRow.tsx';

function ReminderRow({ item, due }: { item: Item; due: boolean }) {
  const { openItem } = useApp();
  const { toast } = useFeedback();
  return (
    <div className="inbox-entry reminder-entry">
      <ItemRow item={item} onOpen={openItem}>
        {due ? (
          <>
            <RemindMenu item={item} label="Snooze" />
            <button
              className="button small"
              onClick={() => call('items.setReminder', item.id, null).then(() => toast('Done'), (error: unknown) => toast(errorMessage(error), 'error'))}
            >
              Done
            </button>
          </>
        ) : (
          <RemindMenu item={item} label="Change" />
        )}
      </ItemRow>
    </div>
  );
}

export function RemindersView() {
  const reminders = useLive(() => call('reminders.list'), []);
  const { due = [], upcoming = [] } = reminders.data ?? {};
  return (
    <div className="page">
      <header className="page-header">
        <h1>Reminders</h1>
        <p className="subtitle">Petty Memory taps you on the shoulder at the time you chose, with a notification that opens the item.</p>
      </header>
      {reminders.data && due.length + upcoming.length === 0 && (
        <Empty title="No reminders">Use the bell on any item to be reminded tonight, tomorrow, this weekend or on a date you pick.</Empty>
      )}
      {due.length > 0 && (
        <section className="task-group" aria-label="Due">
          <h2>Due</h2>
          <div className="rows">{due.map((item) => <ReminderRow key={item.id} item={item} due />)}</div>
        </section>
      )}
      {upcoming.length > 0 && (
        <section className="task-group" aria-label="Upcoming">
          <h2>Upcoming</h2>
          <div className="rows">{upcoming.map((item) => <ReminderRow key={item.id} item={item} due={false} />)}</div>
        </section>
      )}
    </div>
  );
}
