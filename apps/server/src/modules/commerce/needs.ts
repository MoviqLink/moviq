import type { NeedRequest } from '@moviq/contracts';

import { conversations, type ThreadRecord } from './conversation.js';
import { merchantStore, type MerchantAgentSetup } from './merchants.js';
import { buildNeed, itemsFor } from './need.js';
import { close, negotiate, write, type CommerceContext } from './negotiation.js';
import { needStore, offerStore, type NeedRecord, type OfferRecord } from './offers-store.js';
import { merchantsOnTheWay, type Passing } from './route.js';

export type NeedOutcome =
  | { readonly ok: true; readonly need: NeedRecord }
  | { readonly ok: false; readonly status: 404 | 409; readonly message: string };

/**
 * A traveller's need: Sara asks each demo merchant on the way that sells it, each conversation
 * runs the protocol, and Sara recommends one of the offers the server accepted.
 */
export async function createNeed(
  ctx: CommerceContext,
  travellerId: string,
  request: NeedRequest,
  verifiedPassing?: readonly Passing[],
): Promise<NeedOutcome> {
  const route =
    verifiedPassing === undefined
      ? await merchantsOnTheWay(ctx, travellerId, request.route)
      : { ok: true as const, passing: verifiedPassing };
  if (!route.ok) return { ok: false, status: 404, message: route.message };
  const sellers = await withMenus(ctx, route.passing, request.craving);
  const now = ctx.clock.now();
  const opened = await ctx.db.transaction(async (tx) => {
    const need = await needStore.insert(
      tx,
      {
        travellerId,
        craving: request.craving,
        alias: request.alias,
        taste: request.taste,
        language: request.language,
        journeyId: 'journeyId' in request.route ? request.route.journeyId : null,
      },
      now,
    );
    const threads: { thread: ThreadRecord; setup: MerchantAgentSetup }[] = [];
    for (const { passing, setup } of sellers) {
      const thread = await conversations.open(
        tx,
        {
          needId: need.id,
          merchantId: passing.merchant.summary.id,
          passAt: passing.passAt,
          pickupBefore: passing.pickupBefore,
        },
        now,
      );
      const message = buildNeed({
        alias: request.alias,
        craving: request.craving,
        taste: request.taste,
        menu: setup.menu,
        window: { after: passing.passAt, before: passing.pickupBefore },
      });
      await conversations.append(tx, thread.id, message, now);
      threads.push({ thread, setup });
    }
    return { need, threads };
  });
  for (const { thread, setup } of opened.threads) await safely(ctx, thread, opened.need, setup);
  await recommend(ctx, opened.need);
  return { ok: true, need: opened.need };
}

/** The traveller answers a merchant's question; that conversation goes on. */
export async function answerQuestion(
  ctx: CommerceContext,
  need: NeedRecord,
  threadId: string,
  answer: string,
): Promise<NeedOutcome> {
  const thread = await conversations.find(ctx.db, threadId);
  if (thread?.needId !== need.id)
    return { ok: false, status: 404, message: 'There is no such question.' };
  if (thread.status !== 'awaiting-traveller' || thread.question === null) {
    return { ok: false, status: 409, message: 'This merchant is not waiting for an answer.' };
  }
  if (!thread.question.options.includes(answer)) {
    return {
      ok: false,
      status: 409,
      message: `Answer with one of: ${thread.question.options.join(', ')}.`,
    };
  }
  const answered = await write(
    ctx,
    thread,
    [{ type: 'answer', from: 'sara', topic: thread.question.topic, answer, basis: 'traveller' }],
    { status: 'negotiating', question: null },
  );
  const merchant = await merchantStore.find(ctx.db, thread.merchantId);
  if (merchant === undefined) throw new Error(`Merchant ${thread.merchantId} is gone.`);
  await safely(ctx, answered, need, await merchantStore.setup(ctx.db, merchant));
  await recommend(ctx, need);
  return { ok: true, need };
}

/** The traveller turns an offer down; the merchant sees it in the conversation. */
export async function declineOffer(ctx: CommerceContext, offer: OfferRecord): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const moved = await offerStore.move(tx, offer.id, 'open', 'declined');
    if (moved)
      await conversations.append(
        tx,
        offer.threadId,
        { type: 'declined', from: 'sara', offerId: offer.id },
        ctx.clock.now(),
      );
    return moved;
  });
}

async function withMenus(ctx: CommerceContext, passing: readonly Passing[], craving: string) {
  const all = await Promise.all(
    passing.map(async (entry) => ({
      passing: entry,
      setup: await merchantStore.setup(ctx.db, entry.merchant),
    })),
  );
  return all.filter(({ setup }) => itemsFor(craving, setup.menu).length > 0);
}

/** A merchant's agent failing never fails the need: its conversation closes and says why. */
async function safely(
  ctx: CommerceContext,
  thread: ThreadRecord,
  need: NeedRecord,
  setup: MerchantAgentSetup,
) {
  try {
    await negotiate(ctx, thread, need, setup);
  } catch (error) {
    ctx.logger.error('negotiation failed', { threadId: thread.id, error });
    const current = await conversations.find(ctx.db, thread.id);
    if (current !== undefined && current.status !== 'closed') {
      await close(ctx, current, 'unavailable', 'This merchant could not answer right now.');
    }
  }
}

/**
 * Sara's recommendation among the open offers of a need: the largest reward, then the shortest
 * detour. It is written to that offer's conversation once.
 */
async function recommend(ctx: CommerceContext, need: NeedRecord): Promise<void> {
  const offers = await openOffers(ctx, need);
  if (offers.length === 0 || offers.some((offer) => offer.recommended)) return;
  const best = [...offers].sort(
    (a, b) =>
      (b.listMinor - b.priceMinor) / b.listMinor - (a.listMinor - a.priceMinor) / a.listMinor ||
      a.detourMinutes - b.detourMinutes,
  )[0];
  if (best === undefined) return;
  const minutes = String(best.detourMinutes);
  await ctx.db.transaction(async (tx) => {
    await offerStore.recommend(tx, best.id);
    await conversations.append(
      tx,
      best.threadId,
      {
        type: 'recommendation',
        from: 'sara',
        offerId: best.id,
        reason: `The best reward on your way, ${minutes} min out of your trip.`,
      },
      ctx.clock.now(),
    );
  });
}

async function openOffers(ctx: CommerceContext, need: NeedRecord): Promise<readonly OfferRecord[]> {
  const threads = await conversations.ofNeed(ctx.db, need.id);
  const offers = await Promise.all(threads.map((thread) => offerStore.ofThread(ctx.db, thread.id)));
  return offers.filter((offer): offer is OfferRecord => offer?.status === 'open');
}
