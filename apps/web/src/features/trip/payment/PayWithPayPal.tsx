import type { Money, Payment } from '@moviq/contracts';
import { useEffect, useRef, useState } from 'react';

import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { tripApi } from '../api';
import { useTripT, type TripDict } from '../texts';
import { createPaymentFlow, isBusy, type Checkout, type PayState, type PaymentFlow } from './flow';
import { PayPalButton } from './PayPalButton';
import { useCheckout } from './useCheckout';

const schedule = (run: () => void, ms: number) => {
  const timer = window.setTimeout(run, ms);
  return () => {
    window.clearTimeout(timer);
  };
};

function stepText(state: PayState, t: TripDict['pay'], paid: (m: Money) => string) {
  switch (state.step) {
    case 'idle':
      return null;
    case 'creating':
      return t.creating;
    case 'approving':
      return t.approving;
    case 'confirming':
      return t.confirming;
    case 'captured':
      return `${paid(state.payment.amount)} ${t.applied}`;
    case 'cancelled':
      return t.cancelled;
    case 'unconfirmed':
      if (state.checking) return t.checking;
      return state.exhausted ? t.unconfirmedStill : t.unconfirmed;
    case 'declined':
      return t.declined;
    case 'failed':
      return state.at === 'create' ? t.failedCreate : t.failedApprove;
  }
}

interface FlowProps {
  readonly checkout: Checkout;
  readonly sandbox: boolean;
  readonly journeyId: string;
  readonly alternativeId: string;
  readonly onBusy: (busy: boolean) => void;
  readonly onPaid: (payment: Payment, sandbox: boolean) => void;
}

/** One alternative's payment: the official button, locked while a step is in flight. */
function PaymentSteps({ checkout, sandbox, journeyId, alternativeId, onBusy, onPaid }: FlowProps) {
  const t = useTripT().pay;
  const locale = useLocale();
  const [state, setState] = useState<PayState>({ step: 'idle' });
  const flow = useRef<PaymentFlow | null>(null);
  const callbacks = useRef({ onBusy, onPaid });

  useEffect(() => {
    callbacks.current = { onBusy, onPaid };
  });

  useEffect(() => {
    const purpose = { kind: 'journey-alternative', journeyId, alternativeId } as const;
    const current = createPaymentFlow(
      { endpoints: tripApi, checkout, schedule },
      purpose,
      (next) => {
        setState(next);
        callbacks.current.onBusy(isBusy(next) || next.step === 'unconfirmed');
        if (next.step === 'captured') callbacks.current.onPaid(next.payment, sandbox);
      },
    );
    flow.current = current;
    return () => {
      current.stop();
      flow.current = null;
    };
  }, [checkout, sandbox, journeyId, alternativeId]);

  const paid = (m: Money) => (sandbox ? t.capturedSandbox : t.captured)(formatMoney(m, locale));
  const text = stepText(state, t, paid);
  const settled = state.step === 'captured' || state.step === 'unconfirmed';
  return (
    <div className="pay">
      {!settled && <PayPalButton disabled={isBusy(state)} onClick={() => flow.current?.pay()} />}
      {text !== null && (
        <p className={`pay-step ${state.step}`} role="status">
          {text}
        </p>
      )}
      {state.step === 'unconfirmed' && state.exhausted && (
        <button type="button" className="btn small" onClick={() => flow.current?.check()}>
          {t.checkAgain}
        </button>
      )}
    </div>
  );
}

interface Props {
  readonly journeyId: string;
  readonly alternativeId: string;
  readonly price: Money;
  readonly onBusy: (busy: boolean) => void;
  readonly onPaid: (payment: Payment, sandbox: boolean) => void;
}

/** Paying an alternative with PayPal, or the reason it cannot be paid here. */
export function PayWithPayPal({ journeyId, alternativeId, price, onBusy, onPaid }: Props) {
  const t = useTripT();
  const locale = useLocale();
  const [attempt, setAttempt] = useState(0);
  const checkout = useCheckout(locale, attempt);
  return (
    <div className="pay-box">
      <p className="pay-price num">{t.pay.price(formatMoney(price, locale))}</p>
      {checkout.status === 'loading' && <p className="pay-step">{t.pay.loading}</p>}
      {checkout.status === 'unavailable' && (
        <p className="pay-step">{t.pay.unavailable(checkout.reason)}</p>
      )}
      {checkout.status === 'not-eligible' && <p className="pay-step">{t.pay.notEligible}</p>}
      {checkout.status === 'failed' && (
        <div className="pay-failed">
          <p className="pay-step">{t.pay.loadFailed}</p>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setAttempt((n) => n + 1);
            }}
          >
            {t.retry}
          </button>
        </div>
      )}
      {checkout.status === 'ready' && (
        <PaymentSteps
          checkout={checkout.checkout}
          sandbox={checkout.sandbox}
          journeyId={journeyId}
          alternativeId={alternativeId}
          onBusy={onBusy}
          onPaid={onPaid}
        />
      )}
    </div>
  );
}
