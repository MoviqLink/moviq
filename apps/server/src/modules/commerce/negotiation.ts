import {
  merchantMessageSchema,
  toInstant,
  type MerchantMessage,
  type NeedMessage,
  type ProtocolMessage,
} from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { MerchantAgent } from './agent.js';
import { conversations, type ThreadRecord } from './conversation.js';
import type { MerchantAgentSetup } from './merchants.js';
import { checkOffer } from './offer-check.js';
import { offerStore, type NeedRecord } from './offers-store.js';
import { orderStore } from './orders-store.js';
import type { CommerceSettings } from './settings.js';

export interface CommerceContext {
  readonly db: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly settings: CommerceSettings;
  readonly agent: MerchantAgent;
}

/** An offer stays valid this long, or until its pickup, whichever comes first. */
const OFFER_TTL_MS = 15 * 60_000;
const MINUTE = 60_000;

type Clarification = Extract<MerchantMessage, { type: 'clarification' }>;
type Offer = Extract<MerchantMessage, { type: 'offer' }>;

/**
 * Runs the protocol of one conversation until it has a validated offer, waits for the traveller,
 * or closes. Every message of the merchant's agent is untrusted: it is validated against the
 * protocol, and an offer reaches Sara only after the server's check accepted it. The number of
 * clarifications and of offers asked for is bounded by the settings.
 */
export async function negotiate(
  ctx: CommerceContext,
  start: ThreadRecord,
  need: NeedRecord,
  setup: MerchantAgentSetup,
): Promise<ThreadRecord> {
  let thread = start;
  while (thread.status === 'negotiating') {
    if (thread.attempts >= ctx.settings.maxOfferAttempts) {
      return close(ctx, thread, 'no-valid-offer', 'No offer from this merchant passed the checks.');
    }
    const history = (await conversations.messages(ctx.db, thread.id)).map((entry) => entry.message);
    const needMessage = history.find((message) => message.type === 'need');
    if (needMessage?.type !== 'need') throw new Error(`Conversation ${thread.id} has no need.`);
    const reply = await ctx.agent.respond({
      need: needMessage,
      setup,
      history,
      minRewardPercent: ctx.settings.minRewardPercent,
      earliestPickup: new Date(ctx.clock.now().getTime() + setup.rules.prepMinutes * MINUTE),
      clarificationsLeft: Math.max(0, ctx.settings.maxClarifications - thread.clarifications),
    });
    if (reply.message === null) {
      return close(ctx, thread, 'no-valid-offer', 'This merchant cannot make it for you now.');
    }
    const parsed = merchantMessageSchema.safeParse(reply.message);
    if (!parsed.success) {
      const reason = parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'message'}: ${issue.message}`,
      );
      thread = await write(ctx, thread, [refusedMessage(reason.join('; '))], {
        attempts: thread.attempts + 1,
      });
      ctx.logger.warn('merchant agent message refused', { threadId: thread.id });
      continue;
    }
    thread =
      parsed.data.type === 'clarification'
        ? await clarify(ctx, thread, need, parsed.data)
        : await consider(ctx, thread, need, setup, needMessage, parsed.data, reply.composer);
  }
  return thread;
}

/** Sara answers from the traveller's tastes when she can, or asks the traveller. */
async function clarify(
  ctx: CommerceContext,
  thread: ThreadRecord,
  need: NeedRecord,
  question: Clarification,
): Promise<ThreadRecord> {
  if (thread.clarifications >= ctx.settings.maxClarifications) {
    const written = await write(ctx, thread, [question], {});
    return close(
      ctx,
      written,
      'clarifications-exhausted',
      'Too many questions: this need closed without an offer.',
    );
  }
  const known =
    question.topic === 'spice'
      ? need.taste.spice
      : question.topic === 'drink'
        ? need.taste.drink
        : null;
  const counted = { clarifications: thread.clarifications + 1 };
  if (known !== null) {
    const answer: ProtocolMessage = {
      type: 'answer',
      from: 'sara',
      topic: question.topic,
      answer: known,
      basis: 'profile',
    };
    return write(ctx, thread, [question, answer], counted);
  }
  return write(ctx, thread, [question], {
    ...counted,
    status: 'awaiting-traveller',
    question: { topic: question.topic, text: question.question, options: question.options },
  });
}

/** The server's check of an offer: accepted, it is stored for Sara; refused, the agent recomposes. */
async function consider(
  ctx: CommerceContext,
  thread: ThreadRecord,
  need: NeedRecord,
  setup: MerchantAgentSetup,
  needMessage: NeedMessage,
  offer: Offer,
  composer: 'model' | 'rules',
): Promise<ThreadRecord> {
  const now = ctx.clock.now();
  const pickupAt = new Date(offer.pickupAt);
  const check = checkOffer({
    offer,
    need: needMessage,
    setup,
    minRewardPercent: ctx.settings.minRewardPercent,
    ordersInSlot: await orderStore.inSlot(ctx.db, setup.merchant.summary.id, pickupAt),
    earliestPickup: new Date(now.getTime() + setup.rules.prepMinutes * MINUTE),
  });
  const verdict: ProtocolMessage = check.ok
    ? { type: 'check', from: 'server', verdict: 'accepted', refusals: [], reward: check.reward }
    : {
        type: 'check',
        from: 'server',
        verdict: 'rejected',
        refusals: [...check.refusals],
        reward: null,
      };
  if (!check.ok) return write(ctx, thread, [offer, verdict], { attempts: thread.attempts + 1 });
  const waitMinutes = Math.max(
    0,
    Math.ceil((pickupAt.getTime() - new Date(thread.passAt).getTime()) / MINUTE),
  );
  const virtual = await ctx.db.query({
    sql: 'SELECT created_at FROM virtual_ride_needs WHERE need_id = ?',
    args: [need.id],
  });
  const started = virtual.rows[0]?.['created_at'];
  const expires =
    typeof started === 'string'
      ? Math.min(now.getTime() + OFFER_TTL_MS, Date.parse(started) + 5 * MINUTE)
      : now.getTime() + OFFER_TTL_MS;
  return ctx.db.transaction(async (tx) => {
    await conversations.append(tx, thread.id, offer, now);
    await conversations.append(tx, thread.id, verdict, now);
    await offerStore.insert(
      tx,
      {
        threadId: thread.id,
        travellerId: need.travellerId,
        merchantId: setup.merchant.summary.id,
        lines: offer.lines,
        listMinor: check.listMinor,
        priceMinor: offer.priceMinor,
        pickupAt: offer.pickupAt,
        detourMinutes: setup.merchant.summary.walkMinutes * 2 + waitMinutes,
        note: offer.note,
        composer,
        expiresAt: toInstant(new Date(Math.min(expires, pickupAt.getTime()))),
      },
      now,
    );
    return conversations.update(
      tx,
      thread,
      { status: 'offered', attempts: thread.attempts + 1 },
      now,
    );
  });
}

function refusedMessage(reason: string): ProtocolMessage {
  return {
    type: 'refused-message',
    from: 'server',
    of: 'merchant-agent',
    reason: reason.slice(0, 200),
  };
}

export function close(
  ctx: CommerceContext,
  thread: ThreadRecord,
  reason: 'no-valid-offer' | 'clarifications-exhausted' | 'expired' | 'unavailable',
  message: string,
): Promise<ThreadRecord> {
  return write(ctx, thread, [{ type: 'closed', from: 'server', reason, message }], {
    status: 'closed',
    question: null,
  });
}

/** Appends messages and moves the conversation, in one transaction. */
export function write(
  ctx: CommerceContext,
  thread: ThreadRecord,
  messages: readonly ProtocolMessage[],
  change: Parameters<typeof conversations.update>[2],
): Promise<ThreadRecord> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    for (const message of messages) await conversations.append(tx, thread.id, message, now);
    return conversations.update(tx, thread, change, now);
  });
}
