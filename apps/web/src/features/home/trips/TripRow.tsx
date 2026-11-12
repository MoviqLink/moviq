import type { Journey } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { CityTime } from '../../../shared/journey/CityTime';
import { ridesLine } from '../../../shared/journey/rides';
import { useJourneyT } from '../../../shared/journey/texts';
import { travellerHref } from '../../../shared/routing/hrefs';
import { formatCityDay } from '../../../shared/time/city';
import { useHomeT } from '../texts';
import { toneOf, type TripTone } from './model';

function useToneWord(): (tone: TripTone) => string {
  const t = useHomeT().trips;
  return (tone) => (tone === 'completed' || tone === 'cancelled' ? t[tone] : t.status[tone]);
}

/**
 * One trip on the line of trips: the time to be there by, the place as a link to the trip, what it
 * rides, and how it stands now.
 */
export function TripRow({ journey }: { journey: Journey }) {
  const t = useHomeT().trips;
  const words = useJourneyT();
  const locale = useLocale();
  const toneWord = useToneWord();
  const tone = toneOf(journey);
  const { arriveBy, destination } = journey.request;
  return (
    <li className={`trip-row is-${tone}`}>
      <span className="trip-row-node" aria-hidden="true" />
      <div className="trip-row-time">
        <span className="trip-row-label">{t.arrive}</span>
        <CityTime at={arriveBy} className="trip-row-clock" />
        <span className="trip-row-day">{formatCityDay(arriveBy, locale)}</span>
      </div>
      <div className="trip-row-main">
        <h2>
          <a className="trip-row-link" href={travellerHref.trip(journey.id)}>
            {destination.label}
          </a>
        </h2>
        <p className="trip-row-rides">{ridesLine(journey.itinerary, words)}</p>
      </div>
      <p className="trip-row-state">{toneWord(tone)}</p>
    </li>
  );
}

/** A saved trip the server could not give now, with the way to ask again. */
export function TripFailed({ onRetry }: { onRetry: () => void }) {
  const t = useHomeT().trips;
  return (
    <li className="trip-row is-failed">
      <span className="trip-row-node" aria-hidden="true" />
      <p className="trip-row-failed">{t.failed}</p>
      <button type="button" className="btn small" onClick={onRetry}>
        {t.retry}
      </button>
    </li>
  );
}
