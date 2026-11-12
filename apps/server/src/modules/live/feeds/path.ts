import { toInstant, type LiveStation } from '@moviq/contracts';

import {
  pathArrivalsSource,
  type PathArrivals,
} from '../../data-platform/sources/regional/path-arrivals.js';
import { liveSource } from '../sources.js';
import { createTally, type LiveModeFeed } from './feed.js';

type Station = PathArrivals['stations'][number];

/** An arrival this long past may still be at the platform; earlier ones have left. */
const JUST_PASSED_MS = 30_000;

/**
 * A station with the trains still to come, soonest first, as RidePATH announces them. Its time
 * is the newest update of its own arrivals or, with none listed, that of the whole answer.
 */
function stationOf(
  station: Station,
  answeredAt: string,
  now: Date,
): Extract<LiveStation, { mode: 'rail-station' }> {
  const from = now.getTime() - JUST_PASSED_MS;
  const arrivals = station.arrivals
    .filter((arrival) => Date.parse(arrival.arrival) >= from)
    .sort((a, b) => Date.parse(a.arrival) - Date.parse(b.arrival))
    .map(({ headsign, arrival, updatedAt }) => ({ headsign, arrival, updatedAt }));
  const updates = station.arrivals.map((arrival) => Date.parse(arrival.updatedAt));
  return {
    mode: 'rail-station',
    id: `rail-station:path:${station.code}`,
    sourceId: pathArrivalsSource.id,
    network: 'PATH',
    name: station.name,
    lat: station.latitude,
    lon: station.longitude,
    arrivals,
    updatedAt: updates.length === 0 ? answeredAt : toInstant(new Date(Math.max(...updates))),
  };
}

/**
 * PATH by station: RidePATH says when the next trains reach each of the thirteen stations, not
 * where they are, so PATH is shown as its stations with their next arrivals, never as trains.
 */
export function createPathFeed(): LiveModeFeed {
  return {
    mode: 'rail-station',
    interestSourceIds: [pathArrivalsSource.id],
    async read(context) {
      const reading = await context.reader.read(pathArrivalsSource);
      const { data } = reading;
      return {
        vehicles: [],
        stations:
          data === undefined
            ? []
            : data.stations.map((station) => stationOf(station, data.updatedAt, context.now)),
        excluded: createTally().counts,
        sources: [liveSource(pathArrivalsSource, reading)],
        liveSourceIds: [pathArrivalsSource.id],
      };
    },
  };
}
