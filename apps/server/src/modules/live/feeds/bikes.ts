import type { ExclusionReason, LiveStation } from '@moviq/contracts';

import {
  citiBikeStationsSource,
  citiBikeStatusSource,
  type CitiBikeStations,
  type CitiBikeStatus,
} from '../../data-platform/sources/bikes/citi-bike.js';
import { liveSource } from '../sources.js';
import { createTally, type LiveModeFeed } from './feed.js';
import { readSlowly } from './slow-read.js';

type Place = CitiBikeStations['stations'][number];
type Status = CitiBikeStatus['stations'][number];

/** A station with its bikes and free docks, or why it is left out. */
function stationOf(
  status: Status,
  place: Place | undefined,
  now: Date,
): Extract<LiveStation, { mode: 'bike-station' }> | ExclusionReason {
  if (!status.installed) return 'not-in-service';
  if (place === undefined) return 'no-position';
  const reportedAt = status.reportedAt;
  const age = reportedAt === null ? Infinity : now.getTime() - Date.parse(reportedAt);
  if (reportedAt === null || age > citiBikeStatusSource.freshness.staleAfterMs) {
    return 'stale-position';
  }
  return {
    mode: 'bike-station',
    id: `bike-station:${status.stationId}`,
    sourceId: citiBikeStatusSource.id,
    name: place.name,
    lat: place.latitude,
    lon: place.longitude,
    bikes: status.bikes,
    ebikes: status.ebikes,
    docks: status.docks,
    renting: status.renting,
    returning: status.returning,
    reportedAt,
  };
}

/**
 * Bike share stations of New York with their bikes, e-bikes and free docks: the status every
 * minute or two, joined to where each station is, which changes a few times a month and is read
 * at most once a minute. A station not reported for 15 minutes is left out.
 */
export function createBikeFeed(): LiveModeFeed {
  const readPlaces = readSlowly(citiBikeStationsSource);
  return {
    mode: 'bike-station',
    interestSourceIds: [citiBikeStatusSource.id],
    async read(context) {
      const [places, status] = await Promise.all([
        readPlaces(context.reader, context.now),
        context.reader.read(citiBikeStatusSource),
      ]);
      const byId = new Map((places.data?.stations ?? []).map((place) => [place.stationId, place]));
      const tally = createTally();
      const stations: LiveStation[] = [];
      for (const row of status.data?.stations ?? []) {
        const shown = stationOf(row, byId.get(row.stationId), context.now);
        if (typeof shown === 'string') tally.add(shown);
        else stations.push(shown);
      }
      return {
        vehicles: [],
        stations,
        excluded: tally.counts,
        // The licence allows the data in a product but not the Citi Bike marks, so the sources
        // are cited by what they hold, with the attribution the licence asks for.
        sources: [
          {
            ...liveSource(citiBikeStatusSource, status),
            title: 'Bike share station status (GBFS)',
          },
          { ...liveSource(citiBikeStationsSource, places), title: 'Bike share stations (GBFS)' },
        ],
        liveSourceIds: [citiBikeStatusSource.id],
      };
    },
  };
}
