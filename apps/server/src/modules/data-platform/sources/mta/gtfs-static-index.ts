import { toInstant } from '@moviq/contracts';

import type { ParseResult } from '../../definition.js';
import type { GtfsTables } from './gtfs-static-rows.js';
import type { GtfsIndex, GtfsRoute, GtfsStopTimes, GtfsTransfer } from './gtfs-static-schema.js';
import { encodePolyline } from './polyline.js';
import { count } from './provider.js';
import { codesOf, countCalls } from './stop-times-codec.js';

type Refusal = Extract<ParseResult<GtfsIndex>, { ok: false }>;

/** Each shape as one encoded polyline in sequence order, or why `shapes.txt` cannot give one. */
export function encodedShapes(
  tables: GtfsTables,
): { readonly ok: true; readonly shapes: Record<string, string> } | Refusal {
  const shapes: Record<string, string> = {};
  for (const [shapeId, points] of tables.shapes) {
    const sorted = [...points].sort((a, b) => a.sequence - b.sequence);
    const repeated = sorted.find((point, index) => sorted[index + 1]?.sequence === point.sequence);
    if (repeated !== undefined) {
      const detail = `shapes.txt: shape ${shapeId} repeats point ${String(repeated.sequence)}`;
      return { ok: false, code: 'invalid-row', detail };
    }
    // Some feeds include a single-point placeholder (Metro-North shape 27). It cannot
    // describe a route, but the valid timetable must remain usable without that geometry.
    if (sorted.length < 2) continue;
    shapes[shapeId] = encodePolyline(sorted);
  }
  return { ok: true, shapes };
}

/** The optional parts of the index, present only when their tables were read. */
interface Extras {
  readonly shapes: Record<string, string> | undefined;
  readonly routing:
    { readonly stopTimes: GtfsStopTimes; readonly transfers: readonly GtfsTransfer[] } | undefined;
}

export function toIndex(tables: GtfsTables, publishedAt: Date, extras: Extras): GtfsIndex {
  const usedRoutes = new Set([...tables.trips.values()].map((trip) => trip.route));
  const routes = [...tables.routes].filter(([id]) => usedRoutes.has(id));
  const { shapes, routing } = extras;
  return {
    indexVersion: 2,
    feed: {
      publisher: tables.feedInfo?.publisher ?? null,
      version: tables.feedInfo?.version ?? null,
      startDate: tables.feedInfo?.startDate ?? null,
      endDate: tables.feedInfo?.endDate ?? null,
      publishedAt: toInstant(publishedAt),
    },
    routes: Object.fromEntries<GtfsRoute>(routes),
    stops: Object.fromEntries(tables.stops),
    trips: Object.fromEntries(
      [...tables.trips].map(([id, trip]) => [
        id,
        typeof trip.shape === 'string' && tables.shapes.get(trip.shape)?.length === 1
          ? { ...trip, shape: null }
          : trip,
      ]),
    ),
    services: Object.fromEntries(tables.services),
    ...(shapes === undefined ? {} : { shapes }),
    ...(routing === undefined
      ? {}
      : { stopTimes: routing.stopTimes, transfers: [...routing.transfers] }),
  };
}

function callsOf(stopTimes: GtfsStopTimes): number {
  return countCalls(codesOf(stopTimes.calls))?.calls ?? 0;
}

/** A short count for operators; the optional parts only when the index has them. */
export function describeIndex(index: GtfsIndex): string {
  const stops = Object.values(index.stops);
  return [
    count(Object.keys(index.routes).length, 'routes'),
    count(stops.filter((stop) => stop.station).length, 'stations'),
    count(stops.length, 'stops'),
    count(Object.keys(index.trips).length, 'trips'),
    ...(index.shapes === undefined ? [] : [count(Object.keys(index.shapes).length, 'shapes')]),
    ...(index.stopTimes === undefined ? [] : [count(callsOf(index.stopTimes), 'stop times')]),
    ...(index.transfers === undefined ? [] : [count(index.transfers.length, 'transfers')]),
  ].join(', ');
}
