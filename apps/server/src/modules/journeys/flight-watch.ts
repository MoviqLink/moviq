import {
  toInstant,
  type Flight,
  type FlightCheck,
  type Incident,
  type Journey,
} from '@moviq/contracts';

import { toNewYorkWallClockText } from '../../infrastructure/clock/new-york.js';
import { callSignOf } from './flight-callsign.js';
import { deadlineFor, plannedDeparture } from './flight-deadline.js';
import {
  aeroDataBoxFact,
  aircraftFact,
  airportFact,
  type AeroDataBoxFact,
  type FlightLive,
  type FlightWatchSources,
} from './flight-facts.js';
import { flightIncidents } from './flight-incidents.js';
import { BOARDING_PASS, triangulate } from './flight-triangulation.js';

/** A deadline that moves less than this stays as it was. */
const MOVED_MS = 60_000;

export interface FlightStep {
  readonly check: FlightCheck;
  readonly incidents: readonly Incident[];
  /** When to be at the airport now; the request's own deadline when the flight does not move it. */
  readonly arriveBy: string;
}

/**
 * One watch round for the flight of a journey: AeroDataBox (through its cache, so units are
 * spent only when an answer is due), the boarding pass, the FAA and ADS-B, triangulated. Once
 * the flight has left, AeroDataBox is not asked again.
 */
export async function checkFlight(
  journey: Journey,
  sources: FlightWatchSources,
  live: FlightLive,
  now: Date,
  signal?: AbortSignal,
): Promise<FlightStep | undefined> {
  const planned = journey.request.flight;
  if (planned === null) return undefined;
  const previous = journey.watch.flight;
  const earlier =
    previous?.aerodatabox ?? (planned.provenance.sourceId === 'aerodatabox' ? planned : null);
  const aerodatabox: AeroDataBoxFact =
    previous?.departure?.basis === 'take-off' && earlier !== null
      ? { kind: 'found', flight: earlier }
      : aeroDataBoxFact(
          await sources.flights.find(
            {
              carrier: planned.carrier,
              number: planned.number,
              date: toNewYorkWallClockText(new Date(planned.departureAt)).slice(0, 10),
            },
            signal,
          ),
          now,
        );
  const latest: Flight = aerodatabox.kind === 'found' ? aerodatabox.flight : (earlier ?? planned);
  const airport = airportFact(live, planned.airport);
  const aircraft = aircraftFact(
    live,
    { callSign: callSignOf(latest), hex: latest.aircraftHex, airport: planned.airport },
    plannedDeparture(latest),
    now,
  );
  const triangulation = triangulate({
    boardingPass: planned.provenance.sourceId === BOARDING_PASS ? planned : null,
    aerodatabox,
    earlier,
    airport,
    aircraft,
  });
  const arriveBy = deadline(journey, triangulation.check);
  return {
    check: triangulation.check,
    arriveBy,
    incidents: flightIncidents({
      journey,
      planned,
      triangulation,
      earlier,
      aerodatabox,
      airport,
      aircraft,
      arriveBy,
      now,
    }),
  };
}

/** The deadline from the departure used, unless the aircraft is already moving or has left. */
function deadline(journey: Journey, check: FlightCheck): string {
  const current = journey.request.arriveBy;
  const departure = check.departure;
  if (check.movement !== null || departure === null || departure.basis === 'take-off')
    return current;
  const moved = deadlineFor(new Date(departure.at));
  return Math.abs(moved.getTime() - Date.parse(current)) < MOVED_MS ? current : toInstant(moved);
}
