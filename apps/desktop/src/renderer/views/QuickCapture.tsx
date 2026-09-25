import { useEffect, useRef, useState } from 'react';
import { call, errorMessage, onCommand, useLive } from '../lib/api.ts';
import { detectCapture } from '../lib/capture.ts';
import { ProjectSelect } from '../ui.tsx';
import { saveCapture } from './CaptureBar.tsx';

/** The small always-on-top window behind the global shortcut: type or paste, Enter, gone. */
export function QuickCapture() {
  const projects = useLive(() => call('projects.list'), []);
  const [text, setText] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const detected = detectCapture(text);

  useEffect(() => {
    input.current?.focus();
    return onCommand((command) => {
      if (command === 'capture-focus') {
        setMessage(null);
        input.current?.focus();
      }
    });
  }, []);

  const close = () => void call('capture.close');

  const submit = async () => {
    if (!detected) return;
    try {
      const result = await saveCapture(text, project);
      const where = project ? projects.data?.find((p) => p.id === project)?.name : 'Inbox';
      setMessage({ text: result?.existed ? 'Already saved' : `Saved to ${where}`, error: false });
      setText('');
      setTimeout(close, 700);
    } catch (error) {
      setMessage({ text: errorMessage(error), error: true });
    }
  };

  return (
    <div
      className="quick-capture"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
    >
      <textarea
        ref={input}
        aria-label="Quick capture"
        value={text}
        placeholder="Jot a note or paste a link…"
        onChange={(event) => {
          setText(event.target.value);
          setMessage(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="quick-capture-bar">
        <ProjectSelect value={project} onChange={setProject} projects={projects.data ?? []} emptyLabel="Inbox" label="Save to" />
        <span className={`muted small ${message?.error ? 'error-text' : ''}`}>
          {message?.text ?? (detected?.kind === 'link' ? 'Link · archived in the background' : 'Enter to save · Esc to close')}
        </span>
        <button className="button primary small" disabled={!detected} onClick={() => void submit()}>Save</button>
      </div>
    </div>
  );
}
