import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Secret } from '../../../src/config/secret.js';
import type { Clock } from '../../../src/infrastructure/clock/clock.js';
import { createHttpClient } from '../../../src/infrastructure/http/client.js';
import { createPayPalClient } from '../../../src/modules/payments/paypal/client.js';
import {
  createPayPalPayouts,
  type PayPalPayouts,
} from '../../../src/modules/payments/paypal/payouts.js';
import type {
  PayPalEnvironment,
  PayPalGateway,
} from '../../../src/modules/payments/paypal/gateway.js';
import { fixture } from './fixtures.js';

interface Seen {
  readonly method: string;
  /** With the shared HTTP client redirected here, the first segment is PayPal's host. */
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

type Answer = { status: number; body?: unknown; delayMs?: number } | undefined;

export interface PayPalServer {
  readonly seen: Seen[];
  /** How the API answers; the OAuth endpoint answers with the guide's sample token. */
  answer: (request: Seen) => Answer;
  /** From now on the OAuth endpoint refuses the client credentials too. */
  refuseCredentials(): void;
  /** The real PayPal client, sending everything to this server. */
  client(environment?: PayPalEnvironment, timeoutMs?: number): PayPalGateway;
  /** The real Payouts client, sending everything to this server. */
  payouts(): PayPalPayouts;
  /** Requests other than for tokens. */
  api(): Seen[];
  tokens(): Seen[];
  close(): Promise<void>;
}

const isToken = (request: Seen) => request.path.endsWith('/v1/oauth2/token');

/** PayPal's REST API on a local port, answering with the official examples a test chooses. */
export async function paypalServer(clock: Clock): Promise<PayPalServer> {
  let refuse = false;
  const state: PayPalServer = {
    seen: [],
    answer: () => undefined,
    refuseCredentials: () => {
      refuse = true;
    },
    client: (environment = 'sandbox', timeoutMs = 2_000) =>
      createPayPalClient({
        http: createHttpClient({ redirectTo: origin }),
        environment,
        clientId: 'client-id-for-tests',
        clientSecret: new Secret('client-secret-for-tests'),
        clock,
        timeoutMs,
      }),
    payouts: () =>
      createPayPalPayouts({
        http: createHttpClient({ redirectTo: origin }),
        environment: 'sandbox',
        clientId: 'client-id-for-tests',
        clientSecret: new Secret('client-secret-for-tests'),
        clock,
        timeoutMs: 2_000,
      }),
    api: () => state.seen.filter((request) => !isToken(request)),
    tokens: () => state.seen.filter(isToken),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      const entry = {
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body,
      };
      state.seen.push(entry);
      reply(response, isToken(entry) ? tokenAnswer(refuse) : state.answer(entry));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return state;
}

function tokenAnswer(refuse: boolean): Answer {
  return refuse
    ? {
        status: 401,
        body: { error: 'invalid_client', error_description: 'Client Authentication failed' },
      }
    : { status: 200, body: fixture('oauth-token.json') };
}

function reply(response: ServerResponse, result: Answer): void {
  const send = () => {
    if (result === undefined) {
      response.writeHead(404).end();
    } else if (result.body === undefined) {
      response.writeHead(result.status).end();
    } else {
      const text = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      response.writeHead(result.status, { 'content-type': 'application/json' }).end(text);
    }
  };
  if (result?.delayMs === undefined) send();
  else setTimeout(send, result.delayMs);
}
