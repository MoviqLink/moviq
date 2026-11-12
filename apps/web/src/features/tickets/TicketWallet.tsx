import type { TicketWallet as TicketWalletData } from '@moviq/contracts';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { travellerHref } from '../../shared/routing/hrefs';
import { useTicketsT } from './texts';
import { TicketPass } from './TicketPass';
import { localizedNotice, productText } from './localization';

const formatInstant = (value: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );

export function TicketWallet({ data }: { readonly data: TicketWalletData }) {
  const t = useTicketsT();
  const locale = useLocale();
  const lang = useLang();
  return (
    <section className="ticket-section" aria-labelledby="ticket-wallet-title">
      <div className="ticket-section-head">
        <div>
          <h2 id="ticket-wallet-title">{t.wallet}</h2>
          <p className="ticket-description">{t.walletLead}</p>
        </div>
        <a className="btn small" href={travellerHref.tickets}>
          {t.back}
        </a>
      </div>
      <p className="ticket-notice" role="note">
        {localizedNotice(data.notice || t.noticeFallback, lang)}
      </p>
      {data.hasMore && <p className="ticket-note">{t.moreWallet}</p>}
      {data.items.length === 0 ? (
        <div className="ticket-empty">
          <p>{t.walletEmpty}</p>
          <a className="link" href={travellerHref.tickets}>
            {t.back}
          </a>
        </div>
      ) : (
        <ul className="ticket-wallet-list">
          {data.items.map((item) => (
            <li key={item.id} className="ticket-wallet-item">
              <TicketPass
                ticket={{
                  id: item.id,
                  name: productText(
                    item.product.id,
                    item.product.name,
                    item.product.description,
                    lang,
                  ).name,
                  operator: item.product.operator,
                  price: item.product.price,
                  paidWith: item.paypalOrderId === null ? 'wallet' : 'paypal',
                  paypalOrderId: item.paypalOrderId,
                }}
                refunded={item.status === 'refunded'}
              />
              <div>
                <p>{t.purchasedAt(formatInstant(item.createdAt, locale))}</p>
                <p className="ticket-receipt">{t.purchaseId(item.id)}</p>
                <p className="ticket-receipt">Payment: {item.paymentId}</p>
                {item.paypalCaptureId !== null && (
                  <p className="ticket-receipt">PayPal Capture: {item.paypalCaptureId}</p>
                )}
              </div>
              <div className="ticket-wallet-side">
                <span
                  className={item.status === 'refunded' ? 'ticket-refunded' : 'ticket-captured'}
                >
                  {item.status === 'refunded' ? t.refundedStatus : t.capturedStatus}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
