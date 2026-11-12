import { gzipSync } from 'node:zlib';

import { recorderStatsSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { DAY, dayRecording } from '../../server/tests/recorder/day-fixture.js';
import { createReducer } from '../src/nightly/reducer.js';
import { membersMetadata } from '../src/upload.js';
import { memoryBucket, memorySql } from './support.js';

/** The hand-made day of the server's nightly tests, uploaded as the recorder uploads an hour. */
function uploadedDay() {
  const bucket = memoryBucket();
  for (const { sourceId, writes } of dayRecording()) {
    const members = writes.map((lines) => gzipSync(`${lines.join('\n')}\n`));
    const whole = Buffer.concat(members);
    bucket.objects.set(`raw/${DAY}/07/${sourceId}.0.ndjson.gz`, new Uint8Array(whole));
    const lengths = members.map((member) => member.byteLength);
    bucket.metadata.set(`raw/${DAY}/07/${sourceId}.0.ndjson.gz`, membersMetadata(lengths));
  }
  bucket.objects.set('raw/2026-10-01/07/mta-subway-ace.0.ndjson.gz', new Uint8Array([1]));
  return bucket;
}

const HOURS = ['07'];
const counts = {
  'mta-bus-positions': {
    versions: 1,
    unchanged: 0,
    rejected: 0,
    failed: 0,
    events: 0,
    bytes: 0,
    hours: HOURS,
  },
  'mta-subway-ace': {
    versions: 1,
    unchanged: 0,
    rejected: 2,
    failed: 0,
    events: 0,
    bytes: 0,
    hours: HOURS,
  },
};

async function reduce() {
  const bucket = uploadedDay();
  const reducer = createReducer(memorySql(), bucket);
  reducer.start({
    day: DAY,
    counts,
    modes: { 'mta-bus-positions': 'bus', 'mta-subway-ace': 'subway' },
    covered: ['mta-bus-positions', 'mta-subway-ace'],
    retentionDays: 14,
  });
  let steps = 0;
  while (await reducer.step(new Date('2026-11-11T09:30:00.000Z'))) steps += 1;
  const stored = bucket.objects.get('stats/latest.json');
  if (stored === undefined) throw new Error('nothing was published');
  const stats = recorderStatsSchema.parse(JSON.parse(new TextDecoder().decode(stored)));
  return { stats, steps, bucket };
}

describe('the nightly reduction on Cloudflare', () => {
  it('gives the same segments, stoppages and prediction errors as the server, in steps', async () => {
    const { stats, steps } = await reduce();
    // While warming, a step reads 200 lines (a replayed bus line counts twice): two steps read
    // the trips, two the predictions and the bus reports again; the step that writes the day
    // ends the reduction and is not counted.
    expect(steps).toBe(4);
    const x1x2 = stats.segments.find(
      ([, route, , from, to]) => route === 'M15' && from === 'X1' && to === 'X2',
    );
    expect(x1x2).toEqual([
      ...['bus', 'M15', '0', 'X1', 'X2', 'am-peak', 25],
      ...[100, 101.2, 102.4, 106, 112, 118, 121.6, 122.8, 124],
    ]);
    expect(stats.stoppages.map(([, , trip, , , , seconds]) => [trip, seconds]).sort()).toEqual([
      ['R6', 580],
      ['TRIP-1', 360],
    ]);
    const ace = stats.predictions.find(
      ([source, from]) => source === 'mta-subway-ace' && from === 120,
    );
    // Predicted minus observed, −10 to +9 s, at the nine levels the estimator reads.
    expect(ace).toEqual([
      ...['mta-subway-ace', 120, 300, 20],
      ...[-10, -9, -8.1, -5.2, -0.5, 4.3, 7.1, 8.1, 9],
    ]);
  });

  it('reads a version written twice once, and says which hours and answers are missing', async () => {
    const { stats } = await reduce();
    const arrivals = stats.counts.events;
    expect(arrivals).toBeGreaterThan(0);
    expect(stats.counts.predictionsJudged).toBe(20);
    expect(stats.complete).toBe(false);
    const ace = stats.coverage.find((source) => source.sourceId === 'mta-subway-ace');
    expect(ace).toMatchObject({ rejected: 2, failed: 0 });
    expect(ace?.missingHours).toHaveLength(23);
  });

  it('publishes the day and deletes raw days older than the retention', async () => {
    const { bucket } = await reduce();
    expect(bucket.objects.has(`stats/${DAY}.json`)).toBe(true);
    expect(bucket.objects.has('raw/2026-10-01/07/mta-subway-ace.0.ndjson.gz')).toBe(false);
    expect(bucket.objects.has(`raw/${DAY}/07/mta-subway-ace.0.ndjson.gz`)).toBe(true);
    expect(new TextDecoder().decode(bucket.objects.get(`audit/${DAY}/reduced.txt`))).toMatch(
      /incomplete/,
    );
  });
});
