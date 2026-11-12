import {
  assistantTurnSchema,
  journeySchema,
  paymentSchema,
  paymentsConfigSchema,
  restroomsNearResponseSchema,
  type AssistantTurn,
  type Journey,
  type Payment,
  type PaymentPurpose,
  type PaymentsConfig,
  type RestroomsNearResponse,
  type Taste,
} from '@moviq/contracts';

import { api, MODEL_TIMEOUT_MS, type ApiClient } from '../../shared/api/client';
import type { Lang } from '../../shared/i18n/lang';

/** A question to Sara about this trip, in the conversation the card keeps. */
interface TripQuestion {
  readonly conversationId: string | null;
  readonly journeyId: string;
  readonly message: string;
  readonly lang: Lang;
  /** The alias and tastes Sara may tell the merchants on the way; never sent to her model. */
  readonly shopper: { readonly alias: string; readonly taste: Taste };
}

const journeyPath = (id: string) => `/api/journeys/${encodeURIComponent(id)}`;

/** The trip's endpoints, each answer validated against its contract. */
function createTripApi(client: ApiClient) {
  return {
    journey: (id: string, signal: AbortSignal): Promise<Journey> =>
      client.json(journeyPath(id), journeySchema, { signal }),
    eventsUrl: (id: string): string => `${journeyPath(id)}/events`,
    /** Takes a free alternative; the server answers with the journey already changed. */
    applyAlternative: (id: string, alternativeId: string): Promise<Journey> =>
      client.json(
        `${journeyPath(id)}/alternatives/${encodeURIComponent(alternativeId)}/apply`,
        journeySchema,
        { method: 'POST' },
      ),
    /** Asks for Sara's words on the latest change; the server writes them once per change. */
    explain: (id: string, lang: Lang, signal: AbortSignal): Promise<Journey> =>
      client.json(`/api/assistant/journeys/${encodeURIComponent(id)}/explanation`, journeySchema, {
        method: 'POST',
        body: { lang },
        signal,
        timeoutMs: MODEL_TIMEOUT_MS,
      }),
    ask: (question: TripQuestion, signal: AbortSignal): Promise<AssistantTurn> =>
      client.json('/api/assistant/turns', assistantTurnSchema, {
        method: 'POST',
        body: question,
        signal,
        timeoutMs: MODEL_TIMEOUT_MS,
      }),
    /** The public restrooms near the next stops: `query` from `model/restrooms.ts`. */
    restrooms: (query: string, signal: AbortSignal): Promise<RestroomsNearResponse> =>
      client.json(`/api/city/restrooms?${query}`, restroomsNearResponseSchema, { signal }),
    paymentsConfig: (signal: AbortSignal): Promise<PaymentsConfig> =>
      client.json('/api/payments/config', paymentsConfigSchema, { signal }),
    createOrder: (purpose: PaymentPurpose): Promise<Payment> =>
      client.json('/api/payments/orders', paymentSchema, { method: 'POST', body: { purpose } }),
    getOrder: (paymentId: string): Promise<Payment> =>
      client.json(`/api/payments/orders/${encodeURIComponent(paymentId)}`, paymentSchema),
    confirmOrder: (paymentId: string): Promise<Payment> =>
      client.json(`/api/payments/orders/${encodeURIComponent(paymentId)}/confirm`, paymentSchema, {
        method: 'POST',
      }),
  };
}

export const tripApi = createTripApi(api);
