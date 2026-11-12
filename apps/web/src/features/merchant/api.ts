import {
  agentPreviewSchema,
  agentSetupSchema,
  agentTalkSchema,
  customerListSchema,
  merchantListSchema,
  merchantRequestSchema,
  merchantSessionSchema,
  merchantTodaySchema,
  payoutBoardSchema,
  payoutViewSchema,
  refundAnswerSchema,
  requestListSchema,
  savedRulesSchema,
  scanAnswerSchema,
  scanRefusalSchema,
  statusChangeSchema,
  ticketListSchema,
} from '@moviq/contracts';

import { createApiClient, MODEL_TIMEOUT_MS } from '../../shared/api/client';
import type { AgentRules, DemoMerchant, WeeklyHours } from './schemas';

interface Schema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const BASE = '/api/merchant';
const id = encodeURIComponent;

/** The open demo merchant, or null when there is no session. */
const signedInMerchant = (
  session: { signedIn: true; merchant: DemoMerchant } | { signedIn: false },
) => (session.signedIn ? session.merchant : null);

/** A scan is answered with the charge, or refused (403, 404, 409) with the code of its reason. */
const scanOutcomeSchema = scanAnswerSchema.or(scanRefusalSchema);
const SCAN_REFUSALS = [403, 404, 409] as const;

/**
 * The merchant panel's endpoints, each answer validated against its contract in
 * `@moviq/contracts`, all through the shared client.
 */
export function createMerchantApi(fetchImpl: Fetch) {
  const client = createApiClient(fetchImpl);
  const get = <T>(path: string, schema: Schema<T>, signal: AbortSignal) =>
    client.json(`${BASE}${path}`, schema, { signal });
  return {
    merchants: (signal: AbortSignal) =>
      get('/merchants', merchantListSchema, signal).then((list) => list.merchants),
    session: (signal: AbortSignal) =>
      get('/session', merchantSessionSchema, signal).then(signedInMerchant),
    signIn: (merchantId: string, token: string) =>
      client
        .json(`${BASE}/session`, merchantSessionSchema, {
          method: 'POST',
          body: { merchantId, token },
        })
        .then(signedInMerchant),
    signOut: () => client.send(`${BASE}/session`, { method: 'DELETE' }),
    today: (signal: AbortSignal) => get('/today', merchantTodaySchema, signal),
    requests: (signal: AbortSignal) =>
      get('/requests', requestListSchema, signal).then((list) => list.requests),
    request: (threadId: string, signal: AbortSignal) =>
      get(`/requests/${id(threadId)}`, merchantRequestSchema, signal),
    tickets: (signal: AbortSignal) =>
      get('/tickets', ticketListSchema, signal).then((list) => list.tickets),
    moveTicket: (orderId: string, status: 'preparing' | 'ready') =>
      client.json(`${BASE}/tickets/${id(orderId)}/status`, statusChangeSchema, {
        method: 'POST',
        body: { status },
      }),
    scan: (code: string) =>
      client.json(`${BASE}/scan`, scanOutcomeSchema, {
        method: 'POST',
        body: { code },
        answers: SCAN_REFUSALS,
      }),
    refund: (orderId: string, lines: readonly number[]) =>
      client.json(`${BASE}/orders/${id(orderId)}/refunds`, refundAnswerSchema, {
        method: 'POST',
        body: { lines },
      }),
    customers: (signal: AbortSignal) =>
      get('/customers', customerListSchema, signal).then((list) => list.customers),
    payouts: (signal: AbortSignal) => get('/payouts', payoutBoardSchema, signal),
    payNow: () => client.json(`${BASE}/payouts/now`, payoutViewSchema, { method: 'POST' }),
    changePayoutAccount: (receiver: string) =>
      client.send(`${BASE}/payout-account`, { method: 'PUT', body: { receiver } }),
    agent: (signal: AbortSignal) => get('/agent', agentSetupSchema, signal),
    preview: (signal: AbortSignal) => get('/agent/preview', agentPreviewSchema, signal),
    talk: (message: string, language: 'en' | 'es') =>
      client.json(`${BASE}/agent/talk`, agentTalkSchema, {
        method: 'POST',
        body: { message, language },
        timeoutMs: MODEL_TIMEOUT_MS,
      }),
    saveAgent: (rules: AgentRules, hours: WeeklyHours, version: number) =>
      client.json(`${BASE}/agent`, savedRulesSchema, {
        method: 'PUT',
        body: { rules, hours, version },
      }),
  };
}

/** The API the screens use: the browser's fetch against the page's own origin. */
export const merchantApi = createMerchantApi((input, init) => fetch(input, init));
