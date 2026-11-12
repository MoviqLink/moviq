import type { Hono } from 'hono';
import type { Itinerary, Journey, Leg, Place, Provenance } from '@moviq/contracts';
import { expect } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import type { AppBindings } from '../../src/infrastructure/http/context.js';
import { journeyStore } from '../../src/modules/journeys/journey-store.js';

const provenance = (sourceId: string, dataTime: string): Provenance => ({
  sourceId,
  dataTime,
  receivedAt: dataTime,
  ageSeconds: 10,
  state: 'healthy',
  evidence: 'Answered by the test double.',
});

const station = (label: string, lat: number): Place => ({
  label,
  lat,
  lon: -73.98,
  kind: 'station',
  stopId: `S-${label}`,
});
const HARLEM = station('125 St', 40.8075);
const TIMES_SQUARE = station('42 St', 40.7557);
/** The destination is an address: it never leaves for the model. */
const OFFICE: Place = {
  label: '350 Fifth Avenue, Manhattan',
  lat: 40.7484,
  lon: -73.9857,
  kind: 'address',
  stopId: null,
};

const leg = (mode: Leg['mode'], from: Place, to: Place, times: [string, string]): Leg => ({
  mode,
  from,
  to,
  departAt: times[0],
  arriveAt: times[1],
  route: mode === 'subway' ? { id: 'A', shortName: 'A', headsign: 'Far Rockaway' } : null,
  tripId: mode === 'subway' ? 'A-1' : null,
  timing: mode === 'subway' ? 'realtime' : 'estimated',
  provenance: provenance(
    mode === 'subway' ? 'mta-subway-ace' : 'transitous',
    '2026-11-11T22:29:00.000Z',
  ),
  path: [],
});

const itinerary = (id: string, legs: Leg[], spareMinutes: number): Itinerary => ({
  id,
  departAt: legs[0]?.departAt ?? '',
  arriveAt: legs.at(-1)?.arriveAt ?? '',
  spareMinutes,
  transfers: 0,
  walkMinutes: 5,
  legs,
  fare: null,
});

/**
 * A trip at risk: the A is 7 min late, so the traveller arrives at 18:52 (New York) with 3 min
 * to spare; the options are the next A for free and the demo taxi for $34.50.
 */
export function atRiskJourney(id = 'journey-1'): Journey {
  const planned = itinerary(
    'planned',
    [
      leg('subway', HARLEM, TIMES_SQUARE, ['2026-11-11T23:20:00.000Z', '2026-11-11T23:40:00.000Z']),
      leg('walk', TIMES_SQUARE, OFFICE, ['2026-11-11T23:40:00.000Z', '2026-11-11T23:45:00.000Z']),
    ],
    10,
  );
  return {
    id,
    state: 'watching',
    request: {
      origin: HARLEM,
      destination: OFFICE,
      arriveBy: '2026-11-11T23:55:00.000Z',
      preferences: { maxWalkMinutes: 15, stepFree: false, modes: ['subway'], spareMinutes: 5 },
      flight: null,
    },
    itinerary: planned,
    createdAt: '2026-11-11T22:00:00.000Z',
    watch: {
      status: 'at-risk',
      evaluatedAt: '2026-11-11T22:30:00.000Z',
      projectedArriveAt: '2026-11-11T23:52:00.000Z',
      evidence: 'Arriving about 18:52, only 3 min to spare.',
      flight: null,
      stepFreeRefusal: null,
    },
    incidents: [
      {
        id: 'delay:0',
        at: '2026-11-11T22:30:00.000Z',
        legIndex: 0,
        kind: 'delay',
        evidence: 'the A is predicted at 42 St at 18:47, 7 min later than planned.',
        provenance: provenance('mta-subway-ace', '2026-11-11T22:29:30.000Z'),
        impactMinutes: 7,
      },
    ],
    alternatives: [
      {
        id: 'alt-a',
        itinerary: itinerary(
          'alt-a',
          [
            leg('subway', HARLEM, TIMES_SQUARE, [
              '2026-11-11T23:10:00.000Z',
              '2026-11-11T23:48:00.000Z',
            ]),
          ],
          7,
        ),
        recommended: false,
        why: 'Arrives at 18:48, 7 min to spare.',
        price: null,
      },
      {
        id: 'alt-taxi',
        itinerary: itinerary(
          'alt-taxi',
          [leg('taxi', HARLEM, OFFICE, ['2026-11-11T23:05:00.000Z', '2026-11-11T23:40:00.000Z'])],
          15,
        ),
        recommended: true,
        why: 'A taxi of our demo partner, paid with PayPal: arrives at 18:40, 15 min to spare.',
        price: { amountMinor: 3450, currency: 'USD' },
      },
    ],
  };
}

/** The at-risk trip, its A train leaving from the 125 St (4 5 6) stop next to the demo ramen bar. */
export function tripPastTheRamenBar(): Journey {
  const journey = atRiskJourney();
  const [first, ...rest] = journey.itinerary.legs;
  if (first === undefined) throw new Error('fixture');
  const from = { ...first.from, label: '125 St', lat: 40.804138, lon: -73.937594 };
  return { ...journey, itinerary: { ...journey.itinerary, legs: [{ ...first, from }, ...rest] } };
}

/** A device with a session: its traveller owns the journey given, kept in the database. */
export async function ownerOf(
  app: Hono<AppBindings>,
  db: Database,
  journey: Journey,
): Promise<string> {
  const response = await app.request('/api/assistant/journeys/none/explanation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lang: 'en' }),
  });
  expect(response.status).toBe(404);
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  const rows = await db.query('SELECT id FROM travellers');
  const { id } = z.object({ id: z.string() }).parse(rows.rows[0]);
  await journeyStore.create(db, journey, id, new Date('2026-11-11T22:00:00.000Z'));
  return cookie;
}

/** A JSON POST with the session cookie. */
export const post = (body: unknown, cookie: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(body),
});
