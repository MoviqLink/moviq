import { recorderExtractors } from '../../server/src/modules/recorder/extractors/index.js';
import { splitFeed } from '../src/gtfs-rt/split.js';
import { TICK_MS } from '../src/recorder.js';
import {
  BUDGET_MS,
  costOf,
  leftOutSources,
  recordedSources,
  type RecordedSource,
} from '../src/sources.js';
import { LIMIT_MS, capture, measure, partWork, type Row } from './cpu-measure.js';

/** Parts of the captures, with their predicted cost, for the source rows and the plan. */
function partsOf(source: RecordedSource): { bytes: Uint8Array; predicted: number }[] {
  const body = capture(source.definition.id);
  if (body === undefined) return [];
  return splitFeed(body, source.parts, source.splitBy).map((part) => ({
    bytes: part.body,
    predicted: costOf(source, part.body.byteLength),
  }));
}

/**
 * Every part of every source, against the cost its size predicts: the row shows the part that
 * comes closest to its prediction, and the measured CPU per KiB to set `cost` from.
 */
export async function sourceRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const source of recordedSources) {
    const parts = partsOf(source);
    let closest: Row | undefined;
    let perKib = 0;
    for (const [part, { bytes, predicted }] of parts.entries()) {
      let events = 0;
      const budget = Math.min(predicted, BUDGET_MS);
      const row = await measure(`${source.definition.id}#${String(part)}`, budget, '', async () => {
        events = await partWork(source, bytes, part);
      });
      perKib = Math.max(
        perKib,
        (row.median - source.cost.baseMs) / Math.max(1, bytes.byteLength / 1024),
      );
      const note = `${String(bytes.byteLength)} B, ${String(events)} events`;
      if (predicted > BUDGET_MS)
        closest = {
          ...row,
          budget: BUDGET_MS,
          median: predicted,
          note: `predicted over budget, ${note}`,
        };
      else if (closest === undefined || row.median / budget > closest.median / closest.budget)
        closest = { ...row, note };
    }
    if (closest === undefined) {
      rows.push({
        name: source.definition.id,
        first: 0,
        median: 0,
        worst: 0,
        budget: 0,
        note: 'no capture',
      });
      continue;
    }
    rows.push({
      ...closest,
      name: `${closest.name} of ${String(parts.length)}`,
      note: `${closest.note}; ${perKib.toFixed(3)} ms/KiB`,
    });
  }
  return rows;
}

/** The alarms and rows written a day at the rate of the captures, against the free plan's 100,000. */
export function planRow(): Row {
  let cpuPerDay = 0;
  for (const source of recordedSources) {
    const perVersion = partsOf(source).reduce((total, part) => total + part.predicted, 0);
    cpuPerDay += perVersion * (86_400_000 / source.everyMs);
  }
  // Parts are packed into alarms of 9 ms, small ones together, so assume three quarters full;
  // with nothing due, the recorder still wakes every 8 s so that it does not hibernate.
  const alarms = Math.round(cpuPerDay / (BUDGET_MS * 0.75)) + 86_400_000 / TICK_MS;
  // Each alarm sets the next one; a buffer row every 30 s and its deletion; a state a minute.
  const rows = alarms + 2 * 2_880 + 1_440;
  return {
    name: 'plan: rows written a day',
    first: rows,
    median: rows / 1000,
    worst: 0,
    budget: 80,
    count: true,
    note: `${String(alarms)} alarms, ${(cpuPerDay / 1000).toFixed(0)} s of CPU a day (thousands of rows)`,
  };
}

/** What the free plan cannot hold, measured the same way, so the reason stays true. */
export async function leftOutRows(): Promise<Row[]> {
  const { citiBikeStatusSource } =
    await import('../../server/src/modules/data-platform/sources/bikes/citi-bike.js');
  const { fleetSources } =
    await import('../../server/src/modules/data-platform/sources/micromobility/operators.js');
  const definitions = [citiBikeStatusSource, ...fleetSources].filter((definition) =>
    leftOutSources.some((left) => left.sourceId === definition.id),
  );
  const rows: Row[] = [];
  for (const definition of definitions) {
    const body = capture(definition.id);
    const extractor = recorderExtractors.find((found) => found.sourceId === definition.id);
    if (body === undefined || extractor === undefined) continue;
    const source: RecordedSource = {
      definition,
      extractor,
      everyMs: 60_000,
      parts: 1,
      splitBy: 'entity',
      cost: { baseMs: 0, msPerKib: 0 },
    };
    const note = `${String(body.byteLength)} B, the whole alarm of one answer`;
    const row = await measure(`left out: ${definition.id}`, LIMIT_MS, note, () =>
      partWork(source, body, 0),
    );
    rows.push({ ...row, informative: true });
  }
  return rows;
}
