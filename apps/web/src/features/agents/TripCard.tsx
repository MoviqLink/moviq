import type { Itinerary, Leg, PlanResponse, TravelMode } from '@moviq/contracts';
import { lazy, Suspense, useMemo } from 'react';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { CityTime } from '../../shared/journey/CityTime';
import { formatMoney } from '../../shared/journey/money';
import { useJourneyT } from '../../shared/journey/texts';
import { minutesBetween } from '../../shared/time/city';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { roadmapFromItinerary } from '../roadmap/from-itinerary';
import { useAgentsT } from './texts';

/** The timeline is loaded only when a trip is shown: its library stays out of the first load. */
const TripRoadmap = lazy(() =>
  import('../roadmap/TripRoadmap').then((module) => ({ default: module.TripRoadmap })),
);

/** The trip's legs on a timeline, under its summary. */
function Roadmap({ trip }: { trip: Itinerary }) {
  const lang = useLang();
  const legs = useMemo(() => roadmapFromItinerary(trip, lang), [trip, lang]);
  return (
    <div className="agents-trip-roadmap">
      <Suspense fallback={null}>
        <TripRoadmap legs={legs} />
      </Suspense>
    </div>
  );
}

const MODE_ICON: Record<TravelMode, IconName> = {
  walk: 'walk',
  subway: 'subway',
  bus: 'bus',
  rail: 'rail',
  ferry: 'ferry',
  taxi: 'taxi',
};

/** The itinerary Sara recommends, or the first one when she names none. */
function recommended(plan: PlanResponse): Itinerary | null {
  return (
    plan.itineraries.find((itinerary) => itinerary.id === plan.recommendedId) ??
    plan.itineraries[0] ??
    null
  );
}

function LegChip({ leg }: { leg: Leg }) {
  const t = useAgentsT();
  const modes = useJourneyT().modes;
  if (leg.mode === 'walk') {
    return (
      <li className="agents-trip-leg walk">
        <Icon name="walk" />
        {t.walkFor(Math.max(1, minutesBetween(leg.departAt, leg.arriveAt)))}
      </li>
    );
  }
  const name = leg.route?.shortName ?? modes[leg.mode];
  return (
    <li className={`agents-trip-leg ${leg.mode}`} title={`${modes[leg.mode]} ${name}`}>
      <Icon name={MODE_ICON[leg.mode]} />
      <span className="agents-trip-badge">{name}</span>
    </li>
  );
}

/** The recommended trip under Sara's answer, with a button that asks her to buy its tickets. */
export function TripCard({
  plan,
  disabled,
  onBuy,
}: {
  plan: PlanResponse;
  disabled: boolean;
  onBuy: (text: string) => void;
}) {
  const t = useAgentsT();
  const locale = useLocale();
  const trip = recommended(plan);
  const first = trip?.legs[0];
  const last = trip?.legs.at(-1);
  if (trip === null || first === undefined || last === undefined) return null;
  return (
    <section className="agents-trip" aria-label={t.trip}>
      <span className="agents-trip-label">{t.trip}</span>
      <div className="agents-trip-ends">
        <div>
          <CityTime at={trip.departAt} className="agents-trip-time" />
          <span className="agents-trip-place">{first.from.label}</span>
        </div>
        <span className="agents-trip-arrow" aria-hidden="true">
          →
        </span>
        <div>
          <CityTime at={trip.arriveAt} className="agents-trip-time" />
          <span className="agents-trip-place">{last.to.label}</span>
        </div>
      </div>
      <ol className="agents-trip-legs" aria-label={t.tripLegs}>
        {trip.legs.map((leg, index) => (
          <LegChip key={`${leg.departAt}-${String(index)}`} leg={leg} />
        ))}
      </ol>
      <div className="agents-trip-meta">
        <span className={trip.spareMinutes >= 0 ? 'spare' : 'late'}>
          {t.spare(trip.spareMinutes)}
        </span>
        <span>{t.transfers(trip.transfers)}</span>
        {trip.fare !== null && (
          <span title={trip.fare.note}>
            {t.fare} {formatMoney(trip.fare.amount, locale)}
          </span>
        )}
      </div>
      <Roadmap trip={trip} />
      <button
        type="button"
        className="agents-trip-buy"
        disabled={disabled}
        onClick={() => {
          onBuy(t.buyTrip);
        }}
      >
        {t.buyTrip}
      </button>
    </section>
  );
}
