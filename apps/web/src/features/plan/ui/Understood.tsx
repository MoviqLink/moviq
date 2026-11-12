import type { AssistantTurn } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { formatCityDay, formatCityTime } from '../../../shared/time/city';
import { usePlanT, type PlanDict } from '../texts';

type Draft = AssistantTurn['draft'];
type Slot = AssistantTurn['missing'][number];

function Value({ text, slot, missing }: { text: string | null; slot: Slot; missing: Set<Slot> }) {
  const t = usePlanT();
  if (text !== null) return <span className="und-value">{text}</span>;
  return (
    <span className={`und-value empty${missing.has(slot) ? ' asked' : ''}`}>
      {missing.has(slot) ? t.understood.missing : '—'}
    </span>
  );
}

function flightText(flight: NonNullable<Draft['flight']>, t: PlanDict, locale: string): string {
  const line = t.understood.flightLine(
    `${flight.carrier} ${flight.number}`,
    flight.airport,
    formatCityTime(flight.departureAt, locale),
  );
  return flight.terminal === null ? line : `${line} · ${t.understood.terminal(flight.terminal)}`;
}

interface Props {
  readonly turn: AssistantTurn | null;
  readonly onRestart: () => void;
}

/** What Sara has understood so far, as a short route: from, to, the time to arrive and the flight. */
export function Understood({ turn, onRestart }: Props) {
  const t = usePlanT();
  const locale = useLocale();
  const draft = turn?.draft;
  const missing = new Set(turn?.missing ?? []);
  const at = draft?.arriveBy ?? null;
  const flight = draft?.flight ?? null;
  const arriveBy =
    at === null ? null : `${formatCityTime(at, locale)} · ${formatCityDay(at, locale)}`;
  return (
    <aside className="understood" aria-labelledby="understood-title">
      <h2 id="understood-title">{t.understood.title}</h2>
      <dl className="und-route">
        <div className="und-row from">
          <dt>{t.understood.origin}</dt>
          <dd>
            <Value text={draft?.origin?.label ?? null} slot="origin" missing={missing} />
          </dd>
        </div>
        <div className="und-row to">
          <dt>{t.understood.destination}</dt>
          <dd>
            <Value text={draft?.destination?.label ?? null} slot="destination" missing={missing} />
          </dd>
        </div>
      </dl>
      <dl className="und-facts">
        <div>
          <dt>{t.understood.arriveBy}</dt>
          <dd>
            <Value text={arriveBy} slot="arriveBy" missing={missing} />
          </dd>
        </div>
        {flight !== null && (
          <div>
            <dt>{t.understood.flight}</dt>
            <dd className="und-value" title={flight.provenance.evidence}>
              {flightText(flight, t, locale)}
            </dd>
          </div>
        )}
      </dl>
      {turn?.mode === 'basic' && <p className="und-basic">{t.understood.basic}</p>}
      <button type="button" className="btn small" onClick={onRestart}>
        {t.understood.restart}
      </button>
    </aside>
  );
}
