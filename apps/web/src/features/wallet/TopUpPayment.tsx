import type { WalletTopUp } from '@moviq/contracts';
import { useEffect, useRef, useState } from 'react';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { tripApi } from '../trip/api';
import {
  createPaymentFlow,
  isBusy,
  type Checkout,
  type PaymentFlow,
  type PayState,
} from '../trip/payment/flow';
import { PayPalButton } from '../trip/payment/PayPalButton';

const schedule = (run: () => void, ms: number) => {
  const timer = window.setTimeout(run, ms);
  return () => {
    window.clearTimeout(timer);
  };
};

const WORDS = {
  en: {
    creating: 'Creating the PayPal order…',
    approving: 'Approve the payment in the PayPal window.',
    confirming: 'PayPal approved it. Confirming the payment…',
    added: (amount: string) => `${amount} added to your trip wallet.`,
    cancelled: 'You closed PayPal. Nothing was charged.',
    unconfirmed: 'PayPal has not confirmed it yet. Checking again shortly.',
    unconfirmedStill:
      'PayPal has not confirmed it yet. Nothing is added until it does; check again later.',
    declined: 'PayPal declined the payment. Nothing was added.',
    failedCreate: 'The PayPal order could not be created. Try again.',
    failedApprove: 'The PayPal window could not finish. Nothing was charged.',
    checkAgain: 'Check again',
    addMore: 'Add more',
  },
  es: {
    creating: 'Creando el pedido de PayPal…',
    approving: 'Aprueba el pago en la ventana de PayPal.',
    confirming: 'PayPal lo ha aprobado. Confirmando el pago…',
    added: (amount: string) => `${amount} añadidos a tu billetera de viaje.`,
    cancelled: 'Has cerrado PayPal. No se ha cobrado nada.',
    unconfirmed: 'PayPal aún no lo ha confirmado. Volvemos a comprobarlo en breve.',
    unconfirmedStill:
      'PayPal aún no lo ha confirmado. No se añade nada hasta entonces; ' +
      'vuelve a comprobarlo más tarde.',
    declined: 'PayPal ha rechazado el pago. No se ha añadido nada.',
    failedCreate: 'No se pudo crear el pedido de PayPal. Inténtalo de nuevo.',
    failedApprove: 'La ventana de PayPal no pudo terminar. No se ha cobrado nada.',
    checkAgain: 'Comprobar de nuevo',
    addMore: 'Añadir más',
  },
} as const;
type Words = (typeof WORDS)[keyof typeof WORDS];

/** Pays one prepared top-up with PayPal, through the same create/approve/confirm as a ticket. */
export function TopUpPayment({
  topUp,
  checkout,
  onBusyChange,
  onAdded,
  onAddMore,
}: {
  readonly topUp: WalletTopUp;
  readonly checkout: Checkout;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onAdded: () => void;
  readonly onAddMore: () => void;
}) {
  const w = WORDS[useLang()];
  const locale = useLocale();
  const [state, setState] = useState<PayState>({ step: 'idle' });
  const flow = useRef<PaymentFlow | null>(null);
  const added = useRef(onAdded);
  useEffect(() => {
    added.current = onAdded;
  });
  useEffect(() => {
    const current = createPaymentFlow(
      { endpoints: tripApi, checkout, schedule },
      topUp.purpose,
      (next) => {
        setState(next);
        onBusyChange(isBusy(next) || next.step === 'unconfirmed');
        if (next.step === 'captured') added.current();
      },
    );
    flow.current = current;
    return () => {
      current.stop();
      flow.current = null;
    };
  }, [checkout, topUp.purpose, onBusyChange]);

  const status = statusText(state, w, locale);
  const done = state.step === 'captured' || state.step === 'unconfirmed';
  return (
    <div className="wal-pay">
      {!done && (
        <PayPalButton
          disabled={isBusy(state)}
          onClick={() => {
            flow.current?.pay();
          }}
        />
      )}
      {status !== null && (
        <p className={`wal-status ${state.step}`} role="status">
          {status}
        </p>
      )}
      {state.step === 'captured' && (
        <button className="btn small" type="button" onClick={onAddMore}>
          {w.addMore}
        </button>
      )}
      {state.step === 'unconfirmed' && state.exhausted && (
        <button
          className="btn small"
          type="button"
          onClick={() => {
            flow.current?.check();
          }}
        >
          {w.checkAgain}
        </button>
      )}
    </div>
  );
}

function statusText(state: PayState, w: Words, locale: string): string | null {
  switch (state.step) {
    case 'idle':
      return null;
    case 'creating':
      return w.creating;
    case 'approving':
      return w.approving;
    case 'confirming':
      return w.confirming;
    case 'captured':
      return w.added(formatMoney(state.payment.amount, locale));
    case 'cancelled':
      return w.cancelled;
    case 'unconfirmed':
      return state.checking ? w.confirming : state.exhausted ? w.unconfirmedStill : w.unconfirmed;
    case 'declined':
      return w.declined;
    case 'failed':
      return state.at === 'create' ? w.failedCreate : w.failedApprove;
  }
}
