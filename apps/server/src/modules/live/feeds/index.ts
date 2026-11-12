import { createAircraftFeed } from './aircraft.js';
import { createAirportFeed } from './airports.js';
import { createBikeFeed } from './bikes.js';
import { createBusFeed } from './bus.js';
import type { LiveModeFeed } from './feed.js';
import { createMicromobilityFeeds } from './micromobility.js';
import { createNycFerryFeed } from './nyc-ferry.js';
import { createPathFeed } from './path.js';
import { createLirrFeed, createMetroNorthFeed } from './rail.js';
import { createShipFeed } from './ships.js';
import { createAirportShuttleFeeds, createPassioGoFeed } from './shuttles.js';
import { createSubwayFeed } from './subway.js';
import { createAmtrakFeed, createBeeLineFeed, createNyWaterwayFeed } from './untimed.js';

/**
 * Every source on the map, one feed each; feeds of the same mode are shown as one. A new source
 * is one more file here and one more line below. Each call starts with fresh motion memory.
 */
export function defaultFeeds(): LiveModeFeed[] {
  return [
    createBusFeed(),
    createBeeLineFeed(),
    createSubwayFeed(),
    createLirrFeed(),
    createMetroNorthFeed(),
    createAmtrakFeed(),
    createNycFerryFeed(),
    createNyWaterwayFeed(),
    ...createAirportShuttleFeeds(),
    createPassioGoFeed(),
    createPathFeed(),
    createAircraftFeed(),
    createShipFeed(),
    createBikeFeed(),
    ...createMicromobilityFeeds(),
    createAirportFeed(),
  ];
}
