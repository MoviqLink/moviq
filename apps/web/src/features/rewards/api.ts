import {
  needViewSchema,
  orderViewSchema,
  reservationSchema,
  rewardOfferSchema,
  routePromotionsSchema,
  type NeedRequest,
  type NeedView,
  type OrderView,
  type Reservation,
  type RewardOffer,
  type RoutePromotions,
} from '@moviq/contracts';

import { api, type ApiClient } from '../../shared/api/client';
import type { Lang } from '../../shared/i18n/lang';

const BASE = '/api/commerce';
const id = encodeURIComponent;

/** `GET /orders`: the contract's order view, in a list. */
const ordersSchema = orderViewSchema.pick({}).extend({ orders: orderViewSchema.array() });
/** `confirm` answers the order, or only the hold's status while PayPal has not settled. */
const confirmedSchema = orderViewSchema.or(reservationSchema.pick({ status: true }));

export type Confirmed = OrderView | Pick<Reservation, 'status'>;

/** The rewards on the way, each answer validated against its contract. Amounts are the server's. */
function createRewardsApi(client: ApiClient) {
  return {
    promotions: (journeyId: string, signal?: AbortSignal): Promise<RoutePromotions> =>
      client.json(
        `${BASE}/journeys/${id(journeyId)}/promotions`,
        routePromotionsSchema,
        signal ? { signal } : {},
      ),
    ask: (request: NeedRequest): Promise<NeedView> =>
      client.json(`${BASE}/needs`, needViewSchema, { method: 'POST', body: request }),
    need: (needId: string, signal?: AbortSignal): Promise<NeedView> =>
      client.json(`${BASE}/needs/${id(needId)}`, needViewSchema, signal ? { signal } : {}),
    answer: (needId: string, threadId: string, answer: string): Promise<NeedView> =>
      client.json(`${BASE}/needs/${id(needId)}/answers`, needViewSchema, {
        method: 'POST',
        body: { threadId, answer },
      }),
    decline: (offerId: string): Promise<RewardOffer> =>
      client.json(`${BASE}/offers/${id(offerId)}/decline`, rewardOfferSchema, { method: 'POST' }),
    /** Opens the PayPal order at the server's price; only the window's language is sent. */
    reserve: (offerId: string, language: Lang): Promise<Reservation> =>
      client.json(`${BASE}/offers/${id(offerId)}/reserve`, reservationSchema, {
        method: 'POST',
        body: { language },
      }),
    confirm: (offerId: string): Promise<Confirmed> =>
      client.json(`${BASE}/offers/${id(offerId)}/confirm`, confirmedSchema, { method: 'POST' }),
    orders: (signal?: AbortSignal): Promise<readonly OrderView[]> =>
      client
        .json(`${BASE}/orders`, ordersSchema, signal ? { signal } : {})
        .then((body) => body.orders),
    order: (orderId: string): Promise<OrderView> =>
      client.json(`${BASE}/orders/${id(orderId)}`, orderViewSchema),
    cancel: (orderId: string): Promise<OrderView> =>
      client.json(`${BASE}/orders/${id(orderId)}/cancel`, orderViewSchema, { method: 'POST' }),
  };
}

export const rewardsApi = createRewardsApi(api);
