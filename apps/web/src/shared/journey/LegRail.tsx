import type { Leg, TravelMode } from '@moviq/contracts';

import { useLocale, useT } from '../i18n';
import { useNow } from '../time/clock';
import { formatCityTime, minutesBetween } from '../time/city';
import { formatDuration } from '../time/duration';
import { secondsSince } from '../time/instant';
import { Icon, type IconName } from '../ui/Icon';
import { CityTime } from './CityTime';
import { useJourneyT, type JourneyDict } from './texts';
import { walkNote } from './walks';
import './journey.css';

const MODE_ICON: Record<TravelMode, IconName> = {
  walk: 'walk',
  subway: 'subway',
  bus: 'bus',
  rail: 'rail',
  ferry: 'ferry',
  taxi: 'taxi',
};

function title(leg: Leg, t: JourneyDict): string {
  if (leg.mode === 'walk') return t.walkTo(leg.to.label);
  const name =
    leg.route === null ? t.modes[leg.mode] : `${t.modes[leg.mode]} ${leg.route.shortName}`;
  const headsign = leg.route?.headsign ?? null;
  return headsign === null ? name : `${name} · ${t.toward(headsign)}`;
}

/** How the leg's time is known, with its age when it is live and its source on hover. */
function Freshness({ leg }: { leg: Leg }) {
  const t = useJourneyT();
  const states = useT().states;
  const now = useNow();
  const { provenance } = leg;
  const age =
    provenance.dataTime === null ? null : formatDuration(secondsSince(provenance.dataTime, now));
  const state = states[provenance.state].label.toLowerCase();
  const source =
    age === null
      ? t.sourceNoAge(provenance.sourceId, state)
      : t.source(provenance.sourceId, state, age);
  const text = leg.timing === 'realtime' && age !== null ? t.liveAge(age) : t.timing[leg.timing];
  return (
    <span className={`step-fresh ${leg.timing}`} title={`${t.timingHint[leg.timing]} ${source}`}>
      {text}
    </span>
  );
}

/** How a walk is known, in its row: an estimate never reads as a way walked. */
function WalkNote({ legs, index }: { legs: readonly Leg[]; index: number }) {
  const t = useJourneyT();
  const note = walkNote(legs, index);
  if (note === null) return null;
  return (
    <span className={`step-fresh walk-${note}`} title={t.walkHint[note]}>
      {t.walk[note]}
    </span>
  );
}

interface Props {
  readonly legs: readonly Leg[];
  /** The arrival now expected, when it differs from the plan; the planned one is shown struck. */
  readonly arriveAt?: string;
  /** Legs with an incident, drawn in the risk colour. */
  readonly risky?: ReadonlySet<number>;
}

/** The trip as the route line: one node per leg on a vertical rail, then the arrival. */
export function LegRail({ legs, arriveAt, risky = new Set() }: Props) {
  const t = useJourneyT();
  const locale = useLocale();
  const last = legs.at(-1);
  if (last === undefined) return null;
  const expected = arriveAt ?? last.arriveAt;
  const moved = expected !== last.arriveAt;
  const planned = formatCityTime(last.arriveAt, locale);
  const late = Date.parse(expected) > Date.parse(last.arriveAt);
  return (
    <ol className="steps" aria-label={t.steps}>
      {legs.map((leg, index) => (
        <li key={`${leg.departAt}-${String(index)}`} className={railClass(leg, risky.has(index))}>
          <span className="step-time">
            <CityTime at={leg.departAt} />
          </span>
          <span className="step-node" aria-hidden="true">
            <Icon name={MODE_ICON[leg.mode]} />
          </span>
          <span className="step-body">
            <b>{title(leg, t)}</b>
            <span className="step-meta">
              {leg.mode === 'walk' ? '' : `${t.from(leg.from.label)} · `}
              {t.minutes(minutesBetween(leg.departAt, leg.arriveAt))}
            </span>
            {leg.mode === 'walk' ? <WalkNote legs={legs} index={index} /> : <Freshness leg={leg} />}
          </span>
        </li>
      ))}
      <li className={`step end${late ? ' late' : ''}`}>
        <span className="step-time">
          <CityTime at={expected} />
          {moved && <s aria-label={t.planned(planned)}>{planned}</s>}
        </span>
        <span className="step-node" aria-hidden="true">
          <Icon name="flag" />
        </span>
        <span className="step-body">
          <b>{t.arrive(last.to.label)}</b>
        </span>
      </li>
    </ol>
  );
}

function railClass(leg: Leg, risky: boolean): string {
  const mode = leg.mode === 'walk' ? ' walk' : leg.mode === 'taxi' ? ' taxi' : '';
  return `step${mode}${risky ? ' risk' : ''}`;
}
