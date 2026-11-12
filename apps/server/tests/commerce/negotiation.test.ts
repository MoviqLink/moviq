import { merchantMessageSchema, needViewSchema, type NeedView } from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createTokenBudget } from '../../src/modules/assistant/budget.js';
import type {
  LanguageModel,
  ModelRequest,
  ModelStep,
} from '../../src/modules/assistant/model/language-model.js';
import type { AgentTurn, MerchantAgent } from '../../src/modules/commerce/agent.js';
import { modelAgent } from '../../src/modules/commerce/model-agent.js';
import { composeByRules } from '../../src/modules/commerce/rules-agent.js';
import { memoryLogger } from '../support/memory-logger.js';
import {
  browser,
  commerceWorld,
  needRequest,
  TASTE,
  type CommerceWorld,
} from './support/commerce.js';

let world: CommerceWorld | undefined;

const day = [{ opens: '00:00', closes: '24:00' }];
const allDay = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };

afterEach(async () => {
  await world?.temp.dispose();
  world = undefined;
});

/** A merchant agent that says what the test scripts, then composes by the rules. */
function scripted(...replies: ((turn: AgentTurn) => unknown)[]): MerchantAgent {
  const queue = [...replies];
  return {
    respond: (turn) => {
      const next = queue.shift();
      return Promise.resolve(
        next === undefined
          ? composeByRules(turn)
          : { message: next(turn), composer: 'model' as const },
      );
    },
  };
}

/** What the rules would offer, validated, for a test to spoil. */
function offerBy(turn: AgentTurn) {
  return merchantMessageSchema.parse(composeByRules(turn).message);
}

const spiceQuestion = () => ({
  type: 'clarification',
  from: 'merchant-agent',
  topic: 'spice',
  question: 'Mild or hot?',
  options: ['mild', 'hot'],
});

async function ask(
  agent: MerchantAgent,
  overrides = {},
): Promise<{ view: NeedView; traveller: ReturnType<typeof browser> }> {
  world = await commerceWorld({ agent });
  const traveller = browser(world.app);
  const response = await traveller.post('/api/commerce/needs', needRequest(overrides));
  return { view: needViewSchema.parse(response.body), traveller };
}

const types = (view: NeedView) =>
  view.threads[0]?.conversation.map((entry) => entry.message.type) ?? [];

describe('the protocol between Sara and the merchant agent', () => {
  it('refuses a malformed message from the agent, records why, and does not advance on it', async () => {
    const { view } = await ask(
      scripted(
        () => ({ type: 'discount', from: 'merchant-agent' }),
        (turn) => ({ ...offerBy(turn), freeDessert: true }),
        (turn) => ({ ...offerBy(turn), priceMinor: '14.40' }),
      ),
    );
    expect(types(view)).toEqual([
      'need',
      'refused-message',
      'refused-message',
      'refused-message',
      'closed',
    ]);
    expect(view.offers).toEqual([]);
    const reasons = view.threads[0]?.conversation.flatMap((entry) =>
      entry.message.type === 'refused-message' ? [entry.message.reason] : [],
    );
    expect(reasons?.join(' ')).toMatch(/freeDessert/);
    expect(reasons?.join(' ')).toMatch(/priceMinor/);
  });

  it("answers a clarification from the traveller's tastes when it can", async () => {
    const { view } = await ask(scripted(spiceQuestion));
    const answer = view.threads[0]?.conversation.find(
      (entry) => entry.message.type === 'answer',
    )?.message;
    expect(answer).toMatchObject({ topic: 'spice', answer: 'mild', basis: 'profile' });
    expect(view.offers).toHaveLength(1);
  });

  it('asks the traveller when the tastes do not say, and goes on with the answer', async () => {
    const { view, traveller } = await ask(scripted(spiceQuestion), {
      taste: { ...TASTE, spice: null },
    });
    const thread = view.threads[0];
    expect(thread?.status).toBe('awaiting-traveller');
    expect(thread?.question).toMatchObject({ topic: 'spice', options: ['mild', 'hot'] });
    const answered = await traveller.post(`/api/commerce/needs/${view.id}/answers`, {
      threadId: thread?.id,
      answer: 'hot',
    });
    const after = needViewSchema.parse(answered.body);
    expect(
      after.threads[0]?.conversation.find((entry) => entry.message.type === 'answer')?.message,
    ).toMatchObject({ basis: 'traveller' });
    expect(after.offers).toHaveLength(1);
  });

  it('bounds the clarifications and closes the need without an offer when they run out', async () => {
    const { view } = await ask(scripted(spiceQuestion, spiceQuestion, spiceQuestion));
    expect(types(view).filter((type) => type === 'clarification')).toHaveLength(3);
    expect(view.threads[0]?.conversation.at(-1)?.message).toMatchObject({
      type: 'closed',
      reason: 'clarifications-exhausted',
    });
    expect(view.offers).toEqual([]);
  });

  it("rejects an offer above the agent's maximum discount, and the agent recomposes", async () => {
    const tooGenerous = (turn: AgentTurn) => ({ ...offerBy(turn), priceMinor: 1000 });
    const { view } = await ask(scripted(tooGenerous));
    const checks = view.threads[0]?.conversation.flatMap((entry) =>
      entry.message.type === 'check' ? [entry.message] : [],
    );
    expect(checks?.[0]?.verdict).toBe('rejected');
    expect(checks?.[0]?.refusals[0]?.message).toBe(
      "Rejected: above your agent's maximum discount of 25%.",
    );
    expect(checks?.[1]?.verdict).toBe('accepted');
    expect(view.offers).toHaveLength(1);
    expect(view.offers[0]?.reward.price.amountMinor).not.toBe(1000);
  });
});

describe('the merchant agent on the language model', () => {
  function model(
    answer: (request: ModelRequest) => ModelStep,
    seen: ModelRequest[],
  ): LanguageModel {
    return {
      model: 'test-model',
      maxTokensPerStep: 1000,
      open: (request) => {
        seen.push(request);
        return { step: () => Promise.resolve(answer(request)) };
      },
    };
  }

  it('sends no alias or personal data, and its offer goes through the same check', async () => {
    const seen: ModelRequest[] = [];
    const proposal = (request: ModelRequest): ModelStep => {
      const pickupAt = /"latestPickup":"([^"]+)"/.exec(request.context)?.[1] ?? '';
      const lines = [
        {
          itemId: 'tr-miso-vegan',
          quantity: 1,
          remove: ['scallions', 'peanut chili oil'],
          add: [],
        },
      ];
      return {
        ok: true,
        kind: 'calls',
        usage: { totalTokens: 300 },
        calls: [
          {
            callId: 'c1',
            name: 'propose_offer',
            arguments: { lines, priceMinor: 1440, pickupAt, note: 'Made for you.' },
          },
        ],
      };
    };
    world = await commerceWorld({
      agent: (db, clock) =>
        modelAgent({
          model: model(proposal, seen),
          budget: createTokenBudget(db, clock, 100_000),
          logger: memoryLogger().logger,
        }),
    });
    const view = needViewSchema.parse(
      (await browser(world.app).post('/api/commerce/needs', needRequest())).body,
    );
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen[0])).not.toContain('Mia');
    expect(view.offers[0]?.composer).toBe('model');
    expect(view.offers[0]?.reward.price.amountMinor).toBe(1440);
  });

  it('falls back to the rules, and says so, when the model gives no usable answer', async () => {
    const seen: ModelRequest[] = [];
    world = await commerceWorld();
    const agent = modelAgent({
      model: model(
        () => ({ ok: false, reason: 'unavailable', detail: 'no answer', usage: null }),
        seen,
      ),
      budget: createTokenBudget(world.db, world.clock, 100_000),
      logger: memoryLogger().logger,
    });
    const reply = await agent.respond({
      need: {
        type: 'need',
        from: 'sara',
        alias: 'Mia',
        craving: 'ramen',
        category: 'meal',
        pickupAfter: world.clock.now().toISOString(),
        pickupBefore: new Date(world.clock.now().getTime() + 3_600_000).toISOString(),
        preferences: { allergies: [], avoid: [], noAlcohol: false, diet: 'any', drink: null },
      },
      setup: {
        merchant: {
          summary: {
            id: 'x',
            name: 'x',
            kind: 'cafe',
            demo: true,
            stop: { id: '1', name: 'x', routes: [] },
            walkMinutes: 1,
            lat: 40.8,
            lon: -73.9,
          },
          codeLetter: 'X',
          payoutReceiver: 'x@example.com',
          stopAt: { lat: 40.8, lon: -73.9 },
        },
        menu: [],
        rules: {
          maxDiscountPercent: 25,
          minMarginPercent: 60,
          ordersPerQuarterHour: 4,
          prepMinutes: 10,
          featuredItemIds: [],
        },
        hours: allDay,
        rulesVersion: 1,
      },
      history: [],
      minRewardPercent: 10,
      earliestPickup: world.clock.now(),
      clarificationsLeft: 2,
    });
    expect(reply.composer).toBe('rules');
  });
});
