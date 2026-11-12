import { assistantTurnSchema, type Taste } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import { readCraving } from '../../src/modules/assistant/understanding/craving.js';
import type { CommerceDependencies } from '../../src/modules/commerce/context.js';
import { rulesAgent } from '../../src/modules/commerce/rules-agent.js';
import { commerceSettings } from '../../src/modules/commerce/settings.js';
import { CLIENT_ID } from '../payments/support/api.js';
import { fakeHoldPayPal } from '../payments/support/fake-paypal-holds.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import { assistantDatabase, calls, scriptedModel, text } from './doubles.js';
import { device, harness, type HarnessOptions } from './harness.js';
import { ownerOf, post, tripPastTheRamenBar } from './trip-doubles.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

/** 17:31 in New York: Tsuki Ramen House (demo) is open. */
beforeEach(async () => {
  clock = manualClock('2026-11-11T22:31:00.000Z');
  ({ temp, db } = await assistantDatabase(clock));
});

afterEach(async () => {
  await temp.dispose();
});

const TASTE: Taste = {
  allergies: ['peanuts'],
  avoid: ['scallions'],
  noAlcohol: true,
  diet: 'any',
  drink: null,
  spice: 'mild',
};
const SHOPPER = { alias: 'Mia', taste: TASTE };

function commerceDeps(): CommerceDependencies {
  const settings = commerceSettings({ APP_ENV: 'test' });
  if (!settings.ok) throw new Error(settings.problems.join('; '));
  return {
    db,
    clock,
    settings: settings.settings,
    agent: rulesAgent,
    payments: {
      available: true,
      paypal: fakeHoldPayPal(),
      config: { available: true, clientId: CLIENT_ID, environment: 'sandbox', currency: 'USD' },
      webhookId: undefined,
    },
    payouts: undefined,
    secureCookies: false,
  };
}

async function traveller(options: Partial<HarnessOptions> = {}) {
  const built = harness({ db, clock, commerce: commerceDeps(), ...options });
  const cookie = await ownerOf(built.app, db, tripPastTheRamenBar());
  const ask = async (message: string, shopper: typeof SHOPPER | null = SHOPPER) => {
    const body = {
      conversationId: null,
      journeyId: 'journey-1',
      message,
      lang: 'es',
      ...(shopper === null ? {} : { shopper }),
    };
    const response = await built.app.request('/api/assistant/turns', post(body, cookie));
    expect(response.status).toBe(200);
    return assistantTurnSchema.parse(await response.json());
  };
  return { ...built, ask };
}

const needs = async () => (await db.query('SELECT alias FROM commerce_needs')).rows;

describe('reading a craving without the model', () => {
  it.each([
    ["I'm craving ramen", 'ramen'],
    ["I'd like an oat milk latte, please", 'oat milk latte'],
    ['Me apetece un café con leche de avena.', 'café con leche de avena'],
    ['Sara, quiero ramen', 'ramen'],
  ])('reads %s', (said, craving) => {
    expect(readCraving(said)).toBe(craving);
  });

  it.each(['I want to know if the A runs', 'quiero saber si llego', '¿Y si voy en taxi?'])(
    'leaves %s to the trip',
    (said) => {
      expect(readCraving(said)).toBeUndefined();
    },
  );
});

describe('Sara passes a craving to the demo merchants on the trip', () => {
  it('in basic mode, says so, recommends the validated offer and gives the need to the screen', async () => {
    const { ask } = await traveller();
    const turn = await ask('Me apetece un ramen');
    expect(turn.mode).toBe('basic');
    expect(turn.reply).toMatch(/^Mi IA no está conectada, así que te respondo con frases fijas\./);
    expect(turn.reply).toContain('He pasado «ramen» a los comercios de ejemplo de tu camino.');
    expect(turn.reply).toMatch(
      new RegExp(
        'te recomiendo Tsuki Ramen House \\(demo\\) en East 125th Street & Lexington Avenue: ' +
          'pagas \\d+,\\d\\d US\\$ y ganas \\d+,\\d\\d US\\$, listo a las \\d{1,2}:\\d\\d\\.',
      ),
    );
    expect(turn.reply).toContain('solo se retiene, y se cobra cuando la recoges.');
    const stored = z
      .object({ id: z.string(), alias: z.string() })
      .parse((await db.query('SELECT id, alias FROM commerce_needs')).rows[0]);
    expect(turn.rewards).toEqual({ needId: stored.id });
    expect(stored.alias).toBe('Mia');
  });

  it('asks no merchant without the tastes of the device, nor for a question that is not a craving', async () => {
    const { ask } = await traveller();
    expect((await ask('Me apetece un ramen', null)).rewards).toBeNull();
    expect((await ask('quiero saber si llego')).rewards).toBeNull();
    expect(await needs()).toHaveLength(0);
  });

  it('with the model, find_rewards numbers the offers, with prices as Sara says them, and no id or alias', async () => {
    const model = scriptedModel([
      calls(['find_rewards', { craving: 'ramen' }]),
      calls(['reserve_offer', { offer_id: '1' }]),
      text('Tsuki Ramen House, un comercio de ejemplo, te la guarda: apruébala abajo con PayPal.'),
    ]);
    const { ask } = await traveller({ model });
    const turn = await ask('Resérvame algo de ramen por el camino');
    expect(turn.mode).toBe('ai');
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['find_rewards', 'reserve_offer', 'propose_alternative']),
    );
    const found = z
      .object({
        offers: z
          .array(z.object({ number: z.number(), pays: z.string(), pickup_at: z.string() }))
          .min(1),
      })
      .parse(JSON.parse(model.results[1]?.[0]?.output ?? ''));
    expect(found.offers[0]?.number).toBe(1);
    expect(found.offers[0]?.pays).toMatch(/^\d+,\d\d US\$$/);
    expect(found.offers[0]?.pickup_at).toMatch(/^\d{1,2}:\d\d$/);
    const reserved = z
      .object({ paypal_order_id: z.string(), amount: z.string() })
      .parse(JSON.parse(model.results[2]?.[0]?.output ?? ''));
    expect(reserved.paypal_order_id).toMatch(/^ORDER/);
    expect(reserved.amount).toBe(found.offers[0]?.pays);
    const need = z
      .object({ id: z.string() })
      .parse((await db.query('SELECT id FROM commerce_needs')).rows[0]);
    expect(turn.rewards).toEqual({ needId: need.id });
    const sent = JSON.stringify([model.requests, model.results]);
    expect(sent).not.toContain('Mia');
    expect(sent).not.toContain('peanuts');
    expect(sent).not.toContain(need.id);
  });

  it('refuses a reservation by a number find_rewards did not give', async () => {
    const model = scriptedModel([calls(['reserve_offer', { offer_id: '3' }]), text('No puedo.')]);
    const { ask } = await traveller({ model });
    await ask('Resérvame la tercera');
    expect(model.results[1]?.[0]?.output).toContain('Pass the number of an offer');
  });
});

describe('the reward tools while planning', () => {
  it('are offered to the model but answer that rewards come with a trip under watch', async () => {
    const model = scriptedModel([
      calls(['find_rewards', { craving: 'ramen' }]),
      text('Primero empieza el viaje y luego pídemelo en su pantalla.'),
    ]);
    const { app } = harness({ db, clock, model, commerce: commerceDeps() });
    await device(app).say('Me apetece un ramen', 'es');
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['find_place', 'line_status', 'find_rewards', 'reserve_offer']),
    );
    expect(model.results[1]?.[0]?.output).toContain('start the trip first');
    expect(await needs()).toHaveLength(0);
  });
});
