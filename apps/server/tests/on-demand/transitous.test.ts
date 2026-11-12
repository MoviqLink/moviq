import { legSchema, provenanceSchema, type Provenance } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { GENERIC_USER_AGENT } from '../../src/infrastructure/http/client.js';
import {
  createTransitousRouting,
  TRANSITOUS_ATTRIBUTION,
} from '../../src/modules/data-platform/on-demand/transitous.js';
import { planUrl } from '../../src/modules/data-platform/on-demand/transitous-request.js';
import type { RoutedItinerary, RoutedLeg, RouteQuery } from '../../src/modules/journeys/ports.js';
import {
  capture,
  capturedQuery,
  fixedClock,
  stubHttp,
  transitousHeaders,
  type StubAnswer,
} from './support.js';

const planText = capture('transitous-plan.json');
const clock = fixedClock('2026-11-11T01:55:14Z');

interface EngineAnswer {
  direct: unknown[];
  itineraries: { legs: Record<string, unknown>[] }[];
}

/** The capture as an object, to change one thing in a copy. */
function captured(): EngineAnswer {
  return JSON.parse(planText) as EngineAnswer;
}

function engineLeg(answer: EngineAnswer, itinerary: number, leg: number): Record<string, unknown> {
  const found = answer.itineraries[itinerary]?.legs[leg];
  if (found === undefined) throw new Error(`no leg ${String(leg)} in ${String(itinerary)}`);
  return found;
}

async function plan(answer: StubAnswer, query: RouteQuery = capturedQuery) {
  const { http, sent } = stubHttp(answer);
  const outcome = await createTransitousRouting({ http, clock }).plan(query);
  return { outcome, sent };
}

async function planned(body: string, query?: RouteQuery) {
  const { outcome } = await plan({ body, headers: transitousHeaders }, query);
  if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.detail}`);
  return outcome;
}

/** A leg as the public contract carries it, from what the engine said about its timing. */
function asContractLeg(leg: RoutedLeg, provenance: Provenance): unknown {
  const { scheduled, ...rest } = leg;
  const timing = leg.mode === 'walk' ? 'estimated' : scheduled ? 'scheduled' : 'realtime';
  return {
    ...rest,
    departAt: leg.departAt.toISOString(),
    arriveAt: leg.arriveAt.toISOString(),
    timing,
    provenance,
  };
}

function summary(itinerary: RoutedItinerary): string {
  return itinerary.legs.map((leg) => leg.route?.shortName ?? leg.mode).join(' ');
}

describe('Transitous routing', () => {
  it('accepts the real capture: three itineraries by the deadline, latest departure first', async () => {
    const outcome = await planned(planText);
    expect(outcome.value.map(summary)).toEqual([
      'walk B61 walk 3 walk',
      'walk B57 walk C walk 3 walk',
      'walk B57 walk C walk',
    ]);
    for (const itinerary of outcome.value) {
      expect(itinerary.legs.at(-1)?.arriveAt.getTime()).toBeLessThanOrEqual(
        capturedQuery.arriveBy.getTime(),
      );
      expect(itinerary.legs[0]?.from).toEqual(capturedQuery.from);
      expect(itinerary.legs.at(-1)?.to).toEqual(capturedQuery.to);
    }
    expect(outcome.provenance).toEqual({
      sourceId: 'transitous',
      dataTime: '2026-11-11T01:55:13.000Z',
      receivedAt: '2026-11-11T01:55:14.000Z',
      ageSeconds: 1,
      state: 'healthy',
      evidence:
        'Transitous (MOTIS v2.11.4) planned 3 itineraries arriving by 2026-11-11T03:30:00.000Z.',
    });
  });

  it('keeps each leg as the engine gave it: stops, times, route, trip and live or timetable', async () => {
    const [first] = (await planned(planText)).value;
    const bus = first?.legs[1];
    const subway = first?.legs[3];
    expect(bus).toMatchObject({
      mode: 'bus',
      from: {
        label: 'VAN BRUNT ST/SULLIVAN ST',
        kind: 'stop',
        stopId: 'us-ny-MTA-BusBrooklyn_305097',
      },
      to: { label: 'SMITH ST/LIVINGSTON ST', stopId: 'us-ny-MTA-BusBrooklyn_901055' },
      departAt: new Date('2026-11-11T02:48:00Z'),
      arriveAt: new Date('2026-11-11T03:01:00Z'),
      route: {
        id: 'us-ny-MTA-BusBrooklyn_B61',
        shortName: 'B61',
        headsign: 'DOWNTOWN BKLYN FULTON MALL via RED HOOK',
      },
      tripId: '20261110_21:20_us-ny-MTA-BusBrooklyn_JG_D6-Weekday-SDon-128000_B61_825',
      scheduled: false,
    });
    expect(subway).toMatchObject({
      mode: 'subway',
      from: { label: 'Hoyt St', stopId: 'us-ny-MTA-NYCSubway_233N' },
      to: { label: 'Times Sq-42 St', stopId: 'us-ny-MTA-NYCSubway_127N' },
      route: { id: 'us-ny-MTA-NYCSubway_3', shortName: '3', headsign: 'Harlem-148 St' },
      scheduled: true,
    });
    expect(first?.legs[0]).toMatchObject({ mode: 'walk', route: null, tripId: null });
  });

  it('decodes each geometry into as many [longitude, latitude] points as the engine counted', async () => {
    const answer = captured();
    const outcome = await planned(planText);
    const engineLegs = [2, 0, 1].flatMap((index) => answer.itineraries[index]?.legs ?? []);
    const legs = outcome.value.flatMap((itinerary) => itinerary.legs);
    legs.forEach((leg, index) => {
      const geometry = engineLegs[index]?.['legGeometry'] as { length: number };
      expect(leg.path).toHaveLength(geometry.length);
    });
    const bus = legs[1];
    const [lon, lat] = bus?.path[0] ?? [0, 0];
    expect(lon).toBeCloseTo(bus?.from.lon ?? 0, 3);
    expect(lat).toBeCloseTo(bus?.from.lat ?? 0, 3);
  });

  it('keeps the itineraries and their provenance through JSON in the public contract', async () => {
    const outcome = await planned(planText);
    const legs = outcome.value.flatMap((itinerary) =>
      itinerary.legs.map((leg) => asContractLeg(leg, outcome.provenance)),
    );
    const stored: unknown = JSON.parse(JSON.stringify(legs));
    expect(legSchema.array().parse(stored)).toEqual(legs);
    expect(provenanceSchema.parse(JSON.parse(JSON.stringify(outcome.provenance)))).toEqual(
      outcome.provenance,
    );
  });

  it('returns at most the itineraries asked for', async () => {
    const outcome = await planned(planText, { ...capturedQuery, count: 1 });
    expect(outcome.value.map(summary)).toEqual(['walk B61 walk 3 walk']);
  });

  it('leaves out itineraries arriving after the deadline, in a mode not followed or outside the area', async () => {
    const answer = captured();
    engineLeg(answer, 1, 1)['mode'] = 'AIRPLANE';
    const outsideStop = engineLeg(answer, 2, 1)['to'] as { lat: number };
    outsideStop.lat = 39.95;
    const outcome = await planned(JSON.stringify(answer), {
      ...capturedQuery,
      arriveBy: new Date('2026-11-11T03:20:00Z'),
    });
    expect(outcome.value.map(summary)).toEqual(['walk B57 walk C walk 3 walk']);
    expect(outcome.provenance.evidence).toBe(
      'Transitous (MOTIS v2.11.4) planned 1 itineraries arriving by 2026-11-11T03:20:00.000Z; ' +
        'left out: 1 with a mode MovIQ does not follow, 1 with a place outside the New York area.',
    );
  });

  describe('gives each known failure its code', () => {
    const failures: readonly (readonly [string, string, StubAnswer])[] = [
      ['provider-error', 'unavailable', { status: 503, body: 'upstream down' }],
      ['rate-limited', 'rate_limited', { status: 429, headers: { 'retry-after': '60' } }],
      ['not-json', 'unavailable', { body: '<html><body>Bad gateway</body></html>' }],
      ['unexpected-shape', 'misconfigured', { body: '{"itineraries":"none"}' }],
      ['request-refused', 'misconfigured', { status: 400, body: '{"error":"bad time"}' }],
    ];
    it.each(failures)('%s', async (code, state, answer) => {
      const { outcome } = await plan(answer);
      expect(outcome).toMatchObject({ ok: false, code, state });
    });

    it('no-itineraries, with what was left out', async () => {
      const { outcome } = await plan(
        { body: planText },
        {
          ...capturedQuery,
          arriveBy: new Date('2026-11-11T03:00:00Z'),
        },
      );
      expect(outcome).toEqual({
        ok: false,
        state: 'unavailable',
        code: 'no-itineraries',
        detail:
          'Transitous found no itinerary arriving by 2026-11-11T03:00:00.000Z; ' +
          'left out: 3 with arriving too late.',
      });
      const empty = await plan({ body: '{"direct":[],"itineraries":[]}' });
      expect(empty.outcome).toMatchObject({ ok: false, code: 'no-itineraries' });
    });

    it('unexpected-shape when a geometry is not a whole polyline', async () => {
      const answer = captured();
      const geometry = engineLeg(answer, 0, 1)['legGeometry'] as { points: string };
      geometry.points = geometry.points.slice(0, -3);
      const { outcome } = await plan({ body: JSON.stringify(answer) });
      expect(outcome).toMatchObject({
        ok: false,
        code: 'unexpected-shape',
        state: 'misconfigured',
      });
    });

    it('network, without an answer', async () => {
      const { http } = stubHttp('network-down');
      const outcome = await createTransitousRouting({ http, clock }).plan(capturedQuery);
      expect(outcome).toMatchObject({ ok: false, code: 'network', state: 'unavailable' });
    });

    it('daily-budget, without asking Transitous', async () => {
      const { http, sent } = stubHttp({ body: planText });
      const routing = createTransitousRouting({ http, clock, dailyPlans: 1 });
      expect((await routing.plan(capturedQuery)).ok).toBe(true);
      expect(await routing.plan(capturedQuery)).toMatchObject({
        ok: false,
        state: 'rate_limited',
        code: 'daily-budget',
      });
      expect(sent).toHaveLength(1);
    });
  });

  describe('asks the documented plan request', () => {
    const paramsOf = (query: RouteQuery) =>
      Object.fromEntries(new URL(planUrl(query)).searchParams);

    it('is the request of the capture, sent with the generic identity', async () => {
      expect(planUrl(capturedQuery).split('?')[0]).toBe('https://api.transitous.org/api/v6/plan');
      expect(paramsOf(capturedQuery)).toEqual({
        fromPlace: '40.6764,-74.011',
        toPlace: '40.758,-73.9855',
        time: '2026-11-11T03:30:00Z',
        arriveBy: 'true',
        numItineraries: '3',
        pedestrianProfile: 'FOOT',
        transitModes: 'SUBWAY,BUS,COACH',
        maxPreTransitTime: '900',
        maxPostTransitTime: '900',
        maxDirectTime: '900',
      });
      const { sent } = await plan({ body: planText });
      expect(sent[0]?.headers.get('user-agent')).toBe(GENERIC_USER_AGENT);
      expect(sent[0]?.headers.get('accept')).toBe('application/json');
    });

    it('asks for step-free footpaths, other modes and the walk limit', () => {
      expect(paramsOf({ ...capturedQuery, stepFree: true })).toMatchObject({
        pedestrianProfile: 'WHEELCHAIR',
      });
      expect(
        paramsOf({ ...capturedQuery, modes: ['rail', 'ferry'], maxWalkMinutes: 10 }),
      ).toMatchObject({
        transitModes: 'REGIONAL_RAIL,SUBURBAN,LONG_DISTANCE,HIGHSPEED_RAIL,NIGHT_RAIL,FERRY',
        maxPreTransitTime: '600',
        maxDirectTime: '0',
      });
      expect(paramsOf({ ...capturedQuery, modes: ['walk'] })).toMatchObject({ transitModes: '' });
    });

    it('asks for a door-to-door car ride when the mode is taxi (regression)', () => {
      const params = paramsOf({ ...capturedQuery, modes: ['taxi'], count: 1 });
      // `/api/v6/plan` names it `directModes` (the plan's OpenAPI); `directMode` belongs to other routes.
      expect(params).toMatchObject({ transitModes: '', directModes: 'CAR', maxDirectTime: '7200' });
      expect(params).not.toHaveProperty('directMode');
      expect(paramsOf(capturedQuery)).not.toHaveProperty('directModes');
    });
  });

  it('reads a car ride as a taxi leg, without a route or a trip (regression)', async () => {
    const answer = captured();
    const leg = engineLeg(answer, 0, 0);
    leg['mode'] = 'CAR';
    leg['tripId'] = 'not-a-trip';
    const outcome = await planned(JSON.stringify(answer), capturedQuery);
    const ride = outcome.value
      .flatMap((itinerary) => itinerary.legs)
      .find((l) => l.mode === 'taxi');
    expect(ride).toMatchObject({ route: null, tripId: null });
  });

  it('exports the attribution Transitous asks for', () => {
    expect(TRANSITOUS_ATTRIBUTION.text).toBe(
      'Routing by Transitous, map data © OpenStreetMap contributors',
    );
    expect(TRANSITOUS_ATTRIBUTION.links.map((link) => link.url)).toEqual([
      'https://transitous.org/sources/',
      'https://www.openstreetmap.org/copyright',
    ]);
  });
});
