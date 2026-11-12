import {
  toInstant,
  type AirportBoard,
  type AirportCode,
  type BoardDirection,
} from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { AirportBoards, BoardReading } from '../data-platform/on-demand/airport-boards.js';
import type { SourceReader, SourceReading } from '../data-platform/reader.js';
import { adsbFiSource } from '../data-platform/sources/air/adsb-fi.js';
import { adsbLolSource } from '../data-platform/sources/air/adsb-lol.js';
import { adsbRoutesSource } from '../data-platform/sources/air/adsb-routes.js';
import type { AirTraffic } from '../data-platform/sources/air/aircraft.js';
import { faaAirportStatusSource } from '../data-platform/sources/city/faa-airport-status.js';
import { readSlowly } from '../live/feeds/slow-read.js';
import { AIRPORTS } from './airports.js';
import { matchBoard, type LiveTraffic } from './match.js';

/** The mention AeroDataBox's free plan requires wherever its data is shown. */
export const AERODATABOX_ATTRIBUTION = 'Flight data by AeroDataBox';

export interface AirportBoardService {
  /** The board of one airport and direction, with ADS-B now and the FAA's status. */
  board(code: AirportCode, direction: BoardDirection): Promise<AirportBoard>;
}

interface AirportBoardDependencies {
  readonly boards: AirportBoards;
  readonly reader: SourceReader;
  readonly clock: Clock;
}

export function createAirportBoardService(deps: AirportBoardDependencies): AirportBoardService {
  const readRoutes = readSlowly(adsbRoutesSource);
  return {
    async board(code, direction) {
      const [reading, lol, fi, routes, faa] = await Promise.all([
        deps.boards.read(code),
        deps.reader.read(adsbLolSource),
        deps.reader.read(adsbFiSource),
        readRoutes(deps.reader, deps.clock.now()),
        deps.reader.read(faaAirportStatusSource),
      ]);
      const now = deps.clock.now();
      const airport = AIRPORTS[code];
      const traffic = liveTraffic(lol, fi, routes, now);
      const matched = matchBoard({ airport, direction, board: reading.snapshot, traffic, now });
      return {
        airport: { code, icao: airport.icao, name: airport.name },
        direction,
        generatedAt: toInstant(now),
        snapshot: snapshotOf(reading),
        flights: matched.flights,
        aircraft: {
          unmatched: matched.unmatched,
          sources: [lol.provenance, fi.provenance, routes.provenance],
        },
        faa: {
          programs:
            faa.data === undefined
              ? null
              : (faa.data.airports.find((entry) => entry.code === code)?.programs ?? []),
          provenance: faa.provenance,
        },
        attribution: [
          AERODATABOX_ATTRIBUTION,
          traffic.positions.sourceId === adsbFiSource.id
            ? adsbFiSource.licence.attribution
            : adsbLolSource.licence.attribution,
          adsbRoutesSource.licence.attribution,
          faaAirportStatusSource.licence.attribution,
        ],
      };
    },
  };
}

function snapshotOf(reading: BoardReading): AirportBoard['snapshot'] {
  const { snapshot } = reading;
  return {
    state: reading.state,
    takenAt: snapshot === null ? null : toInstant(snapshot.takenAt),
    window:
      snapshot === null
        ? null
        : { from: toInstant(snapshot.window.from), to: toInstant(snapshot.window.to) },
    nextRefreshAt: reading.nextRefreshAt === null ? null : toInstant(reading.nextRefreshAt),
    provenance: reading.provenance,
  };
}

/**
 * adsb.lol while it has something current to serve, adsb.fi standing in otherwise; only the
 * positions newer than the provider's degraded limit are taken as where an aircraft is now.
 */
function liveTraffic(
  lol: SourceReading<AirTraffic>,
  fi: SourceReading<AirTraffic>,
  routes: SourceReading<{ readonly routes: Readonly<Record<string, readonly string[]>> }>,
  now: Date,
): LiveTraffic {
  const useLol = lol.data !== undefined && lol.provenance.state !== 'stale';
  const serving = useLol || fi.data === undefined ? lol : fi;
  const source = serving === lol ? adsbLolSource : adsbFiSource;
  const aircraft = (serving.data?.aircraft ?? []).filter(
    (plane) => now.getTime() - Date.parse(plane.observedAt) <= source.freshness.degradedAfterMs,
  );
  return {
    aircraft,
    positions: serving.provenance,
    routes: routes.data?.routes ?? {},
    routesSourceId: adsbRoutesSource.id,
  };
}
