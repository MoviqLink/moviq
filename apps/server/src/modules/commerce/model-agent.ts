import { z } from 'zod';

import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { TokenBudget } from '../assistant/budget.js';
import type { LanguageModel, ModelStep, ToolSpec } from '../assistant/model/language-model.js';
import { findPersonalData, scrubPersonalData } from '../assistant/privacy.js';
import type { AgentReply, AgentTurn, MerchantAgent } from './agent.js';
import { composeByRules } from './rules-agent.js';

const INSTRUCTIONS = [
  "You are the agent of a demo merchant on MovIQ. Compose ONE offer made for this traveller's need,",
  'or ask ONE short clarification when the need truly leaves a choice open. Use only items, removable',
  'ingredients and extras listed in the menu. Never include an allergen or a disliked ingredient the',
  'need lists, nor alcohol when noAlcohol is true. Price in integer US cents: at least',
  'minRewardPercent below the menu price and never more than maxDiscountPercent below it. The server',
  'checks every rule and refuses what breaks one; read its previous refusals and fix them. Pickup no',
  'earlier than earliestPickup. You never charge, refund or change money: you only propose.',
].join(' ');

const offerArguments = z.toJSONSchema(
  z.strictObject({
    lines: z
      .array(
        z.strictObject({
          itemId: z.string(),
          quantity: z.number().int().min(1).max(4),
          remove: z.array(z.string()),
          add: z.array(z.string()),
        }),
      )
      .min(1)
      .max(4),
    priceMinor: z.number().int(),
    pickupAt: z.string(),
    note: z.string(),
  }),
);

const clarificationArguments = z.toJSONSchema(
  z.strictObject({
    topic: z.enum(['spice', 'drink', 'size']),
    question: z.string(),
    options: z.array(z.string()).min(2).max(4),
  }),
);

const TOOLS: readonly ToolSpec[] = [
  {
    name: 'propose_offer',
    description: 'Proposes the offer for this need.',
    parameters: withoutMeta(offerArguments),
  },
  {
    name: 'ask_clarification',
    description: 'Asks Sara one short question before composing.',
    parameters: withoutMeta(clarificationArguments),
  },
];

function withoutMeta(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const { $schema, ...parameters } = schema;
  return parameters;
}

/**
 * The merchant's agent on the language model, behind the same interface as Sara's. It sends the
 * need's preferences, the menu, the agent's limits and the conversation, never the alias or
 * anything personal. Without an answer it can use (no budget, an error, a reply that is not one
 * tool call), the merchant's rules compose instead, and the offer says so.
 */
export function modelAgent(deps: {
  readonly model: LanguageModel;
  readonly budget: TokenBudget;
  readonly logger: Logger;
}): MerchantAgent {
  return {
    respond: async (turn) => {
      const context = JSON.stringify(contextFor(turn));
      const message = scrubPersonalData(turn.need.craving);
      if (findPersonalData([context, message]) !== undefined) return composeByRules(turn);
      const reservation = await deps.budget.reserve(deps.model.maxTokensPerStep);
      if (reservation === undefined) return composeByRules(turn);
      let used: number | null = null;
      try {
        const exchange = deps.model.open({
          instructions: INSTRUCTIONS,
          context,
          message,
          tools: TOOLS,
        });
        const step = await exchange.step([]);
        used = step.usage?.totalTokens ?? null;
        return fromStep(step, turn, deps.logger);
      } finally {
        await deps.budget.settle(reservation, used);
      }
    },
  };
}

function fromStep(step: ModelStep, turn: AgentTurn, logger: Logger): AgentReply {
  if (!step.ok || step.kind !== 'calls' || step.calls.length !== 1) {
    logger.info('merchant agent fell back to its rules', {
      reason: step.ok ? step.kind : step.reason,
    });
    return composeByRules(turn);
  }
  const [call] = step.calls;
  const args = call?.arguments;
  if (call === undefined || typeof args !== 'object' || args === null) {
    return { message: args, composer: 'model' };
  }
  const type =
    call.name === 'propose_offer'
      ? 'offer'
      : call.name === 'ask_clarification'
        ? 'clarification'
        : call.name;
  return { message: { ...args, type, from: 'merchant-agent' }, composer: 'model' };
}

function contextFor(turn: AgentTurn) {
  const { need, setup } = turn;
  return {
    need: { craving: need.craving, category: need.category, preferences: need.preferences },
    window: { earliestPickup: turn.earliestPickup.toISOString(), latestPickup: need.pickupBefore },
    menu: setup.menu.map((item) => ({
      id: item.id,
      name: item.name,
      priceMinor: item.priceMinor,
      diet: item.diet,
      alcohol: item.alcohol,
      ingredients: item.ingredients,
      extras: item.extras,
    })),
    limits: {
      minRewardPercent: turn.minRewardPercent,
      maxDiscountPercent: setup.rules.maxDiscountPercent,
      featuredItemIds: setup.rules.featuredItemIds,
    },
    clarificationsLeft: turn.clarificationsLeft,
    conversation: turn.history.filter((message) => message.type !== 'need'),
  };
}
