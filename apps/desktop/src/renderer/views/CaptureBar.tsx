import type { ItemDetail } from '@enve-memory/core';
import { useEffect, useRef, useState } from 'react';
import { call, errorMessage, useLive } from '../lib/api.ts';
import { detectCapture } from '../lib/capture.ts';
import { displayTitle } from '../lib/format.ts';
import { Icon, ProjectSelect, useFeedback } from '../ui.tsx';
import { useApp } from '../context.ts';

/** Saves free text as a link (first word is a URL) or a note. */
export async function saveCapture(text: string, project: string | null): Promise<{ item: ItemDetail; existed: boolean } | null> {
  const detected = detectCapture(text);
  if (!detected) return null;
  if (detected.kind === 'link') {
    const { item, created } = await call('items.saveLink', { url: detected.url, note: detected.note || undefined, project: project ?? undefined });
    return { item, existed: !created };
  }
  return { item: await call('items.saveNote', { body: detected.body, project: project ?? undefined }), existed: false };
}

function SavedChip({ id, existed }: { id: string; existed: boolean }) {
  const { openItem } = useApp();
  const item = useLive(() => call('items.get', id), [id]);
  if (!item.data) return null;
  const status = item.data.metadata.ingest?.status;
  const label = status === 'pending'
    ? `Archiving ${item.data.url}…`
    : status === 'failed'
      ? `Saved, but archiving failed: ${item.data.metadata.ingest?.error ?? 'unknown error'}`
      : `${existed ? 'Already saved' : 'Saved'}: ${displayTitle(item.data)}`;
  return (
    <button className={`saved-chip ${status ?? 'done'}`} onClick={() => openItem(id)} data-testid="saved-chip">
      <Icon name={status === 'pending' ? 'refresh' : 'check'} size={14} className={status === 'pending' ? 'spin' : ''} />
      <span>{label}</span>
    </button>
  );
}

export function CaptureBar({ focus, placeholder }: { focus: { n: number; mode: 'note' | 'link' }; placeholder?: string }) {
  const { projects } = useApp();
  const { toast } = useFeedback();
  const [text, setText] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; existed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const detected = detectCapture(text);

  useEffect(() => {
    if (focus.n > 0) input.current?.focus();
  }, [focus.n]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const submit = async () => {
    if (!detected || busy) return;
    setBusy(true);
    try {
      const result = await saveCapture(text, project);
      if (result) {
        setSaved({ id: result.item.id, existed: result.existed });
        setText('');
      }
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="capture" aria-label="Quick capture">
      <div className="capture-box">
        <Icon name={detected?.kind === 'link' ? 'bookmark' : 'note'} className="capture-icon" />
        <textarea
          ref={input}
          rows={1}
          value={text}
          aria-label="Capture a note or link"
          placeholder={placeholder ?? (focus.mode === 'link' ? 'Paste a link to save and archive it…' : 'Jot a note or paste a link…')}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <ProjectSelect className="capture-project" value={project} onChange={setProject} projects={projects} emptyLabel="Inbox" label="Save to" />
        <button className="button primary" disabled={!detected || busy} onClick={() => void submit()}>Save</button>
      </div>
      <div className="capture-hint">
        {detected?.kind === 'link'
          ? 'Link · the page text is archived in the background so it outlives the site'
          : detected
            ? 'Note · Shift+Enter for a new line, Markdown welcome'
            : 'Enter saves · paste a URL to save a link'}
      </div>
      {saved && <SavedChip key={saved.id} id={saved.id} existed={saved.existed} />}
    </section>
  );
}
