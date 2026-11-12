import type { Transaction } from '@libsql/client';
import type { HoldPurpose, Money, OfferLine, OrderStatus } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { HoldPurchases } from '../payments/holds/hold-context.js';
import { holdLedger } from '../payments/holds/hold-ledger.js';
import { virtualReservationAllowed } from '../virtual-rides/validation.js';
import { conversations } from './conversation.js';
import { merchantStore, type MenuItem } from './merchants.js';
import { needStore, offerClosed, offerStore, type OfferRecord } from './offers-store.js';
import { orderStore, type OrderRecord, type TicketLine } from './orders-store.js';
import { retireCodes } from './pickup-code.js';

const MINUTE = 60_000;

/**
 * What a hold buys: the order and its kitchen ticket once PayPal holds the money, the pickup
 * once PayPal charged it, the cancellation once PayPal released it. Each runs inside the
 * transaction that records PayPal's confirmation, so neither exists without the other.
 */
export function commercePurchases(deps: { readonly clock: Clock }): HoldPurchases {
  return {
    authorized: (purpose, holdId, tx) => openOrder(tx, purpose, holdId, deps.clock.now()),
    captured: (_purpose, holdId, tx) => handOver(tx, holdId, deps.clock.now()),
    voided: (_purpose, holdId, tx) => cancel(tx, holdId, deps.clock.now()),
  };
}

/**
 * PayPal holds the money: the order and its ticket exist, if the offer still holds at the server's
 * time and the kitchen still has room. Refusing here releases the authorization.
 */
async function openOrder(tx: Transaction, purpose: HoldPurpose, holdId: string, now: Date) {
  const offer = await offerStore.find(tx, purpose.offerId);
  if (offer === undefined) throw new Error('This offer is no longer available.');
  if (!(await virtualReservationAllowed(tx, offer.travellerId, offer.id, now)))
    throw new Error('The route to this invitation is no longer feasible.');
  const closed = offerClosed(offer, now);
  if (closed !== undefined) throw new Error(closed);
  const merchant = await merchantStore.find(tx, offer.merchantId);
  if (merchant === undefined) throw new Error('The merchant of this offer is gone.');
  const setup = await merchantStore.setup(tx, merchant);
  const pickupAt = new Date(offer.pickupAt);
  const booked = await orderStore.inSlot(tx, offer.merchantId, pickupAt);
  if (booked >= setup.rules.ordersPerQuarterHour) {
    throw new Error('The kitchen filled up before the reservation was confirmed.');
  }
  const thread = await conversations.find(tx, offer.threadId);
  const need = thread === undefined ? undefined : await needStore.find(tx, thread.needId);
  const hold = await holdLedger.find(tx, holdId);
  if (need === undefined || hold === undefined) throw new Error('The need of this offer is gone.');
  const kitchenStartsAt = new Date(pickupAt.getTime() - setup.rules.prepMinutes * MINUTE);
  const order = await orderStore.insert(
    tx,
    {
      offerId: offer.id,
      holdId,
      travellerId: offer.travellerId,
      merchantId: offer.merchantId,
      alias: need.alias,
      pickupAt: offer.pickupAt,
      kitchenStartsAt: kitchenStartsAt.toISOString(),
      ticket: ticketFor(offer, setup.menu),
    },
    merchant.codeLetter,
    now,
  );
  if (!(await offerStore.move(tx, offer.id, 'open', 'reserved'))) {
    throw new Error('The offer moved meanwhile.');
  }
  await tell(tx, offer.threadId, order, { step: 'authorized', amount: hold.amount }, now);
}

/** PayPal charged it: the order is handed over and its codes no longer work. */
async function handOver(tx: Transaction, holdId: string, now: Date) {
  const order = await orderStore.ofHold(tx, holdId);
  const hold = await holdLedger.find(tx, holdId);
  if (order === undefined || hold === undefined) throw new Error('The order of this hold is gone.');
  const moved =
    order.status === 'picked_up' ? order : await orderStore.move(tx, order, 'picked_up', now);
  if (moved === undefined) throw new Error('The order moved meanwhile.');
  await retireCodes(tx, order.id, now);
  await tell(tx, undefined, moved, { step: 'captured', amount: hold.amount }, now);
}

/** PayPal released it: an order that was only reserved is cancelled. */
async function cancel(tx: Transaction, holdId: string, now: Date) {
  const order = await orderStore.ofHold(tx, holdId);
  const hold = await holdLedger.find(tx, holdId);
  if (order === undefined || hold === undefined) return;
  const moved =
    order.status === 'reserved' ? await orderStore.move(tx, order, 'cancelled', now) : order;
  if (moved === undefined) throw new Error('The order moved meanwhile.');
  await retireCodes(tx, order.id, now);
  await tell(tx, undefined, moved, { step: 'voided', amount: hold.amount }, now);
}

/** Writes PayPal's answer and the order's state into the conversation that led to it. */
async function tell(
  tx: Transaction,
  threadId: string | undefined,
  order: OrderRecord,
  payment: { readonly step: 'authorized' | 'captured' | 'voided'; readonly amount: Money },
  now: Date,
): Promise<void> {
  const thread = threadId ?? (await offerStore.find(tx, order.offerId))?.threadId;
  if (thread === undefined) return;
  const status: OrderStatus = order.status;
  const code = order.code;
  await conversations.append(tx, thread, { type: 'payment', from: 'server', ...payment }, now);
  await conversations.append(tx, thread, { type: 'order', from: 'server', code, status }, now);
}

/**
 * The kitchen ticket: each line as composed, with what the traveller pays for it. The price is
 * spread over the lines in proportion to their menu price; the last line takes the rounding.
 */
function ticketFor(
  offer: Pick<OfferRecord, 'lines' | 'listMinor' | 'priceMinor'>,
  menu: readonly MenuItem[],
): TicketLine[] {
  let left = offer.priceMinor;
  return offer.lines.map((line, index) => {
    const item = menu.find((candidate) => candidate.id === line.itemId);
    const list = item === undefined ? 0 : lineList(item, line);
    const last = index === offer.lines.length - 1;
    const paid = last ? left : Math.floor((list * offer.priceMinor) / offer.listMinor);
    left -= paid;
    const name = item?.name ?? line.itemId;
    return { name, quantity: line.quantity, remove: line.remove, add: line.add, paidMinor: paid };
  });
}

export function lineList(item: MenuItem, line: OfferLine): number {
  const extras = item.extras
    .filter((extra) => line.add.includes(extra.name))
    .reduce((sum, extra) => sum + extra.priceMinor, 0);
  return (item.priceMinor + extras) * line.quantity;
}
