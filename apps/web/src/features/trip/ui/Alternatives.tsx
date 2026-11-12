import type { Alternative } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { formatMoney } from '../../../shared/journey/money';
import { ridesLine } from '../../../shared/journey/rides';
import { useJourneyT } from '../../../shared/journey/texts';
import { isProvisional } from '../../../shared/journey/walks';
import { formatCityTime } from '../../../shared/time/city';
import { useTripT } from '../texts';

interface Props {
  readonly name: string;
  readonly alternatives: readonly Alternative[];
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
  /** True while a payment is in flight: the choice cannot change under PayPal's window. */
  readonly locked: boolean;
}

/** The options as a real radio group: arrows move the choice, the recommended one comes first. */
export function Alternatives({ name, alternatives, selected, onSelect, locked }: Props) {
  const t = useTripT();
  const j = useJourneyT();
  const locale = useLocale();
  return (
    <fieldset className="alts" disabled={locked}>
      <legend>{t.sara.options}</legend>
      {alternatives.map((alternative) => {
        const { itinerary, price } = alternative;
        const spare = itinerary.spareMinutes;
        const margin = spare < 0 ? t.late(-spare) : t.spare(spare);
        return (
          <label key={alternative.id} className={`alt${alternative.id === selected ? ' on' : ''}`}>
            <input
              type="radio"
              name={name}
              value={alternative.id}
              checked={alternative.id === selected}
              onChange={() => {
                onSelect(alternative.id);
              }}
            />
            <span className="alt-main">
              <b>{ridesLine(itinerary, j)}</b>
              <span className="alt-price num">
                {price === null ? t.sara.free : formatMoney(price, locale)}
              </span>
            </span>
            <span className="alt-why">{alternative.why}</span>
            <span className="alt-meta">
              {alternative.recommended && <em>{t.sara.recommended}</em>}
              <span className="num">
                {t.sara.arrive(formatCityTime(itinerary.arriveAt, locale))}
              </span>
              <span className={`num${spare < 0 ? ' late' : ''}`}>
                {isProvisional(itinerary) ? j.about(margin) : margin}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
