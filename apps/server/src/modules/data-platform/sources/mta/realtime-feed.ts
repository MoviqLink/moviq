import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { KnownFailure } from '../../definition.js';
import { decodeGtfsRealtime, type GtfsRealtimeFeed } from '../../formats/gtfs-realtime.js';
import { HTTP_FAILURES, MINUTE } from './provider.js';

/** A clock ahead of ours by more than this is wrong, not early. */
const FUTURE_TOLERANCE_MS = 2 * MINUTE;

/** What a header without `incrementality` means, by the default of the GTFS Realtime schema. */
const FULL_DATASET = 'FULL_DATASET';

interface Refusal {
  readonly ok: false;
  readonly code: string;
  readonly detail: string;
}

export type FeedRead =
  { readonly ok: true; readonly feed: GtfsRealtimeFeed; readonly feedTime: Date } | Refusal;

/** An optional time in Unix seconds (0 is what protobuf leaves when it is absent) as an instant. */
export function instantOf(seconds: number | undefined): string | null {
  return seconds === undefined || seconds === 0 ? null : toInstant(new Date(seconds * 1000));
}

const nullableInstant = instantSchema.nullable();

/** A stop still ahead with the predicted times, as the provider gives them. */
export const predictedStopSchema = z.object({
  stopId: z.string().min(1),
  sequence: z.number().int().nonnegative().nullable(),
  arrival: nullableInstant,
  departure: nullableInstant,
});

export type PredictedStop = z.infer<typeof predictedStopSchema>;

/**
 * Whether a trip update says the trip does not run: `trip.schedule_relationship` CANCELED, or
 * DELETED, which GTFS Realtime defines as cancelled and not shown to riders.
 */
export function cancelledTrip(relationship: string | undefined): boolean {
  return relationship === 'CANCELED' || relationship === 'DELETED';
}

/** A trip still runs with a stop ahead; a cancelled one may have none. */
export function runsOrCancelled(trip: {
  readonly cancelled: boolean;
  readonly stops: readonly unknown[];
}): boolean {
  return trip.cancelled || trip.stops.length > 0;
}

type StopTimeUpdate = NonNullable<
  GtfsRealtimeFeed['entity'][number]['trip_update']
>['stop_time_update'][number];

/** The stop time updates that name a stop and give it a time; the others say nothing to show. */
export function predictedStops(updates: readonly StopTimeUpdate[]): PredictedStop[] {
  return updates.flatMap((update) => {
    const arrival = instantOf(update.arrival?.time);
    const departure = instantOf(update.departure?.time);
    if (update.stop_id === undefined || update.stop_id === '') return [];
    if (arrival === null && departure === null) return [];
    if (update.schedule_relationship === 'SKIPPED') return [];
    return [{ stopId: update.stop_id, sequence: update.stop_sequence ?? null, arrival, departure }];
  });
}

/**
 * Decodes a GTFS Realtime body and checks its header. The feed must be a full dataset: changes
 * and deletions are never merged into the version served. The feed time is the time of the data,
 * so it must exist, must not be in the future and must not go back behind the version served.
 */
export function readRealtimeFeed(
  body: Uint8Array,
  receivedAt: Date,
  servedFeedTime: string | undefined,
): FeedRead {
  const decoded = decodeGtfsRealtime(body);
  if (!decoded.ok) return decoded;
  const incrementality = decoded.feed.header.incrementality ?? FULL_DATASET;
  if (incrementality !== FULL_DATASET) {
    return {
      ok: false,
      code: 'differential-feed',
      detail: `header.incrementality is ${incrementality}; only full datasets are read`,
    };
  }
  const seconds = decoded.feed.header.timestamp ?? 0;
  if (seconds === 0) {
    return { ok: false, code: 'no-header-time', detail: 'the feed header carries no timestamp' };
  }
  const feedTime = new Date(seconds * 1000);
  if (feedTime.getTime() - receivedAt.getTime() > FUTURE_TOLERANCE_MS) {
    return {
      ok: false,
      code: 'future-header',
      detail: `header ${toInstant(feedTime)} is after receipt ${toInstant(receivedAt)}`,
    };
  }
  if (servedFeedTime !== undefined && toInstant(feedTime) < servedFeedTime) {
    return {
      ok: false,
      code: 'older-than-served',
      detail: `header ${toInstant(feedTime)} is older than the ${servedFeedTime} served`,
    };
  }
  return { ok: true, feed: decoded.feed, feedTime };
}

/** Failures every GTFS Realtime feed of the MTA can meet. */
export const REALTIME_FAILURES: readonly KnownFailure[] = [
  ...HTTP_FAILURES,
  {
    code: 'not-protobuf',
    detection: 'The body is not a GTFS Realtime message, as with an HTML or JSON error page',
    state: 'degraded',
    remedy: 'Retry on the next run; the last good data keeps being served with its age',
  },
  {
    code: 'unexpected-shape',
    detection: 'The message decodes but lacks the fields of the GTFS Realtime schema',
    state: 'misconfigured',
    remedy: 'An operator compares the feed with the GTFS Realtime reference',
  },
  {
    code: 'differential-feed',
    detection: 'header.incrementality is DIFFERENTIAL: the feed sends changes, not the whole set',
    state: 'misconfigured',
    remedy: 'Refused, as changes and deletions are never merged; an operator checks the feed URL',
  },
  {
    code: 'no-header-time',
    detection: 'header.timestamp is missing or zero, so the age of the data is unknown',
    state: 'degraded',
    remedy: 'Refused: data without a time is never served',
  },
  {
    code: 'future-header',
    detection: 'header.timestamp is more than 2 minutes after the download',
    state: 'degraded',
    remedy: 'Refused until the provider clock is right again',
  },
  {
    code: 'older-than-served',
    detection: 'header.timestamp is older than the version served, as from a stale cache',
    state: 'degraded',
    remedy: 'Refused; the newer version stays served',
  },
  {
    code: 'stale-header',
    detection: 'header.timestamp stops moving while downloads succeed',
    state: 'stale',
    remedy: 'Freshness is measured on the header, so the age grows and the state follows it',
  },
];
