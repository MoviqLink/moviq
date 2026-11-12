import type { OrderView, Reservation } from '@moviq/contracts';

import { ApiRequestError } from '../../../shared/api/errors';
import type { Checkout } from '../../trip/payment/flow';
import type { Confirmed } from '../api';

/**
 * Where a reservation is. Only an order from the server's confirmation counts as reserved; every
 * other ending says that nothing was held, or that PayPal has not confirmed yet.
 */
export type HoldState =
  | { readonly step: 'idle' }
  | { readonly step: 'creating' }
  | { readonly step: 'approving'; readonly reservation: Reservation }
  | { readonly step: 'confirming'; readonly reservation: Reservation }
  | { readonly step: 'reserved'; readonly order: OrderView }
  | { readonly step: 'cancelled' }
  | { readonly step: 'unconfirmed' }
  /**
   * `gone`: refused (the offer expired, its pickup passed, or PayPal's hold could not be kept),
   * with the server's sentence; `unreachable`: PayPal did not answer.
   */
  | {
      readonly step: 'failed';
      readonly why: 'gone' | 'unreachable' | 'other';
      readonly message: string | null;
    };

export interface HoldEndpoints {
  readonly reserve: (offerId: string, language: 'en' | 'es') => Promise<Reservation>;
  readonly confirm: (offerId: string) => Promise<Confirmed>;
}

export const isHolding = (state: HoldState): boolean =>
  state.step === 'creating' || state.step === 'approving' || state.step === 'confirming';

const settled = (state: HoldState): boolean =>
  isHolding(state) || state.step === 'reserved' || state.step === 'unconfirmed';

type Failed = Extract<HoldState, { step: 'failed' }>;

const failed = (why: Failed['why'], message: string | null = null): Failed => ({
  step: 'failed',
  why,
  message,
});

function failure(error: unknown): Failed {
  if (!(error instanceof ApiRequestError)) return failed('other');
  const { failure: f } = error;
  if (f.kind === 'network' || (f.kind === 'http' && f.status === 503)) return failed('unreachable');
  if (f.kind === 'http' && (f.status === 409 || f.status === 404)) return failed('gone', f.message);
  return failed('other');
}

const isOrder = (answer: Confirmed): answer is OrderView => 'id' in answer;

/**
 * Reserves one offer: the server opens the PayPal order at its price, the buyer approves it in
 * PayPal's window, and the server confirms the hold and creates the order. While a step is in
 * flight, or once reserved, `reserve` does nothing, so a second press never opens a second order.
 */
export function createHoldFlow(
  deps: { readonly endpoints: HoldEndpoints; readonly checkout: Checkout },
  input: { readonly offerId: string; readonly language: 'en' | 'es' },
  onChange: (state: HoldState) => void,
) {
  let state: HoldState = { step: 'idle' };
  let reservation: Reservation | null = null;
  let stopped = false;
  const set = (next: HoldState) => {
    if (stopped) return;
    state = next;
    onChange(next);
  };
  const opening = () => state.step === 'creating' || state.step === 'approving';

  async function approved(orderId: string): Promise<void> {
    if (
      reservation === null ||
      state.step !== 'approving' ||
      orderId !== reservation.paypalOrderId
    ) {
      set(failed('other'));
      return;
    }
    set({ step: 'confirming', reservation });
    try {
      const answer = await deps.endpoints.confirm(input.offerId);
      set(isOrder(answer) ? { step: 'reserved', order: answer } : { step: 'unconfirmed' });
    } catch (error) {
      const refused = failure(error);
      set(refused.why === 'gone' ? refused : { step: 'unconfirmed' });
    }
  }

  const session = deps.checkout.session({
    onApprove: approved,
    onCancel: () => {
      if (opening()) set({ step: 'cancelled' });
    },
    onError: () => {
      if (opening()) set(failed('other'));
    },
  });

  return {
    /** Call it straight from the click, so the browser lets PayPal's window open. */
    reserve(): void {
      if (settled(state)) return;
      reservation = null;
      set({ step: 'creating' });
      const order = deps.endpoints.reserve(input.offerId, input.language).then((opened) => {
        reservation = opened;
        set({ step: 'approving', reservation: opened });
        return { orderId: opened.paypalOrderId };
      });
      void order.catch((error: unknown) => {
        if (state.step === 'creating') set(failure(error));
      });
      void session.start(order).catch(() => {
        if (opening()) set(failed('other'));
      });
    },
    stop(): void {
      stopped = true;
    },
  };
}

export type HoldFlow = ReturnType<typeof createHoldFlow>;
