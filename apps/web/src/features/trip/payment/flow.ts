import type { Payment, PaymentPurpose } from '@moviq/contracts';

/**
 * Where a payment is. Only `captured` means paid, and only the server's answer sets it; every
 * other ending says plainly that nothing was charged or that the server has not confirmed yet.
 */
export type PayState =
  | { readonly step: 'idle' }
  | { readonly step: 'creating' }
  | { readonly step: 'approving'; readonly payment: Payment }
  | { readonly step: 'confirming'; readonly payment: Payment }
  | { readonly step: 'captured'; readonly payment: Payment }
  | { readonly step: 'cancelled' }
  /**
   * PayPal approved, but the server has not confirmed the charge (or its answer did not arrive).
   * The order is asked about again a few times; `exhausted` once those are spent.
   */
  | {
      readonly step: 'unconfirmed';
      readonly payment: Payment;
      readonly checking: boolean;
      readonly exhausted: boolean;
    }
  | { readonly step: 'declined'; readonly payment: Payment }
  | { readonly step: 'failed'; readonly at: 'create' | 'approve' };

export const isBusy = (state: PayState): boolean =>
  state.step === 'creating' || state.step === 'approving' || state.step === 'confirming';

/** No other payment may start while one is in flight or its result is still unknown. */
const blocksPaying = (state: PayState): boolean =>
  isBusy(state) || state.step === 'unconfirmed' || state.step === 'captured';

export interface PaymentsEndpoints {
  readonly createOrder: (purpose: PaymentPurpose) => Promise<Payment>;
  readonly confirmOrder: (paymentId: string) => Promise<Payment>;
  readonly getOrder: (paymentId: string) => Promise<Payment>;
}

export interface CheckoutCallbacks {
  /** The buyer approved the PayPal order with this id. */
  readonly onApprove: (orderId: string) => Promise<void>;
  readonly onCancel: () => void;
  readonly onError: () => void;
}

/** A PayPal one-time payment session: opens the approval window for the order being created. */
interface CheckoutSession {
  readonly start: (order: Promise<{ orderId: string }>) => Promise<void>;
}

export interface Checkout {
  readonly session: (callbacks: CheckoutCallbacks) => CheckoutSession;
}

export interface FlowDeps {
  readonly endpoints: PaymentsEndpoints;
  readonly checkout: Checkout;
  /** Runs `run` after `ms` and returns what cancels it. */
  readonly schedule: (run: () => void, ms: number) => () => void;
}

/** Waits before asking again about an unconfirmed payment: three questions, further apart. */
export const RECHECK_DELAYS_MS = [5_000, 15_000, 45_000] as const;

const FINAL_REFUSALS = new Set<Payment['status']>(['failed', 'voided', 'refunded']);

/**
 * Settles what the server says about a payment and, while it is unconfirmed, asks again a few
 * times, spaced out. `check` asks at once.
 */
function createSettler(deps: FlowDeps, set: (state: PayState) => void) {
  let attempts = 0;
  let cancel: (() => void) | null = null;

  function settle(payment: Payment): void {
    if (payment.status === 'captured') set({ step: 'captured', payment });
    else if (FINAL_REFUSALS.has(payment.status)) set({ step: 'declined', payment });
    else unconfirmed(payment);
  }

  function unconfirmed(payment: Payment): void {
    const wait = RECHECK_DELAYS_MS[attempts];
    set({ step: 'unconfirmed', payment, checking: false, exhausted: wait === undefined });
    if (wait === undefined) return;
    cancel = deps.schedule(() => {
      cancel = null;
      attempts += 1;
      void check(payment);
    }, wait);
  }

  async function check(payment: Payment): Promise<void> {
    cancel?.();
    cancel = null;
    set({ step: 'unconfirmed', payment, checking: true, exhausted: false });
    try {
      settle(await deps.endpoints.getOrder(payment.id));
    } catch {
      unconfirmed(payment);
    }
  }

  return {
    settle,
    unconfirmed,
    check,
    stop(): void {
      cancel?.();
      cancel = null;
    },
  };
}

/**
 * Pays one purpose with PayPal: the server creates the order and sets the amount, the buyer
 * approves in PayPal's window, and the server confirms. While a step is in flight, or while the
 * result is unknown, `pay` does nothing, so a second click never creates a second order.
 */
export function createPaymentFlow(
  deps: FlowDeps,
  purpose: PaymentPurpose,
  onChange: (state: PayState) => void,
) {
  let state: PayState = { step: 'idle' };
  let payment: Payment | null = null;
  let stopped = false;
  const set = (next: PayState) => {
    if (stopped) return;
    state = next;
    onChange(next);
  };
  const settler = createSettler(deps, set);
  const opening = () => state.step === 'creating' || state.step === 'approving';

  async function approved(orderId: string): Promise<void> {
    if (payment === null || state.step !== 'approving' || orderId !== payment.paypalOrderId) {
      set({ step: 'failed', at: 'approve' });
      return;
    }
    const ours = payment;
    set({ step: 'confirming', payment: ours });
    try {
      settler.settle(await deps.endpoints.confirmOrder(ours.id));
    } catch {
      settler.unconfirmed(ours);
    }
  }

  const session = deps.checkout.session({
    onApprove: approved,
    onCancel: () => {
      if (opening()) set({ step: 'cancelled' });
    },
    onError: () => {
      if (opening()) set({ step: 'failed', at: 'approve' });
    },
  });

  return {
    state: (): PayState => state,
    /** Starts paying; call it straight from the click so the browser lets PayPal's window open. */
    pay(): void {
      if (blocksPaying(state)) return;
      payment = null;
      set({ step: 'creating' });
      const order = deps.endpoints.createOrder(purpose).then((created) => {
        payment = created;
        set({ step: 'approving', payment: created });
        return { orderId: created.paypalOrderId };
      });
      void order.catch(() => {
        if (state.step === 'creating') set({ step: 'failed', at: 'create' });
      });
      void session.start(order).catch(() => {
        if (opening()) set({ step: 'failed', at: 'approve' });
      });
    },
    /** Asks the server about an unconfirmed payment now. */
    check(): void {
      if (state.step === 'unconfirmed' && !state.checking) void settler.check(state.payment);
    },
    /** Stops asking and reporting, for example when the screen closes. */
    stop(): void {
      stopped = true;
      settler.stop();
    },
  };
}

export type PaymentFlow = ReturnType<typeof createPaymentFlow>;
