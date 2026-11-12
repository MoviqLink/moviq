import type { AgentDetail } from '@moviq/contracts';
import { useState } from 'react';
import { agentsApi } from './api';
import { useAgentsT } from './texts';
import { RoadForm } from './RoadForm';
import { LineBadge, useWhen, WatchCard, type Act } from './WatchCard';

const QUICK_LINES = ['1', '4', '7', 'A', 'L', 'Q', 'M15', 'PATH'] as const;

function LineForm({ detail, act }: { detail: AgentDetail; act: Act }) {
  const t = useAgentsT();
  const [line, setLine] = useState('');
  const watched = new Set(
    detail.watches.filter((watch) => watch.kind === 'line').map((watch) => watch.line),
  );
  const add = (value: string) =>
    act(async () => {
      const result = await agentsApi.watch(detail.agent.id, value);
      setLine('');
      return result;
    });
  return (
    <div className="agents-pane">
      <p className="agents-label">{t.quickLines}</p>
      <ul className="agents-quick">
        {QUICK_LINES.map((name) => (
          <li key={name}>
            <button
              type="button"
              disabled={watched.has(name)}
              aria-label={watched.has(name) ? t.alreadyWatched(name) : t.quickWatch(name)}
              onClick={() => void add(name)}
            >
              <LineBadge line={name} />
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void add(line);
        }}
      >
        <label htmlFor="watch-line" className="agents-label">
          {t.line}
        </label>
        <div className="agents-row">
          <input
            id="watch-line"
            maxLength={32}
            value={line}
            onChange={(event) => {
              setLine(event.target.value);
            }}
            required
          />
          <button type="submit" className="agents-watch-add">
            {t.watch}
          </button>
        </div>
      </form>
    </div>
  );
}

function Notices({ watches }: { watches: AgentDetail['watches'] }) {
  const t = useAgentsT();
  const when = useWhen();
  const notices = watches
    .flatMap((watch) => (watch.alertedAt === null ? [] : [{ watch, at: watch.alertedAt }]))
    .sort((a, b) => b.at.localeCompare(a.at));
  return (
    <section className="agents-notices" aria-labelledby="agents-notices-title">
      <h4 id="agents-notices-title" className="agents-label">
        {t.notices}
      </h4>
      {notices.length === 0 ? (
        <p className="agents-empty">{t.noNotices}</p>
      ) : (
        <ul>
          {notices.map(({ watch, at }) => (
            <li key={watch.id} role="status">
              <time dateTime={at}>{when(at)}</time>
              {watch.kind === 'line' ? (
                <LineBadge line={watch.line} />
              ) : (
                <strong>{watch.line}</strong>
              )}
              <span>{watch.kind === 'street' ? t.roadAlert : t.cleared}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Watches({
  detail,
  onChange,
}: {
  detail: AgentDetail;
  onChange: (value: AgentDetail) => void;
}) {
  const t = useAgentsT();
  const [mode, setMode] = useState<'line' | 'street'>('line');
  const [failed, setFailed] = useState(false);
  const act: Act = async (action) => {
    try {
      onChange(await action());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  const running = detail.watches.filter(
    (watch) => watch.status !== 'paused' && watch.status !== 'needs_setup',
  ).length;
  return (
    <section className="agents-watches" aria-labelledby="agents-watches-title">
      <header className="agents-watches-head">
        <div>
          <h2 id="agents-watches-title">{t.watches}</h2>
          <p>{t.watchesLead}</p>
        </div>
        <span className={`agents-watch-count${running > 0 ? ' is-on' : ''}`}>
          {t.watchCount(running)}
        </span>
      </header>
      <div className="agents-watches-body">
        <div className="agents-watch-new">
          <h3 className="agents-label">{t.addWatch}</h3>
          <div className="agents-switch">
            {(['line', 'street'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                }}
              >
                {value === 'line' ? t.aLine : t.aStreet}
              </button>
            ))}
          </div>
          {mode === 'line' ? (
            <LineForm detail={detail} act={act} />
          ) : (
            <RoadForm key={detail.agent.id} id={detail.agent.id} onChange={onChange} />
          )}
          {failed && <p role="alert">{t.failed}</p>}
        </div>
        <div className="agents-watch-list">
          <h3 className="agents-label">{t.yourWatches}</h3>
          {detail.watches.length === 0 ? (
            <p className="agents-empty">{t.empty}</p>
          ) : (
            <ul>
              {detail.watches.map((watch) => (
                <WatchCard key={watch.id} watch={watch} agentId={detail.agent.id} act={act} />
              ))}
            </ul>
          )}
          <Notices watches={detail.watches} />
        </div>
      </div>
      <footer className="agents-watch-notes" aria-label={t.notesLabel}>
        <p>{t.notice}</p>
        <p>{t.streetSource}</p>
      </footer>
    </section>
  );
}
