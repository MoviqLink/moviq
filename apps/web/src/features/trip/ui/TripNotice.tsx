import { travellerHref } from '../../../shared/routing/hrefs';
import type { JourneyView } from '../live/useJourney';
import { useTripT } from '../texts';

/** What the screen says before the trip is shown: opening, not found, or why it did not load. */
export function TripNotice({ view }: { view: JourneyView }) {
  const t = useTripT();
  if (view.load === 'not-found') {
    return (
      <div className="trip-notice">
        <h1>{t.missingTitle}</h1>
        <p>{t.missingBody}</p>
        <a className="btn primary" href={travellerHref.plan}>
          {t.missingAction}
        </a>
      </div>
    );
  }
  if (view.load === 'failed') {
    return (
      <div className="trip-notice" role="alert">
        <h1>{t.failedTitle}</h1>
        <p>{t.failedBody}</p>
        <button type="button" className="btn primary" onClick={view.reconnect}>
          {t.retry}
        </button>
      </div>
    );
  }
  return (
    <div className="trip-notice" role="status">
      <p>{t.loading}</p>
    </div>
  );
}
