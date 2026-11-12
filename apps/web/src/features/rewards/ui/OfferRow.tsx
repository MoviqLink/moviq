import type { OrderView, RewardOffer } from '@moviq/contracts';
import { useState, type ReactNode } from 'react';

import { useNow } from '../../../shared/time/clock';

import { useLocale } from '../../../shared/i18n';
import { useLang } from '../../../shared/i18n/lang';
import { formatMoney } from '../../../shared/journey/money';
import { formatCityTime } from '../../../shared/time/city';
import { rewardsApi } from '../api';
import { ReserveWithPayPal } from '../hold/ReserveWithPayPal';
import { changesText } from '../model/need';
import { useRewardsT } from '../texts';

interface Props {
  readonly offer: RewardOffer;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onDeclined: (offer: RewardOffer) => void;
  readonly onReserved: (order: OrderView) => void;
  readonly beforeReserve?: ReactNode;
  readonly canReserve?: boolean;
}

/** What the offer holds, as the kitchen will make it. */
function Lines({ offer }: { offer: RewardOffer }) {
  const lang = useLang();
  return (
    <ul className="reward-offer-lines">
      {offer.lines.map((line) => (
        <li key={`${line.name}-${line.changes}`}>
          <span className="num">{line.quantity}×</span> {line.name}
          {line.changes !== '' && (
            <span className="reward-quiet"> · {changesText(line.changes, lang)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The open offer: what it holds, what it earns, who composed it, and PayPal or "No, thanks". */
function Detail({
  offer,
  onDeclined,
  onReserved,
  beforeReserve,
  canReserve = true,
}: Omit<Props, 'open' | 'onToggle'>) {
  const t = useRewardsT().offers;
  const locale = useLocale();
  const [declining, setDeclining] = useState(false);
  const now = useNow();
  const expired =
    offer.status === 'expired' || (offer.status === 'open' && Date.parse(offer.expiresAt) <= now);
  const money = (m: RewardOffer['reward']['price']) => formatMoney(m, locale);
  return (
    <div className="reward-offer-detail">
      <Lines offer={offer} />
      <p className="reward-earn">
        {t.earn(money(offer.reward.earned), offer.reward.percent)}
        <span className="reward-quiet"> · {t.listPrice(money(offer.reward.listPrice))}</span>
      </p>
      <p className="reward-quiet">{offer.note}</p>
      <p className="reward-quiet">
        {t.composer[offer.composer]}. {t.checked}
      </p>
      {offer.status === 'open' && !expired && (
        <>
          {beforeReserve}
          {canReserve && <ReserveWithPayPal offerId={offer.id} onReserved={onReserved} />}
          <button
            type="button"
            className="btn small reward-decline"
            disabled={declining}
            onClick={() => {
              setDeclining(true);
              rewardsApi.decline(offer.id).then(onDeclined, () => {
                setDeclining(false);
              });
            }}
          >
            {t.decline}
          </button>
        </>
      )}
      {expired && <p className="reward-quiet">{t.expired}</p>}
      {offer.status === 'reserved' && <p className="reward-quiet">{t.reserved}</p>}
    </div>
  );
}

/** One offer as a row: merchant, where and when, the detour and the price on the right. */
export function OfferRow(props: Props) {
  const { offer, open, onToggle } = props;
  const r = useRewardsT();
  const t = r.offers;
  const locale = useLocale();
  const detail = `offer-${offer.id}`;
  return (
    <li className={`reward-offer${offer.recommended ? ' is-recommended' : ''}`}>
      <button
        type="button"
        className="reward-offer-row"
        aria-expanded={open}
        aria-controls={detail}
        onClick={onToggle}
      >
        <span className="reward-node" aria-hidden="true" />
        <span className="reward-offer-who">
          {offer.recommended && <span className="reward-kicker">{t.recommended}</span>}
          <span className="reward-offer-name">
            {offer.merchant.name} <span className="reward-demo">{r.demo}</span>
          </span>
          <span className="reward-quiet">
            {t.pickup(formatCityTime(offer.pickupAt, locale), offer.merchant.stop.name)}
          </span>
          <span className="reward-quiet">{t.detour(offer.detourMinutes)}</span>
        </span>
        <span className="reward-offer-price">
          <span className="reward-price num">{formatMoney(offer.reward.price, locale)}</span>
          <span className="reward-was num">{formatMoney(offer.reward.listPrice, locale)}</span>
        </span>
      </button>
      {open && (
        <div id={detail}>
          <Detail
            offer={offer}
            onDeclined={props.onDeclined}
            onReserved={props.onReserved}
            beforeReserve={props.beforeReserve}
            canReserve={props.canReserve ?? true}
          />
        </div>
      )}
    </li>
  );
}
