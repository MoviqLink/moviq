import type { Leg, NeedRequest } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { journeyStore } from '../journeys/journey-store.js';
import { merchantStore, type Merchant } from './merchants.js';

/** A merchant on the way, with when the traveller passes its stop and until when they can collect. */
export interface Passing {
  readonly merchant: Merchant;
  readonly passAt: Date;
  readonly pickupBefore: Date;
}

/** A stop counts as on the route when the route's drawn path comes this close to it. */
const NEAR_METRES = 150;
/** How long after passing the stop the traveller can still collect. */
const WINDOW_MS = 30 * 60_000;
/** Needs are for the trip under way: a stop passed within this time. */
const AHEAD_MS = 3 * 60 * 60_000;
const MINUTE = 60_000;

export type RouteAnswer =
  | { readonly ok: true; readonly passing: readonly Passing[] }
  | { readonly ok: false; readonly message: string };

/**
 * The demo merchants on the traveller's way: next to a stop their watched journey passes from
 * now on (by the journey's own legs and times), or next to the one stop they named.
 */
export async function merchantsOnTheWay(
  deps: { readonly db: Database; readonly clock: Clock },
  travellerId: string,
  route: NeedRequest['route'],
): Promise<RouteAnswer> {
  const now = deps.clock.now();
  const merchants = await merchantStore.all(deps.db);
  if ('stopId' in route) {
    const passAt = route.at === undefined ? now : new Date(route.at);
    if (passAt.getTime() < now.getTime() - MINUTE || passAt.getTime() > now.getTime() + AHEAD_MS) {
      return {
        ok: false,
        message: 'The time you pass the stop must be within the next three hours.',
      };
    }
    const passing = merchants
      .filter((merchant) => merchant.summary.stop.id === route.stopId)
      .map((merchant) => ({
        merchant,
        passAt,
        pickupBefore: new Date(passAt.getTime() + WINDOW_MS),
      }));
    return { ok: true, passing };
  }
  const stored = await journeyStore.get(deps.db, route.journeyId);
  if (stored?.travellerId !== travellerId)
    return { ok: false, message: 'There is no journey with that id.' };
  if (stored.journey.state !== 'watching') {
    return { ok: false, message: 'This journey is no longer being watched.' };
  }
  const legs = stored.journey.itinerary.legs;
  const passing = merchants.flatMap((merchant) => {
    const passAt = passTime(legs, merchant.stopAt);
    if (passAt === undefined || passAt.getTime() < now.getTime()) return [];
    return [{ merchant, passAt, pickupBefore: new Date(passAt.getTime() + WINDOW_MS) }];
  });
  return { ok: true, passing: passing.sort((a, b) => a.passAt.getTime() - b.passAt.getTime()) };
}

/** When the itinerary passes nearest a point, estimated along the leg's path; undefined if it never does. */
export function passTime(
  legs: readonly Leg[],
  at: { readonly lat: number; readonly lon: number },
): Date | undefined {
  for (const leg of legs) {
    const points =
      leg.path.length > 0
        ? leg.path
        : [[leg.from.lon, leg.from.lat] as const, [leg.to.lon, leg.to.lat] as const];
    const share = positionOnPath(points, at, leg.path.length > 1);
    if (share === undefined) continue;
    const start = new Date(leg.departAt).getTime();
    const end = new Date(leg.arriveAt).getTime();
    return new Date(start + Math.round((end - start) * share));
  }
  return undefined;
}

/** Along the published path, weighted by distance. Without a path only its actual endpoints count. */
function positionOnPath(
  points: readonly (readonly [number, number])[],
  at: { readonly lat: number; readonly lon: number },
  hasPath: boolean,
): number | undefined {
  const distances = points.slice(1).map(([lon, lat], index) => {
    const prior = points[index];
    return prior === undefined ? 0 : metresBetween({ lat: prior[1], lon: prior[0] }, { lat, lon });
  });
  const total = distances.reduce((sum, value) => sum + value, 0);
  let before = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    const next = points[index + 1];
    if (hasPath && next !== undefined) {
      const cosine = Math.cos((at.lat * Math.PI) / 180);
      const dx = (next[0] - point[0]) * cosine;
      const dy = next[1] - point[1];
      const length = dx * dx + dy * dy;
      const t =
        length === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((at.lon - point[0]) * cosine * dx + (at.lat - point[1]) * dy) / length),
            );
      const projected = {
        lon: point[0] + (next[0] - point[0]) * t,
        lat: point[1] + (next[1] - point[1]) * t,
      };
      if (metresBetween(at, projected) <= NEAR_METRES)
        return total === 0 ? 0 : (before + (distances[index] ?? 0) * t) / total;
    } else if (metresBetween(at, { lat: point[1], lon: point[0] }) <= NEAR_METRES) {
      return total === 0 ? 0 : before / total;
    }
    before += distances[index] ?? 0;
  }
  return undefined;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function metresBetween(
  a: { readonly lat: number; readonly lon: number },
  b: { readonly lat: number; readonly lon: number },
): number {
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
