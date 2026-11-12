import { gzipSync } from 'node:zlib';

import { recorderStatsSchema, type RecorderStats } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { createBusMeasures } from '../../server/src/modules/recorder/nightly/bus-measures.js';
import { quantileOfCounts, tenths } from '../../server/src/modules/recorder/nightly/statistics.js';
import { BUS_DAY, busDay } from '../../server/tests/recorder/bus-day.js';
import { createReducer } from '../src/nightly/reducer.js';
import { createPublication, ROWS_PER_STEP } from '../src/nightly/publish.js';
import { membersMetadata } from '../src/upload.js';
import { memoryBucket, memorySql } from './support.js';

/** The bus day uploaded in eleven objects of the hour, numbered 0 to 10, as uploads number them. */
function uploadedBusDay() {
  const bucket = memoryBucket();
  const lines = busDay().map((event) => JSON.stringify(event));
  const size = Math.ceil(lines.length / 11);
  for (let number = 0; number < 11; number += 1) {
    const run = number + 1;
    const marker = JSON.stringify({ k: 'version', v: `v${String(run)}`, t: 0, run, at: 0 });
    const chunk = [marker, ...lines.slice(number * size, (number + 1) * size)];
    const member = gzipSync(`${chunk.join('\n')}\n`);
    const key = `raw/${BUS_DAY}/07/mta-bus-positions.${String(number)}.ndjson.gz`;
    bucket.objects.set(key, new Uint8Array(member));
    bucket.metadata.set(key, membersMetadata([member.byteLength]));
  }
  return bucket;
}

async function reduced(): Promise<RecorderStats> {
  const bucket = uploadedBusDay();
  const reducer = createReducer(memorySql(), bucket);
  reducer.start({
    day: BUS_DAY,
    counts: {},
    modes: { 'mta-bus-positions': 'bus' },
    covered: [],
    retentionDays: 14,
  });
  while (await reducer.step(new Date('2026-11-11T09:30:00.000Z')));
  const stored = bucket.objects.get('stats/latest.json');
  if (stored === undefined) throw new Error('nothing was published');
  return recorderStatsSchema.parse(JSON.parse(new TextDecoder().decode(stored)));
}

describe('the bus measures on Cloudflare', () => {
  it('publishes the same speeds and replayed errors as the server, objects in written order', async () => {
    const server = createBusMeasures('weekday');
    for (const event of busDay()) server.add('mta-bus-positions', event);
    server.replay();
    for (const event of busDay()) server.add('mta-bus-positions', event);
    const speeds = [...server.speeds(1_000)].flat();
    const tracking = server.tracking();
    const stats = await reduced();
    expect(stats.speeds).toHaveLength(19);
    expect(stats.speeds).toEqual(
      speeds.map((row) => [
        row.route,
        row.stretch,
        row.band,
        row.n,
        tenths(quantileOfCounts(row.counts, 0.5)),
      ]),
    );
    expect(stats.tracking).toEqual(
      tracking.map((row) => [
        row.route,
        row.ageFrom,
        row.ageTo,
        row.n,
        quantileOfCounts(row.counts, 0.9),
      ]),
    );
    expect(stats.tracking.find(([, from]) => from === 30)?.[3]).toBe(25 * 19);
  });

  it('writes a large day a few thousand rows a step, into the same document', async () => {
    const stats = await reduced();
    const segment = stats.segments[0] ?? [
      'bus',
      'M15',
      '0',
      'X1',
      'X2',
      'am-peak',
      25,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
    ];
    const large: RecorderStats = {
      ...stats,
      segments: Array.from({ length: ROWS_PER_STEP * 2 + 7 }, (_, index) => {
        const row: RecorderStats['segments'][number] = [...segment];
        row[3] = `S${String(index)}`;
        return row;
      }),
    };
    const publication = createPublication(large);
    let steps = 1;
    let document = publication.step();
    while (document === undefined) {
      steps += 1;
      document = publication.step();
    }
    expect(steps).toBe(3);
    expect(JSON.parse(await document.text())).toEqual(JSON.parse(JSON.stringify(large)));
  });
});
