import type { LiveLineKey, LiveMode, LiveVehicle } from '@moviq/contracts';

export const OTHER_MODES: readonly LiveMode[] = [
  'aircraft',
  'ship',
  'bike-station',
  'rail-station',
  'micromobility',
  'airport',
];

/** A source is part of the identity: two providers may use the same line number. */
export const lineKey = (line: LiveLineKey): string =>
  JSON.stringify([line.mode, line.sourceId, line.lineId]);

export function matchesLine(vehicle: LiveVehicle, selected: readonly LiveLineKey[]): boolean {
  return (
    vehicle.line !== null &&
    selected.some(
      (line) =>
        line.mode === vehicle.mode &&
        line.sourceId === vehicle.sourceId &&
        line.lineId === vehicle.line?.id,
    )
  );
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();

/** Exact line name first, followed by name prefix, substring and description. */
export function searchRank(name: string, longName: string | null, query: string): number {
  const q = fold(query.trim());
  const n = fold(name);
  if (q === '') return 0;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return fold(longName ?? '').includes(q) ? 3 : 4;
}
export const matchesSearch = (name: string, longName: string | null, query: string) =>
  searchRank(name, longName, query) < 4;
