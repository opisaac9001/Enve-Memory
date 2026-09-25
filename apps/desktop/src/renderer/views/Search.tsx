import type { ItemType, SearchHit } from '@enve-memory/core';
import { useEffect, useRef, useState } from 'react';
import { call } from '../lib/api.ts';
import { TYPE_LABELS, displayTitle, firstLine, snippetParts } from '../lib/format.ts';
import { useApp } from '../context.ts';
import { Icon, TypeIcon } from '../ui.tsx';

const TYPES: (ItemType | '')[] = ['', 'note', 'bookmark', 'file', 'image', 'task', 'decision'];
const MATCH_LABEL: Record<SearchHit['match'], string> = { keyword: 'words', semantic: 'meaning', both: 'words + meaning' };

export function SearchPalette({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const { projects } = useApp();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<ItemType | ''>('');
  const [project, setProject] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const request = useRef(0);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const id = ++request.current;
    const text = query.trim();
    const filter = { type: type || undefined, project: project || undefined };
    const run = text
      ? call('search.hybrid', text, filter, 30)
      : call('items.list', filter, 12).then((items) => items.map((item): SearchHit => ({
          id: item.id, type: item.type, title: displayTitle(item), url: item.url, project: item.project, snippet: '',
          match: 'keyword', taskStatus: null, updatedAt: item.updatedAt,
        })));
    const timer = setTimeout(() => {
      run.then(
        (result) => {
          if (id !== request.current) return;
          setHits(result);
          setError(null);
          setSelected(0);
        },
        (err: unknown) => {
          if (id !== request.current) return;
          setHits([]);
          setError(err instanceof Error ? err.message : String(err));
        },
      );
    }, text ? 90 : 0);
    return () => clearTimeout(timer);
  }, [query, type, project]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((s) => Math.min(s + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (event.key === 'Enter' && hits[selected]) {
      event.preventDefault();
      onOpen(hits[selected]!.id);
    }
  };

  return (
    <div className="overlay palette-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKey}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-label="Search your library"
            placeholder="Search notes, links, files, tasks and decisions…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-filters">
          <div className="chips" role="group" aria-label="Type">
            {TYPES.map((t) => (
              <button key={t || 'all'} className={`chip ${type === t ? 'active' : ''}`} onClick={() => setType(t)} aria-pressed={type === t}>
                {t ? TYPE_LABELS[t] : 'Everything'}
              </button>
            ))}
          </div>
          <select aria-label="Project filter" value={project} onChange={(event) => setProject(event.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <ul className="palette-results" id="search-results" role="listbox" ref={list}>
          {!query.trim() && hits.length > 0 && <li className="palette-caption" role="presentation">Recent</li>}
          {hits.map((hit, index) => (
            <li
              key={hit.id}
              role="option"
              aria-selected={index === selected}
              className={index === selected ? 'selected' : ''}
              onMouseMove={() => setSelected(index)}
              onClick={() => onOpen(hit.id)}
            >
              <TypeIcon type={hit.type} />
              <div className="hit-text">
                <div className="hit-title">
                  <span>{hit.title || hit.url || firstLine(hit.snippet.replace(/[[\]]/g, ''), 80) || 'Untitled'}</span>
                  {hit.project && <span className="project-chip">{hit.project.name}</span>}
                </div>
                {hit.snippet && (
                  <div className="hit-snippet">
                    {snippetParts(hit.snippet).map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
                  </div>
                )}
              </div>
              {query.trim() && <span className={`match ${hit.match}`} title={`Matched on ${MATCH_LABEL[hit.match]}`}>{MATCH_LABEL[hit.match]}</span>}
            </li>
          ))}
          {query.trim() && hits.length === 0 && !error && <li className="palette-empty" role="presentation">No matches. Try other words; search also matches meaning when semantic search is on.</li>}
          {error && <li className="palette-empty" role="presentation">{error}</li>}
        </ul>
        <div className="palette-footer"><span>↑↓ to move</span><span>↵ to open</span></div>
      </div>
    </div>
  );
}
