import type { TicketIntent } from '@moviq/contracts';
import { useEffect, useRef, useState } from 'react';

import { useLocale } from '../../shared/i18n';
import { formatMoney } from '../../shared/journey/money';
import { travellerHref } from '../../shared/routing/hrefs';
import { tripApi } from '../trip/api';
import {
  createPaymentFlow,
  isBusy,
  type Checkout,
  type PaymentFlow,
  type PayState,
} from '../trip/payment/flow';
import { PayPalButton } from '../trip/payment/PayPalButton';
import { SandboxHelp } from './SandboxHelp';
import { useTicketsT } from './texts';

const schedule = (run: () => void, ms: number) => {
  const timer = window.setTimeout(run, ms);
  return () => {
    window.clearTimeout(timer);
  };
};

/** The real intent purpose travels through the existing server create/confirm flow. */
export function TicketPaymentFlow({
  intent,
  checkout,
  disabled,
  onBusyChange,
  onChooseAnother,
}: {
  readonly intent: TicketIntent;
  readonly checkout: Checkout;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onChooseAnother: () => void;
}) {
  const t = useTicketsT();
  const locale = useLocale();
  const [state, setState] = useState<PayState>({ step: 'idle' });
  const flow = useRef<PaymentFlow | null>(null);
  useEffect(() => {
    const current = createPaymentFlow(
      { endpoints: tripApi, checkout, schedule },
      intent.purpose,
      (next) => {
        setState(next);
        onBusyChange(isBusy(next) || next.step === 'unconfirmed');
      },
    );
    flow.current = current;
    return () => {
      current.stop();
      flow.current = null;
    };
  }, [checkout, intent.purpose, onBusyChange]);

  const status = paymentText(state, t, locale);
  const done = state.step === 'captured' || state.step === 'unconfirmed';
  return (
    <div className="ticket-flow">
      <p>
        {t.price} · {formatMoney(intent.product.price, locale)}
      </p>
      {!done && <SandboxHelp />}
      {!done && (
        <PayPalButton
          disabled={disabled || isBusy(state)}
          onClick={() => {
            flow.current?.pay();
          }}
        />
      )}
      {status !== null && (
        <p className={`pay-step ${state.step}`} role="status">
          {status}
        </p>
      )}
      {state.step === 'captured' && (
        <div className="ticket-flow-actions">
          <a className="link" href={travellerHref.ticketWallet}>
            {t.wallet}
          </a>
          <button className="btn small" type="button" onClick={onChooseAnother}>
            {t.another}
          </button>
        </div>
      )}
      {state.step === 'unconfirmed' && state.exhausted && (
        <button
          className="btn small"
          type="button"
          onClick={() => {
            flow.current?.check();
          }}
        >
          {t.checkAgain}
        </button>
      )}
    </div>
  );
}

function paymentText(
  state: PayState,
  t: ReturnType<typeof useTicketsT>,
  locale: string,
): string | null {
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
      return `${t.captured} · ${formatMoney(state.payment.amount, locale)}`;
    case 'cancelled':
      return t.cancelled;
    case 'unconfirmed':
      return state.checking ? t.confirming : state.exhausted ? t.unconfirmedStill : t.unconfirmed;
    case 'declined':
      return t.declined;
    case 'failed':
      return state.at === 'create' ? t.failedCreate : t.failedApprove;
  }
}
