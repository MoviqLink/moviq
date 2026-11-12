import type { TicketProduct } from '@moviq/contracts';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { useTicketsT } from './texts';
import { productText } from './localization';

export function TicketProductCard({
  product,
  selected,
  disabled,
  onChoose,
}: {
  readonly product: TicketProduct;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onChoose: () => void;
}) {
  const t = useTicketsT();
  const locale = useLocale();
  const lang = useLang();
  const text = productText(product.id, product.name, product.description, lang);
  const verified = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${product.fareVerifiedAt}T12:00:00Z`),
  );
  return (
    <article
      className={`ticket-product${selected ? ' selected' : ''}`}
      data-testid={`ticket-product-${product.id}`}
    >
      <div className="ticket-product-top">
        <p className="ticket-operator">{product.operator}</p>
        <span className="ticket-category-tag">{t.categories[product.category]}</span>
      </div>
      <h3>{text.name}</h3>
      <p className="ticket-description">{text.description}</p>
      <p className="ticket-price-label">{t.price}</p>
      <p className="ticket-price">{formatMoney(product.price, locale)}</p>
      <p className="ticket-meta">{t.rides(product.rides)}</p>
      <p className="ticket-date">{t.verified(verified)}</p>
      <a
        className="ticket-source"
        href={product.officialUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t.official}
        <span className="visually-hidden"> · {product.operator}</span>
      </a>
      <button
        className={`btn ticket-choose${selected ? ' is-selected' : ''}`}
        type="button"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onChoose}
      >
        {selected ? t.selected : t.buy}
      </button>
    </article>
  );
}
