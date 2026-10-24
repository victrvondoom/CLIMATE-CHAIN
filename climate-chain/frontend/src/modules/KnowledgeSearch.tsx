import { useEffect, useState } from 'react';
import { searchKnowledge, type KnowledgeSearchResponse } from '../api';
import './knowledge.css';

const DEBOUNCE_MS = 280;
const MIN_QUERY = 2;

type Outcome = { query: string; data?: KnowledgeSearchResponse; failed?: boolean };

export function KnowledgeSearch() {
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const text = query.trim();

  useEffect(() => {
    if (text.length < MIN_QUERY) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchKnowledge(text, 8, controller.signal)
        .then((data) => setOutcome({ query: text, data }))
        .catch(() => {
          if (!controller.signal.aborted) setOutcome({ query: text, failed: true });
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  const current = outcome && outcome.query === text ? outcome : null;
  const loading = text.length >= MIN_QUERY && !current;
  const count = current?.data?.results.length ?? 0;
  const status = text.length < MIN_QUERY
    ? 'Type at least two characters to search.'
    : loading
      ? 'Searching the workspace…'
      : current?.failed
        ? 'Workspace search is unavailable right now. Try again shortly.'
        : count === 0
          ? 'No excerpt matched. Try a project name or a feature word.'
          : `${count} ${count === 1 ? 'excerpt' : 'excerpts'} found.`;

  return (
    <section className="knowledge card" aria-labelledby="knowledge-title">
      <div className="knowledge-head">
        <span className="eyebrow">ASK THE WORKSPACE</span>
        <h2 id="knowledge-title">Search every project file, with sources</h2>
        <p className="muted small">Ranked excerpts from the root docs, project READMEs and docs, the registry and the feature catalogue. Nothing is generated: open the source to check a claim.</p>
      </div>
      <label className="search-field knowledge-field">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try: methane repair priority, double retirement, ESP32 firmware"
          aria-label="Search workspace documents and features"
          maxLength={200}
        />
      </label>
      <p className="muted small knowledge-status" role="status" aria-live="polite">{status}</p>
      {current?.data && count > 0 && (
        <ol className="knowledge-results">
          {current.data.results.map((hit) => (
            <li key={hit.id} className="knowledge-hit">
              <div className="knowledge-source">
                <code>{hit.source}</code>
                {hit.startLine !== null && <span>line {hit.startLine}</span>}
              </div>
              <strong>{hit.heading}</strong>
              <p>{hit.snippet}</p>
            </li>
          ))}
        </ol>
      )}
      {current?.data && (
        <p className="muted small knowledge-foot">
          {current.data.index.chunks} passages from {current.data.index.documents} documents · lexical match · index built {new Date(current.data.index.builtAt).toLocaleTimeString()}
        </p>
      )}
    </section>
  );
}