import type { ParseResult } from '../../definition.js';
import type { GtfsTables } from './gtfs-static-rows.js';
import { serviceRunsOn, type GtfsIndex, type GtfsStopTimes } from './gtfs-static-schema.js';
import { count } from './provider.js';

type Refusal = Extract<ParseResult<GtfsIndex>, { ok: false }>;

function refuse(code: string, detail: string): Refusal {
  return { ok: false, code, detail };
}

function tripProblems(tables: GtfsTables): string[] {
  const problems: string[] = [];
  const checkShapes = tables.shapes.size > 0;
  for (const [tripId, trip] of tables.trips) {
    if (!tables.routes.has(trip.route)) problems.push(`trip ${tripId} names route ${trip.route}`);
    if (!tables.services.has(trip.service)) {
      problems.push(`trip ${tripId} names service ${trip.service}`);
    }
    if (checkShapes && typeof trip.shape === 'string' && !tables.shapes.has(trip.shape)) {
      problems.push(`trip ${tripId} names shape ${trip.shape}`);
    }
  }
  return problems;
}

function stopProblems(tables: GtfsTables, stopTimes: GtfsStopTimes | undefined): string[] {
  const problems: string[] = [];
  for (const [stopId, stop] of tables.stops) {
    if (stop.parent !== null && tables.stops.get(stop.parent)?.station !== true) {
      problems.push(`stop ${stopId} names station ${stop.parent}`);
    }
  }
  for (const tripId of stopTimes?.trips ?? []) {
    if (!tables.trips.has(tripId)) problems.push(`stop_times.txt names trip ${tripId}`);
  }
  for (const stopId of stopTimes?.stops ?? []) {
    if (!tables.stops.has(stopId)) problems.push(`stop_times.txt names stop ${stopId}`);
  }
  for (const transfer of tables.transfers) {
    for (const stopId of [transfer.from, transfer.to]) {
      if (!tables.stops.has(stopId)) problems.push(`transfers.txt names stop ${stopId}`);
    }
  }
  return problems;
}

/**
 * A trip may only name a route, a service and a shape the file holds, and a stop time or a
 * transfer only its trips and stops. A file without `shapes.txt` at all is admitted without
 * shapes, since GTFS makes the table optional; one that holds some but not all is partial.
 */
export function brokenReference(
  tables: GtfsTables,
  stopTimes: GtfsStopTimes | undefined,
): string | undefined {
  const problems = [...tripProblems(tables), ...stopProblems(tables, stopTimes)];
  const [first] = problems;
  if (first === undefined) return undefined;
  return `${count(problems.length, 'missing references')}, first: ${first}`;
}

/** Why the timetable cannot serve today (New York date), or undefined when it can. */
export function notValidToday(tables: GtfsTables, today: string): Refusal | undefined {
  const start = tables.feedInfo?.startDate ?? null;
  const end = tables.feedInfo?.endDate ?? null;
  if (start !== null && today < start) {
    return refuse('outside-feed-dates', `the feed starts on ${start}; today is ${today}`);
  }
  if (end !== null && today > end) {
    return refuse('outside-feed-dates', `the feed ended on ${end}; today is ${today}`);
  }
  const running = new Set(
    [...tables.services].filter(([, service]) => serviceRunsOn(service, today)).map(([id]) => id),
  );
  if (![...tables.trips.values()].some((trip) => running.has(trip.service))) {
    return refuse('no-service-today', `no trip runs on ${today} in any calendar of the feed`);
  }
  return undefined;
}

/** A new version with under half the routes, stops or trips of the one served is partial. */
export function shrunk(index: GtfsIndex, served: GtfsIndex | undefined): string[] {
  if (served === undefined) return [];
  const parts = ['routes', 'stops', 'trips'] as const;
  return parts.flatMap((part) => {
    const now = Object.keys(index[part]).length;
    const before = Object.keys(served[part]).length;
    return now * 2 < before
      ? [`${count(now, part)}, under half of the ${String(before)} served`]
      : [];
  });
}

/** Fewer routes or stops than a file has ever had: a cut or partial export. */
export function belowMinimum(
  index: GtfsIndex,
  minimum: { readonly routes: number; readonly stops: number },
): string[] {
  const routes = Object.keys(index.routes).length;
  const stops = Object.keys(index.stops).length;
  return [
    ...(routes < minimum.routes
      ? [`${count(routes, 'routes')} with trips, minimum ${String(minimum.routes)}`]
      : []),
    ...(stops < minimum.stops
      ? [`${count(stops, 'stops')}, minimum ${String(minimum.stops)}`]
      : []),
  ];
}
