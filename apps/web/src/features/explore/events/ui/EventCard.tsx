import type { EventsResponse, MovIqEvent } from '@moviq/contracts';

import { useLocale } from '../../../../shared/i18n';
import { formatCityDay, formatCityTime } from '../../../../shared/time/city';
import { Icon } from '../../../../shared/ui/Icon';
import { ageText } from '../../model/card';
import { listingAgeSeconds, sourceOfListing } from '../model/layer';
import { planHref } from '../model/plan-link';
import { useEventsT } from '../texts';

interface Props {
  readonly event: MovIqEvent;
  readonly answer: EventsResponse | null;
  readonly now: number;
  readonly onClose: () => void;
}

function When({ event }: { event: MovIqEvent }) {
  const t = useEventsT();
  const locale = useLocale();
  return (
    <section className="ex-group" aria-label={t.card.when}>
      <span className="ex-k">{t.card.when}</span>
      <p className="ex-v">{formatCityDay(event.startsAt, locale)}</p>
      <dl className="ex-ev-times">
        <div>
          <dt className="ex-k">{t.card.starts}</dt>
          <dd className="ex-number mono">{formatCityTime(event.startsAt, locale)}</dd>
        </div>
        <div>
          <dt className="ex-k">{t.card.ends}</dt>
          <dd className={event.endsAt === null ? 'ex-note' : 'ex-number mono'}>
            {event.endsAt === null ? t.card.noEnd : formatCityTime(event.endsAt, locale)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * The card of an event: when, where, from which sources and how old, its official page and the
 * way to plan arriving on time. MovIQ sells nothing here: the only link out is the source's.
 */
export function EventCard({ event, answer, now, onClose }: Props) {
  const t = useEventsT();
  const locale = useLocale();
  const [first] = event.listings;
  return (
    <article className="ex-card ex-ev-card" aria-label={event.name}>
      <header className="ex-card-head">
        <div className="ex-card-id">
          <h2>{event.name}</h2>
          <button type="button" className="ex-close" onClick={onClose} aria-label={t.card.close}>
            <Icon name="close" />
          </button>
        </div>
        <p className="ex-longname">
          {t.categories[event.category]} · {t.card.kind}
        </p>
        {event.status !== 'scheduled' && (
          <p className="ex-state ex-late">
            {t.status[event.status]}. {t.card.callOff}
          </p>
        )}
      </header>
      <When event={event} />
      <section className="ex-group" aria-label={t.card.venue}>
        <span className="ex-k">{t.card.venue}</span>
        <p className="ex-v">{event.venue.name}</p>
        {event.venue.address !== null && <span className="ex-note">{event.venue.address}</span>}
      </section>
      <section className="ex-group ex-ev-actions">
        {first !== undefined && (
          <a
            className="ex-ev-official"
            href={first.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.card.official}
            <Icon name="external" />
          </a>
        )}
        <span className="ex-note">{t.card.officialNote}</span>
        {event.status === 'scheduled' && (
          <>
            <a className="ex-ev-plan" href={planHref(event)}>
              {t.card.onTime}
            </a>
            <span className="ex-note">
              {t.card.onTimeNote(formatCityTime(event.startsAt, locale))}
            </span>
          </>
        )}
      </section>
      <footer className="ex-foot ex-ev-sources">
        <span className="ex-k">{event.listings.length === 1 ? t.card.source : t.card.sources}</span>
        <ul>
          {event.listings.map((listing) => {
            const source = sourceOfListing(answer, listing.sourceId);
            return (
              <li key={listing.sourceId}>
                {source?.attribution ?? listing.sourceId} ·{' '}
                {t.card.listedAt(ageText(listingAgeSeconds(listing.dataTime, now)))}
              </li>
            );
          })}
        </ul>
      </footer>
    </article>
  );
}
