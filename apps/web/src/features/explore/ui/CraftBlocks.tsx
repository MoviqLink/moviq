import type { LiveVehicle } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { shipCategory } from '../model/modes';
import { useExploreT } from '../texts';

const METERS_PER_FOOT = 0.3048;

/** An aircraft: its callsign, its altitude or that it is on the ground, and its usual route. */
export function AircraftBlock({ vehicle }: { vehicle: LiveVehicle }) {
  const t = useExploreT();
  const locale = useLocale();
  const words = t.craft.aircraft;
  const altitude = vehicle.altitudeMeters;
  const route = vehicle.usualRoute;
  return (
    <section className="ex-group" aria-label={words.flight}>
      <span className="ex-k">{words.flight}</span>
      <div className="ex-row">
        <span className="ex-k">{words.callsign}</span>
        <span className="ex-v mono">{vehicle.name ?? '—'}</span>
      </div>
      <div className="ex-row">
        <span className="ex-k">{words.altitude}</span>
        {vehicle.onGround === true ? (
          <span className="ex-v">{words.onGround}</span>
        ) : altitude === null ? (
          <>
            <span className="ex-v ex-none">—</span>
            <span className="ex-note">{words.noAltitude}</span>
          </>
        ) : (
          <>
            <span className="ex-v mono">{Math.round(altitude).toLocaleString(locale)} m</span>
            <span className="ex-note">
              {words.feet(
                (Math.round(altitude / METERS_PER_FOOT / 100) * 100).toLocaleString(locale),
              )}
            </span>
          </>
        )}
      </div>
      <div className="ex-row">
        <span className="ex-k">{words.usualRoute}</span>
        {route === null ? (
          <>
            <span className="ex-v ex-none">—</span>
            <span className="ex-note">{words.noRoute}</span>
          </>
        ) : (
          <>
            <span className="ex-v mono">{route.join(' → ')}</span>
            <span className="ex-note">{words.routeNote}</span>
          </>
        )}
      </div>
    </section>
  );
}

/** A ship: what kind of vessel its AIS declares, its MMSI and the destination its crew typed. */
export function ShipBlock({ vehicle }: { vehicle: LiveVehicle }) {
  const t = useExploreT();
  const words = t.craft.ship;
  const mmsi = vehicle.id.replace(/^ship:/, '');
  return (
    <section className="ex-group" aria-label={words.voyage}>
      <span className="ex-k">{words.voyage}</span>
      <div className="ex-row">
        <span className="ex-k">{words.type}</span>
        <span className="ex-v">{words.types[shipCategory(vehicle.shipType)]}</span>
        <span className="ex-note mono">{words.mmsi(mmsi)}</span>
      </div>
      <div className="ex-row">
        <span className="ex-k">{words.destination}</span>
        {vehicle.destination === null ? (
          <>
            <span className="ex-v ex-none">—</span>
            <span className="ex-note">{words.noDestination}</span>
          </>
        ) : (
          <>
            <span className="ex-v mono">{vehicle.destination.name}</span>
            <span className="ex-note">{words.destinationNote}</span>
          </>
        )}
      </div>
    </section>
  );
}

/** A shuttle: who runs it, on which route, how full it is, and that its feed lists no stops. */
export function ShuttleBlock({ vehicle }: { vehicle: LiveVehicle }) {
  const t = useExploreT();
  const words = t.craft.shuttle;
  const { occupancy } = vehicle;
  return (
    <section className="ex-group" aria-label={words.service}>
      <span className="ex-k">{words.service}</span>
      <div className="ex-row">
        <span className="ex-k">{words.operator}</span>
        <span className="ex-v">{vehicle.operator ?? '—'}</span>
      </div>
      <div className="ex-row">
        <span className="ex-k">{words.route}</span>
        {vehicle.line === null ? (
          <>
            <span className="ex-v ex-none">—</span>
            <span className="ex-note">{words.noRoute}</span>
          </>
        ) : (
          <span className="ex-v">{vehicle.line.name}</span>
        )}
      </div>
      <div className="ex-row">
        <span className="ex-k">{words.onBoard}</span>
        {occupancy === null ? (
          <>
            <span className="ex-v ex-none">—</span>
            <span className="ex-note">{words.noCounter}</span>
          </>
        ) : (
          <span className="ex-v mono">{words.load(occupancy.passengers, occupancy.capacity)}</span>
        )}
      </div>
      <p className="ex-note">{words.noStops}</p>
    </section>
  );
}
