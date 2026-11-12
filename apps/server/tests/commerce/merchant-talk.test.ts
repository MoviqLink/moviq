import { agentSetupSchema, agentTalkSchema, savedRulesSchema } from '@moviq/contracts';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';

import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import { unexpectedError } from '../../src/infrastructure/http/errors.js';
import { createTokenBudget } from '../../src/modules/assistant/budget.js';
import type { ModelRequest, ModelStep } from '../../src/modules/assistant/model/language-model.js';
import { modelTalk } from '../../src/modules/commerce/agent-talk.js';
import { merchantRoutes } from '../../src/modules/commerce/merchant-routes.js';
import { memoryLogger } from '../support/memory-logger.js';
import { browser, commerceWorld, needRequest, type CommerceWorld } from './support/commerce.js';
import { merchantSession } from './support/orders.js';

let world: CommerceWorld | undefined;

afterEach(async () => {
  await world?.temp.dispose();
  world = undefined;
});

const RAMEN = 'demo-tsuki-ramen-house';

/** The panel with the agent's talk on a model that answers what the test says. */
async function talking(answer: (request: ModelRequest) => ModelStep) {
  const current = await commerceWorld();
  world = current;
  const seen: ModelRequest[] = [];
  const talk = modelTalk({
    model: {
      model: 'test-model',
      maxTokensPerStep: 1000,
      open: (request) => {
        seen.push(request);
        return { step: () => Promise.resolve(answer(request)) };
      },
    },
    budget: createTokenBudget(current.db, current.clock, 100_000),
    logger: memoryLogger().logger,
  });
  const app = new Hono<AppBindings>();
  app.use(requestContext(memoryLogger().logger));
  app.route('/api/merchant', merchantRoutes({ ...current.deps, talk }));
  app.onError(unexpectedError);
  const merchant = browser(app);
  await merchant.post('/api/merchant/session', { token: MERCHANT_TEST_TOKEN, merchantId: RAMEN });
  const setup = agentSetupSchema.parse((await merchant.get('/api/merchant/agent')).body);
  const say = async (message: string) => {
    const answer = await merchant.post('/api/merchant/agent/talk', { message, language: 'en' });
    return agentTalkSchema.parse(answer.body);
  };
  return { merchant, setup, seen, say };
}

const proposing =
  (maxDiscountPercent: number) =>
  (request: ModelRequest): ModelStep => {
    const rules = (JSON.parse(request.context) as { rules: Record<string, unknown> }).rules;
    return {
      ok: true,
      kind: 'calls',
      usage: { totalTokens: 200 },
      calls: [
        {
          callId: 'c1',
          name: 'propose_rules',
          arguments: {
            rules: { ...rules, maxDiscountPercent },
            explanation: `Your next offers can go up to ${String(maxDiscountPercent)}% off.`,
          },
        },
      ],
    };
  };

describe('talking with the agent in "Your agent" (F-J9-14)', () => {
  it('says the chat is off without a model, and the rest of the panel works', async () => {
    world = await commerceWorld();
    const merchant = await merchantSession(world);
    const answer = await merchant.post('/api/merchant/agent/talk', {
      message: 'Why did you refuse that offer?',
      language: 'es',
    });
    expect(agentTalkSchema.parse(answer.body)).toEqual({ mode: 'off' });
    expect((await merchant.get('/api/merchant/agent')).status).toBe(200);
  });

  it('proposes a change of rule, checked, and saves nothing until the merchant confirms it', async () => {
    const { merchant, setup, say } = await talking(proposing(12));
    const answer = await say('Raise the maximum discount to 12%');
    expect(answer).toMatchObject({
      mode: 'answer',
      reply: 'Your next offers can go up to 12% off.',
      refused: null,
      proposal: { version: setup.version, rules: { maxDiscountPercent: 12 } },
    });
    const unchanged = agentSetupSchema.parse((await merchant.get('/api/merchant/agent')).body);
    expect(unchanged.rules.maxDiscountPercent).toBe(setup.rules.maxDiscountPercent);
    if (answer.mode !== 'answer' || answer.proposal === null) throw new Error('No proposal.');
    const saved = await merchant.put('/api/merchant/agent', answer.proposal);
    expect(savedRulesSchema.parse(saved.body).rules.maxDiscountPercent).toBe(12);
  });

  it('never proposes what the server would refuse, and says why', async () => {
    const { say } = await talking(proposing(5));
    expect(await say('Only 5% off from now on')).toMatchObject({
      mode: 'answer',
      proposal: null,
      refused:
        'MovIQ requires every offer to be at least 10% below the menu price, so the maximum ' +
        'discount cannot be lower.',
    });
  });

  it('answers from its real rules and refusals, never with an alias', async () => {
    const { seen, say } = await talking(() => ({
      ok: true,
      kind: 'text',
      text: 'I cannot move money: refunds are made in Scan, payouts in Payouts.',
      usage: { totalTokens: 100 },
    }));
    await browser(world?.app ?? new Hono()).post('/api/commerce/needs', needRequest());
    const answer = await say('Give Mia her money back');
    expect(answer).toEqual({
      mode: 'answer',
      reply: 'I cannot move money: refunds are made in Scan, payouts in Payouts.',
      proposal: null,
      refused: null,
    });
    const context = seen[0]?.context ?? '';
    expect(context).toContain('"maxDiscountPercent":25');
    expect(context).toContain('"hours"');
    expect(context).not.toContain('Mia');
    expect(seen[0]?.message).toBe('Give Mia her money back');
  });

  it('says the agent could not answer when the model gives nothing usable', async () => {
    const { say } = await talking(() => ({
      ok: false,
      reason: 'unavailable',
      detail: 'timeout',
      usage: null,
    }));
    expect(await say('Hello')).toEqual({ mode: 'unavailable' });
  });
});
