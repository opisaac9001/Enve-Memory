import type { Task } from '@enve-memory/core';
import { useState } from 'react';
import { call, errorMessage } from '../lib/api.ts';
import { displayTitle, dueInfo } from '../lib/format.ts';
import { useApp } from '../context.ts';
import { Icon, ProjectSelect, useFeedback } from '../ui.tsx';

export function TaskRow({ task, showProject = false }: { task: Task; showProject?: boolean }) {
  const { openItem } = useApp();
  const { toast } = useFeedback();
  const done = task.task.status === 'done';
  const due = dueInfo(task.task.dueAt);
  const title = displayTitle(task);
  return (
    <div className={`task-row ${done ? 'done' : ''} ${task.task.status === 'cancelled' ? 'cancelled' : ''}`}>
      <button
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? 'Reopen' : 'Complete'} ${title}`}
        className="task-check"
        onClick={() => call('tasks.update', task.id, { status: done ? 'open' : 'done' }).catch((error: unknown) => toast(errorMessage(error), 'error'))}
      >
        {done && <Icon name="check" size={14} />}
      </button>
      <button className="task-title" onClick={() => openItem(task.id)}>
        <span>{title}</span>
        {task.task.status === 'in_progress' && <span className="badge">In progress</span>}
        {task.task.priority === 'high' && <span className="badge high">High</span>}
        {task.task.priority === 'low' && <span className="badge low">Low</span>}
        {showProject && task.project && <span className="project-chip">{task.project.name}</span>}
        {due && !done && <span className={`due ${due.tone}`}>{due.label}</span>}
      </button>
    </div>
  );
}

/** One-line task entry: title, then optional project, due date and priority. */
export function AddTask({ project, withProject = false }: { project?: string; withProject?: boolean }) {
  const { projects } = useApp();
  const { toast } = useFeedback();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');
  const [chosen, setChosen] = useState<string | null>(project ?? null);
  const add = () => {
    if (!title.trim()) return;
    call('tasks.create', { title, due: due || undefined, priority, project: (withProject ? chosen : project) ?? undefined }).then(
      () => {
        setTitle('');
        setDue('');
        setPriority('normal');
      },
      (error: unknown) => toast(errorMessage(error), 'error'),
    );
  };
  return (
    <form
      className="add-task"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Icon name="plus" size={16} />
      <input aria-label="New task" placeholder="Add a task" value={title} onChange={(event) => setTitle(event.target.value)} />
      {withProject && <ProjectSelect value={chosen} onChange={setChosen} projects={projects} emptyLabel="No project" />}
      <input aria-label="Due date" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
      <select aria-label="Priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
        <option value="high">High</option>
        <option value="normal">Normal</option>
        <option value="low">Low</option>
      </select>
      <button type="submit" className="button small" disabled={!title.trim()}>Add</button>
    </form>
  );
}
