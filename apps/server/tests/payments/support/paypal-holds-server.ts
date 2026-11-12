import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Money } from '@moviq/contracts';
import { z } from 'zod';

import { PayPalError } from '../../../src/modules/payments/paypal/errors.js';
import { toPayPalAmount } from '../../../src/modules/payments/paypal/schemas.js';
import type { FakeHoldPayPal } from './fake-paypal-holds.js';
import { fixture } from './fixtures.js';

/** The sandbox host, the first path segment of a request redirected by `TEST_PROVIDER_ORIGIN`. */
const HOST = '/api-m.sandbox.paypal.com';

const wireAmount = z
  .object({ currency_code: z.literal('USD'), value: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/) })
  .transform((amount): Money => ({
    amountMinor: Math.round(Number(amount.value) * 100),
    currency: 'USD',
  }));

const createBody = z.object({
  intent: z.enum(['CAPTURE', 'AUTHORIZE']),
  purchase_units: z
    .array(z.object({ reference_id: z.string(), description: z.string(), amount: wireAmount }))
    .length(1),
});
const captureBody = z.object({ amount: wireAmount.optional(), final_capture: z.boolean() });
const refundBody = z.object({ amount: wireAmount.optional(), custom_id: z.string().optional() });

interface Call {
  readonly ids: readonly string[];
  readonly body: unknown;
  readonly requestId: string;
}

type Route = readonly [method: string, path: RegExp, act: (call: Call) => Promise<unknown>];

function routes(paypal: FakeHoldPayPal): readonly Route[] {
  const id = (call: Call) => call.ids[0] ?? '';
  return [
    [
      'POST',
      /^\/v2\/checkout\/orders$/,
      (call) => {
        const body = createBody.parse(call.body);
        const [unit] = body.purchase_units;
        if (unit === undefined) throw new Error('no purchase unit');
        return paypal.createOrder({
          intent: body.intent,
          amount: unit.amount,
          description: unit.description,
          referenceId: unit.reference_id,
          requestId: call.requestId,
        });
      },
    ],
    ['GET', /^\/v2\/checkout\/orders\/([^/]+)$/, (call) => paypal.getOrder(id(call))],
    [
      'POST',
      /^\/v2\/checkout\/orders\/([^/]+)\/authorize$/,
      (call) => paypal.authorizeOrder(id(call), call.requestId),
    ],
    [
      'POST',
      /^\/v2\/payments\/authorizations\/([^/]+)\/capture$/,
      (call) => {
        const body = captureBody.parse(call.body);
        return paypal.captureAuthorization(id(call), {
          ...(body.amount === undefined ? {} : { amount: body.amount }),
          finalCapture: body.final_capture,
          requestId: call.requestId,
        });
      },
    ],
    [
      'POST',
      /^\/v2\/payments\/authorizations\/([^/]+)\/void$/,
      (call) => paypal.voidAuthorization(id(call), call.requestId),
    ],
    [
      'POST',
      /^\/v2\/payments\/captures\/([^/]+)\/refund$/,
      (call) => {
        const body = refundBody.parse(call.body);
        return paypal.refundCapture(id(call), {
          ...(body.amount === undefined ? {} : { amount: body.amount }),
          ...(body.custom_id === undefined ? {} : { customId: body.custom_id }),
          requestId: call.requestId,
        });
      },
    ],
    ['GET', /^\/v2\/payments\/refunds\/([^/]+)$/, (call) => paypal.getRefund(id(call))],
  ];
}

/** An answer as PayPal writes it: every amount back to `{ currency_code, value }`. */
function toWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWire);
  if (typeof value !== 'object' || value === null) return value;
  if ('amountMinor' in value && 'currency' in value) return toPayPalAmount(value as Money);
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, toWire(field)]));
}

export interface PayPalHoldsServer {
  /** For `TEST_PROVIDER_ORIGIN`: every provider a process calls lands here. */
  readonly origin: string;
  close(): Promise<void>;
}

/**
 * The in-memory PayPal of holds behind PayPal's REST paths on a local port, so the API and worker
 * processes reach it through their real PayPal client, and its state outlives their restarts. A
 * refusal answers PayPal's error body; an answer lost on the way drops the connection after
 * PayPal acted. Anything that is not PayPal's sandbox answers 404.
 */
export async function paypalHoldsServer(paypal: FakeHoldPayPal): Promise<PayPalHoldsServer> {
  const table = routes(paypal);
  const server = createServer((request, response) => {
    let text = '';
    request.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    request.on('end', () => {
      void answer(table, request, text, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    origin,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

async function answer(
  table: readonly Route[],
  request: IncomingMessage,
  text: string,
  response: ServerResponse,
): Promise<void> {
  const url = request.url ?? '';
  const path = url.startsWith(`${HOST}/`) ? (url.slice(HOST.length).split('?')[0] ?? '') : '';
  if (path === '/v1/oauth2/token') {
    json(response, 200, fixture('oauth-token.json'));
    return;
  }
  const method = request.method ?? '';
  const found = findRoute(table, method, path);
  if (found === undefined) {
    response.writeHead(404).end();
    return;
  }
  const requestId = request.headers['paypal-request-id'];
  try {
    const result = await found.act({
      ids: found.ids,
      body: text === '' ? {} : (JSON.parse(text) as unknown),
      requestId: typeof requestId === 'string' ? requestId : '',
    });
    if (result === undefined) response.writeHead(204).end();
    else json(response, method === 'GET' ? 200 : 201, toWire(result));
  } catch (error) {
    failed(response, error);
  }
}

function findRoute(table: readonly Route[], method: string, path: string) {
  for (const [routeMethod, pattern, act] of table) {
    const match = pattern.exec(path);
    if (routeMethod === method && match !== null) return { act, ids: match.slice(1) };
  }
  return undefined;
}

function failed(response: ServerResponse, error: unknown): void {
  if (!(error instanceof PayPalError) || error.outcome !== 'refused') {
    response.socket?.destroy();
    return;
  }
  json(response, error.status ?? 422, {
    name: error.errorName ?? 'UNPROCESSABLE_ENTITY',
    message: error.message,
    debug_id: 'local-double',
    details: [{ issue: error.issue ?? 'UNPROCESSABLE_ENTITY' }],
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
