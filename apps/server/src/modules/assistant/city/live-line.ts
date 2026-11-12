import type { CitySource, LiveMode, LiveVehicle } from '@moviq/contracts';

import type { SourceDefinition } from '../../data-platform/definition.js';
import { subwaySources, type SubwayFeed } from '../../data-platform/sources/mta/subway-realtime.js';
import type { CitySnapshot } from '../../live/city.js';
import type { RouteRef } from './lines.js';

/** The MTA feed that carries each subway route, as on the MTA developer page. */
const SUBWAY_FEEDS: readonly (readonly [feed: string, routes: readonly string[]])[] = [
  ['ace', ['A', 'C', 'E', 'H']],
  ['bdfm', ['B', 'D', 'F', 'M', 'FS']],
  ['g', ['G']],
  ['jz', ['J', 'Z']],
  ['nqrw', ['N', 'Q', 'R', 'W']],
  ['l', ['L']],
  ['1234567', ['1', '2', '3', '4', '5', '6', '7', 'GS']],
  ['sir', ['SI']],
];

/** The live feeds of the subway routes asked for. */
export function subwayFeedsOf(ids: readonly string[]): SourceDefinition<SubwayFeed>[] {
  const feeds = SUBWAY_FEEDS.filter(([, routes]) => routes.some((route) => ids.includes(route)));
  return subwaySources.filter((definition) =>
    feeds.some(([feed]) => definition.id === `mta-subway-${feed}`),
  );
}

/** The mode of Explore a line runs in. */
export const liveModeOf = (route: RouteRef): LiveMode => (route.mode === 'bus' ? 'bus' : 'subway');

/** The sources of those ids that Explore read, as Sara cites them. */
export function citySources(snapshot: CitySnapshot, ids: readonly string[]): CitySource[] {
  return snapshot.sources
    .filter((source) => ids.includes(source.provenance.sourceId))
    .map(({ title, provenance }) => ({
      sourceId: provenance.sourceId,
      title,
      dataTime: provenance.dataTime,
      ageSeconds: provenance.ageSeconds,
      state: provenance.state,
    }));
}

/** Live feeds of the route that Explore read. */
export function liveSourcesOf(snapshot: CitySnapshot, route: RouteRef): CitySource[] {
  const ids =
    route.mode === 'bus'
      ? ['mta-bus-positions', 'mta-bus-trip-updates']
      : subwayFeedsOf(route.ids).map((definition) => definition.id);
  return citySources(snapshot, ids);
}

/** Whether Explore has live data of the mode now: not when its live sources are unusable. */
export function modeIsLive(snapshot: CitySnapshot, mode: LiveMode): boolean {
  const status = snapshot.modes.find((summary) => summary.mode === mode)?.status;
  return status === 'live' || status === 'degraded';
}

/** The vehicles of the route followed in Explore now. */
export function vehiclesOf(snapshot: CitySnapshot, route: RouteRef): LiveVehicle[] {
  const mode = liveModeOf(route);
  return snapshot.vehicles.filter(
    (vehicle) =>
      vehicle.mode === mode && vehicle.line !== null && route.ids.includes(vehicle.line.id),
  );
}
