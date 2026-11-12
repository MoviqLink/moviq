import type { Taste } from '@moviq/contracts';
import { z } from 'zod';

import type { Logger } from '../../infrastructure/telemetry/logger.js';
import { moneyText } from '../assistant/journey/facts.js';
import type { ToolCall, ToolResult, ToolSpec } from '../assistant/model/language-model.js';
import { time } from '../assistant/planning/words.js';
import {
  commerceContext,
  holdContext,
  paymentsReason,
  type CommerceDependencies,
} from './context.js';
import { createNeed } from './needs.js';
import { reserveOffer } from './reservations.js';
import { needView } from './views.js';

/** What Sara knows of the traveller for these tools: never sent to the model, only used here. */
export interface RewardToolContext {
  readonly deps: CommerceDependencies;
  readonly logger: Logger;
  readonly travellerId: string;
  readonly journeyId: string;
  readonly alias: string;
  readonly taste: Taste;
  readonly language: 'en' | 'es';
}

const findSchema = z.strictObject({ craving: z.string().trim().min(2).max(80) });
const reserveSchema = z.strictObject({ offer_id: z.string().min(1).max(60) });

const spec = (name: string, description: string, schema: z.ZodType): ToolSpec => {
  const { $schema, ...parameters } = z.toJSONSchema(schema);
  return { name, description, parameters };
};

/**
 * Sara's commerce tools. `find_rewards` asks the demo merchants on the traveller's journey and
 * returns only offers the server validated, with their reward; `reserve_offer` opens the PayPal
 * order of one of them for the traveller to approve. Neither charges, refunds nor sets an
 * amount: every price is the server's, and nothing is held until the person approves in PayPal.
 */
export const REWARD_TOOLS: readonly ToolSpec[] = [
  spec(
    'find_rewards',
    'Asks the demo merchants on the traveller\'s journey for what they want ("ramen", "a coffee"). ' +
      'Returns the offers the server validated, each with its reward, pickup time and detour, ' +
      'and the questions a merchant asks the traveller, who answers them on the screen.',
    findSchema,
  ),
  spec(
    'reserve_offer',
    'Opens the PayPal reservation of one offer returned by find_rewards. The traveller must ' +
      'approve it in the PayPal window; nothing is held before.',
    reserveSchema,
  ),
];

/** An offer as Sara says it: prices and the pickup time written as the traveller reads them. */
interface FoundOffer {
  readonly offer_id: string;
  readonly merchant: string;
  readonly stop: string;
  readonly lines: readonly { name: string; quantity: number; changes: string }[];
  readonly pays: string;
  readonly earns: string;
  readonly reward_percent: number;
  readonly pickup_at: string;
  readonly detour_minutes: number;
  readonly recommended: boolean;
}

/** What `find_rewards` found: the need, its validated offers and what a merchant still asks. */
export type FoundRewards =
  | {
      readonly ok: true;
      readonly needId: string;
      readonly message: string | null;
      readonly offers: readonly FoundOffer[];
      readonly questions: readonly { question: string; options: readonly string[] }[];
    }
  | { readonly ok: false; readonly error: string };

/** Passes the craving to the demo merchants on the journey, as the traveller's need. */
export async function findRewards(ctx: RewardToolContext, craving: string): Promise<FoundRewards> {
  const outcome = await createNeed(commerceContext(ctx.deps, ctx.logger), ctx.travellerId, {
    craving,
    alias: ctx.alias,
    taste: ctx.taste,
    route: { journeyId: ctx.journeyId },
    language: ctx.language,
  });
  if (!outcome.ok) return { ok: false, error: outcome.message };
  const view = await needView(ctx.deps, outcome.need);
  const money = (value: Parameters<typeof moneyText>[0]) => moneyText(value, ctx.language);
  return {
    ok: true,
    needId: view.id,
    message: view.message,
    offers: view.offers.map((offer) => ({
      offer_id: offer.id,
      merchant: `${offer.merchant.name} (demo)`,
      stop: offer.merchant.stop.name,
      lines: offer.lines,
      pays: money(offer.reward.price),
      earns: money(offer.reward.earned),
      reward_percent: offer.reward.percent,
      pickup_at: time(new Date(offer.pickupAt), ctx.language),
      detour_minutes: offer.detourMinutes,
      recommended: offer.recommended,
    })),
    questions: view.threads.flatMap((thread) =>
      thread.status === 'awaiting-traveller' && thread.question !== null
        ? [{ question: thread.question.text, options: thread.question.options }]
        : [],
    ),
  };
}

export async function runRewardTool(call: ToolCall, ctx: RewardToolContext): Promise<ToolResult> {
  const answer = (value: unknown): ToolResult => ({
    callId: call.callId,
    output: JSON.stringify(value),
  });
  if (call.name === 'find_rewards') {
    const parsed = findSchema.safeParse(call.arguments);
    if (!parsed.success) return answer({ error: 'craving must be 2 to 80 characters' });
    const found = await findRewards(ctx, parsed.data.craving);
    if (!found.ok) return answer({ error: found.error });
    const { message, offers, questions } = found;
    return answer({ need_id: found.needId, message, offers, questions });
  }
  if (call.name === 'reserve_offer') {
    const parsed = reserveSchema.safeParse(call.arguments);
    if (!parsed.success) return answer({ error: 'offer_id is required' });
    const hold = holdContext(ctx.deps, ctx.logger);
    if (hold === undefined) return answer({ error: paymentsReason(ctx.deps) });
    const outcome = await reserveOffer(hold, {
      travellerId: ctx.travellerId,
      offerId: parsed.data.offer_id,
      language: ctx.language,
    });
    if (!outcome.ok) return answer({ error: outcome.message });
    return answer({
      paypal_order_id: outcome.hold.paypalOrderId,
      amount: moneyText(outcome.hold.amount, ctx.language),
      next: 'The traveller approves the reservation with the PayPal button under the offer.',
    });
  }
  return answer({ error: `unknown tool ${call.name}` });
}
