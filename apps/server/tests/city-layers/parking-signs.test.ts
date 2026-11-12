import { parkingSignsResponseSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { fixture } from '../live-vehicles/city.js';
import { manualClock } from '../support/manual-clock.js';
import { capturedReader, cityApp, NOW } from './captures.js';

/** 10 Av and W 57 St, in the tile of the capture. */
const TENTH_AVENUE = 'lat=40.7695&lon=-73.9885';

function dataset(answer: () => Response) {
  const asked: string[] = [];
  const fetch: typeof globalThis.fetch = (input) => {
    asked.push(input instanceof Request ? input.url : String(input));
    return Promise.resolve(answer());
  };
  return { asked, fetch };
}

describe('parking signs on demand', () => {
  it('serves the signs of the tile with their text as DOT lists it, asked once', async () => {
    const nycOpenData = dataset(() => new Response(fixture('street/parking-signs-tile.json')));
    const app = cityApp(capturedReader(), manualClock(NOW), nycOpenData.fetch);
    const first = parkingSignsResponseSchema.parse(
      await (await app.request(`/api/city/parking-signs?${TENTH_AVENUE}`)).json(),
    );
    await app.request(`/api/city/parking-signs?${TENTH_AVENUE}`);
    expect(nycOpenData.asked).toHaveLength(1);
    expect(first.source.state).toBe('healthy');
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items[0]).toMatchObject({
      layer: 'parking-signs',
      detail: {
        kind: 'parking-sign',
        code: 'PS-214C',
        text: '2 HMP MONDAY-FRIDAY 10AM-4PM SATURDAY 9AM-7PM <->',
      },
    });
  });

  it('says why when the dataset does not answer, and refuses a point outside the city', async () => {
    const down = dataset(() => new Response('busy', { status: 503 }));
    const app = cityApp(capturedReader(), manualClock(NOW), down.fetch);
    const answer = parkingSignsResponseSchema.parse(
      await (await app.request(`/api/city/parking-signs?${TENTH_AVENUE}`)).json(),
    );
    expect(answer.items).toEqual([]);
    expect(answer.source.state).toBe('unavailable');
    expect((await app.request('/api/city/parking-signs?lat=41.5&lon=-73.98')).status).toBe(400);
  });
});
