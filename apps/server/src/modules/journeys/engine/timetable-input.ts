import { z } from 'zod';

import {
  stopTimesSchema,
  type GtfsIndex,
} from '../../data-platform/sources/mta/gtfs-static-schema.js';
import { codesOf, countCalls, readTrip } from '../../data-platform/sources/mta/stop-times-codec.js';
import type { StopTimeColumns, TimetableInput, WheelchairBoarding } from './inputs.js';

type Decoded = StopTimeColumns | string;

/** The calls of every trip laid out in columns, or why the text does not hold them. */
function decodeColumns(stopTimes: z.output<typeof stopTimesSchema>): Decoded {
  const codes = codesOf(stopTimes.calls);
  const counted = countCalls(codes);
  if (counted === undefined) return 'the calls break the encoding';
  if (counted.trips !== stopTimes.trips.length) {
    return `${String(counted.trips)} trips of calls for ${String(stopTimes.trips.length)} trips`;
  }
  const columns = {
    trips: stopTimes.trips,
    tripStart: new Int32Array(stopTimes.trips.length + 1),
    stops: stopTimes.stops,
    stop: new Int32Array(counted.calls),
    arrival: new Int32Array(counted.calls),
    departure: new Int32Array(counted.calls),
    flags: new Uint8Array(counted.calls),
  };
  const cursor = { at: 0 };
  let offset = 0;
  for (let trip = 0; trip < stopTimes.trips.length; trip += 1) {
    const count = readTrip(codes, cursor, stopTimes.stops.length, columns, offset);
    if (count < 0) return `the calls of trip ${stopTimes.trips[trip] ?? ''} are not valid`;
    offset += count;
    columns.tripStart[trip + 1] = offset;
  }
  return columns;
}

/**
 * The stop times of a GTFS index in the columns the engine reads: validated, then decoded with
 * every stop index in range and every time of zero or more, in `stop_sequence` order.
 */
const stopTimeColumnsSchema = stopTimesSchema.transform((stopTimes, context) => {
  const decoded = decodeColumns(stopTimes);
  if (typeof decoded !== 'string') return decoded;
  context.addIssue({ code: 'custom', message: decoded });
  return z.NEVER;
});

/** `wheelchair_boarding` from the file, with the step-free stops of other sources on top. */
export function wheelchairBoardingOf(
  index: GtfsIndex,
  stepFree: Readonly<Record<string, WheelchairBoarding>>,
): Record<string, WheelchairBoarding> {
  const own = Object.entries(index.stops).flatMap(([id, stop]) =>
    stop.wheelchairBoarding === undefined ? [] : [[id, stop.wheelchairBoarding] as const],
  );
  return { ...Object.fromEntries(own), ...stepFree };
}

/**
 * Why the engine cannot use a served GTFS index, or undefined when it can: an index stored
 * before stop times were kept (until 11/11/2026) has none, and stop times must decode whole.
 * Decoding to check costs 0.05 s for Brooklyn (2.4 M calls); the columns are dropped after.
 */
export function stopTimesProblem(index: GtfsIndex): string | undefined {
  if (index.stopTimes === undefined) {
    return 'The version served was stored without its stop times.';
  }
  const columns = stopTimeColumnsSchema.safeParse(index.stopTimes);
  if (columns.success) return undefined;
  return `Its stop times do not decode: ${columns.error.issues[0]?.message ?? ''}.`;
}

/**
 * The engine's view of an index whose stop times were checked with `stopTimesProblem`. Its
 * columns (13 bytes a call, 30 MB for Brooklyn) are decoded when the engine first reads them,
 * when it compiles, and go with the object: the compiled network keeps its own arrays.
 */
export function checkedTimetable(
  index: GtfsIndex,
  wheelchairBoarding: Readonly<Record<string, WheelchairBoarding>>,
  access: Pick<TimetableInput, 'complexes' | 'entrances'>,
): TimetableInput {
  const { routes, stops, trips, services } = index;
  let columns: StopTimeColumns | undefined;
  return {
    routes,
    stops,
    trips,
    services,
    get stopTimes(): StopTimeColumns {
      if (columns === undefined) {
        const decoded = stopTimeColumnsSchema.safeParse(index.stopTimes);
        if (!decoded.success) throw new Error('Stop times checked before no longer decode.');
        columns = decoded.data;
      }
      return columns;
    },
    transfers: index.transfers ?? [],
    shapes: index.shapes ?? {},
    wheelchairBoarding,
    complexes: access.complexes,
    entrances: access.entrances,
  };
}

/** What the engine reads from one served GTFS index, or why it cannot. */
export function timetableInput(
  index: GtfsIndex,
  stepFree: Readonly<Record<string, WheelchairBoarding>> = {},
):
  | { readonly ok: true; readonly timetable: TimetableInput }
  | { readonly ok: false; readonly detail: string } {
  const problem = stopTimesProblem(index);
  if (problem !== undefined) return { ok: false, detail: problem };
  const wheelchairBoarding = wheelchairBoardingOf(index, stepFree);
  const access = { complexes: {}, entrances: {} };
  return { ok: true, timetable: checkedTimetable(index, wheelchairBoarding, access) };
}
