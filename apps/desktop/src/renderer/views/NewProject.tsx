import { useEffect, useState } from 'react';
import { call, errorMessage } from '../lib/api.ts';
import { useFeedback } from '../ui.tsx';

export function NewProject({ onClose }: { onClose: (id: string | null) => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const create = () => {
    call('projects.create', { name, description }).then(
      (project) => onClose(project.id),
      (error: unknown) => toast(errorMessage(error), 'error'),
    );
  };
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose(null)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <h2 id="new-project-title">New project</h2>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Garage door opener" />
        </label>
        <label className="field">
          <span>What is it? <span className="muted">(optional)</span></span>
          <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="One or two sentences your AI tools will read first." />
        </label>
        <div className="dialog-actions">
          <button type="button" className="button ghost" onClick={() => onClose(null)}>Cancel</button>
          <button type="submit" className="button primary" disabled={!name.trim()}>Create project</button>
        </div>
      </form>
    </div>
  );
}
