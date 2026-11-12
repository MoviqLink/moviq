import {
  NO_DROP_OFF,
  NO_PICKUP,
  type StopTimeColumns,
} from '../../../src/modules/journeys/engine/inputs.js';

/** The calls of one trip in travel order, as a test or a GTFS reader collects them. */
export interface TripCalls {
  readonly stops: readonly string[];
  readonly arrivals: readonly number[];
  readonly departures: readonly number[];
  readonly noPickup: readonly number[];
  readonly noDropOff: readonly number[];
}

/** Trips laid out in the flat columns the engine reads. */
export function stopTimeColumns(trips: readonly (readonly [string, TripCalls])[]): StopTimeColumns {
  const stops: string[] = [];
  const stopIndex = new Map<string, number>();
  const total = trips.reduce((sum, [, calls]) => sum + calls.stops.length, 0);
  const columns = {
    trips: trips.map(([id]) => id),
    tripStart: new Int32Array(trips.length + 1),
    stops,
    stop: new Int32Array(total),
    arrival: new Int32Array(total),
    departure: new Int32Array(total),
    flags: new Uint8Array(total),
  };
  let at = 0;
  for (const [trip, [, calls]] of trips.entries()) {
    for (const [position, id] of calls.stops.entries()) {
      let index = stopIndex.get(id);
      if (index === undefined) {
        index = stops.length;
        stops.push(id);
        stopIndex.set(id, index);
      }
      columns.stop[at] = index;
      columns.arrival[at] = calls.arrivals[position] ?? 0;
      columns.departure[at] = calls.departures[position] ?? 0;
      columns.flags[at] =
        (calls.noPickup.includes(position) ? NO_PICKUP : 0) |
        (calls.noDropOff.includes(position) ? NO_DROP_OFF : 0);
      at += 1;
    }
    columns.tripStart[trip + 1] = at;
  }
  return columns;
}
