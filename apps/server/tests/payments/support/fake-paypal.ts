import type { Money } from '@moviq/contracts';

import { PayPalError } from '../../../src/modules/payments/paypal/errors.js';
import type {
  CreateOrderInput,
  PayPalGateway,
} from '../../../src/modules/payments/paypal/gateway.js';
import {
  orderSchema,
  refundSchema,
  toPayPalAmount,
} from '../../../src/modules/payments/paypal/schemas.js';

type Method = keyof PayPalGateway;

/** What a scripted call does: fail before PayPal acts, or act and then lose the answer. */
type Script = { readonly fail: PayPalError } | { readonly loseAnswer: true };

interface OrderState {
  readonly id: string;
  readonly input: CreateOrderInput;
  status: 'CREATED' | 'APPROVED' | 'COMPLETED' | 'VOIDED';
  capture: { id: string; status: 'COMPLETED' | 'PENDING' | 'DECLINED' | 'REFUNDED' } | undefined;
  readonly refunds: { id: string; amount: Money }[];
}

interface Call {
  readonly method: Method;
  readonly target: string;
  readonly requestId: string | undefined;
}

/**
 * PayPal in memory, keeping the rules MovIQ relies on: a repeated PayPal-Request-Id returns the
 * first result, an order is captured only after its buyer approved it, and only once. Answers
 * go through the client's own schemas, so they have the shapes of the real API.
 */
export interface FakePayPal extends PayPalGateway {
  readonly calls: Call[];
  /** The buyer approves the order in the PayPal window. */
  approve(orderId: string): void;
  /** The next call of `method` behaves as scripted. */
  script(method: Method, script: Script): void;
  /** How the next capture ends, when PayPal reviews or declines it. */
  captureEndsAs(status: 'PENDING' | 'DECLINED'): void;
  order(orderId: string): OrderState | undefined;
  signatureValid: boolean;
}

export const refusal = (operation: string, status: number, issue: string): PayPalError =>
  new PayPalError(operation, 'refused', `HTTP ${String(status)} ${issue}`, {
    status,
    errorName: status === 404 ? 'RESOURCE_NOT_FOUND' : 'UNPROCESSABLE_ENTITY',
    issue,
  });

export const lostAnswer = (operation: string): PayPalError =>
  new PayPalError(operation, 'unknown', 'No answer within 15000 ms');

export function fakePayPal(): FakePayPal {
  const orders = new Map<string, OrderState>();
  const byRequest = new Map<string, unknown>();
  const scripts = new Map<Method, Script[]>();
  let nextCapture: 'PENDING' | 'DECLINED' | undefined;
  let counter = 0;
  const fake: FakePayPal = {
    calls: [],
    signatureValid: true,
    approve: (orderId) => {
      const order = orders.get(orderId);
      if (order?.status !== 'CREATED') throw new Error(`order ${orderId} cannot be approved`);
      order.status = 'APPROVED';
    },
    script: (method, script) => {
      scripts.set(method, [...(scripts.get(method) ?? []), script]);
    },
    captureEndsAs: (status) => {
      nextCapture = status;
    },
    order: (orderId) => orders.get(orderId),

    createOrder: (input) =>
      run('createOrder', input.referenceId, input.requestId, () => {
        counter += 1;
        const state: OrderState = {
          id: `ORDER${String(counter)}`,
          input,
          status: 'CREATED',
          capture: undefined,
          refunds: [],
        };
        orders.set(state.id, state);
        return body(state);
      }).then((answer) => orderSchema.parse(answer)),
    getOrder: (orderId) =>
      run('getOrder', orderId, undefined, () => body(existing(orderId, 'orders.get'))).then(
        (answer) => orderSchema.parse(answer),
      ),
    captureOrder: (orderId, requestId) =>
      run('captureOrder', orderId, requestId, () =>
        capture(existing(orderId, 'orders.capture')),
      ).then((answer) => orderSchema.parse(answer)),
    refundCapture: (captureId, input) =>
      run('refundCapture', captureId, input.requestId, () => refund(captureId, input.amount)).then(
        (answer) => refundSchema.parse(answer),
      ),
    getRefund: (refundId) =>
      run('getRefund', refundId, undefined, () => {
        const found = [...orders.values()]
          .flatMap((order) => order.refunds)
          .find((item) => item.id === refundId);
        if (found === undefined) throw refusal('refunds.get', 404, 'RESOURCE_NOT_FOUND');
        return { id: found.id, status: 'COMPLETED', amount: toPayPalAmount(found.amount) };
      }).then((answer) => refundSchema.parse(answer)),
    verifyWebhookSignature: ({ headers }) =>
      run(
        'verifyWebhookSignature',
        headers.transmissionId,
        undefined,
        () => fake.signatureValid,
      ).then((answer) => answer === true),
    authorizeOrder: () => Promise.reject(new Error('not used by these tests')),
    captureAuthorization: () => Promise.reject(new Error('not used by these tests')),
    voidAuthorization: () => Promise.reject(new Error('not used by these tests')),
  };

  async function run(
    method: Method,
    target: string,
    requestId: string | undefined,
    act: () => unknown,
  ): Promise<unknown> {
    await Promise.resolve();
    fake.calls.push({ method, target, requestId });
    const script = scripts.get(method)?.shift();
    if (script !== undefined && 'fail' in script) throw script.fail;
    const key = requestId === undefined ? undefined : `${method}:${requestId}`;
    const answer = key !== undefined && byRequest.has(key) ? byRequest.get(key) : act();
    if (key !== undefined) byRequest.set(key, answer);
    if (script !== undefined) throw lostAnswer(method);
    return answer;
  }

  function existing(orderId: string, operation: string): OrderState {
    const order = orders.get(orderId);
    if (order === undefined) throw refusal(operation, 404, 'RESOURCE_NOT_FOUND');
    return order;
  }

  function capture(order: OrderState): unknown {
    if (order.status === 'COMPLETED')
      throw refusal('orders.capture', 422, 'ORDER_ALREADY_CAPTURED');
    if (order.status !== 'APPROVED') throw refusal('orders.capture', 422, 'ORDER_NOT_APPROVED');
    counter += 1;
    order.capture = { id: `CAPTURE${String(counter)}`, status: nextCapture ?? 'COMPLETED' };
    nextCapture = undefined;
    order.status = 'COMPLETED';
    return body(order);
  }

  function refund(captureId: string, amount: Money | undefined): unknown {
    const order = [...orders.values()].find((candidate) => candidate.capture?.id === captureId);
    if (order?.capture === undefined) throw refusal('captures.refund', 404, 'RESOURCE_NOT_FOUND');
    counter += 1;
    const given = amount ?? order.input.amount;
    order.refunds.push({ id: `REFUND${String(counter)}`, amount: given });
    const refunded = order.refunds.reduce((sum, item) => sum + item.amount.amountMinor, 0);
    if (refunded >= order.input.amount.amountMinor) order.capture.status = 'REFUNDED';
    return { id: `REFUND${String(counter)}`, status: 'COMPLETED', amount: toPayPalAmount(given) };
  }

  return fake;
}

/** An order as PayPal returns it with `Prefer: return=representation`. */
function body(order: OrderState): unknown {
  const amount = toPayPalAmount(order.input.amount);
  const payments =
    order.capture === undefined
      ? undefined
      : {
          captures: [
            { id: order.capture.id, status: order.capture.status, amount, final_capture: true },
          ],
          refunds: order.refunds.map((item) => ({
            id: item.id,
            status: 'COMPLETED',
            amount: toPayPalAmount(item.amount),
            links: [
              {
                href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${order.capture?.id ?? ''}`,
                rel: 'up',
              },
            ],
          })),
        };
  return {
    id: order.id,
    status: order.status,
    intent: order.input.intent,
    purchase_units: [
      {
        reference_id: order.input.referenceId,
        description: order.input.description,
        amount,
        ...(payments === undefined ? {} : { payments }),
      },
    ],
  };
}
