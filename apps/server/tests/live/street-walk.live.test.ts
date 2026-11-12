import { describe, expect, it } from 'vitest';

import { systemClock } from '../../src/infrastructure/clock/clock.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import { createDailyBudget } from '../../src/modules/data-platform/on-demand/daily-budget.js';
import { createTransitousStreets } from '../../src/modules/data-platform/on-demand/transitous-streets.js';

/**
 * One walk asked of Transitous on the OpenStreetMap streets: Times Square to Bryant Park, the
 * corners of `transitous-walk-foot.json`. Straight, about 280 m; walked, 300 m in 255 s on
 * 11/11/2026. The answer must be a whole walk of that order, with its path.
 */
describe('Transitous walks live', () => {
  it('walks Times Square to Bryant Park on the streets', async () => {
    const streets = createTransitousStreets({
      http: createHttpClient(),
      clock: systemClock,
      budget: createDailyBudget(300),
    });
    const ask = { from: { lat: 40.7553, lon: -73.9876 }, to: { lat: 40.7542, lon: -73.9846 } };
    const { answers, requests } = await streets.walk([ask], 'foot', 1);
    expect(requests).toBe(1);
    const [walk] = answers;
    if (walk?.kind !== 'walked') throw new Error(`Transitous gave no walk: ${String(walk?.kind)}`);
    expect(walk.metres).toBeGreaterThan(250);
    expect(walk.metres).toBeLessThan(500);
    expect(walk.seconds).toBeGreaterThan(150);
    expect(walk.seconds).toBeLessThan(600);
    expect(walk.path.length).toBeGreaterThan(2);
  });
});
