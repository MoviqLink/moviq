import { roadSegmentsSchema } from '@moviq/contracts';
import type { SourceReader } from '../data-platform/reader.js';
import { nycDotTrafficSpeedsSource } from '../data-platform/sources/city/nyc-dot-traffic-speeds.js';
import { current, sourceOf } from '../assistant/city/ports.js';

const MAX_AGE_MS = 15 * 60_000;
export function recentMeasurement(measuredAt: string, now: Date): boolean {
  const age = now.getTime() - Date.parse(measuredAt);
  return Number.isFinite(age) && age >= -120_000 && age <= MAX_AGE_MS;
}
export async function readRoads(reader: SourceReader, now: Date, query: string) {
  const reading = await reader.read(nycDotTrafficSpeedsSource);
  const available = current(reading);
  const search = query.trim().toLocaleLowerCase();
  const segments =
    !available || search.length < 2
      ? []
      : (reading.data?.segments ?? [])
          .filter(
            (segment) =>
              segment.name !== null &&
              recentMeasurement(segment.measuredAt, now) &&
              `${segment.name} ${segment.borough ?? ''}`.toLocaleLowerCase().includes(search),
          )
          .slice(0, 50)
          .map((segment) => ({
            id: segment.id,
            name: segment.name ?? segment.id,
            borough: segment.borough,
            measuredAt: segment.measuredAt,
          }));
  return roadSegmentsSchema.parse({
    available,
    source: sourceOf(nycDotTrafficSpeedsSource, reading),
    segments,
  });
}
export async function findRoad(reader: SourceReader, now: Date, id: string) {
  const reading = await reader.read(nycDotTrafficSpeedsSource);
  if (!current(reading)) return undefined;
  const segment = reading.data?.segments.find(
    (item) => item.id === id && item.name !== null && recentMeasurement(item.measuredAt, now),
  );
  return segment;
}
