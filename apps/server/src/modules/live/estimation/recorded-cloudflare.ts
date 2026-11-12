import type { RecorderStats } from '@moviq/contracts';

import type { SourceReader } from '../../data-platform/reader.js';
import { recorderStatsSource } from '../../data-platform/sources/recorder/moviq-recorder-stats.js';
import { marginKey, stretchId } from './recorded-gps.js';
import { daySpan, segmentId } from './recorded-segments.js';
import {
  usableDistribution,
  usableMargin,
  usableSpeed,
  type RecordedDistribution,
  type RecordedMargin,
  type RecordedSpeed,
} from './statistics.js';

export const errorKey = (sourceId: string, horizonFrom: number) =>
  `${sourceId}|${String(horizonFrom)}`;

/** The figures of one published day, by the keys the estimator asks with. */
export interface PublishedDay {
  readonly segments: ReadonlyMap<string, RecordedDistribution>;
  readonly errors: ReadonlyMap<string, RecordedDistribution>;
  readonly speeds: ReadonlyMap<string, RecordedSpeed>;
  readonly margins: ReadonlyMap<string, RecordedMargin>;
}

export const nothingPublished: PublishedDay = {
  segments: new Map(),
  errors: new Map(),
  speeds: new Map(),
  margins: new Map(),
};

function put<T>(map: Map<string, T>, key: string, value: T | null): void {
  if (value !== null) map.set(key, value);
}

/**
 * The day the Cloudflare recorder published, indexed: each figure measured from the start to the
 * end of that New York day, 20 measures or more. Its prediction errors are published as the
 * recorder keeps them, predicted minus observed: they are turned to observed minus predicted, the
 * sign of the estimator, level by level from the top.
 */
function indexPublished(stats: RecorderStats): PublishedDay {
  const span = daySpan(stats.day, stats.day);
  if (span === undefined) return nothingPublished;
  const { dayType } = stats;
  const segments = new Map<string, RecordedDistribution>();
  for (const [mode, route, , fromStop, toStop, band, n, ...seconds] of stats.segments)
    put(
      segments,
      segmentId({ mode, route, from: fromStop, to: toStop, band, dayType }),
      usableDistribution({ ...span, n, seconds }),
    );
  const errors = new Map<string, RecordedDistribution>();
  for (const [sourceId, horizonFrom, , n, ...predictedMinusObserved] of stats.predictions) {
    const seconds = predictedMinusObserved.map((value) => -value).reverse();
    put(errors, errorKey(sourceId, horizonFrom), usableDistribution({ ...span, n, seconds }));
  }
  const speeds = new Map<string, RecordedSpeed>();
  for (const [route, stretch, band, n, metersPerSecond] of stats.speeds)
    put(
      speeds,
      stretchId({ route, stretch, band, dayType }),
      usableSpeed({ ...span, n, metersPerSecond }),
    );
  const margins = new Map<string, RecordedMargin>();
  for (const [route, ageFrom, , n, p90Meters] of stats.tracking)
    put(margins, marginKey(route, ageFrom), usableMargin({ ...span, n, p90Meters }));
  return { segments, errors, speeds, margins };
}

/** The latest day the Cloudflare recorder published, as the data platform serves it. */
export async function readPublished(reader: SourceReader): Promise<PublishedDay> {
  const reading = await reader.read(recorderStatsSource);
  return reading.data === undefined ? nothingPublished : indexPublished(reading.data);
}

/** Of two measures of the same thing, the one with more measures, never a mix of both. */
export function moreMeasured<T extends { readonly n: number }>(
  local: T | null,
  published: T | undefined,
): T | null {
  if (published === undefined) return local;
  return local === null || published.n > local.n ? published : local;
}
