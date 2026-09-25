import type { ItemType, Project } from '@enve-memory/core';
import {
  type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { call } from './lib/api.ts';
import { createMarkdown } from './lib/markdown.ts';

const PATHS = {
  note: 'M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 16h6',
  bookmark: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  task: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0zM8.5 12.5l2.5 2.5 4.5-5',
  decision: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 3v18M4 7.5l8 4.5 8-4.5',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  inbox: 'M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5',
  project: 'M3 7h7l2 2h9v10H3z',
  library: 'M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.8 1 -3.6 14-3.8-1',
  tasks: 'M5 4h14v16H5zM8.5 12l2.5 2.5 4.5-5',
  ask: 'M12 3l1.8 4.9L19 9.5l-5.2 1.7L12 16l-1.8-4.8L5 9.5l5.2-1.6zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  check: 'M5 12.5l4.5 4.5L19 7',
  sparkle: 'M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  refresh: 'M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
  graph: 'M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 7.8l4 8.4M16.8 9.6l-3.8 6.8M8 6.3l8 1.4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export const TypeIcon = ({ type, size }: { type: ItemType; size?: number }) => <Icon name={type} size={size} className={`type-${type}`} />;

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

const markdown = createMarkdown(window as unknown as Parameters<typeof createMarkdown>[0]);

/** Rendered untrusted Markdown. Links open in the system browser through the main process. */
export function MarkdownView({ source, baseUrl, className }: { source: string; baseUrl?: string | null; className?: string }) {
  const html = useMemo(() => markdown.render(source, { baseUrl }), [source, baseUrl]);
  return (
    <div
      className={`markdown ${className ?? ''}`}
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        if (!anchor) return;
        event.preventDefault();
        const href = anchor.getAttribute('href');
        if (href) void call('app.openExternal', href);
      }}
      // Sanitized by DOMPurify in createMarkdown.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function MarkdownEditor({ value, onChange, placeholder, rows = 10, label, onSubmit }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  label: string;
  onSubmit?: () => void;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="md-editor">
      <div className="segmented small" role="tablist" aria-label={`${label} mode`}>
        <button role="tab" aria-selected={!preview} className={preview ? '' : 'active'} onClick={() => setPreview(false)}>Write</button>
        <button role="tab" aria-selected={preview} className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Preview</button>
      </div>
      {preview ? (
        value.trim() ? <MarkdownView source={value} className="md-preview" /> : <p className="muted md-preview">Nothing to preview.</p>
      ) : (
        <textarea
          aria-label={label}
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSubmit) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      )}
    </div>
  );
}

export function ProjectSelect({ value, onChange, projects, emptyLabel = 'No project (Inbox)', label = 'Project', className }: {
  value: string | null;
  onChange: (projectId: string | null) => void;
  projects: Project[];
  emptyLabel?: string;
  label?: string;
  className?: string;
}) {
  return (
    <select aria-label={label} className={className} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>{project.name}</option>
      ))}
    </select>
  );
}

export function TagEditor({ tags, onAdd, onRemove }: { tags: string[]; onAdd: (tag: string) => void; onRemove: (tag: string) => void }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    for (const tag of draft.split(',').map((t) => t.trim()).filter(Boolean)) onAdd(tag);
    setDraft('');
  };
  return (
    <div className="tag-editor">
      {tags.map((tag) => (
        <span key={tag} className="tag">
          #{tag}
          <button aria-label={`Remove tag ${tag}`} onClick={() => onRemove(tag)}><Icon name="close" size={12} /></button>
        </span>
      ))}
      <input
        aria-label="Add tag"
        value={draft}
        placeholder={tags.length ? 'Add tag' : 'Add tags (Enter or comma)'}
        onChange={(event) => {
          const parts = event.target.value.split(',');
          const rest = parts.pop()!;
          for (const tag of parts.map((t) => t.trim()).filter(Boolean)) onAdd(tag);
          setDraft(rest);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Backspace' && !draft && tags.length) onRemove(tags[tags.length - 1]!);
        }}
        onBlur={() => draft.trim() && commit()}
      />
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="button ghost small"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : label}
    </button>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** The user must type this word to enable the confirm button. */
  typeToConfirm?: string;
}

interface Feedback {
  toast: (message: string, tone?: Toast['tone']) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<Feedback>({ toast: () => {}, confirm: async () => false });
export const useFeedback = () => useContext(FeedbackContext);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const next = useRef(1);

  const toast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = next.current++;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3000);
  }, []);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...options, resolve })), []);
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.message}</div>)}
      </div>
      {dialog && (
        <ConfirmDialog
          options={dialog}
          onClose={(ok) => {
            dialog.resolve(ok);
            setDialog(null);
          }}
        />
      )}
    </FeedbackContext.Provider>
  );
}

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const [typed, setTyped] = useState('');
  const ready = !options.typeToConfirm || typed.trim().toLowerCase() === options.typeToConfirm.toLowerCase();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{options.title}</h2>
        <div className="dialog-body">{options.body}</div>
        {options.typeToConfirm && (
          <label className="field">
            <span>Type <strong>{options.typeToConfirm}</strong> to confirm</span>
            <input autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} aria-label="Confirmation word" />
          </label>
        )}
        <div className="dialog-actions">
          <button className="button ghost" onClick={() => onClose(false)} autoFocus={!options.typeToConfirm}>Cancel</button>
          <button className={`button ${options.danger ? 'danger' : 'primary'}`} disabled={!ready} onClick={() => onClose(true)}>
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Keeps a local draft of a server value; outside changes replace it only while the user isn't editing. */
export function useDraft(value: string | undefined): { draft: string; setDraft: (next: string) => void; dirty: boolean; reset: () => void } {
  const [draft, setDraftState] = useState(value ?? '');
  const [editing, setEditing] = useState(false);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (value === undefined) return;
    if (!editing || latest.current === value) {
      setDraftState(value);
      setEditing(false);
    }
  }, [value]);
  return {
    draft,
    setDraft: (next) => {
      setDraftState(next);
      setEditing(true);
    },
    dirty: value !== undefined && draft !== value,
    reset: () => {
      setDraftState(value ?? '');
      setEditing(false);
    },
  };
}
