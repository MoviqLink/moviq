import { restroomsNearResponseSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { nearestRestrooms } from '../../src/modules/city-layers/restrooms-near.js';
import type { PublicRestroom } from '../../src/modules/data-platform/sources/street/public-restrooms.js';
import { readerWith } from '../live-vehicles/reader.js';
import { manualClock } from '../support/manual-clock.js';
import { capturedReader, cityApp, NOW } from './captures.js';

const noNetwork = () => Promise.reject(new Error('No request leaves a test of the restrooms.'));

/** The stops of the trip in `tests/fixtures/journey/`: Parkchester, then Grand Central. */
const PARKCHESTER = '40.833226,-73.860816';
const GRAND_CENTRAL = '40.751776,-73.976848';

async function near(query: string, reader = capturedReader()) {
  const response = await cityApp(reader, manualClock(NOW), noNetwork).request(
    `/api/city/restrooms${query}`,
  );
  return { status: response.status, body: await response.json() };
}

describe('public restrooms near the stops', () => {
  it('lists the nearest in service to each stop, in a straight line to the nearest 10 m', async () => {
    const { status, body } = await near(`?near=${PARKCHESTER};${GRAND_CENTRAL}`);
    expect(status).toBe(200);
    const answer = restroomsNearResponseSchema.parse(body);
    expect(answer).toMatchObject({ stepFree: false, withinMetres: 800 });
    expect(answer.source.provenance.sourceId).toBe('nyc-public-restrooms');
    expect(answer.restrooms?.map((one) => [one.near, one.name, one.straightMetres])).toEqual([
      [0, 'Virginia Playground', 170],
      [0, 'Parkchester Library, NYPL', 220],
      [1, 'Grand Central (Metro North) LIRR Restroom', 10],
      [1, '120 Park Avenue POPS', 120],
    ]);
    expect(answer.restrooms?.[2]?.facts.hours).toMatch(/^Bathrooms are open from 7 a\.m\./);
  });

  it('puts the fully accessible first on a step-free trip', async () => {
    const answer = restroomsNearResponseSchema.parse(
      (await near(`?near=${GRAND_CENTRAL}&stepFree=1`)).body,
    );
    expect(answer.stepFree).toBe(true);
    expect(answer.restrooms?.map((one) => one.facts.access)).toEqual(['full', 'full', 'full']);
    expect(answer.restrooms?.map((one) => one.name)).not.toContain(
      'Grand Central (Metro North) LIRR Restroom',
    );
  });

  it('says the list cannot be read, never that there is none', async () => {
    const answer = restroomsNearResponseSchema.parse(
      (await near(`?near=${GRAND_CENTRAL}`, readerWith(new Map(), NOW))).body,
    );
    expect(answer.restrooms).toBeNull();
  });

  it('refuses points outside the city, too many points or none', async () => {
    expect((await near('')).status).toBe(400);
    expect((await near('?near=48.85,2.35')).status).toBe(400);
    expect((await near(`?near=${Array(5).fill(GRAND_CENTRAL).join(';')}`)).status).toBe(400);
  });

  it('lists a restroom near two stops once, at the first', () => {
    const restroom: PublicRestroom = {
      name: 'One',
      point: [-73.98, 40.75],
      facts: {
        placeType: null,
        operator: null,
        hours: null,
        season: null,
        access: null,
        stalls: null,
        changingTable: null,
        keyOrCode: false,
        note: null,
        website: null,
      },
    };
    const point = { lat: 40.7501, lon: -73.98 };
    expect(nearestRestrooms([restroom], [point, point], false).map((one) => one.near)).toEqual([0]);
  });
});
