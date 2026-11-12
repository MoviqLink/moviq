import { useLocale } from '../../../shared/i18n';
import { useNow } from '../../../shared/time/clock';
import { formatDuration } from '../../../shared/time/duration';
import { formatClock } from '../../../shared/time/instant';
import { Icon } from '../../../shared/ui/Icon';
import type { JourneyView } from '../live/useJourney';
import { useTripT } from '../texts';

/**
 * The live connection, always visible: live with the age of the last update, or lost since when,
 * when it tries again by itself, and a button that reconnects and asks the server now.
 */
export function LiveLine({ view }: { view: JourneyView }) {
  const t = useTripT().live;
  const locale = useLocale();
  const now = useNow();
  const { feed, receivedAt } = view;
  const age = receivedAt === null ? null : formatDuration((now - receivedAt) / 1000);
  const rejected = view.rejected > 0 && <p className="live-rejected">{t.rejected}</p>;

  if (feed.kind === 'connecting') {
    return <p className="live-line connecting">{t.connecting}</p>;
  }
  if (feed.kind === 'live') {
    return (
      <>
        <p className="live-line on">
          <i aria-hidden="true" />
          {age === null ? t.connecting : t.live(age)}
        </p>
        {rejected}
      </>
    );
  }
  const since = formatClock(new Date(feed.since).toISOString(), locale, now);
  const wait = (feed.retryAt - now) / 1000;
  return (
    <div className="live-line lost" role="status">
      <Icon name="offline" />
      <p>
        {age === null ? t.lostNoData(since) : t.lost(since, age)}{' '}
        {wait > 0 ? t.retryIn(formatDuration(wait)) : t.retrying}
      </p>
      <button type="button" className="btn small" onClick={view.reconnect}>
        {t.retryNow}
      </button>
    </div>
  );
}
