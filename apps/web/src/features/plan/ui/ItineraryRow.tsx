import type { Itinerary } from '@moviq/contracts';
import { useId } from 'react';

import { useLocale } from '../../../shared/i18n';
import { CityTime } from '../../../shared/journey/CityTime';
import { LegRail } from '../../../shared/journey/LegRail';
import { formatMoney } from '../../../shared/journey/money';
import { ridesOf } from '../../../shared/journey/rides';
import { useJourneyT } from '../../../shared/journey/texts';
import { arrivalTiming, departureTiming, type Timing } from '../../../shared/journey/timing';
import { isProvisional } from '../../../shared/journey/walks';
import { Icon } from '../../../shared/ui/Icon';
import { usePlanT } from '../texts';
import { StartTrip } from './StartTrip';

function TimeOf({ label, at, timing }: { label: string; at: string; timing: Timing }) {
  const j = useJourneyT();
  return (
    <span className="itin-time">
      <small>{label}</small>
      <CityTime at={at} className="itin-clock" />
      <em className={timing} title={j.timingHint[timing]}>
        {j.timing[timing]}
      </em>
    </span>
  );
}

function Rides({ itinerary }: { itinerary: Itinerary }) {
  const j = useJourneyT();
  return (
    <span className="itin-rides">
      {ridesOf(itinerary, j).map((ride, index) => (
        <span key={`${ride.name}-${String(index)}`} className="itin-ride">
          <Icon name={ride.mode} />
          <span className="visually-hidden">{j.modes[ride.mode]}</span>
          {ride.name}
        </span>
      ))}
    </span>
  );
}

interface Props {
  readonly planId: string;
  readonly itinerary: Itinerary;
  readonly recommended: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
}

/** One way to get there: leave, arrive and spare in a row, opening into its steps. */
export function ItineraryRow({ planId, itinerary, recommended, open, onToggle }: Props) {
  const t = usePlanT().plan;
  const locale = useLocale();
  const detail = useId();
  const { spareMinutes: spare, fare } = itinerary;
  const fareText = fare === null ? t.noFare : t.fare(formatMoney(fare.amount, locale));
  const j = useJourneyT();
  const provisional = isProvisional(itinerary);
  const margin = spare < 0 ? t.lateBy(-spare) : t.spare(spare);
  return (
    <li className={`itin${recommended ? ' rec' : ''}${open ? ' open' : ''}`}>
      <button
        type="button"
        className="itin-head"
        aria-expanded={open}
        aria-controls={detail}
        onClick={onToggle}
      >
        <span className="itin-top">
          {recommended && <span className="itin-tag">{t.recommended}</span>}
          <Rides itinerary={itinerary} />
        </span>
        <span className="itin-times">
          <TimeOf
            label={t.leave}
            at={itinerary.departAt}
            timing={departureTiming(itinerary.legs)}
          />
          <span className="itin-line" aria-hidden="true" />
          <TimeOf label={t.arrive} at={itinerary.arriveAt} timing={arrivalTiming(itinerary.legs)} />
          <span className={`itin-spare${spare < 0 ? ' late' : ''}`}>
            {provisional ? j.about(margin) : margin}
          </span>
        </span>
        <span className="itin-facts">
          {t.transfers(itinerary.transfers)} · {t.walk(itinerary.walkMinutes)} · {fareText}
        </span>
        <Icon name="chevron" className="itin-chevron" />
      </button>
      <div id={detail} className="itin-detail" hidden={!open}>
        {provisional && <p className="itin-note">{j.provisional}</p>}
        <LegRail legs={itinerary.legs} />
        {fare !== null && <p className="itin-note">{fare.note}</p>}
        <StartTrip planId={planId} itineraryId={itinerary.id} />
      </div>
    </li>
  );
}
