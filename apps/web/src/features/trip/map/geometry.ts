import type { Itinerary, Leg, TravelMode } from '@moviq/contracts';

import { walkBasis } from '../../../shared/journey/walks';

type Position = [number, number];

interface RouteFeature {
  readonly type: 'Feature';
  readonly properties: {
    readonly kind: 'walk' | 'street-walk' | 'ride' | 'taxi';
    readonly risk: boolean;
  };
  readonly geometry: { readonly type: 'LineString'; readonly coordinates: Position[] };
}

export interface RouteCollection {
  readonly type: 'FeatureCollection';
  readonly features: RouteFeature[];
}

function straight(leg: Leg): Position[] {
  return [
    [leg.from.lon, leg.from.lat],
    [leg.to.lon, leg.to.lat],
  ];
}

/** A leg's drawn path; with none from the source, the straight line between its two places. */
export function pathOf(leg: Leg): Position[] {
  if (leg.path.length >= 2) return leg.path;
  return [
    [leg.from.lon, leg.from.lat],
    [leg.to.lon, leg.to.lat],
  ];
}

/**
 * A walk walked on the streets is drawn along its path; any other walk (estimated, or a change
 * inside a station) is the dotted straight line, never a way walked.
 */
function kindOf(leg: Leg): RouteFeature['properties']['kind'] {
  if (leg.mode === 'walk') {
    return walkBasis(leg) === 'street' && leg.path.length >= 2 ? 'street-walk' : 'walk';
  }
  return leg.mode === 'taxi' ? 'taxi' : 'ride';
}

/** One line per leg, walking apart and the legs with an incident marked as risky. */
export function routeFeatures(
  itinerary: Itinerary,
  risky: ReadonlySet<number> = new Set(),
): RouteCollection {
  return {
    type: 'FeatureCollection',
    features: itinerary.legs.map((leg, index) => ({
      type: 'Feature',
      properties: { kind: kindOf(leg), risk: risky.has(index) },
      geometry: {
        type: 'LineString',
        coordinates: kindOf(leg) === 'walk' ? straight(leg) : pathOf(leg),
      },
    })),
  };
}

/** South-west and north-east corners around every leg of the itineraries given. */
export function boundsOf(itineraries: readonly Itinerary[]): [Position, Position] | null {
  const points = itineraries.flatMap((itinerary) => itinerary.legs.flatMap(pathOf));
  if (points.length === 0) return null;
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

const distance = (a: Position, b: Position) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The first `fraction` of a line by length, so the route can be drawn once from start to end. */
export function trimLine(coordinates: readonly Position[], fraction: number): Position[] {
  const first = coordinates[0];
  if (first === undefined || fraction >= 1) return [...coordinates];
  const lengths = coordinates
    .slice(1)
    .map((point, index) => distance(coordinates[index] ?? point, point));
  const goal = lengths.reduce((sum, length) => sum + length, 0) * Math.max(0, fraction);
  const out: Position[] = [first];
  let walked = 0;
  for (const [index, length] of lengths.entries()) {
    const from = coordinates[index] ?? first;
    const to = coordinates[index + 1] ?? from;
    if (walked + length >= goal) {
      const k = length === 0 ? 0 : (goal - walked) / length;
      out.push([from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]);
      return out;
    }
    out.push(to);
    walked += length;
  }
  return out;
}

export interface Stop {
  readonly at: Position;
  readonly kind: 'start' | 'board' | 'end';
  readonly mode: TravelMode;
  readonly label: string;
  /** The instant shown beside the stop: leaving, boarding or arriving. */
  readonly time: string;
}

/** The places to mark on the map: where the trip starts, where each ride is boarded and the end. */
export function stopsOf(itinerary: Itinerary): Stop[] {
  const first = itinerary.legs[0];
  const last = itinerary.legs.at(-1);
  if (first === undefined || last === undefined) return [];
  const boards = itinerary.legs
    .filter((leg, index) => leg.mode !== 'walk' && index > 0)
    .map((leg): Stop => ({
      at: [leg.from.lon, leg.from.lat],
      kind: 'board',
      mode: leg.mode,
      label: leg.route === null ? leg.from.label : `${leg.route.shortName} · ${leg.from.label}`,
      time: leg.departAt,
    }));
  return [
    {
      at: [first.from.lon, first.from.lat],
      kind: 'start',
      mode: first.mode,
      label: first.from.label,
      time: first.departAt,
    },
    ...boards,
    {
      at: [last.to.lon, last.to.lat],
      kind: 'end',
      mode: last.mode,
      label: last.to.label,
      time: last.arriveAt,
    },
  ];
}

/**
 * The route drawn up to `fraction` of its length, leg after leg, so it grows once from the start
 * to the arrival. Legs not reached yet are left out.
 */
export function trimRoute(route: RouteCollection, fraction: number): RouteCollection {
  const lengths = route.features.map((feature) =>
    feature.geometry.coordinates
      .slice(1)
      .reduce(
        (sum, point, index) => sum + distance(feature.geometry.coordinates[index] ?? point, point),
        0,
      ),
  );
  const goal = lengths.reduce((sum, length) => sum + length, 0) * fraction;
  const features: RouteFeature[] = [];
  let walked = 0;
  for (const [index, feature] of route.features.entries()) {
    const length = lengths[index] ?? 0;
    if (walked >= goal && length > 0) break;
    const part = length === 0 ? 1 : Math.min(1, (goal - walked) / length);
    const coordinates = trimLine(feature.geometry.coordinates, part);
    features.push({ ...feature, geometry: { type: 'LineString', coordinates } });
    walked += length;
  }
  return { type: 'FeatureCollection', features };
}
