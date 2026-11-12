import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { formatCityTime } from '../../../shared/time/city';
import { merchantApi } from '../api';
import { lineText } from '../model/counter';
import type { KitchenTicket, MerchantToday } from '../schemas';
import { useMerchantT } from '../texts';
import { useResource } from '../useResource';
import { Head } from '../ui/Head';
import { Loaded } from '../ui/Loaded';

/** The orders on their way, on the route line: the next one carries the dot ahead. */
function Arriving({ tickets }: { tickets: readonly KitchenTicket[] }) {
  const t = useMerchantT();
  const locale = useLocale();
  const ordered = [...tickets].sort((a, b) => a.pickupAt.localeCompare(b.pickupAt));
  if (ordered.length === 0) {
    return (
      <div className="mc-empty">
        <p className="mc-empty-title">{t.today.nobody}</p>
        <p>{t.today.nobodyBody}</p>
      </div>
    );
  }
  return (
    <ol className="mc-rail">
      {ordered.map((ticket, index) => (
        <li key={ticket.orderId} className={index === 0 ? 'mc-rail-next' : undefined}>
          <span className="mc-rail-time mono">{formatCityTime(ticket.pickupAt, locale)}</span>
          <span className="mc-rail-node" aria-hidden="true" />
          <div className="mc-rail-body">
            <p className="mc-rail-title">
              <span className="mono">{ticket.code}</span> · {ticket.alias}
            </p>
            <p className="mc-rail-lines">{ticket.lines.map(lineText).join(' + ')}</p>
            <p className="mc-rail-meta">
              {t.status[ticket.status]} ·{' '}
              {t.today.kitchen(formatCityTime(ticket.kitchenStartsAt, locale))}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Figures({ today }: { today: MerchantToday }) {
  const t = useMerchantT();
  const percent = (value: number | null) =>
    value === null ? t.today.noOffers : t.today.percent(value);
  const figures = [
    [t.today.orders, String(today.orders)],
    [t.today.offers, String(today.offers)],
    [t.today.conversion, percent(today.conversionPercent)],
    [t.today.reward, percent(today.averageRewardPercent)],
  ] as const;
  return (
    <dl className="mc-figures">
      {figures.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Today": what was charged, the day's figures and who is coming, all counted by the server. */
export function TodayView() {
  const t = useMerchantT();
  const locale = useLocale();
  const today = useResource(merchantApi.today);
  return (
    <>
      <Head title={t.today.title} lead={t.today.lead} receivedAt={today.receivedAt} />
      <Loaded resource={today}>
        {(data) => (
          <div className="mc-today">
            <section className="mc-hero" aria-label={t.today.sales}>
              <p className="mc-label">{t.today.sales}</p>
              <p className="mc-number">{formatMoney(data.sales, locale)}</p>
              <p className="mc-note">{t.today.salesNote}</p>
              <Figures today={data} />
            </section>
            <section aria-labelledby="mc-arriving">
              <h2 id="mc-arriving" className="mc-label">
                {t.today.arriving}
              </h2>
              <Arriving tickets={data.arriving} />
            </section>
          </div>
        )}
      </Loaded>
    </>
  );
}
