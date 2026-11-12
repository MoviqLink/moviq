import type { LiveLine, LiveLineKey, LiveVehicle } from '@moviq/contracts';
import type { SourceReader } from '../data-platform/reader.js';
import { passioRouteSource } from '../data-platform/sources/shuttles/passio-routes.js';
import type { GtfsRoute } from '../data-platform/sources/mta/gtfs-static-schema.js';
import type { Timetables } from './timetable.js';

const subwaySources: Readonly<Record<string, string>> = Object.fromEntries(
  (
    [
      ['ace', ['A', 'C', 'E', 'H']],
      ['bdfm', ['B', 'D', 'F', 'FX', 'M', 'FS']],
      ['g', ['G']],
      ['jz', ['J', 'Z']],
      ['nqrw', ['N', 'Q', 'R', 'W']],
      ['l', ['L']],
      ['1234567', ['1', '2', '3', '4', '5', '6', '6X', '7', '7X', 'GS']],
      ['sir', ['SI']],
    ] as const
  ).flatMap(([feed, ids]) => ids.map((id) => [id, `mta-subway-${feed}`])),
);

export function lineKey(key: LiveLineKey): string {
  return JSON.stringify([key.mode, key.sourceId, key.lineId]);
}

function addStatic(map: Map<string, LiveLine>, tables: Timetables): void {
  const networks = [
    ['bus', 'mta-bus-positions', tables.bus],
    ['rail', 'mta-lirr-realtime', tables.lirr],
    ['rail', 'mta-metro-north-realtime', tables.metroNorth],
    ['ferry', 'nyc-ferry-positions', tables.nycFerry],
    ['shuttle', 'ewr-shuttle-positions', tables.newarkShuttle],
  ] as const;
  for (const [mode, sourceId, table] of networks) {
    for (const [lineId, route] of table.routes?.() ?? [])
      add(map, { mode, sourceId, lineId }, route);
  }
  for (const [lineId, route] of tables.subway.routes?.() ?? []) {
    const sourceId = subwaySources[lineId];
    if (sourceId !== undefined) add(map, { mode: 'subway', sourceId, lineId }, route);
  }
}

function add(map: Map<string, LiveLine>, key: LiveLineKey, route: GtfsRoute): void {
  map.set(lineKey(key), {
    ...key,
    name: route.shortName ?? route.longName ?? key.lineId,
    longName: route.longName,
    vehicleCount: 0,
  });
}

/** Published lines and active lines, each with its own operator source. */
export async function lineDirectory(
  vehicles: readonly LiveVehicle[],
  tables: Timetables,
  reader: SourceReader,
): Promise<LiveLine[]> {
  const result = new Map<string, LiveLine>();
  addStatic(result, tables);
  const passio = await reader.read(passioRouteSource);
  for (const [lineId, route] of Object.entries(passio.data ?? {})) {
    const key: LiveLineKey = { mode: 'shuttle', sourceId: 'passio-go-shuttles', lineId };
    result.set(lineKey(key), {
      ...key,
      name: typeof route === 'string' ? lineId : route.name,
      longName: null,
      vehicleCount: 0,
    });
  }
  for (const vehicle of vehicles) {
    if (vehicle.line === null) continue;
    const key = { mode: vehicle.mode, sourceId: vehicle.sourceId, lineId: vehicle.line.id };
    const id = lineKey(key);
    const current = result.get(id);
    result.set(
      id,
      current === undefined
        ? { ...key, name: vehicle.line.name, longName: vehicle.line.longName, vehicleCount: 1 }
        : {
            ...current,
            name: current.name === current.lineId ? vehicle.line.name : current.name,
            vehicleCount: current.vehicleCount + 1,
          },
    );
  }
  return [...result.values()].sort(
    (a, b) =>
      a.mode.localeCompare(b.mode) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }) ||
      a.sourceId.localeCompare(b.sourceId),
  );
}
