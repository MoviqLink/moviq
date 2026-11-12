import type { TravelMode } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { createTransitousRouting } from '../../src/modules/data-platform/on-demand/transitous.js';
import { OMNY_FARE, omnyFareRules } from '../../src/modules/journeys/fares/omny.js';
import type { RoutedItinerary, RoutedLeg } from '../../src/modules/journeys/ports.js';
import {
  capture,
  capturedQuery,
  fixedClock,
  redHook,
  stubHttp,
  timesSquare,
} from '../on-demand/support.js';

/** The three itineraries of the real Transitous capture, as the routing provider returns them. */
async function capturedItineraries(): Promise<readonly RoutedItinerary[]> {
  const { http } = stubHttp({ body: capture('transitous-plan.json') });
  const routing = createTransitousRouting({ http, clock: fixedClock('2026-11-11T01:55:14Z') });
  const outcome = await routing.plan(capturedQuery);
  if (!outcome.ok) throw new Error(outcome.detail);
  return outcome.value;
}

/** A leg with Transitous' ids, departing `minute` minutes after 20:00 in New York. */
function ride(
  mode: TravelMode,
  routeId: string,
  shortName: string,
  minute: number,
  stops: { from?: string; to?: string } = {},
): RoutedLeg {
  const departAt = new Date(Date.parse('2026-11-11T01:00:00Z') + minute * 60_000);
  return {
    mode,
    from: { ...redHook, kind: 'stop', stopId: stops.from ?? null },
    to: { ...timesSquare, kind: 'stop', stopId: stops.to ?? null },
    departAt,
    arriveAt: new Date(departAt.getTime() + 10 * 60_000),
    route: { id: routeId, shortName, headsign: null },
    tripId: null,
    scheduled: true,
    path: [],
  };
}

const walk: RoutedLeg = { ...ride('walk', 'none', 'none', 0), route: null };
const busB61 = (minute: number) => ride('bus', 'us-ny-MTA-BusBrooklyn_B61', 'B61', minute);
const busM15 = (minute: number) => ride('bus', 'us-ny-MTA-BusManhattan_M15+', 'M15-SBS', minute);
const subwayA = (minute: number, from = 'A41N', to = 'A36N') =>
  ride('subway', 'us-ny-MTA-NYCSubway_A', 'A', minute, {
    from: `us-ny-MTA-NYCSubway_${from}`,
    to: `us-ny-MTA-NYCSubway_${to}`,
  });

const oneFareWithTransfer =
  'MTA fare with OMNY: one fare, with one free transfer within two hours. ' +
  'With the same card or device, subway and local bus fares stop at $35 in 7 days.';

describe('OMNY fare rules', () => {
  it('prices the real itineraries: a bus and the subway are one fare with a free transfer', async () => {
    const [b61Then3, b57CThen3, b57ThenC] = await capturedItineraries();
    const quote = { amount: { amountMinor: 300, currency: 'USD' }, note: oneFareWithTransfer };
    expect(omnyFareRules.fareFor(b61Then3?.legs ?? [])).toEqual(quote);
    expect(omnyFareRules.fareFor(b57ThenC?.legs ?? [])).toEqual(quote);
    // C at Chambers St (A36) to the 3 at Chambers St (137): two stations, so unpriced.
    expect(omnyFareRules.fareFor(b57CThen3?.legs ?? [])).toBeNull();
  });

  it('takes a change of trains inside one station as the same entry', () => {
    const legs = [subwayA(0, 'A41N', 'A32S'), walk, subwayA(8, 'A32N', 'A27N')];
    expect(omnyFareRules.fareFor(legs)).toEqual({
      amount: { amountMinor: 300, currency: 'USD' },
      note:
        'MTA fare with OMNY: one fare. ' +
        'With the same card or device, subway and local bus fares stop at $35 in 7 days.',
    });
  });

  it('gives one free transfer within two hours of paying, and charges after it', () => {
    expect(omnyFareRules.fareFor([busB61(0), subwayA(119)])?.amount.amountMinor).toBe(300);
    expect(omnyFareRules.fareFor([busB61(0), subwayA(121)])?.amount.amountMinor).toBe(600);
    const three = omnyFareRules.fareFor([busB61(0), subwayA(20), busM15(50)]);
    expect(three).toEqual({
      amount: { amountMinor: 600, currency: 'USD' },
      note:
        'MTA fare with OMNY: 2 fares, with one free transfer within two hours. ' +
        'With the same card or device, subway and local bus fares stop at $35 in 7 days.',
    });
  });

  it('is free on foot and unknown with no legs', () => {
    expect(omnyFareRules.fareFor([walk])).toEqual({
      amount: { amountMinor: 0, currency: 'USD' },
      note: 'No fare: the whole trip is on foot.',
    });
    expect(omnyFareRules.fareFor([])).toBeNull();
  });

  it('never prices a leg without a verified rule', () => {
    const unpriced: readonly (readonly [string, RoutedLeg])[] = [
      ['express bus', ride('bus', 'us-ny-MTA-BusCompany_BXM1', 'BxM1', 0)],
      ['express bus X', ride('bus', 'us-ny-MTA-BusStatenIsland_X27', 'X27', 0)],
      ['Q70 LaGuardia Link', ride('bus', 'us-ny-MTA-BusCompany_Q70+', 'Q70-SBS', 0)],
      ['Staten Island Railway', ride('subway', 'us-ny-MTA-NYCSubway_SI', 'SIR', 0)],
      ['commuter rail', ride('rail', 'us-ny-LIRR_1', 'Babylon Branch', 0)],
      ['ferry', ride('ferry', 'us-ny-NYCFerry_ER', 'East River', 0)],
      ['taxi', ride('taxi', 'taxi', 'taxi', 0)],
      ['another operator', ride('bus', 'us-nj-NJT-Bus_62', '62', 0)],
      ['an id in another form', ride('bus', 'B61', 'B61', 0)],
    ];
    for (const [what, leg] of unpriced) {
      expect(omnyFareRules.fareFor([walk, busB61(0), leg]), what).toBeNull();
    }
    expect(omnyFareRules.fareFor([busB61(0), walk, busB61(30)]), 'same bus again').toBeNull();
    expect(
      omnyFareRules.fareFor([subwayA(0, 'A41N', 'A36N'), walk, subwayA(9, 'A27N', 'A24N')]),
      'two stations',
    ).toBeNull();
  });

  it('states the figures of the MTA fare page with its address and date', () => {
    expect(OMNY_FARE).toEqual({
      sourceUrl: 'https://www.mta.info/fares-tolls/subway-bus',
      checkedOn: '2026-11-11',
      fare: { amountMinor: 300, currency: 'USD' },
      transferWindowMinutes: 120,
      weeklyCap: { amountMinor: 3500, currency: 'USD' },
      capDays: 7,
    });
  });
});
