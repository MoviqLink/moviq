import type { PredictedStop } from '../../data-platform/sources/mta/realtime-feed.js';
import { unixSeconds, type ExtractedEvent } from '../events.js';

/** A trip as the feeds of predictions describe it: the stops still ahead, in travel order. */
export interface TripView {
  readonly tripId: string;
  readonly routeId: string;
  readonly direction: string | null;
  readonly vehicleId: string | null;
  readonly stops: readonly PredictedStop[];
}

export type StopTime = (stop: PredictedStop) => number | undefined;

/** The departure a feed gives for a stop, or its arrival when it gives no departure. */
export const departureTime: StopTime = (stop) => {
  const time = stop.departure ?? stop.arrival;
  return time === null ? undefined : unixSeconds(time);
};

/** The arrival a feed gives for a stop, or its departure when it gives no arrival. */
export const arrivalTime: StopTime = (stop) => {
  const time = stop.arrival ?? stop.departure;
  return time === null ? undefined : unixSeconds(time);
};

interface TripMemory {
  readonly seenAt: number;
  readonly stops: readonly string[];
  readonly times: ReadonlyMap<string, number>;
}

function departuresOf(trip: TripView, before: TripMemory, feedTime: number): ExtractedEvent[] {
  const head = trip.stops[0]?.stopId;
  const index = head === undefined ? -1 : before.stops.indexOf(head);
  // A new first stop that was not ahead before means a changed path: nothing can be deduced.
  if (index <= 0) return [];
  return before.stops.slice(0, index).map((stop, position) => {
    const predicted = before.times.get(stop);
    const exact = predicted !== undefined && predicted >= before.seenAt && predicted <= feedTime;
    return {
      k: 'stn',
      t: exact ? predicted : feedTime,
      ev: 'dep',
      trip: trip.tripId,
      route: trip.routeId,
      dir: trip.direction,
      veh: trip.vehicleId,
      stop,
      next: before.stops[position + 1] ?? null,
      lo: before.seenAt,
      hi: feedTime,
      exact,
    };
  });
}

/**
 * Deduces departures from how each trip evolves, as Vektia's arrival engine does: a stop that
 * was ahead and is no longer stopped being listed between the two versions. Inside that window
 * the last time the feed gave for the stop is taken when it falls there; otherwise only the
 * window is known. Some feeds list a stop until the train has reached the next one (the B
 * Division of the subway, measured on 11/11/2026), so the subway is timed by its arrivals.
 */
export function createDepartureTracker() {
  const memory = new Map<string, TripMemory>();
  return {
    observe(trips: readonly TripView[], feedTime: number): ExtractedEvent[] {
      const events: ExtractedEvent[] = [];
      const seen = new Set<string>();
      for (const trip of trips) {
        seen.add(trip.tripId);
        const before = memory.get(trip.tripId);
        if (before !== undefined && before.seenAt < feedTime)
          events.push(...departuresOf(trip, before, feedTime));
        const times = new Map<string, number>();
        for (const stop of trip.stops) {
          const time = departureTime(stop);
          if (time !== undefined) times.set(stop.stopId, time);
        }
        memory.set(trip.tripId, {
          seenAt: feedTime,
          stops: trip.stops.map((stop) => stop.stopId),
          times,
        });
      }
      for (const tripId of memory.keys()) if (!seen.has(tripId)) memory.delete(tripId);
      return events;
    },
  };
}

/** Upper bounds, in seconds of lead time, of the bands at which predictions are sampled. */
export const HORIZON_BANDS = [60, 120, 300, 600, 1200] as const;

/** The band of a lead time, or undefined when it is negative or beyond the last band. */
export function horizonBand(leadSeconds: number, bands: readonly number[]): number | undefined {
  if (leadSeconds < 0) return undefined;
  const index = bands.findIndex((upper) => leadSeconds < upper);
  return index === -1 ? undefined : index;
}

/**
 * Keeps one prediction per trip, stop and horizon band: the first one seen inside the band.
 * That is enough to measure the error by lead time without storing every update. `timeOf`
 * picks the predicted time that matches the passage it will be judged against.
 */
export function createPredictionSampler(bands: readonly number[], timeOf: StopTime) {
  const sampled = new Map<string, Map<string, number>>();
  return {
    observe(trips: readonly TripView[], feedTime: number): ExtractedEvent[] {
      const events: ExtractedEvent[] = [];
      const seen = new Set<string>();
      for (const trip of trips) {
        seen.add(trip.tripId);
        const masks = sampled.get(trip.tripId) ?? new Map<string, number>();
        sampled.set(trip.tripId, masks);
        for (const stop of trip.stops) {
          const predicted = timeOf(stop);
          if (predicted === undefined) continue;
          const band = horizonBand(predicted - feedTime, bands);
          const mask = masks.get(stop.stopId) ?? 0;
          if (band === undefined || (mask & (1 << band)) !== 0) continue;
          masks.set(stop.stopId, mask | (1 << band));
          events.push({
            k: 'pred',
            t: feedTime,
            trip: trip.tripId,
            route: trip.routeId,
            stop: stop.stopId,
            p: predicted,
          });
        }
      }
      for (const tripId of sampled.keys()) if (!seen.has(tripId)) sampled.delete(tripId);
      return events;
    },
  };
}
