import { journeySchema, type Journey } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/database.js';
import {
  explanationSubject,
  keptExplanation,
  type WatchExplanation,
} from '../../src/modules/journeys/explanation.js';
import { journeyStore } from '../../src/modules/journeys/journey-store.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import { assistantDatabase, scriptedModel, text } from './doubles.js';
import { harness, type HarnessOptions } from './harness.js';
import { atRiskJourney, ownerOf, post } from './trip-doubles.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

beforeEach(async () => {
  clock = manualClock('2026-11-11T22:31:00.000Z');
  ({ temp, db } = await assistantDatabase(clock));
});

afterEach(async () => {
  await temp.dispose();
});

const SPANISH =
  'Tu A va con retraso: está previsto en 42 St a las 18:47, 7 min más tarde de lo previsto, ' +
  'así que llegarías hacia las 18:52 con solo 3 min de margen. Te recomiendo el taxi, que ' +
  'llega a las 18:40 por 34,50 US$ y se paga con PayPal solo cuando lo apruebes.';

async function explained(options: Partial<HarnessOptions>, lang: 'en' | 'es' = 'es') {
  const { app, log } = harness({ db, clock, ...options });
  const cookie = await ownerOf(app, db, atRiskJourney());
  const ask = async () => {
    const response = await app.request(
      '/api/assistant/journeys/journey-1/explanation',
      post({ lang }, cookie),
    );
    expect(response.status).toBe(200);
    return journeySchema.parse(await response.json());
  };
  return { ask, log };
}

describe('Sara explains a trip under watch', () => {
  it('words the change from the journey facts, keeps them in the journey and cites the sources', async () => {
    const model = scriptedModel([text(SPANISH)]);
    const { ask } = await explained({ model });
    const journey = await ask();
    expect(journey.watch.explanation).toMatchObject({
      mode: 'ai',
      lang: 'es',
      text: SPANISH,
      writtenAt: '2026-11-11T22:31:00.000Z',
    });
    const sources =
      journey.watch.explanation?.mode === 'ai' ? journey.watch.explanation.sources : [];
    expect(sources.map((source) => source.sourceId)).toEqual(['mta-subway-ace', 'transitous']);
    const [request] = model.requests;
    expect(request?.tools).toEqual([]);
    expect(request?.instructions).toContain('Spanish from Spain');
    const facts: unknown = JSON.parse(request?.context ?? '{}');
    expect(facts).toMatchObject({
      status: 'at-risk',
      expectedArrival: '18:52',
      incidents: [{ kind: 'delay', impactMinutes: 7 }],
      options: [
        { option: 1, rides: 'A', price: null },
        { option: 2, rides: 'taxi', price: '34,50 US$', recommended: true },
      ],
    });
    // The address of the destination and every coordinate stay in MovIQ.
    expect(request?.context).not.toContain('350 Fifth');
    expect(request?.context).not.toContain('40.7');
    const stored = await journeyStore.get(db, 'journey-1');
    expect(stored?.journey.watch.explanation?.mode).toBe('ai');
  });

  it('writes once per change: asking again for the same change calls nobody', async () => {
    const model = scriptedModel([text(SPANISH)]);
    const { ask } = await explained({ model });
    await ask();
    const again = await ask();
    expect(again.watch.explanation?.mode).toBe('ai');
    expect(model.requests).toHaveLength(1);
  });

  it('replaces words with a figure the facts do not hold by the fixed words, and says why', async () => {
    const invented = 'Llegarás a las 18:45 con 9 minutos de margen si coges el taxi por 30 US$.';
    const { ask, log } = await explained({ model: scriptedModel([text(invented)]) });
    const journey = await ask();
    expect(journey.watch.explanation).toEqual({
      mode: 'basic',
      about: 'at-risk|delay:0|A;taxi+paid',
      lang: 'es',
      reason: 'model-failed',
    });
    expect(log.text()).toContain('sara trip words replaced by the fixed words');
  });

  it('without a model, keeps the fixed words and says it has no AI', async () => {
    const { ask } = await explained({ model: undefined }, 'en');
    const journey = await ask();
    expect(journey.watch.explanation).toMatchObject({ mode: 'basic', reason: 'no-model' });
  });

  it("once today's allowance is spent, calls no model and says so", async () => {
    const model = scriptedModel([text(SPANISH)]);
    const { ask } = await explained({ model, dailyTokens: 10 });
    const journey = await ask();
    expect(journey.watch.explanation).toMatchObject({ mode: 'basic', reason: 'budget' });
    expect(model.results).toHaveLength(0);
  });

  it('has nothing to explain on a trip on track with no incident and no option', async () => {
    const { app } = harness({ db, clock, model: scriptedModel([]) });
    const base = atRiskJourney();
    const calm: Journey = {
      ...base,
      watch: { ...base.watch, status: 'on-track' },
      incidents: [],
      alternatives: [],
    };
    const cookie = await ownerOf(app, db, calm);
    const response = await app.request(
      '/api/assistant/journeys/journey-1/explanation',
      post({ lang: 'en' }, cookie),
    );
    const journey = journeySchema.parse(await response.json());
    expect(journey.watch.explanation ?? null).toBeNull();
  });

  it("refuses another traveller's trip", async () => {
    const { app } = harness({ db, clock });
    await ownerOf(app, db, atRiskJourney());
    const response = await app.request('/api/assistant/journeys/journey-1/explanation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang: 'en' }),
    });
    expect(response.status).toBe(404);
  });
});

describe('the watch keeps Sara’s words only while they tell the change', () => {
  it('keeps them for the same verdict, incidents and options, and drops them on a new incident', () => {
    const journey = atRiskJourney();
    const explanation: WatchExplanation = {
      mode: 'basic',
      about: explanationSubject(journey) ?? '',
      lang: 'en',
      reason: 'no-model',
    };
    const before = { ...journey, watch: { ...journey.watch, explanation } };
    const same = { status: journey.watch.status, incidents: journey.incidents };
    expect(keptExplanation(before, same, journey.alternatives)).toEqual(explanation);
    const lift = { ...same, incidents: [...journey.incidents, { id: 'elevator:0:EL293' }] };
    expect(keptExplanation(before, lift, journey.alternatives)).toBeNull();
    expect(keptExplanation(before, same, [])).toBeNull();
  });
});
