import type { Capture, CaptureRoutes } from './provider-server.js';

const MTA_FEEDS = 'api-endpoint.mta.info/Dataservice/mtagtfsfeeds';
const MTA_TIMETABLES = 'rrgtfsfeeds.s3.amazonaws.com';
const SUBWAY_FEEDS = ['ace', 'bdfm', 'g', 'jz', 'nqrw', 'l'] as const;
const BUS_TIMETABLES = ['b', 'bx', 'm', 'q', 'si', 'busco'] as const;

/** A live GTFS Realtime capture, its times moved so that its header falls on the test's now. */
const live = (file: string): readonly Capture[] => [{ file, times: { format: 'gtfs-realtime' } }];
const whole = (file: string): readonly Capture[] => [{ file }];
/**
 * A timetable captured for the service of 10/11/2026 (the MTA files keep only the trips of that
 * day, `tests/fixtures/mta/`): its dates move so that day is the day it is asked on, a holiday or
 * a weekend included.
 */
const timetable = (file: string): readonly Capture[] => [
  { file, times: { format: 'gtfs-static', serviceDay: '20261110' } },
];

/**
 * The journey of `journey.spec.ts`, captured in one go on 11/11/2026 (`tests/fixtures/journey/`):
 * from Parkchester, in the Bronx, to 89 East 42nd Street by 03:17 in New York, on the 6. Its
 * captures share one instant, the header of its subway feed, so the plan and the trains move
 * together.
 */
export const JOURNEY = {
  capturedAt: '2026-11-11T07:01:41Z',
  arriveBy: '2026-11-11T08:17:00Z',
  origin: '1 Hugh J Grant Circle',
  destination: '89 East 42nd Street Manhattan',
  subwayFeed: `${MTA_FEEDS}/nyct%2Fgtfs`,
} as const;

const TRANSITOUS_PLAN = 'api.transitous.org/api/v6/plan';
const PLACES = { fromPlace: '40.833352,-73.861008', toPlace: '40.752732,-73.977218' } as const;
const TRANSIT_MODES =
  'SUBWAY,BUS,COACH,REGIONAL_RAIL,SUBURBAN,LONG_DISTANCE,HIGHSPEED_RAIL,NIGHT_RAIL,FERRY';
const journeyTimes = { format: 'json', capturedAt: JOURNEY.capturedAt } as const;

/** Transitous answers by the query: the plan (5 min before the deadline), alternatives, taxi. */
const transitous: readonly Capture[] = [
  {
    file: 'journey/transitous-plan.json',
    times: journeyTimes,
    query: { ...PLACES, time: '2026-11-11T08:12:00Z', transitModes: TRANSIT_MODES },
  },
  {
    file: 'journey/transitous-alternatives.json',
    times: journeyTimes,
    query: { ...PLACES, time: JOURNEY.arriveBy, transitModes: TRANSIT_MODES },
  },
  {
    file: 'journey/transitous-taxi.json',
    times: journeyTimes,
    query: { ...PLACES, time: JOURNEY.arriveBy, transitModes: '', directModes: 'CAR' },
  },
];

/** GeoSearch answers by the text searched. */
const geosearch: readonly Capture[] = [
  { file: 'journey/geosearch-1-hugh-j-grant-circle.json', query: { text: JOURNEY.origin } },
  {
    file: 'journey/geosearch-89-east-42nd-street-manhattan.json',
    query: { text: JOURNEY.destination },
  },
];

/**
 * The captures that answer each provider endpoint during end-to-end runs, by `host/path`, tried
 * in order against the query. Files are relative to `tests/fixtures/`.
 */
export const captureRoutes: CaptureRoutes = {
  [`${MTA_TIMETABLES}/gtfs_subway.zip`]: timetable('mta/gtfs_subway.zip'),
  ...Object.fromEntries(
    BUS_TIMETABLES.map((code) => [
      `${MTA_TIMETABLES}/gtfs_${code}.zip`,
      timetable(`mta/gtfs_${code}.zip`),
    ]),
  ),
  ...Object.fromEntries(
    SUBWAY_FEEDS.map((feed) => [`${MTA_FEEDS}/nyct%2Fgtfs-${feed}`, live(`mta/subway-${feed}.pb`)]),
  ),
  [JOURNEY.subwayFeed]: live('journey/subway-1234567.pb'),
  [`${MTA_FEEDS}/nyct%2Fgtfs-si`]: live('mta/subway-sir.pb'),
  [`${MTA_FEEDS}/camsys%2Fall-alerts`]: live('mta/alerts.pb'),
  [`${MTA_FEEDS}/nyct%2Fnyct_ene.json`]: whole('mta/elevators.json'),
  'gtfsrt.prod.obanyc.com/vehiclePositions': live('mta/bus-vehicle-positions.pb'),
  'gtfsrt.prod.obanyc.com/tripUpdates': live('mta/bus-trip-updates.pb'),
  // The Bee-Line of Westchester is shown with the buses, so the bus mode is live only with it.
  'westchester.gmv.com/gtfsrtapi/api/vehiclepositions': live('westchester/bee-line-positions.pb'),
  'westchester-win.gmv.com:8443/repository/gtfs-public/GTFS_GMV_WCDOT.zip': timetable(
    'westchester/bee-line-gtfs.zip',
  ),
  'nasstatus.faa.gov/api/airport-status-information': whole('city/faa-airport-status.xml'),
  'data.cityofnewyork.us/resource/i4gi-tjb9.json': whole('city/nyc-dot-traffic-speeds.json'),
  'api.weather.gov/alerts/active': whole('city/nws-alerts-new-york.geojson'),
  'api.weather.gov/gridpoints/OKX/34,44/forecast/hourly': whole('city/nws-hourly-forecast.geojson'),
  [TRANSITOUS_PLAN]: transitous,
  'geosearch.planninglabs.nyc/v2/search': geosearch,
};
