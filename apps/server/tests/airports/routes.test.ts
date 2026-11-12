import { airportBoardSchema, apiErrorSchema } from '@moviq/contracts';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import { createAirportBoardService } from '../../src/modules/airports/board.js';
import { airportRoutes } from '../../src/modules/airports/routes.js';
import { manualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';
import {
  ADSB_AT,
  currentReading,
  fakeReader,
  jfkSnapshot,
  jfkTraffic,
  stubBoards,
} from './support.js';

function app() {
  const { boards, asked } = stubBoards({ JFK: currentReading(jfkSnapshot()) }, ADSB_AT);
  const service = createAirportBoardService({
    boards,
    reader: fakeReader({ 'adsb-lol-new-york': jfkTraffic() }, ADSB_AT),
    clock: manualClock(ADSB_AT.toISOString()),
  });
  const root = new Hono<AppBindings>();
  root.use(requestContext(memoryLogger().logger));
  root.route('/api/airports', airportRoutes({ service }));
  return { root, asked };
}

describe('GET /api/airports/:code/board', () => {
  it('serves departures unless arrivals are asked, in any case of the code', async () => {
    const { root, asked } = app();
    const departures = await root.request('/api/airports/jfk/board');
    expect(departures.status).toBe(200);
    expect(airportBoardSchema.parse(await departures.json())).toMatchObject({
      airport: { code: 'JFK' },
      direction: 'departures',
    });
    const arrivals = await root.request('/api/airports/JFK/board?direction=arrivals');
    const board = airportBoardSchema.parse(await arrivals.json());
    expect(board.direction).toBe('arrivals');
    expect(board.flights).toHaveLength(9);
    expect(asked).toEqual(['JFK', 'JFK']);
  });

  it('refuses another airport or direction with the API error body', async () => {
    const { root, asked } = app();
    for (const path of ['/api/airports/ORD/board', '/api/airports/JFK/board?direction=both']) {
      const response = await root.request(path);
      expect(response.status).toBe(400);
      expect(apiErrorSchema.parse(await response.json()).error).toMatchObject({
        code: 'bad_request',
        message: 'Ask for JFK, LGA or EWR, and for departures or arrivals.',
      });
    }
    expect(asked).toEqual([]);
  });
});
