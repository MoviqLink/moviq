import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config.js';
import { systemClock } from '../../src/infrastructure/clock/clock.js';
import { createTokenBudget } from '../../src/modules/assistant/budget.js';
import { openAIModelFromConfig } from '../../src/modules/assistant/model/openai.js';
import { createSara } from '../../src/modules/assistant/sara.js';
import { fakeCity, fakeReader } from '../assistant/city-doubles.js';
import { assistantDatabase, fakeFlights, fakeGeocoder, fakePlanner } from '../assistant/doubles.js';
import { PLACES } from '../assistant/harness.js';
import { memoryLogger } from '../support/memory-logger.js';

/**
 * One real turn with OpenAI: the model reads a sentence, calls the tools through their schemas
 * and answers in words. Places and the plan come from doubles, so only the model is real. Run
 * with `npm run verify:live`; without `OPENAI_API_KEY` it fails naming the variable to set.
 * It costs a few thousand tokens.
 */
const loaded = loadConfig(process.env);
if (!loaded.ok) throw new Error(`Configuration error: ${loaded.problems.join('; ')}`);
const model = openAIModelFromConfig(loaded.config);

describe('Sara against the real OpenAI API', () => {
  it('understands a trip and plans it through the tools', async () => {
    expect(model, 'set OPENAI_API_KEY to validate the OpenAI integration').toBeDefined();
    if (model === undefined) return;
    const { temp, db } = await assistantDatabase(systemClock);
    try {
      const now = new Date().toISOString();
      await db.execute({
        sql: 'INSERT INTO travellers (id, created_at, last_seen_at) VALUES (?, ?, ?)',
        args: ['live-test-traveller', now, now],
      });
      const sara = createSara({
        db,
        clock: systemClock,
        geocoder: fakeGeocoder(PLACES),
        flights: fakeFlights({}),
        planner: fakePlanner(),
        reader: fakeReader({}),
        live: fakeCity(),
        model,
        budget: createTokenBudget(db, systemClock, 50_000),
      });
      const turn = await sara.turn(
        { conversationId: null, message: 'Bryant Park at 7 pm from 125 Street', lang: 'en' },
        'live-test-traveller',
        memoryLogger().logger,
      );
      expect(turn.mode).toBe('ai');
      expect(turn.draft.destination?.label).toBe(PLACES['Bryant Park'][0]?.label);
      expect(turn.reply.length).toBeGreaterThan(0);
    } finally {
      await temp.dispose();
    }
  }, 60_000);
});
