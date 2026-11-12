import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config.js';
import { systemClock } from '../../src/infrastructure/clock/clock.js';
import { createTokenBudget } from '../../src/modules/assistant/budget.js';
import { openAIModelFromConfig } from '../../src/modules/assistant/model/openai.js';
import { createSara } from '../../src/modules/assistant/sara.js';
import { journeyStore } from '../../src/modules/journeys/journey-store.js';
import { fakeCity, fakeReader } from '../assistant/city-doubles.js';
import { assistantDatabase, fakeFlights, fakeGeocoder, fakePlanner } from '../assistant/doubles.js';
import { atRiskJourney } from '../assistant/trip-doubles.js';
import { memoryLogger } from '../support/memory-logger.js';

/**
 * One real explanation with OpenAI: the model words, in Spanish, a trip at risk from its facts
 * alone, and the guard keeps the words only if every price, time and number came from them.
 * Run with `npm run verify:live`; without `OPENAI_API_KEY` it fails naming the variable to set.
 * It costs about two thousand tokens.
 */
const loaded = loadConfig(process.env);
if (!loaded.ok) throw new Error(`Configuration error: ${loaded.problems.join('; ')}`);
const model = openAIModelFromConfig(loaded.config);

describe('Sara explaining a trip with the real OpenAI API', () => {
  it('writes the change in Spanish from the facts of the trip', async () => {
    expect(model, 'set OPENAI_API_KEY to validate the OpenAI integration').toBeDefined();
    if (model === undefined) return;
    const { temp, db } = await assistantDatabase(systemClock);
    try {
      const now = new Date();
      const traveller = 'live-test-traveller';
      await db.execute({
        sql: 'INSERT INTO travellers (id, created_at, last_seen_at) VALUES (?, ?, ?)',
        args: [traveller, now.toISOString(), now.toISOString()],
      });
      await journeyStore.create(db, atRiskJourney(), traveller, now);
      const sara = createSara({
        db,
        clock: systemClock,
        geocoder: fakeGeocoder({}),
        flights: fakeFlights({}),
        planner: fakePlanner(),
        reader: fakeReader({}),
        live: fakeCity(),
        model,
        budget: createTokenBudget(db, systemClock, 20_000),
      });
      const log = memoryLogger();
      const journey = await sara.explain('journey-1', traveller, 'es', log.logger);
      const explanation = journey?.watch.explanation;
      expect(log.text()).not.toContain('replaced by the fixed words');
      expect(explanation).toMatchObject({ mode: 'ai', lang: 'es' });
      const words = explanation?.mode === 'ai' ? explanation.text : '';
      expect(words).toMatch(/taxi/i);
      expect(words).not.toContain('350 Fifth');
    } finally {
      await temp.dispose();
    }
  }, 60_000);
});
