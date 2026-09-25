import type { Answer } from '@enve-memory/ai';
import type { ItemType } from '@enve-memory/core';
import { useState } from 'react';
import { call, errorMessage, useLive } from '../lib/api.ts';
import { useApp } from '../context.ts';
import { Icon, TypeIcon } from '../ui.tsx';

function Cited({ text, sources, onOpen }: { text: string; sources: Answer['sources']; onOpen: (id: string) => void }) {
  const byNumber = new Map(sources.map((s) => [s.n, s]));
  return (
    <div className="answer-text">
      {text.split(/\n{2,}/).map((paragraph, p) => (
        <p key={p}>
          {paragraph.split(/(\[\d+\])/).map((part, i) => {
            const n = /^\[(\d+)\]$/.exec(part)?.[1];
            const source = n ? byNumber.get(Number(n)) : undefined;
            return source ? (
              <button key={i} className="cite" title={source.title || source.url || ''} onClick={() => onOpen(source.id)}>{n}</button>
            ) : (
              <span key={i}>{part}</span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

export function Ask() {
  const { projects, openItem, go } = useApp();
  const status = useLive(() => call('ai.status'), []);
  const [question, setQuestion] = useState('');
  const [project, setProject] = useState('');
  const [answer, setAnswer] = useState<{ question: string; answer: Answer } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = status.data?.providers.find((p) => p.id === status.data?.provider);

  const submit = async () => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setAnswer({ question, answer: await call('ai.ask', question, project || undefined) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page ask">
      <header className="page-header">
        <h1>Ask your library</h1>
        <p className="subtitle">
          Answers come only from what you’ve saved, with numbered citations. {provider?.cloud
            ? <>The question and the most relevant passages are sent to {provider.label}.</>
            : provider ? <>Runs on the {provider.label.replace(/ \(.*\)$/, '')} server at {status.data?.baseUrl || provider.baseUrl}.</> : null}{' '}
          <button className="link-button" onClick={() => go({ view: 'settings', section: 'ai' })}>AI settings</button>
        </p>
      </header>
      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="Question"
          rows={3}
          value={question}
          placeholder="What do we know about the garage door protocol?"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="inline-actions">
          <select aria-label="Limit to project" value={project} onChange={(event) => setProject(event.target.value)}>
            <option value="">Whole library</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="submit" className="button primary" disabled={busy || !question.trim()}>
            <Icon name="sparkle" size={15} /> {busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </form>
      {error && <p className="error-text">{error}</p>}
      {answer && (
        <section className="panel answer" aria-label="Answer">
          <p className="muted small">{answer.question}</p>
          <Cited text={answer.answer.answer} sources={answer.answer.sources} onOpen={openItem} />
          {answer.answer.sources.length > 0 && (
            <ol className="sources">
              {answer.answer.sources.map((source) => (
                <li key={source.n}>
                  <button className="link-button" onClick={() => openItem(source.id)}>
                    <span className="cite static">{source.n}</span>
                    <TypeIcon type={source.type as ItemType} size={14} /> {source.title || source.url || `Untitled ${source.type}`}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
