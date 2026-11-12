import type { Journey, Provenance } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { toItinerary } from '../src/modules/journeys/itineraries.js';
import type { RoutedItinerary } from '../src/modules/journeys/ports.js';
import {
  assessJourney,
  type LiveData,
  type PredictedTrip,
} from '../src/modules/journeys/watch-assess.js';
import { planRequest, ROUTING_PROVENANCE, subwayTrip } from './support/journeys.js';

const NOW = new Date('2026-11-11T18:20:00.000Z');
const LIVE: Provenance = {
  ...ROUTING_PROVENANCE,
  sourceId: 'mta-subway-ace',
  evidence: 'Data is 20 s old.',
};
const DOWN: Provenance = {
  ...LIVE,
  state: 'unavailable',
  evidence: 'No usable data yet: timeout.',
};

function journeyOf(routed: RoutedItinerary, arriveBy = '2026-11-11T19:00:00.000Z'): Journey {
  return {
    id: 'j1',
    state: 'watching',
    request: planRequest(arriveBy),
    itinerary: toItinerary(routed, ROUTING_PROVENANCE, new Date(arriveBy), { fareFor: () => null }),
    createdAt: '2026-11-11T18:00:00.000Z',
    watch: {
      status: 'unknown',
      evaluatedAt: null,
      projectedArriveAt: null,
      evidence: 'Not checked yet.',
      flight: null,
      stepFreeRefusal: null,
    },
    incidents: [],
    alternatives: [],
  };
}

/** The A train predicted at 42 St (`A27S` platform) at the given time. */
function aTrain(arrival: string): PredictedTrip {
  return { tripId: 'live-1', routeId: 'A', stops: [{ stopId: 'A27S', arrival, departure: null }] };
}

function live(
  trips: readonly PredictedTrip[] | 'down',
  alerts: LiveData['alerts']['data'] = { alerts: [] },
): LiveData {
  return {
    predictions: [
      trips === 'down'
        ? { data: undefined, provenance: DOWN }
        : { data: { trips }, provenance: LIVE },
    ],
    alerts: { data: alerts, provenance: { ...LIVE, sourceId: 'mta-alerts' } },
  };
}

// The A leaves 125 St at 18:15 and reaches 42 St at 18:45; a 5 min walk; arrival 18:50, 10 min to spare.
const journey = journeyOf(subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:50:00.000Z'));

describe('assessJourney', () => {
  it('is on track when the live train keeps the plan', () => {
    const result = assessJourney(journey, live([aTrain('2026-11-11T18:45:00.000Z')]), NOW);
    expect(result).toMatchObject({ status: 'on-track', needsAlternatives: false, incidents: [] });
    expect(result.evidence).toBe('On track: arriving about 13:50, 10 min to spare.');
  });

  it('is at risk with a delay that eats the spare time, and says by how much', () => {
    const result = assessJourney(journey, live([aTrain('2026-11-11T18:53:00.000Z')]), NOW);
    expect(result).toMatchObject({ status: 'at-risk', needsAlternatives: true });
    expect(result.evidence).toBe('Arriving about 13:58, only 2 min to spare.');
    expect(result.projectedArriveAt?.toISOString()).toBe('2026-11-11T18:58:00.000Z');
    expect(result.incidents).toMatchObject([
      {
        kind: 'delay',
        legIndex: 0,
        impactMinutes: 8,
        evidence: 'the A is predicted at 42 St at 13:53, 8 min later than planned.',
      },
    ]);
  });

  it('is late when the delay passes the deadline', () => {
    const result = assessJourney(journey, live([aTrain('2026-11-11T19:02:00.000Z')]), NOW);
    expect(result).toMatchObject({
      status: 'late',
      evidence: 'Arriving about 14:07, 7 min after 14:00.',
    });
  });

  it('is unknown, never on track, when the live data cannot be read', () => {
    const result = assessJourney(journey, live('down'), NOW);
    expect(result.status).toBe('unknown');
    expect(result.projectedArriveAt).toBeNull();
    expect(result.incidents).toMatchObject([
      { kind: 'source-down', provenance: { state: 'unavailable' } },
    ]);
  });

  it('flags a missed connection between two rides', () => {
    const first = subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:35:00.000Z');
    const ride = first.legs[0];
    const walk = first.legs[1];
    if (ride === undefined || walk === undefined) throw new Error('fixture');
    const second = {
      ...ride,
      departAt: new Date('2026-11-11T18:33:00.000Z'),
      arriveAt: new Date('2026-11-11T18:50:00.000Z'),
      route: { id: 'C', shortName: 'C', headsign: null },
    };
    const connecting = journeyOf({
      legs: [{ ...ride, arriveAt: new Date('2026-11-11T18:30:00.000Z') }, second, walk],
    });
    const result = assessJourney(connecting, live([aTrain('2026-11-11T18:34:00.000Z')]), NOW);
    expect(result).toMatchObject({
      status: 'late',
      evidence: 'The connection at 42 St will be missed; looking for another way.',
    });
  });

  it('reports active alerts on the routes of the trip, and ignores expired ones', () => {
    const alerts = {
      alerts: [
        {
          id: 'now',
          header: 'A trains are delayed while we address a signal problem.',
          affected: [{ agencyId: 'MTASBWY', routeId: 'A' }],
          activePeriods: [],
        },
        {
          id: 'past',
          header: 'Old alert.',
          affected: [{ agencyId: 'MTASBWY', routeId: 'A' }],
          activePeriods: [{ start: null, end: '2026-11-11T17:00:00.000Z' }],
        },
        {
          id: 'other',
          header: 'Other line.',
          affected: [{ agencyId: 'MTASBWY', routeId: 'L' }],
          activePeriods: [],
        },
      ],
    };
    const result = assessJourney(journey, live([aTrain('2026-11-11T18:45:00.000Z')], alerts), NOW);
    expect(result.incidents).toMatchObject([
      {
        id: 'alert:0:now',
        kind: 'alert',
        evidence: 'A trains are delayed while we address a signal problem.',
      },
    ]);
  });

  describe('the 4 train from Wall St to Grand Central, northbound, not started yet', () => {
    const at = (time: string) => `2026-11-11T${time}:00.000Z`;
    const base = subwayTrip(at('18:30'), at('18:50'));
    const [ride, walk] = base.legs;
    if (ride === undefined || walk === undefined) throw new Error('fixture');
    const wallSt = { ...ride.from, label: 'Wall St', stopId: '419N' };
    const grandCentral = { ...ride.to, label: 'Grand Central', stopId: '631N' };
    const fourTrain = journeyOf({
      legs: [
        {
          ...ride,
          from: wallSt,
          to: grandCentral,
          route: { id: '4', shortName: '4', headsign: 'Woodlawn' },
        },
        { ...walk, from: grandCentral },
      ],
    });
    const stop = (stopId: string, time: string) => ({
      stopId,
      arrival: at(time),
      departure: at(time),
    });

    it('compares platforms with their direction: a southbound train never hides the delay', () => {
      const trips: PredictedTrip[] = [
        { tripId: 'south', routeId: '4', stops: [stop('419S', '18:29'), stop('631S', '18:45')] },
        { tripId: 'north', routeId: '4', stops: [stop('419N', '18:38'), stop('631N', '18:53')] },
      ];
      const result = assessJourney(fourTrain, live(trips), NOW);
      expect(result.incidents).toMatchObject([{ kind: 'delay', impactMinutes: 8 }]);
    });

    it('is unknown, never on track, when the live 4 trains do not stop at Wall St yet', () => {
      const trips: PredictedTrip[] = [
        { tripId: 'short', routeId: '4', stops: [stop('631N', '18:45')] },
        { tripId: 'later', routeId: '4', stops: [stop('419N', '19:05'), stop('631N', '19:20')] },
      ];
      const result = assessJourney(fourTrain, live(trips), NOW);
      expect(result.status).toBe('unknown');
      expect(result.evidence).toBe(
        'No live prediction yet for the 4 from Wall St; the plan is followed by its timetable.',
      );
    });

    it('is on track with a live 4 that stops at Wall St near the planned departure', () => {
      const trips: PredictedTrip[] = [
        { tripId: 'ok', routeId: '4', stops: [stop('419N', '18:31'), stop('631N', '18:45')] },
      ];
      expect(assessJourney(fourTrain, live(trips), NOW).status).toBe('on-track');
    });

    it("reports the subway's alerts on route 4, never Metro-North's route 4", () => {
      const trips: PredictedTrip[] = [
        { tripId: 'ok', routeId: '4', stops: [stop('419N', '18:31'), stop('631N', '18:45')] },
      ];
      const alerts = {
        alerts: [
          {
            id: 'mnr',
            header: 'New Haven Line trains are delayed.',
            affected: [{ agencyId: 'MNR', routeId: '4' }],
            activePeriods: [],
          },
          {
            id: 'subway',
            header: '4 trains are running with delays.',
            affected: [{ agencyId: 'MTASBWY', routeId: '4' }],
            activePeriods: [],
          },
        ],
      };
      const result = assessJourney(fourTrain, live(trips, alerts), NOW);
      expect(result.incidents.map((incident) => incident.id)).toEqual(['alert:0:subway']);
    });
  });

  it('follows rides more than 45 min away by their timetable, without live data yet', () => {
    const early = new Date('2026-11-11T17:00:00.000Z');
    expect(assessJourney(journey, live('down'), early)).toMatchObject({
      status: 'on-track',
      incidents: [],
    });
  });
});
