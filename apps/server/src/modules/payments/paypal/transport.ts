import type { z } from 'zod';

import type { Secret } from '../../../config/secret.js';
import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { HttpClient } from '../../../infrastructure/http/client.js';
import { PayPalError, toPayPalError } from './errors.js';
import type { PayPalEnvironment } from './gateway.js';
import { tokenSchema } from './schemas.js';

const PAYPAL_HOSTS: Readonly<Record<PayPalEnvironment, string>> = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

export interface PayPalClientOptions {
  readonly http: HttpClient;
  readonly environment: PayPalEnvironment;
  readonly clientId: string;
  readonly clientSecret: Secret;
  readonly clock: Clock;
  readonly timeoutMs?: number;
}

/** A token is renewed this long before PayPal says it expires. */
const TOKEN_MARGIN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface Call {
  readonly operation: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: string;
  readonly requestId?: string;
}

/** Sends one call and returns its JSON body, or undefined for an empty answer. */
export type Requester = (call: Call) => Promise<unknown>;

/** Calls to PayPal's REST API with the OAuth2 token cached until it expires. */
export function requester(options: PayPalClientOptions): Requester {
  const host = PAYPAL_HOSTS[options.environment];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const token = tokenCache(options, host, timeoutMs);
  return async (call) => {
    for (let attempt = 0; ; attempt += 1) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${await token.get()}`,
        accept: 'application/json',
        prefer: 'return=representation',
      };
      if (call.method === 'POST') headers['content-type'] = 'application/json';
      if (call.requestId !== undefined) headers['paypal-request-id'] = call.requestId;
      try {
        const response = await options.http.send({
          url: `${host}${call.path}`,
          method: call.method,
          body: call.body,
          headers,
          timeoutMs,
          maxBytes: MAX_RESPONSE_BYTES,
        });
        return readJson(call.operation, response.body);
      } catch (error) {
        const failure = toPayPalError(call.operation, error);
        // An expired token is refused before PayPal acts: a new one makes the same call safe.
        if (failure.status !== 401 || attempt > 0) throw failure;
        token.invalidate();
      }
    }
  };
}

/** One call whose answer must fit `schema`. */
export async function parsed<T>(request: Requester, schema: z.ZodType<T>, call: Call): Promise<T> {
  return parse(schema, call.operation, await request(call));
}

interface TokenCache {
  get(): Promise<string>;
  invalidate(): void;
}

/** Client-credentials tokens, shared by concurrent callers and renewed before they expire. */
function tokenCache(options: PayPalClientOptions, host: string, timeoutMs: number): TokenCache {
  let current: { readonly value: string; readonly renewAtMs: number } | undefined;
  let inFlight: Promise<string> | undefined;
  const fetchToken = async (): Promise<string> => {
    const basic = Buffer.from(`${options.clientId}:${options.clientSecret.reveal()}`).toString(
      'base64',
    );
    try {
      const response = await options.http.send({
        url: `${host}/v1/oauth2/token`,
        method: 'POST',
        body: 'grant_type=client_credentials',
        headers: {
          authorization: `Basic ${basic}`,
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        timeoutMs,
        maxBytes: MAX_RESPONSE_BYTES,
      });
      const token = parse(tokenSchema, 'oauth2.token', readJson('oauth2.token', response.body));
      const renewAtMs =
        options.clock.now().getTime() + Math.max(0, token.expires_in * 1000 - TOKEN_MARGIN_MS);
      current = { value: token.access_token, renewAtMs };
      return token.access_token;
    } catch (error) {
      const failure = toPayPalError('oauth2.token', error);
      // Without a token nothing reached the money: whatever went wrong, nothing was done.
      throw new PayPalError('oauth2.token', 'not_done', failure.message, failure);
    }
  };
  return {
    get: () => {
      if (current !== undefined && options.clock.now().getTime() < current.renewAtMs) {
        return Promise.resolve(current.value);
      }
      inFlight ??= fetchToken().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    invalidate: () => {
      current = undefined;
    },
  };
}

function readJson(operation: string, body: Uint8Array): unknown {
  const text = new TextDecoder().decode(body);
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new PayPalError(operation, 'unknown', 'the answer is not JSON');
  }
}

export function parse<T>(schema: z.ZodType<T>, operation: string, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
  throw new PayPalError(operation, 'unknown', `unexpected answer: ${issues.join('; ')}`);
}
