import type { SourceReader } from '../../data-platform/reader.js';
import { subwaySources } from '../../data-platform/sources/mta/subway-realtime.js';
import { HORIZON_BANDS, horizonBand } from '../../recorder/extractors/trip-stops.js';
import { bandOf, dayOf, dayTypeOf } from '../../recorder/nightly/calendar.js';
import {
  predictionErrorDistributions,
  segmentDistribution,
} from '../../recorder/reading-estimation.js';
import type { ReadingDependencies } from '../../recorder/reading.js';
import {
  errorKey,
  moreMeasured,
  nothingPublished,
  readPublished,
  type PublishedDay,
} from './recorded-cloudflare.js';
import {
  createStretchCache,
  marginFor,
  marginKey,
  readMargins,
  stretchId,
  stretchOn,
} from './recorded-gps.js';
import { createSubwayRoutes } from './recorded-routes.js';
import { asDistribution, createSegmentCache, segmentId } from './recorded-segments.js';
import {
  LEVELS,
  type EstimationStatistics,
  type RecordedDistribution,
  type RecordedMargin,
} from './statistics.js';

/** The recorder reduces each day once, after 04:00 in New York: an hourly look is enough. */
const RENEW_MS = 3_600_000;

export interface RecordedStatisticsDependencies extends ReadingDependencies {
  /** Reads the subway feeds, and the day the Cloudflare recorder published. */
  readonly reader: SourceReader;
  readonly onError: (error: unknown) => void;
  readonly renewEveryMs?: number;
}

/** The statistics port fed by the recorder, renewed in the background. */
export interface RecordedStatistics {
  readonly statistics: EstimationStatistics;
  /** Reads the recorder now, then every hour; timers do not keep the process alive. */
  start(): void;
  /** Reads the errors, margins, feeds of routes and Cloudflare's day, and renews every key. */
  renew(): Promise<void>;
  /** Resolves once every segment and stretch asked for so far has been read. */
  settled(): Promise<void>;
  /** Stops renewing; resolves once no read is in flight. */
  stop(): Promise<void>;
}

/** The errors of the subway feeds by band of lead time, each with 20 measures or more. */
async function subwayErrors(deps: ReadingDependencies) {
  const readings = await predictionErrorDistributions(
    deps,
    subwaySources.map((definition) => definition.id),
    LEVELS,
  );
  const errors = new Map<string, RecordedDistribution>();
  for (const reading of readings) {
    if (reading.status !== 'ok') continue;
    const { sourceId, horizonFrom, seconds } = reading.value;
    const distribution = asDistribution({ ...reading, value: seconds });
    if (distribution !== null) errors.set(errorKey(sourceId, horizonFrom), distribution);
  }
  return errors;
}

/**
 * The estimator's statistics from MovIQ's recorders: the one in this process's database over the
 * last 28 reduced days, and the last day the one on Cloudflare published. Run times of subway
 * segments, the error of the subway feeds' arrival times, the speed of buses by stretch and the
 * replayed error of their `gps-plus` positions. Of two measures of the same figure, the one with
 * more measures is given; anything with fewer than 20 measures answers null.
 */
export function createRecordedStatistics(deps: RecordedStatisticsDependencies): RecordedStatistics {
  const segments = createSegmentCache(
    async (key) => asDistribution(await segmentDistribution(deps, key, LEVELS)),
    deps.onError,
  );
  const stretches = createStretchCache(deps, deps.onError);
  const routes = createSubwayRoutes(deps.reader, deps.clock, deps.onError);
  let errors = new Map<string, RecordedDistribution>();
  let margins = new Map<string, RecordedMargin>();
  let published: PublishedDay = nothingPublished;
  let timer: ReturnType<typeof setInterval> | undefined;
  let renewing: Promise<void> | undefined;

  const margin = (route: string, ageFrom: number) => {
    const key = marginKey(route, ageFrom);
    return moreMeasured(margins.get(key) ?? null, published.margins.get(key));
  };

  const statistics: EstimationStatistics = {
    segments: {
      runTime(route, from, to, at) {
        const key = {
          mode: 'subway' as const,
          route,
          from,
          to,
          band: bandOf(at),
          dayType: dayTypeOf(dayOf(at)),
        };
        return moreMeasured(segments.get(key), published.segments.get(segmentId(key)));
      },
      typicalSpeed(route, line, meters, at) {
        const key = {
          route,
          stretch: stretchOn(line, meters),
          band: bandOf(at),
          dayType: dayTypeOf(dayOf(at)),
        };
        return moreMeasured(stretches.get(key), published.speeds.get(stretchId(key)));
      },
    },
    predictions: {
      forHorizon(route, horizonSeconds) {
        const sourceId = routes.feedOf(route);
        const band = horizonBand(horizonSeconds, HORIZON_BANDS);
        if (sourceId === undefined || band === undefined) return null;
        const key = errorKey(sourceId, band === 0 ? 0 : (HORIZON_BANDS[band - 1] ?? 0));
        return moreMeasured(errors.get(key) ?? null, published.errors.get(key));
      },
    },
    tracking: { forAge: (mode, route, ageSeconds) => marginFor(margin, mode, route, ageSeconds) },
  };

  async function renew(): Promise<void> {
    await routes.read();
    errors = await subwayErrors(deps);
    margins = await readMargins(deps);
    published = await readPublished(deps.reader);
    segments.renew();
    stretches.renew();
  }

  const renewInBackground = () => {
    renewing ??= renew()
      .catch(deps.onError)
      .finally(() => {
        renewing = undefined;
      });
  };

  return {
    statistics,
    start() {
      renewInBackground();
      timer = setInterval(renewInBackground, deps.renewEveryMs ?? RENEW_MS);
      timer.unref();
    },
    renew,
    settled: () => Promise.all([segments.settled(), stretches.settled()]).then(() => undefined),
    async stop() {
      clearInterval(timer);
      await Promise.all([renewing, segments.stop(), stretches.stop(), routes.settled()]);
    },
  };
}
