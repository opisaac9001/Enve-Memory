import type { Task } from '@enve-memory/core';
import { useState } from 'react';
import { call, useLive } from '../lib/api.ts';
import { useApp } from '../context.ts';
import { Empty } from '../ui.tsx';
import { AddTask, TaskRow } from './TaskRow.tsx';

const FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

export function Tasks() {
  const { go } = useApp();
  const [status, setStatus] = useState('active');
  const tasks = useLive(() => call('tasks.list', { status }, 200), [status]);
  const groups = new Map<string, { name: string; id: string | null; tasks: Task[] }>();
  for (const task of tasks.data ?? []) {
    const key = task.project?.id ?? '';
    if (!groups.has(key)) groups.set(key, { name: task.project?.name ?? 'No project', id: task.project?.id ?? null, tasks: [] });
    groups.get(key)!.tasks.push(task);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name)));

  return (
    <div className="page">
      <header className="page-header">
        <h1>Tasks</h1>
        <div className="segmented" role="tablist" aria-label="Task status">
          {FILTERS.map((f) => (
            <button key={f.value} role="tab" aria-selected={status === f.value} className={status === f.value ? 'active' : ''} onClick={() => setStatus(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </header>
      <AddTask withProject />
      {tasks.data && ordered.length === 0 && (
        <Empty title={status === 'active' ? 'Nothing to do' : 'No tasks here'}>Tasks you or your AI tools add show up here, grouped by project.</Empty>
      )}
      {ordered.map((group) => (
        <section key={group.id ?? 'none'} className="task-group" aria-label={group.name}>
          <h2>{group.id ? <button className="link-button heading" onClick={() => go({ view: 'project', id: group.id! })}>{group.name}</button> : group.name}</h2>
          <div className="task-list">{group.tasks.map((task) => <TaskRow key={task.id} task={task} />)}</div>
        </section>
      ))}
    </div>
  );
}
