import type { RecorderStats } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSourceReader,
  type SourceReader,
} from '../../../src/modules/data-platform/reader.js';
import { busSources } from '../../../src/modules/data-platform/sources/mta/bus-realtime.js';
import { recorderStatsSource } from '../../../src/modules/data-platform/sources/recorder/moviq-recorder-stats.js';
import { createRecordedStatistics } from '../../../src/modules/live/estimation/recorded.js';
import { stretchOn } from '../../../src/modules/live/estimation/recorded-gps.js';
import { lineOf } from '../../../src/modules/live/estimation/line.js';
import { encodePolyline } from '../../../src/modules/data-platform/sources/mta/polyline.js';
import { recorderExtractors } from '../../../src/modules/recorder/extractors/index.js';
import { reduceDay } from '../../../src/modules/recorder/nightly/reduce.js';
import { BUS_DAY, northOf, writeBusDay } from '../../recorder/bus-day.js';
import { recorderWorld, type RecorderWorld } from '../../recorder/support.js';
import { manualClock } from '../../support/manual-clock.js';

/** Wednesday 11/11/2026 in New York, the morning after the day reduced; asked at 07:10. */
const clock = manualClock('2026-11-11T12:10:00.000Z');
const AT = clock.now();
const [busPositions] = busSources;

/** The street every bus of the day ran on, as the shape of its trip. */
const line = lineOf('M150001', encodePolyline([northOf(0), northOf(3_000), northOf(6_000)]));

let world: RecorderWorld;

beforeEach(async () => {
  world = await recorderWorld();
  await writeBusDay(world.directory);
  await reduceDay(
    world.term,
    {
      db: world.db,
      clock,
      directory: world.directory,
      definitions: [busPositions],
      extractors: recorderExtractors,
    },
    BUS_DAY,
  );
});

afterEach(async () => {
  await world.dispose();
});

/** The recorder's database, and what the Cloudflare recorder published, if anything. */
function recorder(published?: RecorderStats) {
  const reader = createSourceReader({ db: world.db, clock, missingVariables: () => [] });
  const serving: SourceReader = {
    read: (definition) =>
      definition.id === recorderStatsSource.id && published !== undefined
        ? Promise.resolve({
            data: published as never,
            version: 'v1',
            provenance: {
              sourceId: definition.id,
              dataTime: '2026-11-11T09:10:00.000Z',
              receivedAt: '2026-11-11T09:20:00.000Z',
              ageSeconds: 600,
              state: 'healthy',
              evidence: 'Served by the test.',
            },
          })
        : reader.read(definition),
  };
  return createRecordedStatistics({
    db: world.db,
    clock,
    reader: serving,
    onError: (error) => {
      throw error;
    },
  });
}

function cloudflareDay(stretch: string, n: number): RecorderStats {
  return {
    version: 'moviq-recorder-stats/1',
    day: '2026-11-10',
    dayType: 'weekday',
    generatedAt: '2026-11-11T09:10:00.000Z',
    complete: true,
    coverage: [],
    counts: {
      events: 1,
      trajectories: 1,
      segmentRuns: 0,
      predictionsJudged: 0,
      predictionsUnmatched: 0,
    },
    segments: [],
    headways: [],
    predictions: [],
    stoppages: [],
    incidents: [],
    speeds: [['M15', stretch, 'am-peak', n, 4]],
    tracking: [['M15', 30, 45, n, 80]],
  };
}

describe('the estimator statistics measured from bus GPS', () => {
  it('gives the typical speed of a stretch of the shape from 20 moves, read in the background', async () => {
    if (line === undefined) throw new Error('no test line');
    const recorded = recorder();
    await recorded.renew();
    const { segments } = recorded.statistics;
    // 450 m along the shape is the middle of the second move of every bus.
    expect(segments.typicalSpeed('M15', line, 450, AT)).toBeNull();
    await recorded.settled();
    expect(segments.typicalSpeed('M15', line, 450, AT)).toMatchObject({
      n: 25,
      metersPerSecond: 10,
      from: '2026-11-10T05:00:00.000Z',
      to: '2026-11-11T04:59:59.999Z',
    });
    // Another route, or the night: never measured.
    expect(segments.typicalSpeed('M101', line, 450, AT)).toBeNull();
    await recorded.settled();
    expect(segments.typicalSpeed('M101', line, 450, AT)).toBeNull();
    await recorded.stop();
  });

  it('gives the margin of a gps-plus bus by its age, an older band when its own has none', async () => {
    const recorded = recorder();
    await recorded.renew();
    const { tracking } = recorded.statistics;
    const thirty = tracking.forAge('bus', 'M15', 35);
    expect(thirty).toMatchObject({ n: 25 * 19 });
    expect(thirty?.p90Meters).toBeLessThanOrEqual(5);
    // No bus reported 10 s after another: the 30 s band bounds it from above.
    expect(tracking.forAge('bus', 'M15', 10)).toEqual(thirty);
    expect(tracking.forAge('bus', 'M101', 35)).toBeNull();
    expect(tracking.forAge('ferry', 'M15', 35)).toBeNull();
    expect(tracking.forAge('bus', 'M15', 600)).toBeNull();
    await recorded.stop();
  });

  it('takes what Cloudflare published when it has more measures, never a mix of both', async () => {
    if (line === undefined) throw new Error('no test line');
    const stretch = stretchOn(line, 450);
    const more = recorder(cloudflareDay(stretch, 600));
    await more.renew();
    expect(more.statistics.segments.typicalSpeed('M15', line, 450, AT)).toMatchObject({
      n: 600,
      metersPerSecond: 4,
    });
    expect(more.statistics.tracking.forAge('bus', 'M15', 35)).toMatchObject({
      n: 600,
      p90Meters: 80,
    });
    await more.stop();
    const fewer = recorder(cloudflareDay(stretch, 21));
    await fewer.renew();
    fewer.statistics.segments.typicalSpeed('M15', line, 450, AT);
    await fewer.settled();
    expect(fewer.statistics.segments.typicalSpeed('M15', line, 450, AT)).toMatchObject({
      n: 25,
      metersPerSecond: 10,
    });
    expect(fewer.statistics.tracking.forAge('bus', 'M15', 35)?.n).toBe(25 * 19);
    await fewer.stop();
  });
});
