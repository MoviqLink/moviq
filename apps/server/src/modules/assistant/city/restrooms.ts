import { nextStops, type CitySource, type LiveSource, type PlanResponse } from '@moviq/contracts';

import { restroomsNear } from '../../city-layers/restrooms-near.js';
import { mtaSubwayEntrances } from '../../data-platform/sources/accessibility/subway-entrances.js';
import { mtaSubwayStations } from '../../data-platform/sources/accessibility/subway-stations.js';
import type { Geocoder } from '../../journeys/ports.js';
import type { Finding, Unanswered } from './findings.js';
import { sourceOf, watchedJourney, type CityPorts } from './ports.js';
import { stationsNamed } from './stations.js';

/** Where the restrooms are looked for: the trip's next stops, a subway station or a place. */
export type RestroomsAsked =
  | { readonly by: 'trip' }
  | { readonly by: 'stop'; readonly name: string }
  | { readonly by: 'place'; readonly name: string };

interface NamedPoint {
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
}

/** The points asked about, whether the trip is step-free, and the sources read to find them. */
interface Asked {
  readonly points: readonly NamedPoint[];
  readonly stepFree: boolean;
  readonly sources: readonly CitySource[];
}

export interface RestroomPorts {
  readonly city: CityPorts;
  readonly geocoder: Geocoder;
  readonly signal: AbortSignal | undefined;
}

interface TripRef {
  readonly travellerId: string;
  readonly plan: PlanResponse | null;
}

/** The next stops of the trip under watch, or of the plan being made, with its step-free wish. */
async function tripPoints(ports: RestroomPorts, trip: TripRef, now: Date): Promise<Asked | null> {
  const journey = await watchedJourney(ports.city.db, trip.travellerId);
  const itinerary =
    journey?.itinerary ??
    trip.plan?.itineraries.find((candidate) => candidate.id === trip.plan?.recommendedId);
  const stops = itinerary === undefined ? [] : nextStops(itinerary.legs, now.getTime());
  if (stops.length === 0) return null;
  return { points: stops, stepFree: journey?.request.preferences.stepFree ?? false, sources: [] };
}

/** A subway station by name, placed at the middle of its entrances in the MTA survey. */
async function stopPoint(ports: RestroomPorts, said: string): Promise<Asked | Unanswered> {
  const { reader } = ports.city;
  const [stations, entrances] = await Promise.all([
    reader.read(mtaSubwayStations),
    reader.read(mtaSubwayEntrances),
  ]);
  if (stations.data === undefined || entrances.data === undefined) {
    return { kind: 'stations-unavailable', said };
  }
  const [named] = stationsNamed(stations.data, said, new Map());
  const doors = entrances.data.entrances.filter((door) =>
    named === undefined ? false : door.stations.includes(named.id),
  );
  if (named === undefined || doors.length === 0) return { kind: 'unknown-station', said };
  const mean = (index: 0 | 1) =>
    doors.reduce((total, door) => total + door.point[index], 0) / doors.length;
  return {
    points: [{ label: named.station.name, lon: mean(0), lat: mean(1) }],
    stepFree: false,
    sources: [sourceOf(mtaSubwayEntrances, entrances)],
  };
}

/** A place or address, found by the same geocoder as the trips. */
async function placePoint(ports: RestroomPorts, said: string): Promise<Asked | Unanswered> {
  const outcome = await ports.geocoder.search(said, ports.signal);
  if (!outcome.ok) return { kind: 'places-unavailable', said };
  const [first] = outcome.value;
  if (first === undefined) return { kind: 'unknown-place', said };
  return { points: [first], stepFree: false, sources: [] };
}

const cited = (source: LiveSource): CitySource => ({
  sourceId: source.provenance.sourceId,
  title: source.title,
  dataTime: source.provenance.dataTime,
  ageSeconds: source.provenance.ageSeconds,
  state: source.provenance.state,
});

/**
 * The public restrooms in service nearest to the trip's next stops, a station or a place, from
 * the city's list only: every one is free. The distance is a straight line, the hours are as
 * published, and a list that cannot be read is said, never taken for "none near".
 */
export async function restroomsNearFinding(
  ports: RestroomPorts,
  asked: RestroomsAsked,
  trip: TripRef,
  now: Date,
): Promise<Finding | Unanswered> {
  const where =
    asked.by === 'trip'
      ? await tripPoints(ports, trip, now)
      : asked.by === 'stop'
        ? await stopPoint(ports, asked.name)
        : await placePoint(ports, asked.name);
  if (where === null) return { kind: 'no-trip' };
  if (!('points' in where)) return where;
  const answer = await restroomsNear(ports.city.reader, where.points, where.stepFree, now);
  const labels = where.points.map((point) => point.label);
  return {
    kind: 'restrooms',
    scope: asked.by,
    subject: labels.join(', '),
    stepFree: answer.stepFree,
    withinMetres: answer.withinMetres,
    restrooms:
      answer.restrooms?.map((restroom) => ({
        name: restroom.name,
        near: labels[restroom.near] ?? '',
        straightMetres: restroom.straightMetres,
        hours: restroom.facts.hours,
        season: restroom.facts.season,
        access: restroom.facts.access,
        keyOrCode: restroom.facts.keyOrCode,
      })) ?? null,
    sources: [cited(answer.source), ...where.sources],
  };
}
