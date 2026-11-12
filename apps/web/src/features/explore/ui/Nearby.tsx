import type { LiveVehicle } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { formatCityTime } from '../../../shared/time/city';
import { stopName } from '../model/card';
import { nextStop, stopTime } from '../model/vehicle';
import { useExploreT } from '../texts';

interface Props {
  readonly vehicles: readonly LiveVehicle[];
  readonly now: number;
  readonly onOpen: (id: string) => void;
}

/** The vehicles nearest the middle of the map, as rows a keyboard can open. */
export function Nearby({ vehicles, now, onOpen }: Props) {
  const t = useExploreT();
  const locale = useLocale();
  return (
    <section className="ex-nearby" aria-label={t.nearby}>
      <h2 className="ex-eyebrow">{t.nearby}</h2>
      {vehicles.length === 0 ? (
        <p className="ex-note">{t.nearbyNone}</p>
      ) : (
        <ul>
          {vehicles.map((vehicle) => {
            const next = nextStop(vehicle, now);
            const time = next === undefined ? null : stopTime(next);
            // A craft without a destination is told by its name: a flight, a ship, a shuttle.
            const destination =
              vehicle.destination === null
                ? (vehicle.operator ?? vehicle.name ?? '—')
                : stopName(vehicle.destination.name);
            return (
              <li key={vehicle.id}>
                <button
                  type="button"
                  className="ex-near"
                  onClick={() => {
                    onOpen(vehicle.id);
                  }}
                  aria-label={t.open(
                    `${vehicle.line?.name ?? t.modeOne[vehicle.mode]} → ${destination}`,
                  )}
                >
                  <span className={`ex-line ${vehicle.mode}`}>
                    {vehicle.line?.name ?? t.modeOne[vehicle.mode]}
                  </span>
                  <span className="ex-near-main">
                    <span className="ex-near-to">{destination}</span>
                    {next !== undefined && <span className="ex-note">{stopName(next.name)}</span>}
                  </span>
                  {time !== null && <time className="mono">{formatCityTime(time, locale)}</time>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
