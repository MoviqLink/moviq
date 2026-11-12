import type { NeedView, OrderView, Reward, RewardOffer } from '@moviq/contracts';

import type { Secret } from '../../config/secret.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { holdLedger, type HoldRecord } from '../payments/holds/hold-ledger.js';
import { refundStore } from '../payments/holds/hold-refund-store.js';
import { conversations } from './conversation.js';
import { merchantStore, type MenuItem } from './merchants.js';
import { offerStore, type NeedRecord, type OfferRecord } from './offers-store.js';
import type { OrderRecord, TicketLine } from './orders-store.js';
import { issueCode } from './pickup-code.js';

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' as const });

function rewardOf(listMinor: number, priceMinor: number): Reward {
  const earned = listMinor - priceMinor;
  return {
    listPrice: usd(listMinor),
    price: usd(priceMinor),
    earned: usd(earned),
    percent: Math.floor((earned * 100) / listMinor),
  };
}

const changes = (remove: readonly string[], add: readonly string[]) =>
  [...remove.map((name) => `without ${name}`), ...add.map((name) => `with ${name}`)].join(', ');

/** A need as its traveller sees it: the offers on the way and every conversation that led to them. */
export async function needView(
  deps: { readonly db: Database; readonly clock: Clock },
  need: NeedRecord,
): Promise<NeedView> {
  const threads = await conversations.ofNeed(deps.db, need.id);
  const offers: RewardOffer[] = [];
  const views = [];
  for (const thread of threads) {
    const offer = await offerStore.ofThread(deps.db, thread.id);
    if (offer !== undefined) {
      const view = await offerView(deps, offer);
      if (view !== undefined) offers.push(view);
    }
    views.push({
      id: thread.id,
      merchantId: thread.merchantId,
      status: thread.status,
      question:
        thread.question === null
          ? null
          : { ...thread.question, options: [...thread.question.options] },
      conversation: [...(await conversations.messages(deps.db, thread.id))],
    });
  }
  const waiting = views.some((thread) => thread.status === 'awaiting-traveller');
  return {
    id: need.id,
    craving: need.craving,
    createdAt: need.createdAt,
    offers,
    threads: views,
    message:
      offers.length > 0 || waiting
        ? null
        : 'No merchant on your next stops can make it for you right now.',
  };
}

export async function offerView(
  deps: { readonly db: Database; readonly clock: Clock },
  offer: OfferRecord,
): Promise<RewardOffer | undefined> {
  const merchant = await merchantStore.find(deps.db, offer.merchantId);
  if (merchant === undefined) return undefined;
  const { menu } = await merchantStore.setup(deps.db, merchant);
  const expired =
    offer.status === 'open' && new Date(offer.expiresAt).getTime() <= deps.clock.now().getTime();
  return {
    id: offer.id,
    merchant: merchant.summary,
    lines: lineViews(menu, offer.lines),
    reward: rewardOf(offer.listMinor, offer.priceMinor),
    pickupAt: offer.pickupAt,
    detourMinutes: offer.detourMinutes,
    note: offer.note,
    composer: offer.composer,
    recommended: offer.recommended,
    status: expired ? 'expired' : offer.status,
    expiresAt: offer.expiresAt,
  };
}

/** An order as its traveller sees it, with a fresh signed code while it can be collected. */
export async function orderView(
  deps: { readonly db: Database; readonly clock: Clock; readonly secret: Secret },
  order: OrderRecord,
): Promise<OrderView | undefined> {
  const [merchant, hold, offer] = await Promise.all([
    merchantStore.find(deps.db, order.merchantId),
    holdLedger.find(deps.db, order.holdId),
    offerStore.find(deps.db, order.offerId),
  ]);
  if (merchant === undefined || hold === undefined || offer === undefined) return undefined;
  const now = deps.clock.now();
  const collectable =
    order.status !== 'picked_up' && order.status !== 'cancelled' && hold.status === 'authorized';
  return {
    id: order.id,
    code: order.code,
    merchant: merchant.summary,
    status: order.status,
    lines: order.ticket.map(ticketLine),
    reward: rewardOf(offer.listMinor, offer.priceMinor),
    pickupAt: order.pickupAt,
    kitchenStartsAt: order.kitchenStartsAt,
    freeCancellation:
      order.status === 'reserved' && now.getTime() < new Date(order.kitchenStartsAt).getTime(),
    payment: await paymentOf(deps.db, hold),
    pickup: collectable ? await issueCode(deps.db, deps.secret, order.id, now) : null,
  };
}

export async function paymentOf(db: Database, hold: HoldRecord): Promise<OrderView['payment']> {
  const refunds = await refundStore.totals(db, hold.id);
  return {
    holdId: hold.id,
    status: hold.status,
    authorized: hold.amount,
    captured: usd(hold.capturedMinor),
    refunded: usd(refunds.completed),
    refundPending: usd(refunds.pending),
  };
}

export function ticketLine(line: TicketLine) {
  return { name: line.name, quantity: line.quantity, changes: changes(line.remove, line.add) };
}

/** The lines of an offer as people read them: the dish, how many, and what changes. */
export function lineViews(
  menu: readonly MenuItem[],
  lines: readonly {
    readonly itemId: string;
    readonly quantity: number;
    readonly remove: readonly string[];
    readonly add: readonly string[];
  }[],
): RewardOffer['lines'] {
  return lines.map((line) => ({
    name: nameOf(menu, line.itemId),
    quantity: line.quantity,
    changes: changes(line.remove, line.add),
  }));
}

function nameOf(menu: readonly MenuItem[], itemId: string): string {
  return menu.find((item) => item.id === itemId)?.name ?? itemId;
}
