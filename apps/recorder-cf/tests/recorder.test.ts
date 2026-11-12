import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { createHttpClient } from '../../server/src/infrastructure/http/client.js';
import { recordedEventSchema } from '../../server/src/modules/recorder/events.js';
import { nextAttempt } from '../src/collect.js';
import { splitFeed } from '../src/gtfs-rt/split.js';
import { createRecorder, hourOf } from '../src/recorder.js';
import { BUDGET_MS, recordedSources, type RecordedSource } from '../src/sources.js';
import { fixture, memoryBucket, memorySql } from './support.js';

const pick = (id: string): RecordedSource => {
  const source = recordedSources.find((candidate) => candidate.definition.id === id);
  if (source === undefined) throw new Error(`missing ${id}`);
  return source;
};

const ACE = pick('mta-subway-ace');
const BUSES = pick('mta-bus-positions');

/** 11/11/2026 05:10 in New York, after both captures. */
const START = Date.parse('2026-11-11T10:10:00.000Z');

interface World {
  readonly answers: Map<string, () => Response>;
  readonly seen: Headers[];
  readonly clock: { now: number };
}

function world(sources: readonly RecordedSource[]) {
  const sql = memorySql();
  const bucket = memoryBucket();
  const state: World = { answers: new Map(), seen: [], clock: { now: START } };
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    state.seen.push(new Headers(init?.headers));
    const answer = [...state.answers].find(([prefix]) => url.startsWith(prefix))?.[1];
    return Promise.resolve(answer?.() ?? new Response('missing', { status: 404 }));
  };
  const recorder = createRecorder({
    sql,
    bucket,
    http: createHttpClient({ fetch }),
    sources,
    now: () => state.clock.now,
    random: () => 0.5,
  });
  return { sql, bucket, recorder, ...state };
}

const pb = (path: string, etag?: string) => () =>
  new Response(fixture(path), { headers: etag === undefined ? {} : { etag } });

/** Runs alarms, as the Durable Object would, until nothing is queued. */
async function settle(recorder: ReturnType<typeof createRecorder>, clock: { now: number }) {
  for (let alarms = 1; alarms <= 40; alarms += 1) {
    const next = await recorder.alarm();
    if (recorder.queued() === 0 && next > clock.now) return alarms;
    clock.now += 50;
  }
  throw new Error('the queue never emptied');
}

describe('the recorder of the Durable Object', () => {
  it('splits Bus Time into its parts and processes them over alarms within the CPU budget', async () => {
    const { recorder, answers, clock } = world([BUSES]);
    answers.set('https://gtfsrt.prod.obanyc.com/', pb('mta/bus-vehicle-positions.pb'));
    const alarms = await settle(recorder, clock);
    // A fresh object reads one part per alarm while its code warms up.
    expect(alarms).toBeGreaterThanOrEqual(BUSES.parts);
    expect(BUDGET_MS).toBeLessThan(10);
    const day = Object.values(recorder.state.days)[0]?.['mta-bus-positions'];
    expect(day?.versions).toBeGreaterThan(0);
    expect((day?.versions ?? 0) + (day?.rejected ?? 0)).toBeLessThanOrEqual(BUSES.parts);
  });

  it('never records the same answer twice: a 304 or the same bytes count as unchanged', async () => {
    const { recorder, answers, clock, seen } = world([ACE]);
    answers.set('https://api-endpoint.mta.info/', pb('mta/subway-ace.pb', '"a1"'));
    await settle(recorder, clock);
    clock.now += ACE.everyMs;
    await settle(recorder, clock);
    expect(seen.at(-1)?.get('if-none-match')).toBe('"a1"');
    answers.set('https://api-endpoint.mta.info/', () => new Response(null, { status: 304 }));
    clock.now += ACE.everyMs;
    await settle(recorder, clock);
    // A version counts on the New York day of its data; an unchanged answer on the day it came.
    const days = Object.values(recorder.state.days).flatMap((day) => day['mta-subway-ace'] ?? []);
    const total = (key: 'versions' | 'unchanged' | 'rejected' | 'failed') =>
      days.reduce((sum, day) => sum + day[key], 0);
    // Each part is a version; the same bytes again are unchanged part by part, a 304 as a whole.
    const counts = [total('versions'), total('unchanged'), total('rejected'), total('failed')];
    const recorded = splitFeed(fixture('mta/subway-ace.pb'), ACE.parts, 'trip').filter(
      (part) => part.entities !== 0,
    ).length;
    expect(counts).toEqual([recorded, recorded + 1, 0, 0]);
    expect(
      seen.every((headers) => headers.get('user-agent')?.startsWith('Mozilla/5.0') === true),
    ).toBe(true);
  });

  it('waits longer after three failures in a row, never sooner than its cadence', () => {
    const at = (failures: number, random: number) =>
      nextAttempt(ACE, failures, 0, undefined, () => random);
    expect(at(1, 0)).toBe(ACE.everyMs);
    expect(at(3, 0)).toBe(ACE.everyMs * 2 * 0.8);
    expect(at(3, 0.999)).toBeLessThanOrEqual(ACE.everyMs * 2 * 1.2);
    expect(at(30, 0.5)).toBe(5 * 60_000);
    expect(nextAttempt(ACE, 0, 0, 90_000, () => 0)).toBe(90_000);
  });

  it('notes a failure with its reason and no key, then uploads the hour once it ends', async () => {
    const { recorder, answers, clock, bucket, sql } = world([ACE]);
    answers.set('https://api-endpoint.mta.info/', () => new Response('busy', { status: 503 }));
    await settle(recorder, clock);
    const failing = recorder.state.sources['mta-subway-ace'];
    expect(failing?.failures).toBe(1);
    expect(failing?.lastError).toContain('HTTP 503');
    answers.set('https://api-endpoint.mta.info/', pb('mta/subway-ace.pb'));
    clock.now += ACE.everyMs;
    await settle(recorder, clock);
    const hour = hourOf(clock.now);
    clock.now += 60 * 60_000;
    // The first step reads the lengths of the hour, the next ones upload it.
    for (let step = 0; step < 4 && !bucket.objects.has(`audit/${hour}.txt`); step += 1)
      await recorder.alarm();
    const raw = bucket.objects.get(`raw/${hour}/mta-subway-ace.0.ndjson.gz`);
    if (raw === undefined) throw new Error('the hour was not uploaded');
    const lines = gunzipSync(raw).toString('utf8').trim().split('\n');
    const events = lines.map((line) => recordedEventSchema.parse(JSON.parse(line)));
    expect(events[0]).toMatchObject({ k: 'version', run: 1 });
    // One gzip member per part recorded: the versions of the parts that had entities.
    const parts = splitFeed(fixture('mta/subway-ace.pb'), ACE.parts, 'trip');
    const versions = events.filter((event) => event.k === 'version');
    expect(versions).toHaveLength(parts.filter((part) => part.entities !== 0).length);
    const audit = new TextDecoder().decode(bucket.objects.get(`audit/${hour}.txt`));
    expect(audit).toContain('mta-subway-ace failed: HTTP 503 for api-endpoint.mta.info/');
    expect(sql.exec('SELECT COUNT(*) AS n FROM buffer').toArray()[0]?.['n']).toBe(0);
  });

  it('writes a few rows, not one per download', async () => {
    const { recorder, answers, clock, sql } = world([ACE, BUSES]);
    answers.set('https://api-endpoint.mta.info/', pb('mta/subway-ace.pb'));
    answers.set('https://gtfsrt.prod.obanyc.com/', pb('mta/bus-vehicle-positions.pb'));
    const before = sql.writes();
    await settle(recorder, clock);
    clock.now += 31_000;
    await recorder.alarm();
    expect(sql.writes() - before).toBeLessThanOrEqual(3);
  });
});

describe('a restart of the Durable Object', () => {
  it('keeps the state saved every minute, so a version is not recorded twice after it', async () => {
    const first = world([ACE]);
    first.answers.set('https://api-endpoint.mta.info/', pb('mta/subway-ace.pb'));
    await settle(first.recorder, first.clock);
    first.clock.now += 61_000;
    await settle(first.recorder, first.clock);
    const saved = first.sql.exec('SELECT json FROM state').toArray();
    expect(saved).toHaveLength(1);
    const again = createRecorder({
      sql: first.sql,
      bucket: first.bucket,
      http: createHttpClient({ fetch: () => Promise.resolve(pb('mta/subway-ace.pb')()) }),
      sources: [ACE],
      now: () => first.clock.now,
      random: () => 0.5,
    });
    expect(again.state.sources['mta-subway-ace']?.run).toBe(
      first.recorder.state.sources['mta-subway-ace']?.run,
    );
    first.clock.now += ACE.everyMs;
    await settle(again, first.clock);
    const versions = Object.values(again.state.days).reduce(
      (sum, day) => sum + (day['mta-subway-ace']?.versions ?? 0),
      0,
    );
    const before = Object.values(first.recorder.state.days).reduce(
      (sum, day) => sum + (day['mta-subway-ace']?.versions ?? 0),
      0,
    );
    expect(versions).toBe(before);
  });
});
