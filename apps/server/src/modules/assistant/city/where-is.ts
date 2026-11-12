import type { LiveVehicle, PlanResponse } from '@moviq/contracts';

import { busSources } from '../../data-platform/sources/mta/bus-realtime.js';
import type { CitySnapshot } from '../../live/city.js';
import type { Finding, Unanswered, VehicleFact } from './findings.js';
import { routeOf, type RouteRef } from './lines.js';
import { citySources, liveModeOf, liveSourcesOf, modeIsLive, vehiclesOf } from './live-line.js';
import { sourceOf, watchedJourney, type CityPorts } from './ports.js';
import { simplifyName } from './stations.js';

type WhereAsked =
  | { readonly by: 'route'; readonly route: RouteRef; readonly towards: string | null }
  | { readonly by: 'vehicle'; readonly name: string }
  | { readonly by: 'trip'; readonly travellerId: string; readonly plan: PlanResponse | null };

/** At most this many vehicles are told, soonest at their next stop first. */
const MAX_VEHICLES = 3;

const [busPositions] = busSources;

/**
 * Where vehicles are, as Explore follows them: the line, its destination, the basis of the
 * position (GPS, between GPS reports, by station or by timetable) with its margin, and the next
 * stop with its predicted time. A mode whose live data cannot be read is said, not left empty.
 */
export async function whereIs(
  ports: CityPorts,
  asked: WhereAsked,
  now: Date,
): Promise<Finding | Unanswered> {
  const snapshot = await ports.live.snapshot();
  switch (asked.by) {
    case 'route': {
      const towards = asked.towards === null ? '' : simplifyName(asked.towards);
      const found = vehiclesOf(snapshot, asked.route).filter(
        (vehicle) =>
          towards === '' || simplifyName(vehicle.destination?.name ?? '').includes(towards),
      );
      const live = modeIsLive(snapshot, liveModeOf(asked.route));
      const subject =
        asked.towards === null ? asked.route.label : `${asked.route.label} → ${asked.towards}`;
      return answer(subject, live ? found : null, liveSourcesOf(snapshot, asked.route), now);
    }
    case 'vehicle': {
      const name = asked.name.trim().toLowerCase();
      const found = snapshot.vehicles.filter((vehicle) => vehicle.name?.toLowerCase() === name);
      const ids = [...new Set(found.map((vehicle) => vehicle.sourceId))];
      const sources = citySources(snapshot, ids.length === 0 ? sourceIdsOf(snapshot) : ids);
      return answer(asked.name, found, sources, now);
    }
    case 'trip':
      return tripVehicle(ports, snapshot, asked, now);
  }
}

function answer(
  subject: string,
  vehicles: readonly LiveVehicle[] | null,
  sources: Finding['sources'],
  now: Date,
): Finding {
  const sorted = [...(vehicles ?? [])].sort((a, b) => nextAt(a, now) - nextAt(b, now));
  return {
    kind: 'where-is',
    subject,
    vehicles: vehicles === null ? null : sorted.slice(0, MAX_VEHICLES).map(vehicleFact),
    more: Math.max(0, sorted.length - MAX_VEHICLES),
    sources,
  };
}

const sourceIdsOf = (snapshot: CitySnapshot) =>
  snapshot.modes
    .filter((summary) => summary.mode === 'bus')
    .flatMap((summary) => summary.sourceIds);

function nextAt(vehicle: LiveVehicle, now: Date): number {
  const [next] = vehicle.stops;
  const at = next?.arrival ?? next?.departure;
  return at === undefined || at === null ? Number.MAX_SAFE_INTEGER : Date.parse(at) - now.getTime();
}

function vehicleFact(vehicle: LiveVehicle): VehicleFact {
  const [next] = vehicle.stops;
  const { position } = vehicle;
  return {
    line: vehicle.line?.name ?? '',
    name: vehicle.name,
    destination: vehicle.destination?.name ?? '',
    basis: position.basis,
    station:
      position.station === null
        ? null
        : { name: position.station.name, status: position.station.status },
    marginMeters: position.marginMeters,
    dataTime: position.dataTime,
    next: next === undefined ? null : { name: next.name, at: next.arrival ?? next.departure },
  };
}

/** The vehicle of the next ride of the trip under watch, or of the plan, by its trip id. */
async function tripVehicle(
  ports: CityPorts,
  snapshot: CitySnapshot,
  asked: Extract<WhereAsked, { by: 'trip' }>,
  now: Date,
): Promise<Finding | Unanswered> {
  const journey = await watchedJourney(ports.db, asked.travellerId);
  const itinerary =
    journey?.itinerary ??
    asked.plan?.itineraries.find((candidate) => candidate.id === asked.plan?.recommendedId);
  const leg = itinerary?.legs.find(
    (candidate) =>
      (candidate.mode === 'bus' || candidate.mode === 'subway') &&
      candidate.tripId !== null &&
      Date.parse(candidate.arriveAt) > now.getTime(),
  );
  const route = leg?.route === null || leg === undefined ? undefined : routeOf(leg.route.shortName);
  if (leg?.tripId === null || leg === undefined || route === undefined) return { kind: 'no-trip' };
  const vehicleId =
    leg.mode === 'subway' ? `subway:${leg.tripId}` : await busOfTrip(ports, leg.tripId);
  const found = snapshot.vehicles.filter((vehicle) => vehicle.id === vehicleId);
  const live = modeIsLive(snapshot, liveModeOf(route));
  const sources = liveSourcesOf(snapshot, route);
  if (leg.mode === 'bus' && sources.length === 0) {
    sources.push(sourceOf(busPositions, await ports.reader.read(busPositions)));
  }
  return answer(route.label, live ? found : null, sources, now);
}

/** The bus running a trip, by the positions of Bus Time: the map knows buses by vehicle. */
async function busOfTrip(ports: CityPorts, tripId: string): Promise<string | undefined> {
  const reading = await ports.reader.read(busPositions);
  const bus = reading.data?.vehicles.find((vehicle) => vehicle.tripId === tripId);
  return bus === undefined ? undefined : `bus:${bus.vehicleId}`;
}
