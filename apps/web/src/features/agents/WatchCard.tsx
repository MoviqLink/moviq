import type { AgentDetail } from '@moviq/contracts';
import { localeOf, useLang } from '../../shared/i18n/lang';
import { agentsApi } from './api';
import { useAgentsT, type AgentsWords } from './texts';

export type Watch = AgentDetail['watches'][number];
export type Act = (action: () => Promise<AgentDetail>) => Promise<void>;

/** Subway trunk colours as riders know them; a line not listed keeps the neutral badge. */
const TRUNKS: readonly (readonly [string, string])[] = [
  ['123', 'red'],
  ['456', 'green'],
  ['7', 'purple'],
  ['ACE', 'blue'],
  ['BDFM', 'orange'],
  ['G', 'lime'],
  ['JZ', 'brown'],
  ['L', 'grey'],
  ['NQRW', 'yellow'],
  ['S', 'shuttle'],
];

/** A subway line as a round badge in its trunk colour; a bus route or PATH as a pill. */
export function LineBadge({ line }: { line: string }) {
  const name = line.toUpperCase();
  const trunk = name.length === 1 ? TRUNKS.find(([lines]) => lines.includes(name)) : undefined;
  const shape = trunk !== undefined ? `is-subway is-${trunk[1]}` : 'is-route';
  return (
    <span className={`agents-badge ${shape}`} aria-hidden="true">
      {line}
    </span>
  );
}

/** A time of today as `2:14 PM`; an older one with its day. */
export function useWhen() {
  const locale = localeOf(useLang());
  return (iso: string) => {
    const at = new Date(iso);
    const today = at.toDateString() === new Date().toDateString();
    return new Intl.DateTimeFormat(locale, {
      ...(today ? {} : { day: 'numeric', month: 'short' }),
      hour: 'numeric',
      minute: '2-digit',
    }).format(at);
  };
}

/** The state of a watch in a few words, and the tone of its mark. */
function stateOf(watch: Watch, t: AgentsWords): { label: string; tone: string } {
  if (watch.status === 'paused') return { label: t.paused, tone: 'paused' };
  if (watch.status === 'needs_setup') return { label: t.statusSetup, tone: 'paused' };
  if (watch.status === 'unavailable') return { label: t.statusUnavailable, tone: 'unavailable' };
  if (watch.status === 'waiting') return { label: t.statusWaiting, tone: 'waiting' };
  if (watch.status === 'active') return { label: t.statusAlert, tone: 'alert' };
  if (watch.alertedAt !== null) {
    return { label: watch.kind === 'street' ? t.statusRecovered : t.statusCleared, tone: 'ok' };
  }
  return { label: t.statusWatching, tone: 'ok' };
}

export function WatchCard({ watch, agentId, act }: { watch: Watch; agentId: string; act: Act }) {
  const t = useAgentsT();
  const when = useWhen();
  const state = stateOf(watch, t);
  const detail =
    watch.kind === 'line' && (watch.status === 'active' || watch.status === 'clear')
      ? t[watch.status]
      : watch.status === 'needs_setup'
        ? t.needs_setup
        : null;
  return (
    <li className={`agents-watch is-${state.tone}`}>
      <div className="agents-watch-head">
        {watch.kind === 'line' ? (
          <LineBadge line={watch.line} />
        ) : (
          <span className="agents-badge is-street" aria-hidden="true">
            {t.streetTag}
          </span>
        )}
        <h4>{watch.kind === 'line' ? t.lineName(watch.line) : watch.line}</h4>
        <span className="agents-watch-state">{state.label}</span>
      </div>
      {detail !== null && <p className="agents-watch-detail">{detail}</p>}
      {watch.kind === 'street' && watch.thresholdKmh !== null && (
        <p className="agents-watch-speed">
          {watch.speedKmh !== null && <strong>{t.speedNow(watch.speedKmh)}</strong>}
          <span>{t.speedLimit(watch.thresholdKmh)}</span>
        </p>
      )}
      <dl className="agents-watch-meta">
        {watch.checkedAt !== null && (
          <div>
            <dt>{t.checked}</dt>
            <dd>{when(watch.checkedAt)}</dd>
          </div>
        )}
        {watch.source !== null && (
          <div>
            <dt>{t.source}</dt>
            <dd>
              {watch.source.title}
              {watch.source.dataTime === null ? '' : ` · ${when(watch.source.dataTime)}`}
            </dd>
          </div>
        )}
      </dl>
      <div className="agents-watch-actions">
        {watch.status !== 'needs_setup' && (
          <button
            type="button"
            onClick={() =>
              void act(() => agentsApi.pause(agentId, watch.id, watch.status !== 'paused'))
            }
          >
            {watch.status === 'paused' ? t.resume : t.pause}
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            void act(async () => {
              await agentsApi.deleteWatch(agentId, watch.id);
              return agentsApi.detail(agentId);
            })
          }
        >
          {t.delete}
        </button>
      </div>
    </li>
  );
}
