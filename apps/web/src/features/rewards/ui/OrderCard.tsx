import type { OrderView } from '@moviq/contracts';
import { useState } from 'react';

import { useLocale } from '../../../shared/i18n';
import { useLang } from '../../../shared/i18n/lang';
import { formatMoney } from '../../../shared/journey/money';
import { formatCityTime } from '../../../shared/time/city';
import { useNow } from '../../../shared/time/clock';
import { rewardsApi } from '../api';
import { canCancel, changesText } from '../model/need';
import { serverWords } from '../model/server-words';
import { ApiRequestError } from '../../../shared/api/errors';
import { QrCode } from '../qr/QrCode';
import { useRewardsT } from '../texts';

/** `failed` keeps the server's sentence, when it gave one. */
type Action =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'failed'; readonly message: string | null };

const refusal = (error: unknown): string | null =>
  error instanceof ApiRequestError && error.failure.kind === 'http' ? error.failure.message : null;

/** The signed code while the order can be collected, renewed by asking the server again. */
function Pickup({ order, onChange }: { order: OrderView; onChange: (o: OrderView) => void }) {
  const t = useRewardsT().orders;
  const locale = useLocale();
  const now = useNow();
  const { pickup } = order;
  if (pickup === null) return null;
  const expired = Date.parse(pickup.expiresAt) <= now;
  return (
    <div className="reward-pickup">
      {!expired && <QrCode text={pickup.qr} label={`${t.code} ${order.code}`} />}
      <div className="reward-pickup-words">
        <p className="reward-code-label">{t.code}</p>
        <p className="reward-code num">{order.code}</p>
        <p className="reward-quiet">{t.show}</p>
        {expired ? (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              void rewardsApi.order(order.id).then(onChange, () => undefined);
            }}
          >
            {t.renew}
          </button>
        ) : (
          <p className="reward-quiet">{t.expires(formatCityTime(pickup.expiresAt, locale))}</p>
        )}
      </div>
    </div>
  );
}

/** What PayPal holds, charged and refunded, as the server says. */
function PaymentLine({ order }: { order: OrderView }) {
  const t = useRewardsT().orders;
  const locale = useLocale();
  const { payment } = order;
  const parts = [t.payment[payment.status]];
  if (payment.captured.amountMinor > 0)
    parts.push(t.charged(formatMoney(payment.captured, locale)));
  if (payment.refunded.amountMinor > 0)
    parts.push(t.refunded(formatMoney(payment.refunded, locale)));
  if (payment.refundPending.amountMinor > 0)
    parts.push(t.refundPending(formatMoney(payment.refundPending, locale)));
  return <p className="reward-quiet">{parts.join(' · ')}</p>;
}

/** One order of "My orders": the merchant, the code to show, its state and free cancellation. */
export function OrderCard({
  order,
  onChange,
}: {
  order: OrderView;
  onChange: (o: OrderView) => void;
}) {
  const r = useRewardsT();
  const t = r.orders;
  const lang = useLang();
  const locale = useLocale();
  const [action, setAction] = useState<Action>({ kind: 'idle' });
  const cancel = () => {
    setAction({ kind: 'busy' });
    rewardsApi.cancel(order.id).then(
      (changed) => {
        setAction({ kind: 'idle' });
        onChange(changed);
      },
      (error: unknown) => {
        setAction({ kind: 'failed', message: refusal(error) });
      },
    );
  };
  return (
    <article
      className={`reward-order is-${order.status}`}
      aria-label={`${order.merchant.name} ${order.code}`}
    >
      <header className="reward-order-head">
        <h3>
          {order.merchant.name} <span className="reward-demo">{r.demo}</span>
        </h3>
        <p className="reward-order-status">{t.status[order.status]}</p>
      </header>
      <p className="reward-lines">
        {order.lines
          .map((line) =>
            [`${String(line.quantity)} × ${line.name}`, changesText(line.changes, lang)]
              .filter(Boolean)
              .join(', '),
          )
          .join(' · ')}
      </p>
      <p className="reward-amount num">{formatMoney(order.reward.price, locale)}</p>
      <PaymentLine order={order} />
      <Pickup order={order} onChange={onChange} />
      {order.status === 'reserved' && (
        <div className="reward-cancel">
          <p className="reward-quiet">
            {canCancel(order) ? t.kitchen(formatCityTime(order.kitchenStartsAt, locale)) : t.noFree}
          </p>
          {canCancel(order) && (
            <button
              type="button"
              className="btn small"
              disabled={action.kind === 'busy'}
              onClick={cancel}
            >
              {action.kind === 'busy' ? t.cancelling : t.cancel}
            </button>
          )}
          {action.kind === 'failed' && (
            <p className="reward-quiet" role="status">
              {serverWords(action.message, lang) ?? t.cancelFailed}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
