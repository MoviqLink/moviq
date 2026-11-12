import { gtfsStaticSources } from '../../../src/modules/data-platform/sources/mta/gtfs-static.js';
import type { TimetableInput } from '../../../src/modules/journeys/engine/inputs.js';
import { timetableInput } from '../../../src/modules/journeys/engine/timetable-input.js';

/**
 * A real GTFS archive read into what the engine takes, exactly as in production: the GTFS index
 * the data platform builds and stores, with its stop times and transfers, then decoded.
 */
export function timetableFromGtfs(
  sourceId: string,
  body: Uint8Array,
  receivedAt: Date,
): TimetableInput {
  const definition = gtfsStaticSources.find((source) => source.id === sourceId);
  if (definition === undefined) throw new Error(`no GTFS source ${sourceId}`);
  const index = definition.parse(body, { receivedAt, previous: undefined });
  if (!index.ok) throw new Error(`${index.code}: ${index.detail}`);
  const stored = definition.dataSchema.parse(JSON.parse(JSON.stringify(index.data)));
  const input = timetableInput(stored);
  if (!input.ok) throw new Error(input.detail);
  return input.timetable;
}
