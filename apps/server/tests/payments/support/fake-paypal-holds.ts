import type { Money } from '@moviq/contracts';

import type {
  CreateOrderInput,
  PayPalGateway,
} from '../../../src/modules/payments/paypal/gateway.js';
import {
  authorizationSchema,
  captureSchema,
  orderSchema,
  refundSchema,
  toPayPalAmount,
} from '../../../src/modules/payments/paypal/schemas.js';
import { lostAnswer, refusal } from './fake-paypal.js';

type Method = keyof PayPalGateway;

interface HoldOrder {
  readonly id: string;
  readonly input: CreateOrderInput;
  status: 'CREATED' | 'APPROVED' | 'COMPLETED';
  authorization: { id: string; status: 'CREATED' | 'CAPTURED' | 'VOIDED' } | undefined;
  capture: { id: string; amount: Money } | undefined;
  readonly refunds: FakeRefund[];
}

interface FakeRefund {
  readonly id: string;
  readonly amount: Money;
  readonly customId: string | undefined;
  status: RefundStatus;
}

type RefundStatus = 'COMPLETED' | 'PENDING' | 'FAILED';

/**
 * A scripted call: `refuse-not-approved` is turned away before PayPal acts, `lose-answer` acts
 * and loses the answer, `lose-request` loses the request before PayPal sees it.
 */
type Script = 'refuse-not-approved' | 'lose-answer' | 'lose-request';

/**
 * PayPal in memory for orders of intent AUTHORIZE, keeping the rules MovIQ relies on: a repeated
 * PayPal-Request-Id returns the first result; an order is authorized only after its buyer
 * approved it, and once; an authorization is captured or voided once, never both. Answers go
 * through the client's own schemas.
 */
export interface FakeHoldPayPal extends PayPalGateway {
  readonly calls: { readonly method: Method; readonly requestId: string | undefined }[];
  approve(orderId: string): void;
  /** How the next call of `method` goes wrong. */
  script(method: Method, outcome: Script): void;
  /** How the next refund ends when PayPal answers it, and how a refund ends later. */
  refundEndsAs(status: 'PENDING'): void;
  settleRefund(refundId: string, status: 'COMPLETED' | 'FAILED'): void;
  order(orderId: string): HoldOrder | undefined;
  captures(): number;
  /** Refunds PayPal made, whatever their status. */
  refunds(): number;
}

export function fakeHoldPayPal(): FakeHoldPayPal {
  const orders = new Map<string, HoldOrder>();
  const byRequest = new Map<string, unknown>();
  const scripts = new Map<Method, Script[]>();
  let nextRefund: RefundStatus = 'COMPLETED';
  let counter = 0;
  const next = (prefix: string) => {
    counter += 1;
    return `${prefix}${String(counter)}`;
  };

  async function run(
    method: Method,
    requestId: string | undefined,
    act: () => unknown,
  ): Promise<unknown> {
    await Promise.resolve();
    fake.calls.push({ method, requestId });
    const script = scripts.get(method)?.shift();
    if (script === 'refuse-not-approved') throw refusal(method, 422, 'ORDER_NOT_APPROVED');
    if (script === 'lose-request') throw lostAnswer(method);
    const key = requestId === undefined ? undefined : `${method}:${requestId}`;
    const answer = key !== undefined && byRequest.has(key) ? byRequest.get(key) : act();
    if (key !== undefined) byRequest.set(key, answer);
    if (script === 'lose-answer') throw lostAnswer(method);
    return answer;
  }

  const find = (orderId: string) => {
    const order = orders.get(orderId);
    if (order === undefined) throw refusal('orders.get', 404, 'RESOURCE_NOT_FOUND');
    return order;
  };
  const refundOf = (id: string) => {
    const refund = [...orders.values()]
      .flatMap((order) => order.refunds)
      .find((candidate) => candidate.id === id);
    if (refund === undefined) throw refusal('refunds.get', 404, 'RESOURCE_NOT_FOUND');
    return refund;
  };
  const byAuthorization = (id: string) => {
    const order = [...orders.values()].find((candidate) => candidate.authorization?.id === id);
    if (order?.authorization === undefined)
      throw refusal('authorizations', 404, 'RESOURCE_NOT_FOUND');
    return { order, authorization: order.authorization };
  };

  const fake: FakeHoldPayPal = {
    calls: [],
    approve: (orderId) => {
      const order = find(orderId);
      if (order.status !== 'CREATED') throw new Error(`order ${orderId} cannot be approved`);
      order.status = 'APPROVED';
    },
    script: (method, outcome) => {
      scripts.set(method, [...(scripts.get(method) ?? []), outcome]);
    },
    refundEndsAs: (status) => {
      nextRefund = status;
    },
    settleRefund: (refundId, status) => {
      refundOf(refundId).status = status;
    },
    order: (orderId) => orders.get(orderId),
    captures: () => [...orders.values()].filter((order) => order.capture !== undefined).length,
    refunds: () => [...orders.values()].reduce((sum, order) => sum + order.refunds.length, 0),

    createOrder: (input) =>
      run('createOrder', input.requestId, () => {
        const order: HoldOrder = {
          id: next('ORDER'),
          input,
          status: 'CREATED',
          authorization: undefined,
          capture: undefined,
          refunds: [],
        };
        orders.set(order.id, order);
        return body(order);
      }).then((answer) => orderSchema.parse(answer)),
    getOrder: (orderId) =>
      run('getOrder', undefined, () => body(find(orderId))).then((answer) =>
        orderSchema.parse(answer),
      ),
    authorizeOrder: (orderId, requestId) =>
      run('authorizeOrder', requestId, () => {
        const order = find(orderId);
        if (order.authorization !== undefined)
          throw refusal('orders.authorize', 422, 'ORDER_ALREADY_AUTHORIZED');
        if (order.status !== 'APPROVED')
          throw refusal('orders.authorize', 422, 'ORDER_NOT_APPROVED');
        order.status = 'COMPLETED';
        order.authorization = { id: next('AUTH'), status: 'CREATED' };
        return body(order);
      }).then((answer) => orderSchema.parse(answer)),
    captureAuthorization: (authorizationId, input) =>
      run('captureAuthorization', input.requestId, () => {
        const { order, authorization } = byAuthorization(authorizationId);
        if (authorization.status === 'CAPTURED')
          throw refusal('authorizations.capture', 422, 'AUTHORIZATION_ALREADY_CAPTURED');
        if (authorization.status === 'VOIDED')
          throw refusal('authorizations.capture', 422, 'AUTHORIZATION_VOIDED');
        authorization.status = 'CAPTURED';
        order.capture = { id: next('CAPTURE'), amount: input.amount ?? order.input.amount };
        return {
          id: order.capture.id,
          status: 'COMPLETED',
          amount: toPayPalAmount(order.capture.amount),
          final_capture: true,
        };
      }).then((answer) => captureSchema.parse(answer)),
    voidAuthorization: (authorizationId, requestId) =>
      run('voidAuthorization', requestId, () => {
        const { authorization } = byAuthorization(authorizationId);
        if (authorization.status === 'CAPTURED')
          throw refusal('authorizations.void', 422, 'PREVIOUSLY_CAPTURED');
        authorization.status = 'VOIDED';
        return undefined;
      }).then((answer) => (answer === undefined ? undefined : authorizationSchema.parse(answer))),
    refundCapture: (captureId, input) =>
      run('refundCapture', input.requestId, () => {
        const order = [...orders.values()].find((candidate) => candidate.capture?.id === captureId);
        if (order?.capture === undefined)
          throw refusal('captures.refund', 404, 'RESOURCE_NOT_FOUND');
        const amount = input.amount ?? order.capture.amount;
        const refund = { id: next('REFUND'), amount, customId: input.customId, status: nextRefund };
        nextRefund = 'COMPLETED';
        order.refunds.push(refund);
        return refundBody(refund);
      }).then((answer) => refundSchema.parse(answer)),
    getRefund: (refundId) =>
      run('getRefund', undefined, () => refundBody(refundOf(refundId))).then((answer) =>
        refundSchema.parse(answer),
      ),
    captureOrder: () => Promise.reject(new Error('a hold is captured through its authorization')),
    verifyWebhookSignature: () => Promise.resolve(false),
  };
  return fake;
}

/** An order as PayPal returns it with `Prefer: return=representation`. */
function body(order: HoldOrder): unknown {
  const amount = toPayPalAmount(order.input.amount);
  const authorizations =
    order.authorization === undefined
      ? undefined
      : [{ id: order.authorization.id, status: order.authorization.status, amount }];
  const captures =
    order.capture === undefined
      ? undefined
      : [
          {
            id: order.capture.id,
            status: 'COMPLETED',
            amount: toPayPalAmount(order.capture.amount),
            final_capture: true,
          },
        ];
  const refunds = order.refunds.length === 0 ? undefined : order.refunds.map(refundBody);
  return {
    id: order.id,
    status: order.status,
    purchase_units: [
      {
        reference_id: order.input.referenceId,
        amount,
        ...(authorizations === undefined
          ? {}
          : {
              payments: {
                authorizations,
                ...(captures === undefined ? {} : { captures }),
                ...(refunds === undefined ? {} : { refunds }),
              },
            }),
      },
    ],
  };
}

function refundBody(refund: FakeRefund): unknown {
  return {
    id: refund.id,
    status: refund.status,
    amount: toPayPalAmount(refund.amount),
    ...(refund.customId === undefined ? {} : { custom_id: refund.customId }),
  };
}
