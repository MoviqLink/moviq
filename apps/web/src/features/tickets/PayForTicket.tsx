import type { TicketIntent, TicketProduct } from '@moviq/contracts';
import type { Lang } from '../../shared/i18n/lang';
import { useEffect, useState } from 'react';

import { ApiRequestError } from '../../shared/api/errors';
import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { useCheckout, type CheckoutState } from '../trip/payment/useCheckout';
import { ticketsApi } from './api';
import { useTicketsT } from './texts';
import { TicketPaymentFlow } from './TicketPaymentFlow';
import { productText } from './localization';

/** Creates a server-priced intent before PayPal is offered. */
export function PayForTicket({
  product,
  disabled,
  onBusyChange,
  onChooseAnother,
}: {
  readonly product: TicketProduct;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onChooseAnother: () => void;
}) {
  const locale = useLocale();
  const lang = useLang();
  const [intentAttempt, setIntentAttempt] = useState(0);
  const [paypalAttempt, setPaypalAttempt] = useState(0);
  const [intent, setIntent] = useState<TicketIntent | null>(null);
  const [intentFailed, setIntentFailed] = useState(false);
  const checkout = useCheckout(locale, paypalAttempt);

  useEffect(() => {
    const controller = new AbortController();
    void ticketsApi.intent(product.id, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setIntent(value);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && error.failure.kind === 'aborted') return;
        setIntentFailed(true);
      },
    );
    return () => {
      controller.abort();
    };
  }, [intentAttempt, product.id]);

  const retryIntent = () => {
    setIntentFailed(false);
    setIntentAttempt((value) => value + 1);
  };

  return (
    <TicketCheckoutPanel
      product={intent?.product ?? product}
      lang={lang}
      intent={intent}
      intentFailed={intentFailed}
      checkout={checkout}
      disabled={disabled}
      onBusyChange={onBusyChange}
      onChooseAnother={onChooseAnother}
      retryIntent={retryIntent}
      retryPayPal={() => {
        setPaypalAttempt((value) => value + 1);
      }}
    />
  );
}

function TicketCheckoutPanel({
  product,
  lang,
  intent,
  intentFailed,
  checkout,
  disabled,
  onBusyChange,
  onChooseAnother,
  retryIntent,
  retryPayPal,
}: {
  readonly product: TicketProduct;
  readonly lang: Lang;
  readonly intent: TicketIntent | null;
  readonly intentFailed: boolean;
  readonly checkout: CheckoutState;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onChooseAnother: () => void;
  readonly retryIntent: () => void;
  readonly retryPayPal: () => void;
}) {
  const t = useTicketsT();
  const locale = useLocale();
  return (
    <section className="ticket-checkout" aria-labelledby="ticket-checkout-title">
      <span className="ticket-demo-tag">{t.sandboxTag}</span>
      <h3 id="ticket-checkout-title">
        {productText(product.id, product.name, product.description, lang).name}
      </h3>
      <p>
        {t.price} · {formatMoney(product.price, locale)}
      </p>
      {intent === null && !intentFailed && <p role="status">{t.preparing}</p>}
      {intentFailed && (
        <div>
          <p role="alert">{t.failedCreate}</p>
          <button className="btn small" type="button" onClick={retryIntent}>
            {t.retry}
          </button>
        </div>
      )}
      {checkout.status === 'loading' && <p role="status">{t.loadingPayPal}</p>}
      {checkout.status === 'unavailable' && <p role="status">{t.unavailable(checkout.reason)}</p>}
      {checkout.status === 'not-eligible' && <p role="status">{t.notEligible}</p>}
      {checkout.status === 'failed' && (
        <div>
          <p role="status">{t.failedPayPal}</p>
          <button className="btn small" type="button" onClick={retryPayPal}>
            {t.retryPayPal}
          </button>
        </div>
      )}
      {intent !== null &&
        checkout.status === 'ready' &&
        (checkout.sandbox ? (
          <TicketPaymentFlow
            key={intent.id}
            intent={intent}
            checkout={checkout.checkout}
            disabled={disabled}
            onBusyChange={onBusyChange}
            onChooseAnother={onChooseAnother}
          />
        ) : (
          <p role="status">{t.unavailable('Ticket demonstrations require PayPal Sandbox.')}</p>
        ))}
    </section>
  );
}
