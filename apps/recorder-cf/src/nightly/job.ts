import type { RecorderStats } from '@moviq/contracts';

import {
  recordedEventSchema,
  type RecordedEvent,
} from '../../../server/src/modules/recorder/events.js';
import type { RecorderMode } from '../../../server/src/modules/recorder/extractor.js';
import {
  createBusMeasures,
  replayedLine,
} from '../../../server/src/modules/recorder/nightly/bus-measures.js';
import type { StretchSpeedRow } from '../../../server/src/modules/recorder/nightly/stretch-speeds.js';
import {
  dayTypeOf,
  shiftDay,
  startOfDay,
} from '../../../server/src/modules/recorder/nightly/calendar.js';
import { createPredictionErrors } from '../../../server/src/modules/recorder/nightly/predictions.js';
import { createTrajectories } from '../../../server/src/modules/recorder/nightly/trajectories.js';
import type { Bucket } from '../ports.js';
import type { DayCount } from '../state.js';
import { emptyIncidentLog, finishDay, speedTuples } from './aggregate.js';
import { createLineBatches } from './batches.js';

/**
 * The nightly reduction of one New York day, in steps small enough for one alarm each: it reads
 * the day's recording object by object (at most 128 KiB each, over a few steps), twice (trips
 * and bus speeds, then the predictions judged against them and the bus reports replayed),
 * measures the lines in batches, then finishes the day and publishes `stats/<day>.json` and
 * `stats/latest.json`. Its progress lives in memory: if the object restarts, the day starts over.
 */
export const LINES_PER_STEP = 1_500;
/**
 * A line of bus GPS replayed through the estimator, ten reports back, costs about twice one read
 * (`tools/cpu-budget.ts`): it counts twice against the lines of a step.
 */
const REPLAY_WEIGHT = 2;
/** Bus stretches turned into published rows per step: a day of the city has about 100,000. */
export const STRETCHES_PER_STEP = 2_500;
/** The first steps after a start read fewer lines, while the reading code compiles. */
const FIRST_STEPS = 3;
const LINES_WHILE_WARMING = 200;

interface RawObject {
  readonly key: string;
  readonly sourceId: string;
  /** The key up to its number: day, hour and source. */
  readonly prefix: string;
  readonly number: number;
}

export interface JobInput {
  readonly day: string;
  readonly counts: Readonly<Record<string, DayCount>>;
  /** The sources read, with their mode; null for incidents, which are not trips. */
  readonly modes: ReadonlyMap<string, RecorderMode | null>;
  /** Every recorded source, whose coverage of the day is judged. */
  readonly covered: readonly string[];
}

const RAW_KEY = /^raw\/(\d{4}-\d{2}-\d{2})\/(\d{2})\/([a-z0-9-]+)\.(\d+)\.ndjson\.gz$/;

/** Objects in the order written: by hour, source and number (`.10.` after `.9.`, not `.1.`). */
const written = (a: RawObject, b: RawObject) =>
  a.prefix.localeCompare(b.prefix) || a.number - b.number;

/** The objects of the sources read, of the day and of the first hour after it, by listing. */
async function objectsOf(
  bucket: Bucket,
  day: string,
  read: ReadonlyMap<string, unknown>,
): Promise<RawObject[]> {
  const prefixes = [`raw/${day}/`, `raw/${shiftDay(day, 1)}/00/`];
  const objects: RawObject[] = [];
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    do {
      const listed = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor });
      for (const object of listed.objects) {
        const [, day, hour, sourceId, number] = RAW_KEY.exec(object.key) ?? [];
        if (day === undefined || sourceId === undefined || !read.has(sourceId)) continue;
        const prefix = `${day}/${hour ?? ''}/${sourceId}`;
        objects.push({ key: object.key, sourceId, prefix, number: Number(number) });
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor !== undefined);
  }
  return objects.sort(written);
}

const MEMBERS = /^[0-9a-z]+(,[0-9a-z]+)*$/;

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * The lines of one object, read whole: at most 128 KiB of gzip members, decompressed one by one
 * from the lengths in its metadata, since a gzip stream of the platform reads one member only.
 */
async function linesOf(bucket: Bucket, object: RawObject): Promise<string[]> {
  const stored = await bucket.get(object.key);
  if (stored === null) return [];
  const listed = stored.customMetadata?.['members'] ?? '';
  if (!MEMBERS.test(listed)) throw new Error(`${object.key} has no list of its members.`);
  const bytes = new Uint8Array(await stored.arrayBuffer());
  const lines: string[] = [];
  let offset = 0;
  for (const length of listed.split(',').map((text) => parseInt(text, 36))) {
    const text = await gunzip(bytes.subarray(offset, offset + length));
    for (const line of text.split('\n')) if (line !== '') lines.push(line);
    offset += length;
  }
  return lines;
}

function parse(line: string): RecordedEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = recordedEventSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// eslint-disable-next-line max-lines-per-function -- the closure is the day's memory between steps
export function createNightlyJob(input: JobInput, bucket: Bucket) {
  const from = Math.floor(startOfDay(input.day).getTime() / 1000);
  const to = Math.floor(startOfDay(shiftDay(input.day, 1)).getTime() / 1000);
  const trajectories = createTrajectories();
  const errors = createPredictionErrors(trajectories);
  const buses = createBusMeasures(dayTypeOf(input.day));
  const incidents = emptyIncidentLog();
  let objects: RawObject[] | undefined;
  let pass: 'trips' | 'predictions' = 'trips';
  let index = 0;
  let lines: string[] = [];
  let offset = 0;
  let events = 0;
  let invalid = 0;
  let steps = 0;

  /** Versions read in this pass: one written twice (an upload tried again) is read once. */
  let seen = new Set<string>();
  let repeated = false;

  const marker = (sourceId: string, line: string) => {
    const event = parse(line);
    if (event?.k !== 'version') {
      invalid += 1;
      return;
    }
    const key = `${sourceId}\u0000${event.v}`;
    repeated = seen.has(key);
    seen.add(key);
  };

  const take = (sourceId: string, line: string) => {
    if (line.startsWith('{"k":"version"')) {
      marker(sourceId, line);
      return;
    }
    if (repeated) return;
    const mode = input.modes.get(sourceId) ?? null;
    const isPrediction = line.includes('"k":"pred"');
    const replayed = pass === 'predictions' && mode === 'bus' && replayedLine(line);
    if (pass === 'predictions' ? !(isPrediction || replayed) || mode === null : isPrediction)
      return;
    // GPS reports are read for the bus measures only; the others are counted.
    if (mode !== 'bus' && line.includes('"k":"gps"')) {
      events += 1;
      return;
    }
    const event = parse(line);
    if (event === undefined) {
      invalid += 1;
      return;
    }
    if (event.t < from || event.t >= to) return;
    if (mode === 'bus') buses.add(sourceId, event);
    if (replayed) return;
    events += 1;
    if (event.k === 'pred' && mode !== null) errors.add(sourceId, mode, event);
    else if (event.k === 'open' || event.k === 'change') {
      if (!incidents.opened.has(event.id)) incidents.opened.set(event.id, event);
    } else if (event.k === 'close') incidents.closed.set(event.id, event);
    else if (mode !== null) trajectories.add(mode, event);
  };

  let batches: ReturnType<typeof createLineBatches> | undefined;
  let stretches: Generator<StretchSpeedRow[]> | undefined;
  const speeds: RecorderStats['speeds'] = [];
  const dayType = dayTypeOf(input.day);

  /**
   * After both passes: one batch of lines per step, then the bus stretches a few thousand a step,
   * then the rest of the day in one.
   */
  const finishing = (now: Date) => {
    batches ??= createLineBatches(trajectories, dayType);
    if (batches.next()) return undefined;
    stretches ??= buses.speeds(STRETCHES_PER_STEP);
    const next = stretches.next();
    if (next.done !== true) {
      speeds.push(...speedTuples(next.value));
      return undefined;
    }
    const stats = finishDay({
      day: input.day,
      dayType,
      endOfDay: to,
      rows: batches.rows,
      trajectories,
      errors,
      incidents,
      speeds,
      tracking: buses.tracking(),
      counts: input.counts,
      recordedSources: input.covered,
      events,
      now,
    });
    return { stats, invalid };
  };

  return {
    /** One step. Returns the statistics once the day is done, `undefined` while it is not. */
    async step(now: Date) {
      objects ??= await objectsOf(bucket, input.day, input.modes);
      steps += 1;
      let budget = steps <= FIRST_STEPS ? LINES_WHILE_WARMING : LINES_PER_STEP;
      while (budget > 0) {
        const object = objects[index];
        if (object === undefined) {
          if (pass === 'trips') {
            pass = 'predictions';
            index = 0;
            seen = new Set();
            buses.replay();
            // The replay runs code the first reading did not: it warms up again.
            steps = 0;
            return undefined;
          }
          return finishing(now);
        }
        if (offset === 0 && lines.length === 0) lines = await linesOf(bucket, object);
        const weight =
          pass === 'predictions' && input.modes.get(object.sourceId) === 'bus' ? REPLAY_WEIGHT : 1;
        const end = Math.min(lines.length, offset + Math.max(1, Math.floor(budget / weight)));
        for (let position = offset; position < end; position += 1)
          take(object.sourceId, lines[position] ?? '');
        budget -= (end - offset) * weight;
        offset = end;
        if (offset >= lines.length) {
          index += 1;
          offset = 0;
          lines = [];
        }
      }
      return undefined;
    },
  };
}

export type NightlyJob = ReturnType<typeof createNightlyJob>;
