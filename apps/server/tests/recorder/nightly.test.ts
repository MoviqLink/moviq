import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { toInstant } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseRow } from '../../src/infrastructure/database/rows.js';
import { healthStore } from '../../src/modules/data-platform/health-store.js';
import { busSources } from '../../src/modules/data-platform/sources/mta/bus-realtime.js';
import { subwaySources } from '../../src/modules/data-platform/sources/mta/subway-realtime.js';
import { recorderExtractors } from '../../src/modules/recorder/extractors/index.js';
import { readLines, reducedFile } from '../../src/modules/recorder/files.js';
import { judgeDay } from '../../src/modules/recorder/nightly/completeness.js';
import { applyRetention, dueDay } from '../../src/modules/recorder/nightly/nightly.js';
import { reduceDay } from '../../src/modules/recorder/nightly/reduce.js';
import { foldSegmentMonths } from '../../src/modules/recorder/nightly/segment-months.js';
import {
  createIncidentDurations,
  createLineReliability,
} from '../../src/modules/recorder/reading-lines.js';
import { createPredictionError, createSegmentStats } from '../../src/modules/recorder/reading.js';
import { manualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';
import { DAY, writeDay } from './day-fixture.js';
import { recorderWorld, type RecorderWorld } from './support.js';

const [busPositions] = busSources;
const [ace] = subwaySources;
const definitions = ace === undefined ? [busPositions] : [busPositions, ace];
const clock = manualClock('2026-11-11T10:00:00.000Z');

let world: RecorderWorld;

beforeEach(async () => {
  world = await recorderWorld();
});

afterEach(async () => {
  await world.dispose();
});

const reduce = (day = DAY) =>
  reduceDay(
    world.term,
    {
      db: world.db,
      clock,
      directory: world.directory,
      definitions,
      extractors: recorderExtractors,
    },
    day,
  );

const detailRow = z.object({ outcome: z.string(), detail: z.string() });
const stoppageRow = z.object({ trip: z.string(), seconds: z.number(), proof: z.string() });

async function nightly() {
  const row = (await world.db.query('SELECT outcome, detail FROM recorder_nightly')).rows[0];
  const parsed = parseRow(detailRow, row, 'recorder_nightly');
  return {
    outcome: parsed.outcome,
    detail: z.record(z.string(), z.unknown()).parse(JSON.parse(parsed.detail)),
  };
}

describe('reducing a recorded day', () => {
  beforeEach(async () => {
    await writeDay(world.directory);
  });

  it('says the day is incomplete, which hours are missing, and invents nothing', async () => {
    expect(await reduce()).toBe('incomplete');
    const { detail } = await nightly();
    expect(detail['completeness']).toMatchObject({
      complete: false,
      judged: 2,
      sources: [
        { sourceId: 'mta-bus-positions', lostVersions: 0 },
        { sourceId: 'mta-subway-ace', lostVersions: 0 },
      ],
    });
    const missing = z
      .object({ sources: z.array(z.object({ missingHours: z.array(z.string()) })) })
      .parse(detail['completeness']).sources[0]?.missingHours;
    expect(missing).toHaveLength(23);
    expect(missing).not.toContain('07');
    expect(detail['read']).toMatchObject({ invalid: 0, repeatedRuns: 1 });
  });

  it('measures segments and serves their quantiles once there are 20 measures', async () => {
    await reduce();
    const segments = createSegmentStats({ db: world.db, clock });
    const thursdayMorning = new Date('2026-11-12T12:30:00.000Z');
    expect(await segments.runTime('M15', 'X1', 'X2', thursdayMorning)).toEqual({
      status: 'ok',
      value: { p10: 102.4, p50: 112, p90: 121.6, p95: 122.8, band: 'am-peak', dayType: 'weekday' },
      n: 25,
      from: DAY,
      to: DAY,
      days: 1,
      incompleteDays: [DAY],
    });
    expect(await segments.runTime('M15', 'X2', 'X3', thursdayMorning)).toEqual({
      status: 'no-data',
      n: 5,
      reason: 'Only 5 measures; 20 are needed.',
    });
    const saturday = new Date('2026-11-14T12:30:00.000Z');
    expect(await segments.runTime('M15', 'X1', 'X2', saturday)).toMatchObject({
      status: 'no-data',
      n: 0,
    });
  });

  it('finds a stoppage between two stops and not a bus waiting at its terminal', async () => {
    await reduce();
    const result = await world.db.query(
      'SELECT trip, seconds, proof FROM recorder_stoppages ORDER BY trip',
    );
    const rows = result.rows.map((row) => parseRow(stoppageRow, row, 'recorder_stoppages'));
    expect(rows.map((row) => [row.trip, row.seconds])).toEqual([
      ['R6', 580],
      ['TRIP-1', 360],
    ]);
    expect(JSON.parse(rows[1]?.proof ?? '{}')).toMatchObject({
      reports: 13,
      leftBefore: { stop: '401' },
      leftAfter: { stop: '402' },
    });
  });

  it('measures the error of the predictions by lead time', async () => {
    await reduce();
    const errors = createPredictionError({ db: world.db, clock });
    expect(await errors.forHorizon('mta-subway-ace', 200)).toMatchObject({
      status: 'ok',
      value: { p50: 5, p90: 9, biasP50: -0.5, horizonFrom: 120, horizonTo: 300 },
      n: 20,
    });
    expect(await errors.forHorizon('mta-subway-ace', 30)).toMatchObject({
      status: 'no-data',
      n: 0,
    });
    expect(await errors.forHorizon('mta-subway-ace', 5000)).toMatchObject({ status: 'no-data' });
  });

  it('measures regularity and bunching, pooled exactly from the sums', async () => {
    await reduce();
    const line = await createLineReliability({ db: world.db, clock }).at(
      'M15',
      new Date('2026-11-12T12:30:00.000Z'),
    );
    expect(line).toMatchObject({ status: 'ok', n: 52, value: { stoppages: 1, band: 'am-peak' } });
    if (line.status !== 'ok') throw new Error('expected a reading');
    // Two headways of about 30 s against a usual 300 s: two vehicles ran together twice.
    expect(line.value.bunchedShare).toBeCloseTo(2 / 52, 3);
  });

  it('writes the reduced copy of the day, one line per trip', async () => {
    await reduce();
    const trips = [];
    for await (const line of readLines(reducedFile(world.directory, DAY, 'trajectories')))
      trips.push(line);
    expect(trips).toHaveLength(25 + 2 + 20 + 7);
  });
});

describe('the life of a day', () => {
  it('records that nothing was recorded rather than staying silent', async () => {
    expect(await reduce('2026-11-09')).toBe('no-recording');
  });

  it('is due after 04:00 in New York, and the oldest day not reduced comes first', async () => {
    const deps = {
      db: world.db,
      clock,
      logger: memoryLogger().logger,
      directory: world.directory,
      definitions,
      extractors: recorderExtractors,
      retentionDays: 7,
      checkEveryMs: 1000,
    };
    expect(await dueDay(deps, new Date('2026-11-11T08:30:00.000Z'))).toBe('2026-11-09');
    await mkdir(join(world.directory, '2026-11-08'), { recursive: true });
    expect(await dueDay(deps, new Date('2026-11-11T09:30:00.000Z'))).toBe('2026-11-08');
  });

  it('deletes raw days past the retention and keeps the others', async () => {
    for (const day of ['2026-11-01', '2026-11-04', '2026-11-10'])
      await mkdir(join(world.directory, day, '07'), { recursive: true });
    expect(await applyRetention(world.directory, new Date('2026-11-11T15:00:00.000Z'), 7)).toEqual([
      '2026-11-01',
    ]);
    expect(await readdir(world.directory)).toEqual(['2026-11-04', '2026-11-10']);
  });

  it('calls a day complete when every hour was recorded or answered unchanged', async () => {
    const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
    const recorded = new Map([
      ['mta-bus-positions', new Set(hours.filter((hour) => hour !== '05'))],
    ]);
    const missing = await judgeDay(world.db, DAY, [busPositions], recorded);
    expect(missing.sources).toEqual([
      { sourceId: 'mta-bus-positions', missingHours: ['05'], lostVersions: 0 },
    ]);
    await world.db.transaction((tx) =>
      healthStore.addRun(tx, {
        sourceId: 'mta-bus-positions',
        trigger: 'schedule',
        requestedBy: null,
        reason: null,
        startedAt: '2026-11-10T10:30:00.000Z',
        finishedAt: '2026-11-10T10:30:01.000Z',
        outcome: 'unchanged',
        httpStatus: 304,
        bytes: 0,
        durationMs: 5,
        dataTime: null,
        version: null,
        coverage: null,
        errorCode: null,
        detail: null,
      }),
    );
    expect(await judgeDay(world.db, DAY, [busPositions], recorded)).toEqual({
      complete: true,
      judged: 1,
      sources: [],
    });
  });
});

describe('incident durations', () => {
  it('gives the typical duration from a curve that counts the ones still open', async () => {
    const start = Date.parse('2026-11-10T13:00:00.000Z');
    await world.db.transaction(async (tx) => {
      for (let k = 1; k <= 13; k += 1) {
        const closed = k <= 12;
        await tx.execute({
          sql: `INSERT INTO recorder_incidents (source_id, incident_id, first_seen, kind, type, routes,
                  fingerprint, last_seen, closed_at) VALUES ('mta-alerts', ?, ?, 'transit-alert',
                  'service-alert', '["A"]', 'fp', ?, ?)`,
          args: [
            `lmm:alert:${String(k)}`,
            toInstant(new Date(start)),
            closed ? toInstant(new Date(start + k * 600_000)) : null,
            closed ? toInstant(new Date(start + k * 600_000 + 60_000)) : null,
          ],
        });
      }
    });
    await writeDay(world.directory);
    await reduce();
    const typical = await createIncidentDurations({ db: world.db, clock }).typical(
      'transit-alert',
      'service-alert',
      'A',
    );
    // Half had ended at 60 min (S = 6/12) and nine in ten at 110 min (S = 1/12).
    expect(typical).toMatchObject({
      status: 'ok',
      value: { p50Seconds: 3600, p90Seconds: 6600, closed: 12, open: 1 },
      n: 13,
      from: DAY,
      to: DAY,
      days: 1,
      incompleteDays: [DAY],
    });
    const fewer = await createIncidentDurations({ db: world.db, clock }).typical(
      'transit-alert',
      'planned-work',
    );
    expect(fewer).toMatchObject({ status: 'no-data', n: 0 });
  });
});

describe('segment months', () => {
  it('folds whole months past the detail window into one row each, kept for good', async () => {
    const insert = (day: string, samples: number[]) =>
      world.db.execute({
        sql: `INSERT INTO recorder_segment_times (day, mode, route, direction, from_stop, to_stop,
                band, day_type, n, p10, p50, p90, samples)
              VALUES (?, 'bus', 'M15', '0', 'X1', 'X2', 'am-peak', 'weekday', ?, 0, 0, 0, ?)`,
        args: [day, samples.length, JSON.stringify(samples)],
      });
    await insert('2026-09-01', [100, 110, 120]);
    await insert('2026-09-08', [130, 140, 150]);
    await insert('2026-11-03', [90]);
    expect(await foldSegmentMonths(world.term, world.db, '2026-11-11')).toEqual(['2026-09']);
    const left = await world.db.query('SELECT day FROM recorder_segment_times');
    expect(left.rows.map((row) => row['day'])).toEqual(['2026-11-03']);
    const history = await createSegmentStats({ db: world.db, clock }).history(
      'M15',
      'X1',
      'X2',
      new Date('2026-11-12T12:30:00.000Z'),
    );
    expect(history).toEqual([
      {
        month: '2026-09',
        n: 6,
        p10: 105,
        p50: 125,
        p90: 145,
        p95: 147.5,
        days: 2,
        from: '2026-09-01',
        to: '2026-09-08',
        band: 'am-peak',
        dayType: 'weekday',
      },
    ]);
    expect(await foldSegmentMonths(world.term, world.db, '2026-11-11')).toEqual([]);
  });
});
