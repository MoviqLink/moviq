import type { Journey } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { CityTime } from '../../../shared/journey/CityTime';
import { useJourneyT } from '../../../shared/journey/texts';
import { isProvisional } from '../../../shared/journey/walks';
import { useNow } from '../../../shared/time/clock';
import { formatCityDay, formatCityTime } from '../../../shared/time/city';
import { formatDuration } from '../../../shared/time/duration';
import { secondsSince } from '../../../shared/time/instant';
import { project } from '../model/projection';
import { useTripT } from '../texts';

/** The watch's verdict with its evidence and how long ago the server checked it. */
function Verdict({ journey }: { journey: Journey }) {
  const t = useTripT();
  const now = useNow();
  const { status, evaluatedAt, evidence } = journey.watch;
  const checked =
    evaluatedAt === null ? t.notChecked : t.checked(formatDuration(secondsSince(evaluatedAt, now)));
  return (
    <div className="verdict">
      <span className={`watch ${status}`}>{t.status[status]}</span>
      <p>
        {evidence} <span className="verdict-age">· {checked}</span>
      </p>
    </div>
  );
}

/** The one number of the screen, the arrival, with the margin left before the deadline. */
export function WatchSummary({ journey }: { journey: Journey }) {
  const t = useTripT();
  const j = useJourneyT();
  const locale = useLocale();
  const { request, itinerary } = journey;
  const projection = project(journey);
  // With the server's projection the arrival comes from live data; without it, from the plan.
  const timing = projection.source === 'live' ? 'realtime' : 'scheduled';
  const spare = projection.spareMinutes;
  const margin = spare < 0 ? t.late(-spare) : t.spare(spare);
  const provisional = isProvisional(itinerary);
  return (
    <header className="trip-head">
      <p className="trip-eyebrow">
        {formatCityDay(itinerary.departAt, locale)} · {t.state[journey.state]}
      </p>
      <h1>{request.destination.label}</h1>
      <Verdict journey={journey} />
      <div className="trip-numbers">
        <span className="k">
          {t.arrive} · <em title={j.timingHint[timing]}>{j.timing[timing]}</em>
        </span>
        <CityTime
          at={projection.arriveAt}
          className={`trip-clock${projection.shiftMinutes > 0 ? ' moved' : ''}`}
        />
        <p className="trip-margin">
          <b className={spare < 0 ? 'late' : spare < 10 ? 'tight' : ''}>
            {provisional ? j.about(margin) : margin}
          </b>{' '}
          · {t.deadline(formatCityTime(request.arriveBy, locale))}
        </p>
        {provisional && <p className="trip-provisional">{j.provisional}</p>}
      </div>
    </header>
  );
}
