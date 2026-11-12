import type { RewardOffer } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { formatCityTime } from '../../../shared/time/city';
import { lineText } from '../model/counter';
import { useMerchantT } from '../texts';

/** The offer the server accepted, with the reward it gives; or why there is none. */
export function OfferSummary({ offer }: { offer: RewardOffer | null }) {
  const t = useMerchantT().requests;
  const locale = useLocale();
  if (offer === null) return <p className="mc-offer-none">{t.noOffer}</p>;
  const figures = [
    [t.listPrice, formatMoney(offer.reward.listPrice, locale)],
    [t.pays, formatMoney(offer.reward.price, locale)],
    [t.earned, `${formatMoney(offer.reward.earned, locale)} · ${String(offer.reward.percent)} %`],
    [t.pickup, formatCityTime(offer.pickupAt, locale)],
  ] as const;
  return (
    <section className="mc-offer" aria-label={t.offer}>
      <p className="mc-offer-head">
        <span className="mc-label">{t.offer}</span>
        <span className="mc-tag">{t.offerStatus[offer.status]}</span>
      </p>
      <p className="mc-offer-lines">{offer.lines.map(lineText).join(' + ')}</p>
      <dl className="mc-offer-figures">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mc-note">{t.composer[offer.composer]}</p>
    </section>
  );
}
