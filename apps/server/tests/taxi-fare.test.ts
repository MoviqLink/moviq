import { describe, expect, it } from 'vitest';

import { taxiFare, type TaxiTrip } from '../src/modules/journeys/taxi-fare.js';

const BROOKLYN: TaxiTrip['path'] = [
  [-73.95, 40.65],
  [-73.95, 40.68],
];
const BRYANT_PARK_TO_HARLEM: TaxiTrip['path'] = [
  [-73.9832, 40.7536],
  [-73.9454, 40.8075],
];
const WEDNESDAY_10AM = new Date('2026-11-11T15:00:00.000Z');
const cents = (trip: Partial<TaxiTrip> & Pick<TaxiTrip, 'path'>) =>
  taxiFare({ durationSeconds: 1200, startsAt: WEDNESDAY_10AM, airport: null, ...trip })?.amount
    .amountMinor;

describe('taxiFare (official NYC TLC yellow taxi rates)', () => {
  it('charges by distance above 12 mph and by time below, plus the state and improvement surcharges', () => {
    expect(cents({ path: BROOKLYN, durationSeconds: 600 })).toBe(1225);
    expect(cents({ path: BROOKLYN, durationSeconds: 1800 })).toBe(2550);
  });

  it('adds the congestion surcharge south of 96th Street and the toll south of 60th Street', () => {
    expect(cents({ path: BRYANT_PARK_TO_HARLEM })).toBe(2325);
  });

  it('adds the rush hour surcharge on weekdays from 4 pm to 8 pm, and the overnight one after 8 pm', () => {
    expect(
      cents({ path: BRYANT_PARK_TO_HARLEM, startsAt: new Date('2026-11-11T22:00:00.000Z') }),
    ).toBe(2575);
    expect(
      cents({ path: BRYANT_PARK_TO_HARLEM, startsAt: new Date('2026-11-12T03:00:00.000Z') }),
    ).toBe(2425);
  });

  it('applies the $70 flat fare between Manhattan and JFK, and the LaGuardia surcharge', () => {
    expect(cents({ path: BRYANT_PARK_TO_HARLEM, airport: 'JFK' })).toBe(7475);
    expect(
      cents({
        path: BRYANT_PARK_TO_HARLEM,
        airport: 'JFK',
        startsAt: new Date('2026-11-11T22:00:00.000Z'),
      }),
    ).toBe(7975);
    expect(
      cents({
        path: [
          [-73.9454, 40.8075],
          [-73.874, 40.7769],
        ],
        airport: 'LGA',
      }),
    ).toBe(2500);
  });

  it('gives no price for Newark, which has no verified rule, and says what the price includes', () => {
    expect(
      taxiFare({ path: BROOKLYN, durationSeconds: 600, startsAt: WEDNESDAY_10AM, airport: 'EWR' }),
    ).toBeNull();
    expect(
      taxiFare({ path: BROOKLYN, durationSeconds: 600, startsAt: WEDNESDAY_10AM, airport: null })
        ?.note,
    ).toContain('tips and tolls not included');
  });
});
