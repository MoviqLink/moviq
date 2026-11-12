import { CITY_NOW, minutesAfter } from './city-doubles.js';

/** Hand-written copies of the sources the city tools read, shaped by each source's schema. */

const at = (minutes: number) => new Date(Date.parse(CITY_NOW) + minutes * 60_000).toISOString();

/** One A alert in force since 6:00 am, and planned work on the A next week. */
export function mtaAlertsData() {
  return {
    feedTime: at(-1),
    leftOut: 0,
    alerts: [
      {
        id: 'lmm:alert:1',
        activePeriods: [{ start: at(-60), end: null }],
        affected: [
          { agencyId: 'MTASBWY', routeId: 'A', stopId: null, tripId: null },
          { agencyId: 'MTASBWY', routeId: 'C', stopId: null, tripId: null },
        ],
        cause: null,
        effect: null,
        header: '[A][C] trains are running with delays in both directions.',
        description: 'We are fixing a signal problem at 59 St-Columbus Circle.',
      },
      {
        id: 'lmm:planned_work:2',
        activePeriods: [{ start: at(6 * 24 * 60), end: at(6 * 24 * 60 + 480) }],
        affected: [{ agencyId: 'MTASBWY', routeId: 'A', stopId: 'A24', tripId: null }],
        cause: null,
        effect: null,
        header: 'Overnight, [A] trains skip 59 St-Columbus Circle.',
        description: null,
      },
      {
        id: 'lmm:alert:3',
        activePeriods: [],
        affected: [{ agencyId: 'MTA NYCT', routeId: 'M15', stopId: null, tripId: null }],
        cause: null,
        effect: null,
        header: 'Southbound M15 buses are detoured at E 23 St.',
        description: null,
      },
    ],
  };
}

/** Two A trips: one running to 50 St, one the MTA lists as cancelled. */
export function aceFeedData() {
  return {
    feedTime: at(-0.5),
    leftOut: 0,
    trips: [
      {
        tripId: 'A-1',
        routeId: 'A',
        direction: 'south',
        startDate: '20261111',
        startTime: null,
        cancelled: false,
        stops: [{ stopId: 'A25S', sequence: null, arrival: minutesAfter(2), departure: null }],
        train: { stopId: 'A24S', status: 'incoming', observedAt: at(-0.5) },
      },
      {
        tripId: 'A-2',
        routeId: 'A',
        direction: 'north',
        startDate: '20261111',
        startTime: null,
        cancelled: true,
        stops: [],
        train: null,
      },
    ],
  };
}

const trip = (tripId: string, routeId: string, stopId: string) => ({
  tripId,
  routeId,
  direction: 'south',
  startDate: '20261111',
  startTime: null,
  cancelled: false,
  stops: [{ stopId, sequence: null, arrival: minutesAfter(4), departure: null }],
  train: null,
});

export const lexFeedData = () => ({
  feedTime: at(-0.5),
  leftOut: 0,
  trips: [trip('4-1', '4', '629S')],
});
export const nqrwFeedData = () => ({
  feedTime: at(-0.5),
  leftOut: 0,
  trips: [trip('R-1', 'R', 'R41N')],
});

const station = (
  name: string,
  complex: string,
  ada: 'full' | 'partial' | 'none',
  note: string | null = null,
) => ({
  name,
  complex,
  ada,
  northbound: ada !== 'none',
  southbound: ada === 'full',
  note,
});

/** Two stations named 59 St (Lexington Av and Brooklyn) and 59 St-Columbus Circle. */
export function stationsData() {
  return {
    readAt: at(-60),
    stations: {
      '629': station('59 St', '613', 'full'),
      R41: station('59 St', '35', 'none'),
      A24: station('59 St-Columbus Circle', '614', 'partial', 'Uptown only'),
      A25: station('50 St', '164', 'none'),
    },
  };
}

/** An elevator out now at 59 St (4 5 6) and an escalator announced at 59 St in Brooklyn. */
export function outagesData() {
  return {
    readAt: at(-1),
    outages: [
      {
        equipmentId: 'EL123',
        kind: 'elevator',
        station: '59 St',
        lines: ['4', '5', '6'],
        serving: 'Street to mezzanine for service in both directions',
        ada: true,
        reason: 'Repair',
        since: at(-120),
        estimatedReturn: at(9 * 60),
        upcoming: false,
        maintenance: false,
      },
      {
        equipmentId: 'ES900',
        kind: 'escalator',
        station: '59 St',
        lines: ['N', 'R'],
        serving: 'Mezzanine to Bay Ridge-bound platform',
        ada: false,
        reason: 'Capital replacement',
        since: at(24 * 60),
        estimatedReturn: null,
        upcoming: true,
        maintenance: true,
      },
    ],
  };
}

export function equipmentData() {
  return {
    readAt: at(-60),
    equipment: {
      EL123: { kind: 'elevator', ada: true, active: true, redundant: false, stations: ['629'] },
      ES900: { kind: 'escalator', ada: false, active: true, redundant: false, stations: ['R41'] },
    },
  };
}

/** An open PATH incident on HOB-WTC and one already closed. */
export function pathAlertsData() {
  return {
    readAt: at(-1),
    leftOut: 0,
    alerts: [
      {
        id: '11',
        incidentId: '900',
        kind: 'Mechanical Problem',
        subject: 'HOB-WTC delayed',
        text: 'HOB-WTC trains are delayed due to a mechanical problem at Exchange Place.',
        sentAt: at(-15),
        state: 'open',
        linesNamed: ['HOB-WTC'],
      },
      {
        id: '10',
        incidentId: '899',
        kind: null,
        subject: 'JSQ-33 resumed',
        text: 'JSQ-33 service has resumed.',
        sentAt: at(-90),
        state: 'closed',
        linesNamed: ['JSQ-33'],
      },
    ],
  };
}

export const ferryAlertsData = (header: string | null) => ({
  feedTime: at(-1),
  leftOut: 0,
  alerts:
    header === null
      ? []
      : [
          {
            id: 'f1',
            activePeriods: [],
            affected: [{ agencyId: null, routeId: 'ER', stopId: null, tripId: null }],
            cause: null,
            effect: null,
            header,
            description: null,
          },
        ],
});

/** A weekday measured by the recorder: the 7 northbound in the morning peak, 63 intervals. */
export function recorderStatsData() {
  const started = Date.parse('2026-11-10T12:30:00.000Z') / 1000;
  return {
    version: 'moviq-recorder-stats/1',
    day: '2026-11-10',
    dayType: 'weekday',
    generatedAt: '2026-11-11T09:10:00.000Z',
    complete: true,
    coverage: [],
    counts: {
      events: 1,
      trajectories: 1,
      segmentRuns: 1,
      predictionsJudged: 0,
      predictionsUnmatched: 0,
    },
    segments: [],
    headways: [
      ['subway', '7', 'N', 'am-peak', 63, 240, 540, 15_120, 4_000_000, 5],
      ['subway', '7', 'S', 'am-peak', 4, 300, 600, 1_200, 400_000, 0],
    ],
    predictions: [],
    stoppages: [['subway', '7', 't-1', null, started, started + 600, 600, 'p95']],
    incidents: [],
  };
}
