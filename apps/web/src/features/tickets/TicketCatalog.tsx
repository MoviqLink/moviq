import type { TicketCatalog as TicketCatalogData, TicketProduct } from '@moviq/contracts';
import { useState } from 'react';

import { travellerHref } from '../../shared/routing/hrefs';
import { useLang } from '../../shared/i18n/lang';
import { PayForTicket } from './PayForTicket';
import { TicketProductCard } from './TicketProductCard';
import { useTicketsT } from './texts';
import { informationText, localizedNotice } from './localization';

const CATEGORIES = ['all', 'subway', 'train', 'bus', 'airport', 'port'] as const;
type Category = (typeof CATEGORIES)[number];

function CategoryFilters({
  category,
  busy,
  onChange,
}: {
  readonly category: Category;
  readonly busy: boolean;
  readonly onChange: (category: Category) => void;
}) {
  const t = useTicketsT();
  return (
    <div className="ticket-filters" role="group" aria-label={t.catalog}>
      {CATEGORIES.map((mode) => (
        <button
          type="button"
          key={mode}
          disabled={busy}
          className={`ticket-filter${category === mode ? ' active' : ''}`}
          aria-pressed={category === mode}
          onClick={() => {
            onChange(mode);
          }}
        >
          {mode === 'all' ? t.all : t.categories[mode]}
        </button>
      ))}
    </div>
  );
}

function ProductCards({
  products,
  selected,
  busy,
  onChoose,
}: {
  readonly products: readonly TicketProduct[];
  readonly selected: TicketProduct | null;
  readonly busy: boolean;
  readonly onChoose: (product: TicketProduct) => void;
}) {
  return (
    <div className="ticket-products">
      {products.map((product) => (
        <TicketProductCard
          key={product.id}
          product={product}
          selected={selected?.id === product.id}
          disabled={busy}
          onChoose={() => {
            onChoose(product);
          }}
        />
      ))}
    </div>
  );
}

function VariableFares({
  information,
}: {
  readonly information: TicketCatalogData['information'];
}) {
  const t = useTicketsT();
  const lang = useLang();
  return (
    <section className="ticket-section ticket-information" aria-labelledby="ticket-info-title">
      <div>
        <p className="ticket-eyebrow">{t.official}</p>
        <h2 id="ticket-info-title">{t.variableHeading}</h2>
        <p className="ticket-description">{t.variableLead}</p>
      </div>
      <ul>
        {information.map((service) => (
          <li key={service.id}>
            <div>
              <h3>{informationText(service.id, service.name, service.description, lang).name}</h3>
              <p>
                {informationText(service.id, service.name, service.description, lang).description}
              </p>
            </div>
            <a
              className="ticket-source"
              href={service.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.official}
              <span className="visually-hidden">
                {' '}
                · {informationText(service.id, service.name, service.description, lang).name}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TicketCatalog({ data }: { readonly data: TicketCatalogData }) {
  const t = useTicketsT();
  const lang = useLang();
  const [category, setCategory] = useState<Category>('all');
  const [selected, setSelected] = useState<TicketProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const products = data.products.filter((item) => category === 'all' || item.category === category);
  const information = data.information.filter(
    (item) => category === 'all' || item.category === category,
  );
  const chooseCategory = (next: Category) => {
    setCategory(next);
    if (selected !== null && next !== 'all' && selected.category !== next) setSelected(null);
  };
  return (
    <>
      <section className="ticket-section" aria-labelledby="ticket-catalog-title">
        <div className="ticket-section-head">
          <h2 id="ticket-catalog-title">{t.catalog}</h2>
          <a className="btn small" href={travellerHref.ticketWallet}>
            {t.wallet}
          </a>
        </div>
        <p className="ticket-notice" role="note">
          {localizedNotice(data.notice || t.noticeFallback, lang)}
        </p>
        <CategoryFilters category={category} busy={busy} onChange={chooseCategory} />
        <ProductCards
          products={products}
          selected={selected}
          busy={busy}
          onChoose={(product) => {
            setSelected(selected?.id === product.id ? null : product);
          }}
        />
        {selected !== null && (
          <PayForTicket
            key={selected.id}
            product={selected}
            disabled={busy}
            onBusyChange={setBusy}
            onChooseAnother={() => {
              setSelected(null);
            }}
          />
        )}
      </section>
      <VariableFares information={information} />
    </>
  );
}
