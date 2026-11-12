import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { recorderStatusSchema } from '@moviq/contracts';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseRow } from '../../src/infrastructure/database/rows.js';
import { subwaySources } from '../../src/modules/data-platform/sources/mta/subway-realtime.js';
import { recordedEventSchema } from '../../src/modules/recorder/events.js';
import { recorderExtractors } from '../../src/modules/recorder/extractors/index.js';
import { placeOf, readLines, recordingFile } from '../../src/modules/recorder/files.js';
import { passContext, recordPass, runRecorder } from '../../src/modules/recorder/recorder.js';
import { recorderRoutes } from '../../src/modules/recorder/routes.js';
import { recorderStatus } from '../../src/modules/recorder/status.js';
import { manualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';
import { testSource } from '../support/sources.js';
import { admit, recorderWorld, type RecorderWorld } from './support.js';

const [ace] = subwaySources;
const ACE = 'mta-subway-ace';
const unrecorded = testSource();
const clock = manualClock('2026-11-11T12:00:40.000Z');

function feed(feedTime: string, stops: [string, string][]) {
  return {
    feedTime,
    leftOut: 0,
    trips: [
      {
        tripId: 'T1',
        routeId: 'A',
        direction: 'north',
        startDate: '20261111',
        startTime: '06:00:00',
        stops: stops.map(([stopId, time]) => ({
          stopId,
          sequence: null,
          arrival: time,
          departure: time,
        })),
        train: null,
      },
    ],
  };
}

const V1 = feed('2026-11-11T12:00:00.000Z', [
  ['A06N', '2026-11-11T12:00:20.000Z'],
  ['A05N', '2026-11-11T12:02:00.000Z'],
]);
const V2 = feed('2026-11-11T12:00:30.000Z', [['A05N', '2026-11-11T12:02:00.000Z']]);
const V3 = feed('2026-11-11T12:01:00.000Z', [['A05N', '2026-11-11T12:02:10.000Z']]);

let world: RecorderWorld;

function context() {
  if (ace === undefined) throw new Error('missing subway source');
  return passContext({
    db: world.db,
    clock,
    logger: memoryLogger().logger,
    definitions: [ace, unrecorded],
    extractors: recorderExtractors,
    directory: world.directory,
    intervalMs: 10,
  });
}

async function linesOf(file: string) {
  const events = [];
  for await (const line of readLines(file))
    events.push(recordedEventSchema.parse(JSON.parse(line)));
  return events;
}

const countRow = z.object({
  versions: z.number(),
  events: z.number(),
  bytes: z.number(),
  lost_versions: z.number(),
});

async function dayCount(sourceId: string) {
  const result = await world.db.query({
    sql: 'SELECT * FROM recorder_days WHERE source_id = ?',
    args: [sourceId],
  });
  const row = result.rows[0];
  return row === undefined ? undefined : parseRow(countRow, row, 'recorder_days');
}

beforeEach(async () => {
  world = await recorderWorld();
});

afterEach(async () => {
  await world.dispose();
});

describe('recording admitted versions', () => {
  it('starts after the newest run, then writes each new version with its events', async () => {
    const pass = context();
    expect(await recordPass(world.term, pass)).toBe(false);
    await admit(world.db, ACE, V1, '2026-11-11T12:00:00.000Z');
    await recordPass(world.term, pass);
    await admit(world.db, ACE, V2, '2026-11-11T12:00:30.000Z');
    await recordPass(world.term, pass);
    const file = recordingFile(world.directory, placeOf(new Date('2026-11-11T12:00:00.000Z')), ACE);
    expect(file).toContain(join('2026-11-11', '07', `${ACE}.ndjson.gz`));
    const events = await linesOf(file);
    expect(events.filter((event) => event.k === 'version')).toHaveLength(2);
    expect(events.find((event) => event.k === 'stn')).toMatchObject({ stop: 'A06N', exact: true });
    expect(events.every((event) => event.v.length > 0)).toBe(true);
    const count = await dayCount(ACE);
    expect(count).toMatchObject({ versions: 2, lost_versions: 0 });
    expect(count?.bytes).toBeGreaterThan(0);
  });

  it('writes a version lost before it was read as one gap with its evidence, never a silence', async () => {
    const pass = context();
    await recordPass(world.term, pass);
    await admit(world.db, ACE, V1, '2026-11-11T12:00:00.000Z');
    await admit(world.db, ACE, V2, '2026-11-11T12:00:30.000Z');
    await admit(world.db, ACE, V3, '2026-11-11T12:01:00.000Z');
    await recordPass(world.term, pass);
    const events = await linesOf(
      recordingFile(world.directory, placeOf(new Date('2026-11-11T12:00:00.000Z')), ACE),
    );
    expect(events.filter((event) => event.k === 'gap')).toMatchObject([
      {
        k: 'gap',
        versions: 2,
        fromRun: 1,
        toRun: 2,
        why: 'The copy was replaced before it was read: the source keeps 1 version.',
      },
    ]);
    expect(events.filter((event) => event.k === 'version')).toHaveLength(1);
    expect(await dayCount(ACE)).toMatchObject({ versions: 1, lost_versions: 2 });
    const status = await recorderStatus({
      db: world.db,
      clock,
      definitions: [ace ?? unrecorded, unrecorded],
      extractors: recorderExtractors,
      directory: world.directory,
      retentionDays: 7,
    });
    expect(status.gaps).toMatchObject([{ sourceId: ACE, versions: 2, fromRunId: 1, toRunId: 2 }]);
  });

  it('leaves a source without an extractor unrecorded and says so, while the cursor moves on', async () => {
    const pass = context();
    await recordPass(world.term, pass);
    await admit(
      world.db,
      unrecorded.id,
      { items: [1], at: '2026-11-11T12:00:00.000Z' },
      '2026-11-11T12:00:00.000Z',
    );
    await admit(world.db, ACE, V1, '2026-11-11T12:00:10.000Z');
    await recordPass(world.term, pass);
    expect(await readdir(join(world.directory, '2026-11-11', '07'))).toEqual([`${ACE}.ndjson.gz`]);
    const cursor = await world.db.query('SELECT last_run_id FROM recorder_cursor');
    expect(cursor.rows[0]?.['last_run_id']).toBe(2);
    const status = await recorderStatus({
      db: world.db,
      clock,
      definitions: [ace ?? unrecorded, unrecorded],
      extractors: recorderExtractors,
      directory: world.directory,
      retentionDays: 7,
    });
    expect(status.state).toBe('recording');
    expect(status.sources).toMatchObject([
      { sourceId: ACE, recorded: true },
      { sourceId: 'test-feed', recorded: false, lastVersion: null },
    ]);
    expect(status.days[0]).toMatchObject({ day: '2026-11-11', versions: 1 });
  });
});

describe('without RECORDING_DIR', () => {
  it('does not start, and its status says why', async () => {
    const log = memoryLogger();
    await runRecorder(world.term, {
      db: world.db,
      clock,
      logger: log.logger,
      definitions: subwaySources,
      extractors: recorderExtractors,
      directory: undefined,
      intervalMs: 10,
    });
    expect(log.entries().map((entry) => entry['reason'])).toEqual(['RECORDING_DIR is not set']);
    const routes = recorderRoutes({
      db: world.db,
      clock,
      definitions: subwaySources,
      extractors: recorderExtractors,
      directory: undefined,
      retentionDays: 7,
    });
    // Mounted as the control room mounts it: `/api/ops` + `/recorder`.
    const response = await new Hono()
      .route('/api/ops/recorder', routes)
      .request('/api/ops/recorder');
    expect(response.status).toBe(200);
    const status = recorderStatusSchema.parse(await response.json());
    expect(status).toMatchObject({
      state: 'not-configured',
      evidence: 'RECORDING_DIR is not set, so nothing is recorded.',
      lastWriteAt: null,
      lastNightly: null,
    });
  });
});
