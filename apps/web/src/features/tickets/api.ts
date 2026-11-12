import {
  createTicketIntentSchema,
  ticketAutopaySchema,
  ticketAutopaySetupSchema,
  ticketAutopaySwitchSchema,
  ticketCatalogSchema,
  ticketIntentSchema,
  ticketWalletSchema,
  type TicketIntent,
} from '@moviq/contracts';

import { api, type ApiClient } from '../../shared/api/client';

const BASE = '/api/tickets';

/** Ticket demonstration endpoints. Every server answer is checked against the shared contract. */
export function createTicketsApi(client: ApiClient) {
  return {
    catalog: (signal?: AbortSignal) =>
      client.json(`${BASE}/catalog`, ticketCatalogSchema, signal ? { signal } : {}),
    intent: (productId: string, signal?: AbortSignal): Promise<TicketIntent> =>
      client.json(`${BASE}/intents`, ticketIntentSchema, {
        method: 'POST',
        body: createTicketIntentSchema.parse({ productId }),
        ...(signal === undefined ? {} : { signal }),
      }),
    wallet: (signal: AbortSignal) => client.json(`${BASE}/wallet`, ticketWalletSchema, { signal }),
    /** Whether the assistant may pay with PayPal for this traveller. */
    autopay: (signal: AbortSignal) =>
      client.json(`${BASE}/autopay`, ticketAutopaySchema, { signal }),
    /** Opens the one approval in PayPal; the answer says where to send the traveller. */
    connectAutopay: () =>
      client.json(`${BASE}/autopay`, ticketAutopaySetupSchema, { method: 'POST', body: {} }),
    /** The traveller's switch: off, the assistant buys nothing even with PayPal connected. */
    setAutopayEnabled: (enabled: boolean) =>
      client.json(`${BASE}/autopay`, ticketAutopaySchema, {
        method: 'PUT',
        body: ticketAutopaySwitchSchema.parse({ enabled }),
      }),
    disconnectAutopay: () =>
      client.json(`${BASE}/autopay`, ticketAutopaySchema, { method: 'DELETE' }),
  };
}

export const ticketsApi = createTicketsApi(api);
