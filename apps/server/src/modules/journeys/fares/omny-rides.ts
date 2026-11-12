import { splitTransitousId } from '../../data-platform/on-demand/transitous-ids.js';
import type { RoutedLeg } from '../ports.js';

/**
 * The legs MovIQ can price with the MTA fare: subways and local buses, as Transitous names their
 * feeds (`feeds/us-ny.json` in the Transitous repository, read on 11/11/2026).
 */
const SUBWAY_FEED = 'us-ny-MTA-NYCSubway';
const BUS_FEEDS: ReadonlySet<string> = new Set([
  'us-ny-MTA-BusBronx',
  'us-ny-MTA-BusBrooklyn',
  'us-ny-MTA-BusManhattan',
  'us-ny-MTA-BusQueens',
  'us-ny-MTA-BusStatenIsland',
  'us-ny-MTA-BusCompany',
]);

/**
 * Express buses have another fare. In the MTA bus timetables of 11/11/2026 every express route,
 * and no other, is named BM, BxM, QM, SIM or X followed by its number (79 of 398 routes).
 */
const EXPRESS_BUS = /^(BM|BXM|QM|SIM|X)\d/i;

/**
 * Routes whose fare the MTA fare page does not state: the Staten Island Railway (`SI` in the
 * subway timetable) and the Q70 LaGuardia Link.
 */
const UNSTATED_SUBWAY_ROUTES: ReadonlySet<string> = new Set(['SI']);
const UNSTATED_BUS_ROUTE = /^Q70(\D|$)/i;

/** One tap of the card: entering the subway, or boarding a bus. */
export interface Ride {
  readonly kind: 'subway' | 'bus';
  readonly routeId: string;
  readonly at: Date;
}

/**
 * The taps an itinerary needs, or `undefined` when a leg has no verified rule. Changing trains
 * inside a station needs no tap; a change between two different stations is left unpriced,
 * because whether it stays inside the system is not known from the legs.
 */
export function ridesOf(legs: readonly RoutedLeg[]): readonly Ride[] | undefined {
  const rides: Ride[] = [];
  let previous: RoutedLeg | undefined;
  for (const leg of legs) {
    if (leg.mode === 'walk') continue;
    const kind = kindOf(leg);
    if (kind === undefined || leg.route === null) return undefined;
    if (kind === 'subway' && previous?.mode === 'subway') {
      if (!sameStation(previous.to.stopId, leg.from.stopId)) return undefined;
    } else {
      rides.push({ kind, routeId: leg.route.id, at: leg.departAt });
    }
    previous = leg;
  }
  return rides;
}

function kindOf(leg: RoutedLeg): Ride['kind'] | undefined {
  if (leg.route === null) return undefined;
  const ids = splitTransitousId(leg.route.id);
  if (ids === undefined) return undefined;
  if (leg.mode === 'subway' && ids.feed === SUBWAY_FEED) {
    return UNSTATED_SUBWAY_ROUTES.has(ids.gtfsId) ? undefined : 'subway';
  }
  if (leg.mode === 'bus' && BUS_FEEDS.has(ids.feed)) {
    const name = leg.route.shortName;
    return EXPRESS_BUS.test(name) || UNSTATED_BUS_ROUTE.test(name) ? undefined : 'bus';
  }
  return undefined;
}

/** Subway platforms are their station's GTFS id with `N` or `S` for the direction (`A41N`). */
function sameStation(a: string | null, b: string | null): boolean {
  const station = (id: string | null) => {
    const ids = id === null ? undefined : splitTransitousId(id);
    if (ids?.feed !== SUBWAY_FEED) return undefined;
    return ids.gtfsId.replace(/[NS]$/, '');
  };
  const first = station(a);
  return first !== undefined && first === station(b);
}
