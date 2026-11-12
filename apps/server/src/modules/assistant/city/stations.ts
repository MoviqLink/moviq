import type { SourceReader } from '../../data-platform/reader.js';
import type { SubwayStations } from '../../data-platform/sources/accessibility/subway-stations.js';
import { subwaySources } from '../../data-platform/sources/mta/subway-realtime.js';
import { routeOf } from './lines.js';

type Station = SubwayStations['stations'][string];

export interface NamedStation {
  readonly id: string;
  readonly station: Station;
}

/** At most this many stations of the same name are listed for the traveller to choose. */
export const MAX_STATIONS = 4;

/** "59th Street" and "59 St" are one name; "Lexington Av/59 St" holds it. */
export function simplifyName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/(\d+)(?:st|nd|rd|th)\b/g, '$1')
    .replace(/\bstreet\b|\bcalle\b/g, 'st')
    .replace(/\bavenue\b|\bave\b|\bavenida\b/g, 'av')
    .replace(/\bstation\b|\bestaci[oó]n( de)?\b/g, '')
    .replace(/[^\p{L}\d]+/gu, ' ')
    .trim();
}

/**
 * The stations named as the traveller said, exact names first; a line said with the name ("59 St
 * on the N") keeps the stations it stops at.
 */
export function stationsNamed(
  stations: SubwayStations,
  said: string,
  linesAt: ReadonlyMap<string, readonly string[]>,
): NamedStation[] {
  const { name, line } = splitLine(said);
  const wanted = simplifyName(name);
  if (wanted === '') return [];
  const all = Object.entries(stations.stations).map(([id, station]) => ({ id, station }));
  const exact = all.filter(({ station }) => simplifyName(station.name) === wanted);
  const words = new RegExp(`(?:^| )${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`);
  const found =
    exact.length > 0 ? exact : all.filter(({ station }) => words.test(simplifyName(station.name)));
  const onLine =
    line === undefined ? found : found.filter(({ id }) => linesAt.get(id)?.includes(line));
  return onLine.length > 0 ? onLine : found;
}

/** "59 St on the N", "59 St (4 5 6)", "59 St de la N" → the name and the line. */
function splitLine(said: string): { readonly name: string; readonly line: string | undefined } {
  const match =
    /^(.+?)\s*(?:\(([^)]+)\)|\s(?:on|of|de|del)\s+(?:the|la|el|line|l[ií]nea)?\s*(\S+))$/i.exec(
      said.trim(),
    );
  const named = match?.[2]?.split(/\s+/)[0] ?? match?.[3];
  const route = named === undefined ? undefined : routeOf(named);
  if (match === null || route?.mode !== 'subway') return { name: said, line: undefined };
  return { name: match[1] ?? said, line: route.ids[0] };
}

/**
 * The routes with trains due at each station in the MTA live feeds now, by GTFS station id: the
 * stations list names no lines. A feed that cannot be read adds none.
 */
export async function linesAtStations(
  reader: SourceReader,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const readings = await Promise.all(subwaySources.map((definition) => reader.read(definition)));
  const lines = new Map<string, Set<string>>();
  for (const trip of readings.flatMap((reading) => reading.data?.trips ?? [])) {
    for (const stop of trip.stops) {
      const station = stop.stopId.replace(/[NS]$/, '');
      const known = lines.get(station) ?? new Set<string>();
      known.add(trip.routeId);
      lines.set(station, known);
    }
  }
  return new Map([...lines].map(([station, routes]) => [station, [...routes].sort(byLine)]));
}

/** Numbers first, then letters, as the MTA lists lines. */
const byLine = (a: string, b: string): number =>
  a.length - b.length || a.localeCompare(b, 'en', { numeric: true });
