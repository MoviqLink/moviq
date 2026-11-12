import type { RoutePromotions } from '@moviq/contracts';
import { useEffect, useState } from 'react';

import { useLang } from '../../../shared/i18n/lang';
import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { formatCityTime } from '../../../shared/time/city';
import { rewardsApi } from '../api';

/** The merchant's featured menu items, not personalised or validated offers yet. */
export function PromotionsOnTheWay({
  journeyId,
  disabled,
  onAsk,
}: {
  readonly journeyId: string;
  readonly disabled: boolean;
  readonly onAsk: (name: string) => void;
}) {
  const lang = useLang();
  const locale = useLocale();
  const [result, setResult] = useState<{ id: string; data: RoutePromotions | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      void rewardsApi
        .promotions(journeyId, controller.signal)
        .then(
          (answer) => {
            if (!controller.signal.aborted) setResult({ id: journeyId, data: answer });
          },
          () => {
            if (!controller.signal.aborted) setResult({ id: journeyId, data: null });
          },
        )
        .finally(() => {
          if (!controller.signal.aborted) timer = setTimeout(read, 60_000);
        });
    };
    read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [journeyId]);
  const current = result?.id === journeyId ? result : null;
  if (current !== null && current.data === null)
    return (
      <p className="reward-quiet">
        {lang === 'es'
          ? 'No se pueden cargar las promociones ahora.'
          : 'Promotions cannot be loaded right now.'}
      </p>
    );
  const data = current?.data;
  if (data === null || data === undefined || data.promotions.length === 0) return null;
  return (
    <div className="reward-promotions">
      <h3>{lang === 'es' ? 'Promociones demo en tu ruta' : 'Demo promotions on your route'}</h3>
      <p className="reward-quiet">
        {lang === 'es'
          ? 'Productos destacados por comercios de ejemplo. Precio de carta; ' +
            'la oferta personalizada se comprueba después.'
          : 'Featured products from demo merchants. Menu prices; personalised offers are checked afterwards.'}
      </p>
      <ul>
        {data.promotions.map((promotion) => (
          <li key={`${promotion.merchant.id}:${promotion.itemId}`}>
            <strong>{promotion.name}</strong> · {formatMoney(promotion.listPrice, locale)}
            <p className="reward-quiet">
              {promotion.merchant.name} · {promotion.merchant.stop.name} ·{' '}
              {lang === 'es' ? 'paso estimado' : 'estimated passing'}{' '}
              {formatCityTime(promotion.passAt, locale)}
            </p>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onAsk(promotion.name);
              }}
            >
              {lang === 'es' ? 'Pedir oferta' : 'Request an offer'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
