import { gzipSync } from 'node:zlib';

import { RECORDER_STATS_VERSION, type RecorderStats } from '@moviq/contracts';

import { busDay } from '../../server/tests/recorder/bus-day.js';
import { DAY, dayRecording } from '../../server/tests/recorder/day-fixture.js';
import { createStretchSpeeds } from '../../server/src/modules/recorder/nightly/stretch-speeds.js';
import { createTrajectories } from '../../server/src/modules/recorder/nightly/trajectories.js';
import { BUFFER_TABLE, createBuffer, gzipLines } from '../src/buffer.js';
import { splitFeed } from '../src/gtfs-rt/split.js';
import { createLineBatches } from '../src/nightly/batches.js';
import { speedTuples } from '../src/nightly/aggregate.js';
import { createNightlyJob, LINES_PER_STEP, STRETCHES_PER_STEP } from '../src/nightly/job.js';
import { createPublication, ROWS_PER_STEP } from '../src/nightly/publish.js';
import { recordedSources } from '../src/sources.js';
import {
  UPLOAD_BYTES_PER_STEP,
  membersMetadata,
  uploadStep,
  type UploadProgress,
} from '../src/upload.js';
import { memoryBucket, memorySql } from '../tests/support.js';
import { LIMIT_MS, capture, measure, type Row } from './cpu-measure.js';
import { leftOutRows, planRow, sourceRows } from './cpu-sources.js';

/** The alarm that downloads and splits, which reads nothing else: every feed with parts at once. */
async function splitRow(): Promise<Row> {
  const split = recordedSources.flatMap((source) => {
    const body = source.parts > 1 ? capture(source.definition.id) : undefined;
    return body === undefined ? [] : [{ source, body }];
  });
  return measure(
    'split of every feed with parts',
    LIMIT_MS,
    `${String(split.length)} feeds`,
    () => {
      for (const { source, body } of split) splitFeed(body, source.parts, source.splitBy);
      return Promise.resolve();
    },
  );
}

/**
 * The 30 s row, and one step of the upload of an hour: 120 rows that each hold one gzip member
 * of every source, made of the start of its real answer.
 */
async function bufferRows(): Promise<Row[]> {
  const members = await Promise.all(
    recordedSources.map(async (source) => {
      const body = capture(source.definition.id) ?? new Uint8Array();
      const text = new TextDecoder().decode(body.subarray(0, 16_384));
      return { source: source.definition.id, bytes: await gzipLines([text]) };
    }),
  );
  const sql = memorySql();
  sql.exec(BUFFER_TABLE);
  const buffer = createBuffer(sql);
  const row = await measure('buffer row of 30 s', 1, `${String(members.length)} members`, () => {
    for (const member of members) buffer.add('2026-11-10/08', member.source, member.bytes, [], 0);
    buffer.persist(0, true);
    return Promise.resolve();
  });
  for (let index = 0; index < 120; index += 1) {
    for (const member of members) buffer.add('2026-11-10/07', member.source, member.bytes, [], 0);
    buffer.persist(0, true);
  }
  const bytes = members.reduce((total, member) => total + member.bytes.byteLength, 0) * 120;
  const discard = { ...memoryBucket(), put: () => Promise.resolve() };
  const progress: UploadProgress = new Map();
  const hour = '2026-11-10/08';
  const sizes = await measure(
    'upload: lengths of an hour',
    LIMIT_MS,
    `${String(bytes)} B`,
    async () => {
      progress.clear();
      await uploadStep(sql, discard, hour, progress);
    },
  );
  const note = `${String(UPLOAD_BYTES_PER_STEP)} B a step`;
  const upload = await measure('upload: one step of an hour', LIMIT_MS, note, () =>
    uploadStep(sql, discard, hour, progress),
  );
  return [row, sizes, upload];
}

/** One step of the nightly reduction over real lines: Bus Time and subway events of the day fixture, repeated. */
async function nightlyRow(): Promise<Row> {
  const lines = dayRecording().flatMap(({ writes }) => writes.flat());
  const member = Array.from(
    { length: Math.ceil(LINES_PER_STEP / lines.length) },
    () => lines,
  ).flat();
  const bucket = memoryBucket();
  const gz = gzipSync(`${member.join('\n')}\n`);
  return measure('nightly step', LIMIT_MS, `${String(LINES_PER_STEP)} lines`, async () => {
    bucket.objects.set(`raw/${DAY}/07/mta-bus-positions.0.ndjson.gz`, new Uint8Array(gz));
    bucket.metadata.set(
      `raw/${DAY}/07/mta-bus-positions.0.ndjson.gz`,
      membersMetadata([gz.byteLength]),
    );
    const job = createNightlyJob(
      { day: DAY, counts: {}, modes: new Map([['mta-bus-positions', 'bus']]), covered: [] },
      bucket,
    );
    await job.step(new Date());
  });
}

/** Bus GPS of the hand-made bus day, its vehicles and trips copied `times` over: one object. */
function busObject(times: number) {
  const lines = Array.from({ length: times }, (_, copy) =>
    busDay().map((event) => {
      const suffix = `-${String(copy)}`;
      const own =
        'veh' in event && event.veh !== null ? { ...event, veh: event.veh + suffix } : event;
      return JSON.stringify('trip' in own ? { ...own, trip: own.trip + suffix } : own);
    }),
  ).flat();
  const marker = JSON.stringify({ k: 'version', v: 'v1', t: 0, run: 1, at: 0 });
  return gzipSync(`${[marker, ...lines].join('\n')}\n`);
}

/**
 * Full steps of the nightly reduction over bus GPS, in both readings: the speeds of the first,
 * and the replay of the estimator in the second (ten reports back for each report, a line
 * counting twice). The job is past its warming steps, as every step of a reading but its first three.
 */
async function nightlyBusRows(): Promise<Row[]> {
  const bucket = memoryBucket();
  const key = `raw/${DAY}/07/mta-bus-positions.0.ndjson.gz`;
  const gz = busObject(25);
  bucket.objects.set(key, new Uint8Array(gz));
  bucket.metadata.set(key, membersMetadata([gz.byteLength]));
  const job = createNightlyJob(
    { day: DAY, counts: {}, modes: new Map([['mta-bus-positions', 'bus']]), covered: [] },
    bucket,
  );
  const now = new Date();
  for (let warming = 0; warming < 3; warming += 1) await job.step(now);
  const note = `${String(LINES_PER_STEP)} lines of bus GPS`;
  const speeds = await measure('nightly step: bus speeds', LIMIT_MS, note, () => job.step(now));
  // The rest of the first reading, the step that turns to the second and its warming steps.
  for (let rest = 0; rest < 6; rest += 1) await job.step(now);
  const replay = await measure('nightly step: bus replay', LIMIT_MS, note, () => job.step(now));
  return [speeds, replay];
}

/**
 * One step turning bus stretches into published rows, out of a day of 100,000 stretches (2,000
 * routes of 50 stretches) moved over 24 times each, more than New York's buses give.
 */
async function stretchesRow(): Promise<Row> {
  const speeds = createStretchSpeeds('weekday');
  const at = Date.parse(`${DAY}T12:00:00.000Z`) / 1000;
  for (let route = 0; route < 2_000; route += 1)
    for (let stretch = 0; stretch < 50; stretch += 1)
      for (let move = 0; move < 24; move += 1) {
        const lat = 40.7 + stretch * 0.003;
        const report = (dlat: number, t: number) => ({
          route: `R${String(route)}`,
          trip: 'T',
          point: { lat: lat + dlat, lon: -73.98 },
          at: t,
        });
        speeds.add(
          'V',
          report(0.0027, at + move * 60 + 30 + (move % 5)),
          report(0, at + move * 60),
        );
      }
  const batches = speeds.batches(STRETCHES_PER_STEP);
  const note = `${String(STRETCHES_PER_STEP)} stretches a step`;
  return measure('nightly step: bus stretches', LIMIT_MS, note, async () => {
    const next = batches.next();
    if (next.done === true) throw new Error('no stretches left to measure');
    speedTuples(next.value);
    await Promise.resolve();
  });
}

/**
 * A day of the city as published: 100,000 segment rows at nine levels (5.6 MB of text in one
 * piece took 15 ms), 20,000 stretches of bus speed and the rest of a day's lists.
 */
function largeDay(): RecorderStats {
  const segments = Array.from(
    { length: 100_000 },
    (_, index): RecorderStats['segments'][number] => [
      ...([
        'bus',
        'M15',
        '0',
        `S${String(index)}`,
        `S${String(index + 1)}`,
        'am-peak',
        25,
      ] as const),
      ...([100, 101.2, 102.4, 106, 112, 118, 121.6, 122.8, 124] as const),
    ],
  );
  const speeds = Array.from({ length: 20_000 }, (_, index): RecorderStats['speeds'][number] => [
    'M15',
    `-23464:${String(18_108 + index)}:0`,
    'am-peak',
    24,
    4.5,
  ]);
  return {
    version: RECORDER_STATS_VERSION,
    day: DAY,
    dayType: 'weekday',
    generatedAt: new Date().toISOString(),
    complete: true,
    coverage: [],
    counts: {
      events: 0,
      trajectories: 0,
      segmentRuns: 0,
      predictionsJudged: 0,
      predictionsUnmatched: 0,
    },
    segments,
    headways: [],
    predictions: [],
    stoppages: [],
    incidents: [],
    speeds,
    tracking: [],
  };
}

/** One step of writing a large day, and the last one, which joins the texts into one document. */
async function publicationRows(): Promise<Row[]> {
  const day = largeDay();
  const note = `${String(ROWS_PER_STEP)} rows a step`;
  const step = await measure('publication: one step', LIMIT_MS, note, async () => {
    createPublication(day).step();
    await Promise.resolve();
  });
  // Six publications written up to their last step: one for each run of the measure.
  const ready = Array.from({ length: 6 }, () => {
    const publication = createPublication(day);
    for (let index = 0; index < Math.ceil(120_000 / ROWS_PER_STEP); index += 1) publication.step();
    return publication;
  });
  const last = await measure('publication: the document', LIMIT_MS, '120,000 rows', async () => {
    const document = ready.pop()?.step();
    if (document === undefined) throw new Error('the publication was not at its last step');
    await Promise.resolve();
  });
  return [step, last];
}

/**
 * One batch of lines with the busiest line of a day in it: 250 trips of 50 stops (12,500
 * departures, two minutes apart), more than any bus route of New York runs in a day. A line is
 * never split, so this is the largest step the reduction can take.
 */
async function batchRow(): Promise<Row> {
  const trajectories = createTrajectories();
  const base = Date.parse(`${DAY}T12:00:00.000Z`) / 1000;
  for (let trip = 0; trip < 250; trip += 1)
    for (let stop = 0; stop < 50; stop += 1) {
      const t = base + trip * 240 + stop * 120;
      trajectories.add('bus', {
        k: 'stn',
        v: 'v',
        t,
        ev: 'dep',
        trip: `T${String(trip)}`,
        route: 'BIG',
        dir: '0',
        veh: null,
        stop: `S${String(stop)}`,
        next: `S${String(stop + 1)}`,
        lo: t - 20,
        hi: t,
        exact: false,
      });
    }
  return measure('nightly batch: the busiest line', LIMIT_MS, '12,500 passages', async () => {
    createLineBatches(trajectories, 'weekday').next();
    await Promise.resolve();
  });
}

export async function measureAll(): Promise<Row[]> {
  // A first pass compiles every path, so no case pays for the code of the cases after it; the
  // first run of each case in that pass is what a fresh isolate pays.
  const cold = new Map((await sourceRows()).map((row) => [row.name, row.first]));
  const warm = (await sourceRows()).map((row) => ({
    ...row,
    first: cold.get(row.name) ?? row.first,
  }));
  return [
    ...warm,
    await splitRow(),
    ...(await bufferRows()),
    await nightlyRow(),
    ...(await nightlyBusRows()),
    await stretchesRow(),
    ...(await publicationRows()),
    await batchRow(),
    planRow(),
    ...(await leftOutRows()),
  ];
}
