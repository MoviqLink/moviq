import type {
  kitchenTicketSchema,
  merchantCustomerSchema,
  merchantRequestSchema,
  merchantTodaySchema,
} from '@moviq/contracts';
import type { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import {
  fromNewYorkWallClockText,
  toNewYorkWallClockText,
} from '../../infrastructure/clock/new-york.js';
import type { Database } from '../../infrastructure/database/database.js';
import { holdLedger } from '../payments/holds/hold-ledger.js';
import { conversations } from './conversation.js';
import type { Merchant } from './merchants.js';
import { offerStore } from './offers-store.js';
import { orderStore, type OrderRecord } from './orders-store.js';
import { offerView, paymentOf, ticketLine } from './views.js';

type KitchenTicket = z.infer<typeof kitchenTicketSchema>;
type MerchantRequest = z.infer<typeof merchantRequestSchema>;
type MerchantToday = z.infer<typeof merchantTodaySchema>;
type MerchantCustomer = z.infer<typeof merchantCustomerSchema>;

interface BoardDependencies {
  readonly db: Database;
  readonly clock: Clock;
}

const REQUESTS_SHOWN = 50;
const LIVE: ReadonlySet<OrderRecord['status']> = new Set(['reserved', 'preparing', 'ready']);

/** Midnight in New York of the day `now` falls in. */
function startOfDay(now: Date): Date {
  return fromNewYorkWallClockText(`${toNewYorkWallClockText(now).slice(0, 10)}T00:00:00`) ?? now;
}

/** The kitchen tickets from today on: exactly what to make, for whom (alias) and by when. */
export async function kitchenTickets(
  deps: BoardDependencies,
  merchantId: string,
): Promise<KitchenTicket[]> {
  const orders = await orderStore.ofMerchant(deps.db, merchantId, startOfDay(deps.clock.now()));
  const tickets: KitchenTicket[] = [];
  for (const order of orders) {
    const hold = await holdLedger.find(deps.db, order.holdId);
    if (hold === undefined) continue;
    tickets.push({
      orderId: order.id,
      code: order.code,
      alias: order.alias,
      status: order.status,
      pickupAt: order.pickupAt,
      kitchenStartsAt: order.kitchenStartsAt,
      lines: order.ticket.map(ticketLine),
      payment: await paymentOf(deps.db, hold),
    });
  }
  return tickets;
}

/** "Today": who is coming, the day's sales, orders, conversion and average reward. */
export async function merchantToday(
  deps: BoardDependencies,
  merchant: Merchant,
): Promise<MerchantToday> {
  const tickets = await kitchenTickets(deps, merchant.summary.id);
  const requests = await merchantRequests(deps, merchant.summary.id);
  const since = startOfDay(deps.clock.now()).getTime();
  const today = requests.filter((request) => new Date(request.at).getTime() >= since);
  const offers = today.flatMap((request) => (request.offer === null ? [] : [request.offer]));
  const reserved = offers.filter((offer) => offer.status === 'reserved').length;
  const rewards = offers.map((offer) => offer.reward.percent);
  return {
    merchant: merchant.summary,
    arriving: tickets.filter((ticket) => LIVE.has(ticket.status)),
    sales: {
      amountMinor: tickets.reduce(
        (sum, t) => sum + t.payment.captured.amountMinor - t.payment.refunded.amountMinor,
        0,
      ),
      currency: 'USD',
    },
    orders: tickets.filter((ticket) => ticket.status !== 'cancelled').length,
    offers: offers.length,
    conversionPercent: offers.length === 0 ? null : Math.round((reserved * 100) / offers.length),
    averageRewardPercent:
      rewards.length === 0
        ? null
        : Math.round(rewards.reduce((sum, value) => sum + value, 0) / rewards.length),
  };
}

/**
 * "Requests": every need that reached this merchant, with the conversation between Sara and its
 * agent, the server's checks and the outcome. The traveller appears by alias only.
 */
export async function merchantRequests(
  deps: BoardDependencies,
  merchantId: string,
): Promise<MerchantRequest[]> {
  const threads = await conversations.ofMerchant(deps.db, merchantId, REQUESTS_SHOWN);
  const requests: MerchantRequest[] = [];
  for (const thread of threads) {
    const conversation = await conversations.messages(deps.db, thread.id);
    const need = conversation.find((entry) => entry.message.type === 'need')?.message;
    if (need?.type !== 'need') continue;
    const offer = await offerStore.ofThread(deps.db, thread.id);
    requests.push({
      threadId: thread.id,
      at: thread.createdAt,
      alias: need.alias,
      craving: need.craving,
      status: thread.status,
      offer: offer === undefined ? null : ((await offerView(deps, offer)) ?? null),
      conversation: [...conversation],
    });
  }
  return requests;
}

/** "Customers": aliases with how many offers they were made and how many they took. */
export async function merchantCustomers(
  deps: BoardDependencies,
  merchantId: string,
): Promise<MerchantCustomer[]> {
  const requests = await merchantRequests(deps, merchantId);
  const byAlias = new Map<string, MerchantCustomer>();
  for (const request of requests) {
    const seen = byAlias.get(request.alias) ?? {
      alias: request.alias,
      offers: 0,
      orders: 0,
      lastSeenAt: request.at,
    };
    byAlias.set(request.alias, {
      alias: request.alias,
      offers: seen.offers + (request.offer === null ? 0 : 1),
      orders: seen.orders + (request.offer?.status === 'reserved' ? 1 : 0),
      lastSeenAt: request.at > seen.lastSeenAt ? request.at : seen.lastSeenAt,
    });
  }
  return [...byAlias.values()];
}
