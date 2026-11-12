import {
  ticketDemoPartnerSchema,
  ticketDemoSessionSchema,
  ticketDemoStatusSchema,
  type TicketDemoPartner,
} from '@moviq/contracts';

import { api, type ApiClient } from '../../shared/api/client';

const BASE = '/api/tickets/demo';
export type PartnerReport = TicketDemoPartner;
export function createDemoApi(client: ApiClient) {
  return {
    status: (signal: AbortSignal) =>
      client.json(`${BASE}/status`, ticketDemoStatusSchema, { signal }),
    login: (role: 'traveller' | 'partner', signal: AbortSignal) =>
      client.json(`${BASE}/${role}`, ticketDemoSessionSchema, { method: 'POST', signal }),
    logout: () => client.json(`${BASE}/logout`, ticketDemoSessionSchema, { method: 'POST' }),
    partner: (signal: AbortSignal) =>
      client.json(`${BASE}/partner`, ticketDemoPartnerSchema, { signal }),
  };
}

export const demoApi = createDemoApi(api);
