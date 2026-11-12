import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';

import type { Database } from '../../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../../src/infrastructure/database/migrations.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import type { LeaderTerm } from '../../src/infrastructure/jobs/leadership.js';
import { createTextSanitizer } from '../../src/infrastructure/telemetry/sanitize.js';
import { createCollector } from '../../src/modules/data-platform/collector.js';
import type { SourceDefinition } from '../../src/modules/data-platform/definition.js';
import { createSourceReader } from '../../src/modules/data-platform/reader.js';
import { adsbFiSource } from '../../src/modules/data-platform/sources/air/adsb-fi.js';
import { amtrakerSource } from '../../src/modules/data-platform/sources/amtrak/amtraker.js';
import { adsbLolSource } from '../../src/modules/data-platform/sources/air/adsb-lol.js';
import { adsbRoutesSource } from '../../src/modules/data-platform/sources/air/adsb-routes.js';
import {
  citiBikeStationsSource,
  citiBikeStatusSource,
} from '../../src/modules/data-platform/sources/bikes/citi-bike.js';
import { faaAirportStatusSource } from '../../src/modules/data-platform/sources/city/faa-airport-status.js';
import { nyWaterwayRealtimeSources } from '../../src/modules/data-platform/sources/ferries/ny-waterway.js';
import { nycFerryRealtimeSources } from '../../src/modules/data-platform/sources/ferries/nyc-ferry-realtime.js';
import { fleetSources } from '../../src/modules/data-platform/sources/micromobility/operators.js';
import { busSources } from '../../src/modules/data-platform/sources/mta/bus-realtime.js';
import { gtfsStaticSources } from '../../src/modules/data-platform/sources/mta/gtfs-static.js';
import { subwaySources } from '../../src/modules/data-platform/sources/mta/subway-realtime.js';
import { pathArrivalsSource } from '../../src/modules/data-platform/sources/regional/path-arrivals.js';
import { railRealtimeSources } from '../../src/modules/data-platform/sources/regional/rail-realtime.js';
import { openWatersSource } from '../../src/modules/data-platform/sources/sea/open-waters.js';
import { airportShuttleSources } from '../../src/modules/data-platform/sources/shuttles/passio-airports.js';
import { passioRouteSource } from '../../src/modules/data-platform/sources/shuttles/passio-routes.js';
import { passioGoSource } from '../../src/modules/data-platform/sources/shuttles/passio-go.js';
import { beeLineSources } from '../../src/modules/data-platform/sources/westchester/bee-line.js';
import type { PositionEstimator } from '../../src/modules/live/estimate.js';
import { createLiveCity, type LiveCity as City } from '../../src/modules/live/city.js';
import { liveRoutes } from '../../src/modules/live/routes.js';
import { timetableSources } from '../../src/modules/live/timetable.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';
import { tempDatabase, type TempDatabase } from '../support/temp-database.js';

const FIXTURES = new URL('../../../../tests/fixtures/', import.meta.url);

/** The moment the MTA captures were taken (New York: 10/11/2026, 20:07). */
const CAPTURED_AT = '2026-11-11T01:07:00.000Z';

export function fixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(path, FIXTURES))));
}

const urlOf = (definition: SourceDefinition) =>
  definition.request({ credentials: {}, now: new Date(CAPTURED_AT) }).url;

const NAMED: readonly SourceDefinition[] = [
  ...timetableSources.lirr,
  ...timetableSources.metroNorth,
  ...timetableSources.nycFerry,
  ...timetableSources.newarkShuttle,
  ...railRealtimeSources,
  ...airportShuttleSources,
  ...fleetSources,
];

function named(id: string): SourceDefinition {
  const found = NAMED.find((definition) => definition.id === id);
  if (found === undefined) throw new Error(`No source ${id}`);
  return found;
}

const lirrTimetable = named('mta-gtfs-lirr');
const metroNorthTimetable = named('mta-gtfs-metro-north');
const nycFerryTimetable = named('nyc-ferry-gtfs');
const lirrLive = named('mta-lirr-realtime');
const metroNorthLive = named('mta-metro-north-realtime');

/** The other networks, each captured at its own time on 11/11/2026 (`tests/fixtures/`). */
const REGIONAL = new Map<SourceDefinition, string>([
  [lirrTimetable, 'regional/gtfslirr.zip'],
  [metroNorthTimetable, 'regional/gtfsmnr.zip'],
  [lirrLive, 'regional/lirr-realtime.pb'],
  [metroNorthLive, 'regional/metro-north-realtime.pb'],
  [pathArrivalsSource, 'regional/path-ridepath.json'],
  [nycFerryTimetable, 'ferries/nyc-ferry-gtfs.zip'],
  [nycFerryRealtimeSources[0], 'ferries/nyc-ferry-positions.pb'],
  [nycFerryRealtimeSources[1], 'ferries/nyc-ferry-trip-updates.pb'],
  [citiBikeStationsSource, 'bikes/citi-bike-station-information.json'],
  [citiBikeStatusSource, 'bikes/citi-bike-station-status.json'],
  [adsbLolSource, 'air/adsb-lol-new-york.json'],
  [adsbFiSource, 'air/adsb-fi-new-york.json'],
  [adsbRoutesSource, 'air/adsb-routes.csv.gz'],
  [openWatersSource, 'sea/open-waters-new-york-harbor.json'],
  [beeLineSources[1], 'westchester/bee-line-positions.pb'],
  [nyWaterwayRealtimeSources[0], 'ferries/ny-waterway-positions.pb'],
  [amtrakerSource, 'amtrak/amtraker-trains.json'],
  [named('jfk-lga-shuttle-positions'), 'shuttles/jfk-lga-shuttle-positions.pb'],
  [named('ewr-shuttle-positions'), 'shuttles/ewr-shuttle-positions.pb'],
  [named('ewr-shuttle-gtfs'), 'shuttles/ewr-shuttle-gtfs.zip'],
  [passioGoSource, 'shuttles/passio-go-buses.json'],
  [passioRouteSource, 'shuttles/passio-go-routes.json'],
  [named('lime-new-york'), 'micromobility/lime-new-york.json'],
  [named('veo-bronx'), 'micromobility/veo-bronx.json'],
  [named('veo-queens'), 'micromobility/veo-queens.json'],
  [named('bird-new-york'), 'micromobility/bird-new-york.json'],
]);

/** Every source Explore reads today, with the capture each one answers by default. */
const CAPTURES: ReadonlyMap<SourceDefinition, string> = new Map<SourceDefinition, string>([
  ...gtfsStaticSources.map((definition) => {
    return [definition, `mta${new URL(urlOf(definition)).pathname}`] as const;
  }),
  ...subwaySources.map((definition) => {
    const feed = definition.id.replace('mta-subway-', '');
    return [definition, `mta/subway-${feed}.pb`] as const;
  }),
  [busSources[0], 'mta/bus-vehicle-positions.pb'],
  [busSources[1], 'mta/bus-trip-updates.pb'],
  [faaAirportStatusSource, 'city/faa-airport-status.xml'],
  ...REGIONAL,
]);

/** The MTA and FAA sources, captured at `CAPTURED_AT`. */
export const LIVE_DEFINITIONS = [...CAPTURES.keys()].filter(
  (definition) => !REGIONAL.has(definition),
);

/** The sources of the other networks, by the name the tests use. */
export const OTHER_SOURCES = {
  lirr: [lirrTimetable, lirrLive],
  metroNorth: [metroNorthTimetable, metroNorthLive],
  path: [pathArrivalsSource],
  nycFerry: [nycFerryTimetable, ...nycFerryRealtimeSources],
  bikes: [citiBikeStationsSource, citiBikeStatusSource],
  air: [adsbLolSource, adsbFiSource, adsbRoutesSource],
  sea: [openWatersSource],
  untimed: [beeLineSources[1], nyWaterwayRealtimeSources[0], amtrakerSource],
  shuttles: [...airportShuttleSources, passioGoSource],
  micromobility: fleetSources,
} satisfies Record<string, readonly SourceDefinition[]>;

type Answer = Uint8Array | { readonly status: number };

export interface LiveCity {
  readonly db: Database;
  readonly clock: ManualClock;
  readonly app: Hono<AppBindings>;
  /** The city the routes read, to build it as the process does while nobody looks. */
  readonly live: City;
  /** Moves the clock forward to that instant. */
  moveTo(instant: string): void;
  /** Runs the admission chain for these sources, each answering its capture or the override. */
  collect(
    definitions?: readonly SourceDefinition[],
    answers?: ReadonlyMap<string, Answer>,
  ): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * A fresh database with the migrations, the real collector over captured answers and the routes,
 * drawing with the default estimator unless another is given.
 */
export async function liveCity(
  estimate?: PositionEstimator,
  start: string = CAPTURED_AT,
): Promise<LiveCity> {
  const temp: TempDatabase = await tempDatabase();
  const db = await temp.open();
  const clock = manualClock(start);
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../../migrations/', import.meta.url))),
    clock,
  );
  let answers: ReadonlyMap<string, Answer> = new Map();
  const byUrl = new Map(
    [...CAPTURES].map(([definition, file]) => [urlOf(definition), { id: definition.id, file }]),
  );
  const fetchCapture: typeof fetch = (input) => {
    const found = byUrl.get(input instanceof Request ? input.url : input.toString());
    if (found === undefined) return Promise.resolve(new Response('not found', { status: 404 }));
    const answer = answers.get(found.id) ?? fixture(found.file);
    if (!(answer instanceof Uint8Array)) {
      return Promise.resolve(new Response('unavailable', { status: answer.status }));
    }
    return Promise.resolve(new Response(new Uint8Array(answer), { status: 200 }));
  };
  const collector = createCollector({
    db,
    http: createHttpClient({ fetch: fetchCapture }),
    clock,
    logger: memoryLogger().logger,
    credentials: () => ({ missing: [], values: {} }),
    sanitize: createTextSanitizer([]),
  });
  const term: LeaderTerm = {
    name: 'worker',
    holder: 'test',
    fencingToken: 1,
    signal: new AbortController().signal,
    fenced: (work) => db.transaction(work),
  };
  const live = createLiveCity({
    reader: createSourceReader({ db, clock, missingVariables: () => [] }),
    clock,
    ...(estimate === undefined ? {} : { estimate }),
  });
  const app = new Hono<AppBindings>();
  app.use(requestContext(memoryLogger().logger));
  app.route('/api/live', liveRoutes({ db, clock, city: live }));
  return {
    db,
    clock,
    app,
    live,
    moveTo(instant) {
      clock.advance(Date.parse(instant) - clock.now().getTime());
    },
    async collect(definitions = LIVE_DEFINITIONS, override = new Map()) {
      answers = override;
      for (const definition of definitions) {
        await collector(definition, term, {
          trigger: 'schedule',
          requestedBy: null,
          reason: null,
        });
      }
    },
    dispose: () => temp.dispose(),
  };
}
