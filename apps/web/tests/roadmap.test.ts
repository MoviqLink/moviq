import type { Itinerary, Leg, Place } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { roadmapFromItinerary, roadmapFromSample } from '../src/features/roadmap/from-itinerary';
import { SAMPLE_TRIPS, sampleStats, type SampleTrip } from '../src/features/triplog/sample';

const place = (label: string): Place => ({
  label,
  lat: 40.75,
  lon: -73.98,
  kind: 'station',
  stopId: null,
});

const leg = (
  mode: Leg['mode'],
  from: string,
  to: string,
  at: string,
  line: string | null,
): Leg => ({
  mode,
  from: place(from),
  to: place(to),
  departAt: `2026-11-11T${at}:00.000Z`,
  arriveAt: `2026-11-11T${at}:30.000Z`,
  route: line === null ? null : { id: line, shortName: line, headsign: null },
  tripId: null,
  timing: 'scheduled',
  provenance: {
    sourceId: 'transitous',
    dataTime: '2026-11-11T12:00:00.000Z',
    receivedAt: '2026-11-11T12:00:00.000Z',
    ageSeconds: 0,
    state: 'healthy',
    evidence: 'Written for the test.',
  },
  path: [],
});

const itinerary: Itinerary = {
  id: 'it-1',
  departAt: '2026-11-11T12:00:00.000Z',
  arriveAt: '2026-11-11T12:40:00.000Z',
  spareMinutes: 5,
  transfers: 1,
  walkMinutes: 4,
  legs: [
    leg('walk', 'Home', '125 St', '12:00', null),
    leg('subway', '125 St', 'Times Sq', '12:05', 'A'),
    leg('walk', 'Times Sq', 'Times Sq', '12:20', null),
    leg('taxi', 'Times Sq', 'Bryant Park', '12:25', null),
  ],
  fare: null,
};

describe('the roadmap of a planned itinerary', () => {
  it('keeps every leg with its times, and names a walk between two rides a transfer', () => {
    const legs = roadmapFromItinerary(itinerary);
    expect(legs.map((item) => item.name)).toEqual(['Walk', 'Subway', 'Transfer', 'Car']);
    expect(legs.map((item) => item.mode)).toEqual(['walk', 'subway', 'walk', 'other']);
    expect(legs[1]).toMatchObject({ id: 'it-1-1', line: 'A', from: '125 St', to: 'Times Sq' });
    expect(legs[1]?.start.toISOString()).toBe('2026-11-11T12:05:00.000Z');
    expect(legs[1]?.end.toISOString()).toBe('2026-11-11T12:05:30.000Z');
    expect(roadmapFromItinerary(itinerary, 'es').map((item) => item.name)).toEqual([
      'A pie',
      'Metro',
      'Transbordo',
      'Coche',
    ]);
  });
});

describe('the roadmap of a sample trip', () => {
  it('shares the planned minutes among the rides, with a transfer named by the change of line', () => {
    const trip = SAMPLE_TRIPS.find(
      (item) => item.legs.length === 2 && item.legs.every((part) => part.mode === 'subway'),
    );
    if (trip === undefined) throw new Error('no sample trip with a change');
    const legs = roadmapFromSample(trip, new Date(2026, 10, 12));
    expect(legs.map((item) => item.name)).toEqual(['Subway', 'Transfer', 'Subway']);
    expect(legs[0]?.from).toBe(trip.from);
    expect(legs[2]?.to).toBe(trip.to);
    expect(legs[1]).toMatchObject({
      mode: 'walk',
      from: trip.legs[0]?.line,
      to: trip.legs[1]?.line,
    });
    const first = legs[0]?.start.getTime() ?? 0;
    const last = legs[2]?.end.getTime() ?? 0;
    expect((last - first) / 60_000).toBe(trip.plannedMinutes);
  });
});

const sample = (overrides: Partial<SampleTrip>): SampleTrip => ({
  id: 's',
  dayOffset: -1,
  departs: '08:00',
  from: 'A',
  to: 'B',
  legs: [{ line: 'Q', mode: 'subway' }],
  plannedMinutes: 30,
  actualMinutes: 30,
  rerouted: null,
  tickets: 1,
  fareMinor: 300,
  ...overrides,
});

describe('the figures of the sample history', () => {
  it('count only past trips, on time within five minutes, and the scheduled ones apart', () => {
    expect(
      sampleStats([
        sample({ actualMinutes: 35 }),
        sample({ actualMinutes: 36, rerouted: { en: 'Changed', es: 'Cambiado' }, tickets: 2 }),
        sample({ dayOffset: 2, fareMinor: 900 }),
      ]),
    ).toEqual({
      trips: 2,
      onTime: 1,
      onTimePercent: 50,
      rerouted: 1,
      tickets: 3,
      spentMinor: 600,
      minutesTravelled: 71,
      scheduled: 1,
    });
  });

  it('give zero, not a division by zero, with no past trips', () => {
    expect(sampleStats([]).onTimePercent).toBe(0);
  });
});
