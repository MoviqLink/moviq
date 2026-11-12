import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import type { ExtractorSession } from '../../server/src/modules/recorder/extractor.js';
import { AIR_LIMIT, createFixes } from '../src/audit.js';
import { gzipLines } from '../src/buffer.js';
import { processPart } from '../src/process.js';
import type { RecordedSource } from '../src/sources.js';
import { emptyPart } from '../src/state.js';

/** How the CPU guard measures: real answers, five runs after a first, the median judged. */
export interface Row {
  readonly name: string;
  readonly first: number;
  readonly median: number;
  readonly worst: number;
  readonly budget: number;
  readonly note: string;
  /** Shown, never judged: the measure of a source left out. */
  readonly informative?: true;
  /** A count judged against its budget only, not against 10 ms of CPU. */
  readonly count?: true;
}

const FIXTURES = new URL('./fixtures-cpu/', import.meta.url);
const RUNS = 5;
/** The free plan's CPU per alarm. */
export const LIMIT_MS = 10;

export const capture = (id: string): Uint8Array | undefined => {
  try {
    return new Uint8Array(gunzipSync(readFileSync(new URL(`${id}.gz`, FIXTURES))));
  } catch {
    return undefined;
  }
};

async function cpuOf(work: () => Promise<unknown>): Promise<number> {
  const start = process.cpuUsage();
  await work();
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
}

export async function measure(
  name: string,
  budget: number,
  note: string,
  work: () => Promise<unknown>,
): Promise<Row> {
  const first = await cpuOf(work);
  const runs: number[] = [];
  for (let run = 0; run < RUNS; run += 1) runs.push(await cpuOf(work));
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(RUNS / 2)] ?? 0;
  return { name, first, median, worst: runs.at(-1) ?? 0, budget, note };
}

/** One part, as an alarm processes it, with a fresh session (every vehicle new: the most events). */
export async function partWork(
  source: RecordedSource,
  body: Uint8Array,
  part: number,
): Promise<number> {
  let session: ExtractorSession | undefined;
  const outcome = await processPart({
    source,
    part,
    body,
    partState: emptyPart(),
    receivedAt: new Date(),
    run: 1,
    session: () => (session ??= source.extractor.start(new Map())),
    dayOf: (instant) => instant.toISOString().slice(0, 10),
    fixes: createFixes(AIR_LIMIT),
  });
  if (outcome.kind !== 'recorded') return 0;
  await gzipLines(outcome.events.map((event) => JSON.stringify(event)));
  return outcome.events.length;
}
