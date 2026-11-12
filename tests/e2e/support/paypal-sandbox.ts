import { request } from '@playwright/test';

import {
  GENERIC_BROWSER_HEADERS,
  GENERIC_USER_AGENT,
} from '../../../apps/server/src/infrastructure/http/client.js';

/** The PayPal REST host of the sandbox, which the stand-in relays to for the API and the worker. */
export const PAYPAL_API_HOST = 'api-m.sandbox.paypal.com';

const SERVER_KEYS = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] as const;
const BUYER = ['PAYPAL_SANDBOX_BUYER_EMAIL', 'PAYPAL_SANDBOX_BUYER_PASSWORD'] as const;

const variable = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
};

/** Why the PayPal journey cannot run here: the variables of `.env` it needs and does not have. */
export function skipReason(): string | undefined {
  const missing = [...SERVER_KEYS, ...BUYER].filter((name) => variable(name) === undefined);
  if (missing.length === 0) return undefined;
  return `PayPal sandbox journey skipped: set ${missing.join(', ')} in .env.`;
}

/**
 * The environment that turns payments on in the deployment, always against the sandbox: the
 * `PAYPAL_ENV` of `.env` is not passed on. Without the keys payments stay off.
 */
export function sandboxServerEnv(): Readonly<Record<string, string>> {
  const keys = SERVER_KEYS.flatMap((name) => {
    const value = variable(name);
    return value === undefined ? [] : [[name, value] as const];
  });
  return { PAYPAL_ENV: 'sandbox', ...Object.fromEntries(keys) };
}

/** The sandbox's test buyer, who signs in and approves in PayPal's window. */
export interface SandboxBuyer {
  readonly email: string;
  readonly password: string;
}

export function sandboxBuyer(): SandboxBuyer {
  const email = variable('PAYPAL_SANDBOX_BUYER_EMAIL');
  const password = variable('PAYPAL_SANDBOX_BUYER_PASSWORD');
  if (email === undefined || password === undefined) throw new Error('The buyer is not set.');
  return { email, password };
}

const PAYPAL_DOMAINS = ['paypal.com', 'paypalobjects.com'] as const;

/** PayPal's pages, web SDK and assets, over HTTPS: all the browser may reach besides MovIQ. */
export function isPayPal(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    PAYPAL_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  );
}

/** Money taken or given back, a capture or a refund, as PayPal itself records it. */
interface PayPalMovement {
  readonly id: string;
  readonly status: string;
  /** As PayPal writes it, `31.25`. */
  readonly value: string;
  readonly currency: string;
}

/** An authorization of an order of intent `AUTHORIZE`, as PayPal records it. */
interface PayPalAuthorization {
  readonly id: string;
  /** `CREATED` while held, `CAPTURED` once taken, `VOIDED` once released. */
  readonly status: string;
}

/** PayPal's own record of an order: its status, the money held, taken and given back. */
export interface PayPalRecord {
  readonly status: string;
  readonly authorizations: readonly PayPalAuthorization[];
  readonly captures: readonly PayPalMovement[];
  readonly refunds: readonly PayPalMovement[];
}

/** A refund as PayPal records it, with the `custom_id` it was sent with, if PayPal kept one. */
export interface PayPalRefundRecord extends PayPalMovement {
  readonly customId: string | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (value: unknown, ...path: readonly string[]): unknown =>
  path.reduce<unknown>((at, key) => (isRecord(at) ? at[key] : undefined), value);

function readMovement(value: unknown, kind: string): PayPalMovement {
  const [id, status, amount, currency] = [
    field(value, 'id'),
    field(value, 'status'),
    field(value, 'amount', 'value'),
    field(value, 'amount', 'currency_code'),
  ];
  if (
    typeof id !== 'string' ||
    typeof status !== 'string' ||
    typeof amount !== 'string' ||
    typeof currency !== 'string'
  )
    throw new Error(`PayPal sent a ${kind} without its id, status or amount.`);
  return { id, status, value: amount, currency };
}

function readAuthorization(value: unknown): PayPalAuthorization {
  const [id, status] = [field(value, 'id'), field(value, 'status')];
  if (typeof id !== 'string' || typeof status !== 'string')
    throw new Error('PayPal sent an authorization without its id or status.');
  return { id, status };
}

/** The payments of one kind of a purchase unit; none if absent. */
function paymentsOf(
  unit: unknown,
  kind: 'authorizations' | 'captures' | 'refunds',
): readonly unknown[] {
  const list: unknown = field(unit, 'payments', kind) ?? [];
  if (!Array.isArray(list)) throw new Error(`PayPal sent ${kind} that are not a list.`);
  return list;
}

/**
 * Reads an order of PayPal Orders v2: its status, and the authorizations, captures and refunds of
 * its one purchase unit.
 */
function readOrder(value: unknown): PayPalRecord {
  const status = field(value, 'status');
  const units = field(value, 'purchase_units');
  if (typeof status !== 'string' || !Array.isArray(units))
    throw new Error('PayPal sent an order without its status or purchase units.');
  const [unit] = units as readonly unknown[];
  return {
    status,
    authorizations: paymentsOf(unit, 'authorizations').map(readAuthorization),
    captures: paymentsOf(unit, 'captures').map((capture) => readMovement(capture, 'capture')),
    refunds: paymentsOf(unit, 'refunds').map((refund) => readMovement(refund, 'refund')),
  };
}

function readRefund(value: unknown): PayPalRefundRecord {
  const customId = field(value, 'custom_id') ?? null;
  if (customId !== null && typeof customId !== 'string')
    throw new Error('PayPal sent a custom_id that is not text.');
  return { ...readMovement(value, 'refund'), customId };
}

/**
 * Reads one resource of the sandbox with the app's keys (two requests: a token and the
 * resource), as the independent check of what MovIQ recorded. `what` names it in an error.
 */
async function readSandbox(path: string, what: string): Promise<unknown> {
  const api = await request.newContext({
    baseURL: `https://${PAYPAL_API_HOST}`,
    userAgent: GENERIC_USER_AGENT,
    extraHTTPHeaders: GENERIC_BROWSER_HEADERS,
  });
  const keys = `${variable('PAYPAL_CLIENT_ID') ?? ''}:${variable('PAYPAL_CLIENT_SECRET') ?? ''}`;
  try {
    const token = await api.post('/v1/oauth2/token', {
      headers: { authorization: `Basic ${Buffer.from(keys).toString('base64')}` },
      form: { grant_type: 'client_credentials' },
    });
    const accessToken = field(await token.json(), 'access_token');
    if (!token.ok() || typeof accessToken !== 'string')
      throw new Error(`PayPal gave no token (HTTP ${String(token.status())}).`);
    const resource = await api.get(path, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!resource.ok())
      throw new Error(`PayPal did not read the ${what} (HTTP ${String(resource.status())}).`);
    const body: unknown = await resource.json();
    return body;
  } finally {
    await api.dispose();
  }
}

/** PayPal's record of an order (Orders v2), read straight from the sandbox. */
export async function payPalRecordOf(orderId: string): Promise<PayPalRecord> {
  return readOrder(
    await readSandbox(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, 'order'),
  );
}

/** PayPal's record of one refund (Payments v2), read straight from the sandbox. */
export async function payPalRefundOf(refundId: string): Promise<PayPalRefundRecord> {
  return readRefund(
    await readSandbox(`/v2/payments/refunds/${encodeURIComponent(refundId)}`, 'refund'),
  );
}
