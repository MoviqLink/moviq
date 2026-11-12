import { describe, expect, it } from 'vitest';

import { afdcNewJerseyChargers } from '../../../src/modules/data-platform/sources/street/afdc-chargers.js';
import { nycDefibrillators } from '../../../src/modules/data-platform/sources/street/defibrillators.js';
import { nycEvChargers } from '../../../src/modules/data-platform/sources/street/ev-chargers.js';
import { nycParkingMeters } from '../../../src/modules/data-platform/sources/street/parking-meters.js';
import { accepted, capture, text } from '../ny511/captures.js';

const at = (iso: string) => ({ receivedAt: new Date(iso), previous: undefined });

describe('NYC parking meters', () => {
  const parse = () =>
    nycParkingMeters.parse(capture('street', 'parking-meters.json'), at('2026-11-11T04:36:53Z'));

  it('lists the active meters apart from the inactive ones and those it cannot place', () => {
    const result = accepted(parse());
    expect(result.coverage).toBe('7 active meters, 1 inactive, 3 left out');
    const ids = result.data.meters.map((meter) => meter.id);
    expect(ids).not.toContain('1013001');
    expect(ids).not.toContain('1433468');
    expect(ids.filter((id) => id === '1033066')).toHaveLength(1);
    expect(result.data.meters.find((meter) => meter.id === '3443014')?.facility).toBe('on-street');
    expect(nycParkingMeters.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
  });

  it('keeps the rules printed on a meter, never a free space', () => {
    const meter = accepted(parse()).data.meters[0];
    expect(Object.keys(meter ?? {}).sort()).toEqual([
      'borough',
      'facility',
      'from',
      'hours',
      'id',
      'point',
      'side',
      'street',
      'to',
    ]);
    expect(nycParkingMeters.check?.(accepted(parse()).data, undefined)).toEqual([
      '7 active meters, minimum 8000',
    ]);
  });
});

describe('EV charging stations in New York City', () => {
  const parse = () =>
    nycEvChargers.parse(capture('street', 'ev-chargers.json'), at('2026-11-11T04:36:57Z'));

  it('keeps the stations of the five boroughs by ZIP code, as a list without live status', () => {
    const result = accepted(parse());
    expect(result.coverage).toBe('7 stations in the five boroughs, 2 left out');
    const cities = result.data.stations.map((station) => station.city);
    expect(cities).not.toContain('New Rochelle');
    expect(cities).not.toContain('Elmont');
    expect(result.data.stations[0]).toMatchObject({ id: '102327', listing: 'open', pricing: null });
    expect(nycEvChargers.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
    expect(nycEvChargers.integration).toBeUndefined();
  });
});

describe('EV charging stations on the New Jersey side (AFDC)', () => {
  const parse = () =>
    afdcNewJerseyChargers.parse(
      capture('street', 'afdc-new-jersey.json'),
      at('2026-11-11T04:34:39Z'),
    );

  it('keeps the New Jersey stations of the city area, with their pricing', () => {
    const result = accepted(parse());
    expect(result.coverage).toBe('4 stations in the New Jersey part of the city area');
    expect(result.data.stations.map((station) => station.city)).toEqual([
      'Jersey City',
      'Fort Lee',
      'Hoboken',
      'Newark',
    ]);
    expect(result.data.stations.find((station) => station.city === 'Newark')).toMatchObject({
      listing: 'temporarily-unavailable',
      pricing: 'Free',
    });
    expect(afdcNewJerseyChargers.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
  });

  it('needs NLR_API_KEY, asks New Jersey only and sends the key only in the request', () => {
    expect(afdcNewJerseyChargers.integration).toBe('nlr');
    const { url } = afdcNewJerseyChargers.request({
      credentials: { NLR_API_KEY: 'k' },
      now: new Date(),
    });
    expect(new URL(url).searchParams.get('api_key')).toBe('k');
    expect(new URL(url).searchParams.get('state')).toBe('NJ');
    expect(
      afdcNewJerseyChargers.failures.find((failure) => failure.code === 'http-429')?.state,
    ).toBe('rate_limited');
  });

  it('refuses an answer that is not the station list', () => {
    expect(
      afdcNewJerseyChargers.parse(
        text('{"errors":["API_KEY_INVALID"]}'),
        at('2026-11-11T04:34:39Z'),
      ),
    ).toMatchObject({
      ok: false,
      code: 'unexpected-shape',
    });
  });
});

describe('NYC automated external defibrillators', () => {
  const parse = () =>
    nycDefibrillators.parse(capture('street', 'defibrillators.json'), at('2026-11-11T04:32:41Z'));

  it('keeps the building and the place inside as registered, and no opening hours', () => {
    const result = accepted(parse());
    expect(result.coverage).toBe('9 places, 0 left out');
    expect(result.data.defibrillators[0]).toEqual({
      entity: 'SI Conference House',
      address: '7455 Hylan Boulevard',
      place: null,
      borough: 'Staten Island',
      zip: '10307',
      units: 1,
      locationType: 'Parks & Recreation',
      updatedOn: '2026-06-04',
      point: [-74.25313136, 40.50247169],
    });
    expect(result.data.defibrillators.map((defibrillator) => defibrillator.place)).toContain(
      'Outside Room 322',
    );
    expect(nycDefibrillators.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
    expect(nycDefibrillators.consumers).toEqual(['live-map']);
  });
});
