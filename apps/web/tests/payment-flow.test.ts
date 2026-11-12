import type { Payment, PaymentPurpose } from '@moviq/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createPaymentFlow,
  type Checkout,
  type CheckoutCallbacks,
  type PayState,
  type PaymentsEndpoints,
  RECHECK_DELAYS_MS,
} from '../src/features/trip/payment/flow';
import { payment } from './fixtures/journeys';

const now = Date.parse('2026-11-11T12:00:00.000Z');
const purpose: PaymentPurpose = {
  kind: 'journey-alternative',
  journeyId: 'trip-risk',
  alternativeId: 'alt-taxi',
};

type Buyer = 'approves' | 'cancels' | 'errors' | 'approves-another-order';

/** A double of PayPal's SDK: waits for our order, then the buyer acts as told. */
function sdkDouble(buyer: Buyer): Checkout & { opened: number } {
  const double = {
    opened: 0,
    session(callbacks: CheckoutCallbacks) {
      return {
        async start(order: Promise<{ orderId: string }>) {
          double.opened += 1;
          const { orderId } = await order;
          if (buyer === 'approves') await callbacks.onApprove(orderId);
          if (buyer === 'approves-another-order') await callbacks.onApprove('SOMEONE-ELSES');
          if (buyer === 'cancels') callbacks.onCancel();
          if (buyer === 'errors') callbacks.onError();
        },
      };
    },
  };
  return double;
}

function endpoints(confirmed: Payment['status'] | 'network'): PaymentsEndpoints & {
  createOrder: ReturnType<typeof vi.fn<PaymentsEndpoints['createOrder']>>;
  confirmOrder: ReturnType<typeof vi.fn<PaymentsEndpoints['confirmOrder']>>;
  getOrder: ReturnType<typeof vi.fn<PaymentsEndpoints['getOrder']>>;
} {
  return {
    createOrder: vi.fn(() => Promise.resolve(payment(now, 'created'))),
    confirmOrder: vi.fn(() =>
      confirmed === 'network'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(payment(now, confirmed)),
    ),
    getOrder: vi.fn(() => Promise.resolve(payment(now, 'unknown'))),
  };
}

/** A clock the test moves by hand: each scheduled question waits until `next` runs it. */
function manualClock() {
  const waits: { ms: number; run: () => void; cancelled: boolean }[] = [];
  return {
    waits,
    schedule: (run: () => void, ms: number) => {
      const wait = { ms, run, cancelled: false };
      waits.push(wait);
      return () => {
        wait.cancelled = true;
      };
    },
    next: () => {
      const wait = waits.find((w) => !w.cancelled);
      if (wait === undefined) return false;
      wait.cancelled = true;
      wait.run();
      return true;
    },
  };
}

async function pay(buyer: Buyer, confirmed: Payment['status'] | 'network') {
  const api = endpoints(confirmed);
  const sdk = sdkDouble(buyer);
  const states: PayState[] = [];
  const clock = manualClock();
  const deps = { endpoints: api, checkout: sdk, schedule: clock.schedule };
  const flow = createPaymentFlow(deps, purpose, (state) => states.push(state));
  flow.pay();
  await vi.waitFor(() => {
    expect(['creating', 'approving', 'confirming']).not.toContain(flow.state().step);
  });
  return { api, sdk, states, flow, clock, steps: states.map((s) => s.step) };
}

describe('paying an alternative with PayPal', () => {
  it('declares it paid only when the server confirms the capture', async () => {
    const { api, steps, flow } = await pay('approves', 'captured');
    expect(api.createOrder).toHaveBeenCalledWith(purpose);
    expect(api.confirmOrder).toHaveBeenCalledWith('pay-1');
    expect(steps).toEqual(['creating', 'approving', 'confirming', 'captured']);
    expect(flow.state()).toMatchObject({ step: 'captured', payment: { status: 'captured' } });
  });

  it('never says paid when the server answers anything but captured', async () => {
    for (const status of ['approved', 'authorized', 'unknown', 'created'] as const) {
      const { flow } = await pay('approves', status);
      expect(flow.state().step).toBe('unconfirmed');
    }
    for (const status of ['failed', 'voided', 'refunded'] as const) {
      const { flow } = await pay('approves', status);
      expect(flow.state().step).toBe('declined');
    }
  });

  it('does not say paid when the confirmation does not arrive', async () => {
    const { flow } = await pay('approves', 'network');
    expect(flow.state().step).toBe('unconfirmed');
  });

  it('confirms nothing when the buyer closes PayPal', async () => {
    const { api, flow } = await pay('cancels', 'captured');
    expect(flow.state().step).toBe('cancelled');
    expect(api.confirmOrder).not.toHaveBeenCalled();
  });

  it('confirms nothing when PayPal fails or approves an order that is not ours', async () => {
    for (const buyer of ['errors', 'approves-another-order'] as const) {
      const { api, flow } = await pay(buyer, 'captured');
      expect(flow.state()).toEqual({ step: 'failed', at: 'approve' });
      expect(api.confirmOrder).not.toHaveBeenCalled();
    }
  });

  it('creates one order however many times the button is pressed while it works', async () => {
    const api = endpoints('captured');
    const sdk = sdkDouble('approves');
    const flow = createPaymentFlow(
      { endpoints: api, checkout: sdk, schedule: manualClock().schedule },
      purpose,
      () => undefined,
    );
    flow.pay();
    flow.pay();
    flow.pay();
    await vi.waitFor(() => {
      expect(flow.state().step).toBe('captured');
    });
    flow.pay();
    expect(api.createOrder).toHaveBeenCalledTimes(1);
    expect(sdk.opened).toBe(1);
  });

  it('says the order was not created when the server refuses it, and lets the person try again', async () => {
    const api = endpoints('captured');
    api.createOrder.mockRejectedValueOnce(new Error('500'));
    const sdk = sdkDouble('approves');
    const flow = createPaymentFlow(
      { endpoints: api, checkout: sdk, schedule: manualClock().schedule },
      purpose,
      () => undefined,
    );
    flow.pay();
    await vi.waitFor(() => {
      expect(flow.state()).toEqual({ step: 'failed', at: 'create' });
    });
    flow.pay();
    await vi.waitFor(() => {
      expect(flow.state().step).toBe('captured');
    });
    expect(api.createOrder).toHaveBeenCalledTimes(2);
  });

  it('asks again about an unconfirmed payment three times, spaced out, then stops', async () => {
    const { api, flow, clock } = await pay('approves', 'unknown');
    expect(flow.state()).toMatchObject({ step: 'unconfirmed', exhausted: false });
    for (let n = 1; n <= 3; n += 1) {
      expect(clock.next()).toBe(true);
      await vi.waitFor(() => {
        expect(api.getOrder).toHaveBeenCalledTimes(n);
        expect(flow.state()).toMatchObject({ step: 'unconfirmed', checking: false });
      });
    }
    expect(clock.waits.map((w) => w.ms)).toEqual([...RECHECK_DELAYS_MS]);
    expect(clock.next()).toBe(false);
    expect(flow.state()).toMatchObject({ step: 'unconfirmed', exhausted: true });
    expect(api.getOrder).toHaveBeenCalledWith('pay-1');
  });

  it('declares it paid when asking again finds the capture', async () => {
    const { api, flow, clock } = await pay('approves', 'approved');
    api.getOrder.mockResolvedValueOnce(payment(now, 'captured'));
    clock.next();
    await vi.waitFor(() => {
      expect(flow.state().step).toBe('captured');
    });
  });

  it('starts no second payment while the first one is unconfirmed', async () => {
    const { api, sdk, flow } = await pay('approves', 'unknown');
    flow.pay();
    expect(api.createOrder).toHaveBeenCalledTimes(1);
    expect(sdk.opened).toBe(1);
  });

  it('asks once more when the person checks again, and stops asking when the screen closes', async () => {
    const { api, flow, clock } = await pay('approves', 'network');
    flow.check();
    await vi.waitFor(() => {
      expect(api.getOrder).toHaveBeenCalledTimes(1);
    });
    flow.stop();
    expect(clock.next()).toBe(false);
    expect(api.getOrder).toHaveBeenCalledTimes(1);
  });
});
