import { liveVehiclesResponseSchema, type LiveVehicle } from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import type { Database } from '../../../src/infrastructure/database/database.js';
import type { LeaderTerm } from '../../../src/infrastructure/jobs/leadership.js';
import { createSourceReader } from '../../../src/modules/data-platform/reader.js';
import { subwaySources } from '../../../src/modules/data-platform/sources/mta/subway-realtime.js';
import { createPositionEstimator } from '../../../src/modules/live/estimation/estimator.js';
import {
  createRecordedStatistics,
  type RecordedStatistics,
} from '../../../src/modules/live/estimation/recorded.js';
import type { EstimationStatistics } from '../../../src/modules/live/estimation/statistics.js';
import { HORIZON_BANDS } from '../../../src/modules/recorder/extractors/trip-stops.js';
import {
  replaceAggregates,
  writeNightly,
} from '../../../src/modules/recorder/nightly/aggregates-store.js';
import { liveCity, type LiveCity } from '../city.js';
import { subwayLater, TRAIN_A } from '../feeds.js';

const [aceFeed] = subwaySources;
/** Weekdays reduced before the capture (Tuesday 10/11/2026, 20:07 in New York). */
const DAYS = ['2026-11-03', '2026-11-04', '2026-11-05'];

interface Measured {
  /** Run times of A06N → A05N on the A, in the evening of a weekday, each day. */
  readonly runs: readonly number[];
  /** Predicted minus observed arrival of the A, C and E feed, each day and band of lead time. */
  readonly errors: readonly number[];
}

function termOf(db: Database): LeaderTerm {
  return {
    name: 'worker',
    holder: 'test',
    fencingToken: 1,
    signal: new AbortController().signal,
    fenced: (work) => db.transaction(work),
  };
}

/** Writes each day as the nightly process would: its aggregates, then its nightly record. */
async function reduced(db: Database, measured: Measured): Promise<void> {
  const term = termOf(db);
  const samples = [...measured.runs].sort((a, b) => a - b);
  const histogram = [...new Set(measured.errors)]
    .sort((a, b) => a - b)
    .map((error) => [error, measured.errors.filter((value) => value === error).length] as const);
  for (const day of DAYS) {
    await replaceAggregates(term, day, {
      segments: [
        {
          mode: 'subway',
          route: 'A',
          direction: 'north',
          from: 'A06N',
          to: 'A05N',
          band: 'evening',
          dayType: 'weekday',
          samples,
          p10: 0,
          p50: 0,
          p90: 0,
        },
      ],
      headways: [],
      predictions: HORIZON_BANDS.map((horizonTo, index) => ({
        sourceId: aceFeed?.id ?? '',
        horizonFrom: index === 0 ? 0 : (HORIZON_BANDS[index - 1] ?? 0),
        horizonTo,
        n: measured.errors.length,
        p50Abs: 0,
        p90Abs: 0,
        biasP50: 0,
        histogram,
      })),
      stoppages: [],
      incidents: [],
      speeds: [],
      tracking: [],
    });
    const at = new Date(`${day}T12:00:00.000Z`);
    await writeNightly(term, {
      day,
      outcome: 'complete',
      startedAt: at,
      finishedAt: at,
      detail: {},
    });
  }
}

let city: LiveCity | undefined;
let recorder: RecordedStatistics | undefined;

afterEach(async () => {
  await recorder?.stop();
  await city?.dispose();
  city = undefined;
  recorder = undefined;
});

/** The estimator with the recorder of the city's own database, which exists once it opens. */
function delegating(): EstimationStatistics {
  const port = () => recorder?.statistics;
  return {
    segments: {
      runTime: (...args) => port()?.segments.runTime(...args) ?? null,
      typicalSpeed: (...args) => port()?.segments.typicalSpeed(...args) ?? null,
    },
    predictions: { forHorizon: (...args) => port()?.predictions.forHorizon(...args) ?? null },
    tracking: { forAge: (...args) => port()?.tracking.forAge(...args) ?? null },
  };
}

async function trainA(open: LiveCity): Promise<LiveVehicle | undefined> {
  const response = await open.app.request('/api/live/vehicles');
  const { vehicles } = liveVehiclesResponseSchema.parse(await response.json());
  return vehicles.find((vehicle) => vehicle.id === `subway:${TRAIN_A}`);
}

/** The city with what the recorder measured, the train left 181 St a minute ago. */
async function cityRecording(measured: Measured): Promise<LiveCity> {
  const open = await liveCity(createPositionEstimator(delegating()));
  await reduced(open.db, measured);
  recorder = createRecordedStatistics({
    db: open.db,
    clock: open.clock,
    reader: createSourceReader({ db: open.db, clock: open.clock, missingVariables: () => [] }),
    onError: (error) => {
      throw error;
    },
  });
  await open.collect();
  await recorder.renew();
  await trainA(open);
  open.clock.advance(60_000);
  if (!aceFeed) throw new Error('no A, C and E feed');
  await open.collect([aceFeed], new Map([[aceFeed.id, subwayLater(60, 180)]]));
  return open;
}

/** The train once the segments asked for have been read, on the next build of the city. */
async function afterReading(open: LiveCity) {
  const first = await trainA(open);
  await recorder?.settled();
  open.clock.advance(5_000);
  return { first, then: await trainA(open) };
}

const spread = (from: number, to: number, count: number) =>
  Array.from({ length: count }, (_, index) => from + ((to - from) * index) / (count - 1));

describe('the estimator fed by the recorder', () => {
  it('gives a train between stations a margin, read without making the city wait', async () => {
    city = await cityRecording({ runs: spread(200, 380, 10), errors: spread(-20, 20, 10) });
    const { first, then } = await afterReading(city);
    expect(first?.position.marginMeters).toBeNull();
    expect(then?.position).toMatchObject({ basis: 'predicted', stall: null });
    expect(then?.position.marginMeters).toBeGreaterThan(0);
  });

  it('carries a possible stoppage with its evidence past the 95th percentile', async () => {
    city = await cityRecording({ runs: spread(40, 80, 10), errors: spread(-20, 20, 10) });
    const { then } = await afterReading(city);
    expect(then?.position.stall).toMatchObject({
      elapsedSeconds: 182,
      usualSeconds: 80,
      medianSeconds: 60,
      n: 30,
      from: '2026-11-03T05:00:00.000Z',
      to: '2026-11-06T04:59:59.999Z',
      leftStop: { id: 'A06N', name: '181 St' },
    });
  });

  it('turns the error of the feed into observed minus predicted, by the feed of the route', async () => {
    // Every prediction 10 to 30 s later than the arrival: trains came that much earlier.
    city = await cityRecording({ runs: spread(200, 380, 10), errors: spread(10, 30, 10) });
    expect(recorder?.statistics.predictions.forHorizon('A', 200)).toEqual({
      n: 30,
      from: '2026-11-03T05:00:00.000Z',
      to: '2026-11-06T04:59:59.999Z',
      seconds: [-30, -30, -28, -25.6, -20, -14.4, -12, -10, -10],
    });
    // No feed lists a C train in the capture, and `lirr:1` is not a subway route.
    expect(recorder?.statistics.predictions.forHorizon('C', 200)).toBeNull();
    expect(recorder?.statistics.predictions.forHorizon('lirr:1', 200)).toBeNull();
    expect(recorder?.statistics.predictions.forHorizon('A', 1_200)).toBeNull();
  });

  it('gives nothing below 20 measures', async () => {
    city = await cityRecording({ runs: spread(40, 80, 6), errors: spread(-20, 20, 6) });
    const { then } = await afterReading(city);
    expect(then?.position).toMatchObject({ basis: 'predicted', marginMeters: null, stall: null });
    const at = city.clock.now();
    expect(recorder?.statistics.segments.runTime('A', 'A06N', 'A05N', at)).toBeNull();
    expect(recorder?.statistics.predictions.forHorizon('A', 200)).toBeNull();
  });
});
