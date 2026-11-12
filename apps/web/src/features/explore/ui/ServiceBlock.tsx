import type { LiveVehicle } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { formatCityTime } from '../../../shared/time/city';
import { punctuality, stopName } from '../model/card';
import { dayRange, durationText, stallOf } from '../model/modes';
import { nextStop, stopTime } from '../model/vehicle';
import { useExploreT } from '../texts';
import type { ExploreDict } from '../texts-en';

function DelayValue({ seconds, t }: { seconds: number | null; t: ExploreDict }) {
  if (seconds === null) {
    return (
      <>
        <span className="ex-v ex-none">—</span>
        <span className="ex-note">{t.card.noDelay}</span>
      </>
    );
  }
  const verdict = punctuality(seconds);
  if (verdict.kind === 'on-time') return <span className="ex-v">{t.card.onTime}</span>;
  return verdict.kind === 'late' ? (
    <span className="ex-v ex-late">{t.card.late(verdict.minutes)}</span>
  ) : (
    <span className="ex-v">{t.card.early(verdict.minutes)}</span>
  );
}

/**
 * A train longer between two stops than 95 in 100 recorded runs, with its evidence in one
 * sentence: how long, between which stops, what is usual and from how many runs of which days.
 */
function StallNote({ vehicle }: { vehicle: LiveVehicle }) {
  const t = useExploreT();
  const locale = useLocale();
  const stall = stallOf(vehicle.position);
  if (stall === null) return null;
  const days = dayRange(stall.from, stall.to, locale);
  const from = stopName(stall.leftStop.name);
  const to = stall.toStop === null ? null : stopName(stall.toStop);
  return (
    <div className="ex-stall" role="note">
      <span className="ex-k">{t.craft.stall.title}</span>
      <p>
        {t.craft.stall.text(
          durationText(stall.elapsedSeconds),
          from,
          to,
          durationText(stall.usualSeconds),
        )}
      </p>
      <span className="ex-note">{t.craft.stall.evidence(stall.n, days.from, days.to)}</span>
    </div>
  );
}

/**
 * People on board and room, by the vehicle's own counter: MTA buses send it, each bus when it
 * counts; the other line modes publish none.
 */
function Occupancy({ vehicle, t }: { vehicle: LiveVehicle; t: ExploreDict }) {
  const locale = useLocale();
  const { occupancy } = vehicle;
  return (
    <div className="ex-row">
      <span className="ex-k">{t.card.occupancy}</span>
      {occupancy === null ? (
        <>
          <span className="ex-v ex-none">—</span>
          <span className="ex-note">
            {vehicle.mode === 'bus' ? t.card.noBusCount : t.card.noOccupancy}
          </span>
        </>
      ) : (
        <>
          <span className="ex-v mono">
            {t.card.onBoard(
              occupancy.passengers.toLocaleString(locale),
              occupancy.capacity.toLocaleString(locale),
            )}
          </span>
          {vehicle.mode === 'bus' && <span className="ex-note">{t.card.busCounter}</span>}
        </>
      )}
    </div>
  );
}

/** The stops ahead with their times, the destination, the delay and the occupancy. */
export function ServiceBlock({ vehicle, now }: { vehicle: LiveVehicle; now: number }) {
  const t = useExploreT();
  const locale = useLocale();
  const station = vehicle.position.station;
  const next = nextStop(vehicle, now);
  const time = next === undefined ? null : stopTime(next);
  const later = vehicle.stops.filter((stop) => stop !== next);
  return (
    <section className="ex-group" aria-label={t.card.service}>
      <span className="ex-k">{t.card.service}</span>
      {station !== null && (
        <p className="ex-state">{t.card.stationStatus[station.status](stopName(station.name))}</p>
      )}
      <StallNote vehicle={vehicle} />
      <ol className="ex-rail">
        {next !== undefined && (
          <li className="next">
            <span className="ex-k">{t.card.nextStop}</span>
            <span className="ex-v">{stopName(next.name)}</span>
            {time !== null && (
              <span className="ex-note">{t.card.expectedAt(formatCityTime(time, locale))}</span>
            )}
          </li>
        )}
        {later.map((stop) => {
          const at = stopTime(stop);
          return (
            <li key={stop.id} className="later">
              <span className="ex-stop">{stopName(stop.name)}</span>
              {at !== null && <time className="mono">{formatCityTime(at, locale)}</time>}
            </li>
          );
        })}
        <li className="end">
          <span className="ex-k">{t.card.destination}</span>
          <span className="ex-v">
            {vehicle.destination === null ? '—' : stopName(vehicle.destination.name)}
          </span>
        </li>
      </ol>
      <div className="ex-row">
        <span className="ex-k">{t.card.delay}</span>
        <DelayValue seconds={vehicle.delaySeconds} t={t} />
      </div>
      <Occupancy vehicle={vehicle} t={t} />
    </section>
  );
}
