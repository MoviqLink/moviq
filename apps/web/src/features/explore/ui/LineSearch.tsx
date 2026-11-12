import type { LiveLine, LiveMode } from '@moviq/contracts';
import { useRef, useState } from 'react';
import { useLang } from '../../../shared/i18n/lang';
import type { useLineSelection } from '../live/useLineSelection';
import type { useLineCatalog } from '../live/useLineCatalog';
import { lineKey, matchesSearch, searchRank } from '../model/line-selection';
import { useExploreT } from '../texts';
import { WORDS, network } from './your-map-words';
type Choice = ReturnType<typeof useLineSelection>;
type Catalog = ReturnType<typeof useLineCatalog>;
const LINE_MODES: readonly LiveMode[] = ['bus', 'subway', 'rail', 'ferry', 'shuttle'];

function SearchResults({
  results,
  choice,
  catalog,
  onAdd,
}: {
  results: readonly LiveLine[];
  choice: Choice;
  catalog: Catalog;
  onAdd: (line: LiveLine) => void;
}) {
  const w = WORDS[useLang()];
  const t = useExploreT();
  return results.length === 0 ? (
    <p className="ex-note">{w.noMatches}</p>
  ) : (
    <ul className="your-results">
      {results.map((line) => {
        const added = choice.lines.some((item) => lineKey(item) === lineKey(line));
        return (
          <li key={lineKey(line)}>
            <span>
              <b>{line.name}</b> · {t.modes[line.mode]}
              <small>
                {network(line, catalog)}
                {line.longName ? ` · ${line.longName}` : ''}
              </small>
            </span>
            <button
              type="button"
              className="btn small"
              disabled={added}
              aria-label={`${w.add} ${line.name} · ${network(line, catalog)}`}
              onClick={() => {
                onAdd(line);
              }}
            >
              {w.add}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SearchPage({
  results,
  choice,
  catalog,
  limit,
  onMore,
  onAdd,
}: {
  results: readonly LiveLine[];
  choice: Choice;
  catalog: Catalog;
  limit: number;
  onMore: () => void;
  onAdd: (line: LiveLine) => void;
}) {
  const w = WORDS[useLang()];
  return (
    <div>
      <h2 className="ex-eyebrow">{w.results}</h2>
      <SearchResults
        results={results.slice(0, limit)}
        choice={choice}
        catalog={catalog}
        onAdd={onAdd}
      />
      {results.length > 0 && (
        <p className="ex-note">{w.shown(Math.min(limit, results.length), results.length)}</p>
      )}
      {results.length > limit && (
        <button type="button" className="ex-link" onClick={onMore}>
          {w.more}
        </button>
      )}
    </div>
  );
}

function rankLines(catalog: Catalog, mode: LiveMode | 'all', query: string, lang: 'en' | 'es') {
  if (query.trim() === '' && mode === 'all') return [];
  return (catalog.data?.lines ?? [])
    .filter(
      (line) =>
        (mode === 'all' || mode === line.mode) && matchesSearch(line.name, line.longName, query),
    )
    .sort(
      (a, b) =>
        searchRank(a.name, a.longName, query) - searchRank(b.name, b.longName, query) ||
        a.name.localeCompare(b.name, lang, { numeric: true }) ||
        network(a, catalog).localeCompare(network(b, catalog), lang),
    );
}

export function SearchLines({ choice, catalog }: { choice: Choice; catalog: Catalog }) {
  const lang = useLang();
  const w = WORDS[lang];
  const t = useExploreT();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<LiveMode | 'all'>('all');
  const [limit, setLimit] = useState(20);
  const results = rankLines(catalog, mode, query, lang);
  return (
    <section className="your-search" aria-label={w.label}>
      <label htmlFor="line-search">{w.search}</label>
      <input
        id="line-search"
        ref={input}
        type="search"
        value={query}
        placeholder={w.placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setLimit(20);
        }}
      />
      <label htmlFor="line-mode">{w.mode}</label>
      <select
        id="line-mode"
        value={mode}
        onChange={(event) => {
          setMode(event.target.value as LiveMode | 'all');
          setLimit(20);
        }}
      >
        <option value="all">{w.all}</option>
        {LINE_MODES.map((item) => (
          <option key={item} value={item}>
            {t.modes[item]}
          </option>
        ))}
      </select>
      {catalog.failing && (
        <p className="ex-note" role="status">
          {w.failed}
        </p>
      )}
      {catalog.data === null && !catalog.failing && (
        <p className="ex-note" role="status">
          {w.loading}
        </p>
      )}
      {(query.trim() !== '' || mode !== 'all') && catalog.data !== null && (
        <SearchPage
          results={results}
          choice={choice}
          catalog={catalog}
          limit={limit}
          onAdd={(line) => {
            choice.add(line);
            setQuery('');
            setMode('all');
            setLimit(20);
            input.current?.focus({ preventScroll: true });
          }}
          onMore={() => {
            setLimit((value) => value + 20);
          }}
        />
      )}
    </section>
  );
}
