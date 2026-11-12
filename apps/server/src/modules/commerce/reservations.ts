import { virtualReservationAllowed } from '../virtual-rides/validation.js';
import type { Money } from '@moviq/contracts';

import { toNewYorkWallClockText } from '../../infrastructure/clock/new-york.js';
import {
  decideAgainWhenStale,
  type HoldContext,
  type HoldOutcome,
} from '../payments/holds/hold-context.js';
import { holdLedger, purposeKey, type HoldRecord } from '../payments/holds/hold-ledger.js';
import { authorizeHold, startHold, voidHold } from '../payments/holds/hold-steps.js';
import { lineList } from './hold-purchases.js';
import { merchantStore, type MerchantAgentSetup } from './merchants.js';
import { offerClosed, offerStore, type OfferRecord } from './offers-store.js';
import type { OrderRecord } from './orders-store.js';

export interface Refusal {
  readonly ok: false;
  readonly status: 404 | 409;
  readonly message: string;
}

const NO_OFFER: Refusal = { ok: false, status: 404, message: 'There is no offer with that id.' };

/**
 * Reserving an offer opens a PayPal order of intent AUTHORIZE for the price the server
 * validated, with the lines and the reward shown in the PayPal window. Nothing is held until the
 * buyer approves it there and `confirmReservation` asks PayPal to authorize it.
 */
export async function reserveOffer(
  ctx: HoldContext,
  input: { readonly travellerId: string; readonly offerId: string; readonly language: 'en' | 'es' },
): Promise<HoldOutcome | Refusal> {
  const offer = await offerStore.find(ctx.db, input.offerId);
  if (offer?.travellerId !== input.travellerId) return NO_OFFER;
  if (!(await virtualReservationAllowed(ctx.db, input.travellerId, input.offerId, ctx.clock.now())))
    return {
      ok: false,
      status: 409,
      message: 'Plan a feasible trip to this invitation before reserving.',
    };
  const closed = offerClosed(offer, ctx.clock.now());
  if (closed !== undefined) return { ok: false, status: 409, message: closed };
  const merchant = await merchantStore.find(ctx.db, offer.merchantId);
  if (merchant === undefined) return NO_OFFER;
  const setup = await merchantStore.setup(ctx.db, merchant);
  const pickup = toNewYorkWallClockText(new Date(offer.pickupAt)).slice(11, 16);
  const hold = {
    travellerId: input.travellerId,
    purpose: { kind: 'merchant-offer', offerId: offer.id } as const,
    amount: usd(offer.priceMinor),
    description: `${merchant.summary.name} (demo), pickup at ${pickup}`.slice(0, 127),
    presentation: presentationFor(offer, setup, input.language),
  };
  return decideAgainWhenStale(() => startHold(ctx, hold));
}

/**
 * After the buyer approved the order in PayPal: PayPal holds the money and the order exists. An
 * offer that no longer holds is refused before anything is held, and its reservation closed.
 */
export async function confirmReservation(
  ctx: HoldContext,
  input: { readonly travellerId: string; readonly offerId: string },
): Promise<HoldOutcome | Refusal> {
  return decideAgainWhenStale(() => confirmOnce(ctx, input));
}

async function confirmOnce(
  ctx: HoldContext,
  input: { readonly travellerId: string; readonly offerId: string },
): Promise<HoldOutcome | Refusal> {
  const hold = await liveHold(ctx, input.travellerId, input.offerId);
  if (hold === undefined) return NO_OFFER;
  if (hold.status !== 'created') return authorizeHold(ctx, hold);
  if (!(await virtualReservationAllowed(ctx.db, input.travellerId, input.offerId, ctx.clock.now())))
    return {
      ok: false,
      status: 409,
      message: 'Plan a feasible trip to this invitation before reserving.',
    };
  const offer = await offerStore.find(ctx.db, input.offerId);
  const closed = offer === undefined ? NO_OFFER.message : offerClosed(offer, ctx.clock.now());
  if (closed === undefined) return authorizeHold(ctx, hold);
  await voidHold(ctx, hold);
  return { ok: false, status: 409, message: closed };
}

/**
 * Cancelling is free until the kitchen starts: the authorization is voided and nothing is
 * charged. Once the kitchen has started, or the order was collected, it is refused.
 */
export async function cancelOrder(
  ctx: HoldContext,
  order: OrderRecord,
): Promise<HoldOutcome | Refusal> {
  if (order.status === 'cancelled')
    return { ok: false, status: 409, message: 'This order is already cancelled.' };
  const started = ctx.clock.now().getTime() >= new Date(order.kitchenStartsAt).getTime();
  if (order.status !== 'reserved' || started) {
    return {
      ok: false,
      status: 409,
      message:
        'The kitchen has already started this order, so it can no longer be cancelled for free.',
    };
  }
  return decideAgainWhenStale(async () => {
    const hold = await holdLedger.find(ctx.db, order.holdId);
    if (hold === undefined) throw new Error(`Order ${order.id} has no hold.`);
    return voidHold(ctx, hold);
  });
}

async function liveHold(
  ctx: HoldContext,
  travellerId: string,
  offerId: string,
): Promise<HoldRecord | undefined> {
  const result = await ctx.db.query({
    sql: `SELECT id FROM payment_holds WHERE traveller_id = ? AND purpose_key = ?
          AND status IN ('unknown', 'created', 'authorized', 'captured')`,
    args: [travellerId, purposeKey({ kind: 'merchant-offer', offerId })],
  });
  const id = result.rows[0]?.['id'];
  return typeof id === 'string' ? holdLedger.find(ctx.db, id) : undefined;
}

/** The PayPal window shows MovIQ, in the traveller's language, each line at its menu price and the reward. */
function presentationFor(
  offer: OfferRecord,
  setup: MerchantAgentSetup,
  language: 'en' | 'es',
): HoldRecord['presentation'] {
  const items = offer.lines.map((line) => {
    const item = setup.menu.find((candidate) => candidate.id === line.itemId);
    if (item === undefined) throw new Error(`Item ${line.itemId} left the menu.`);
    const changes = [
      ...line.remove.map((name) => `no ${name}`),
      ...line.add.map((name) => `+ ${name}`),
    ];
    return {
      name: changes.length === 0 ? item.name : `${item.name} (${changes.join(', ')})`,
      quantity: line.quantity,
      unitAmount: usd(lineList(item, line) / line.quantity),
      category: 'PHYSICAL_GOODS' as const,
    };
  });
  return {
    brandName: 'MovIQ',
    locale: language === 'es' ? 'es-US' : 'en-US',
    items,
    discount: usd(offer.listMinor - offer.priceMinor),
  };
}

const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD' });
