import type { Journey, NearRestroom, RestroomsNearResponse } from '@moviq/contracts';
import { useId } from 'react';

import { useNow } from '../../../shared/time/clock';
import { formatDuration } from '../../../shared/time/duration';
import { secondsSince } from '../../../shared/time/instant';
import { Icon } from '../../../shared/ui/Icon';
import { useRestrooms } from '../live/useRestrooms';
import { byStop, hoursLine } from '../model/restrooms';
import { useRestroomT } from '../restroom-texts';
import './restrooms.css';

/** One restroom: its name and straight line, then access, a key, the hours as published. */
function Row({ restroom }: { restroom: NearRestroom }) {
  const t = useRestroomT();
  const { facts } = restroom;
  const access = facts.access === null ? t.accessUnknown : t.access[facts.access];
  return (
    <li className="rest-row">
      <div className="rest-head">
        <b>{restroom.name}</b>
        <span className="rest-metres">
          <span className="num">{t.metres(restroom.straightMetres)}</span>
          <span className="rest-straight">{t.straight}</span>
        </span>
      </div>
      <p className={facts.access === 'full' ? 'rest-facts' : 'rest-facts rest-quiet'}>
        {[access, facts.season === 'seasonal' ? t.seasonal : null].filter(Boolean).join(' · ')}
      </p>
      {facts.keyOrCode && <p className="rest-key">{t.key}</p>}
      <p className="rest-hours" title={t.hours}>
        <span className="rest-hours-k">{t.hours}</span>
        {facts.hours === null ? t.noHours : hoursLine(facts.hours)}
      </p>
      {facts.website !== null && (
        <a className="rest-link" href={facts.website} target="_blank" rel="noopener noreferrer">
          {t.official}
          <Icon name="external" />
        </a>
      )}
    </li>
  );
}

/** The list's source and how long ago it was read, as every datum on screen carries. */
function Source({ answer }: { answer: RestroomsNearResponse }) {
  const t = useRestroomT();
  const now = useNow();
  const { provenance, title } = answer.source;
  const text =
    provenance.dataTime === null
      ? t.sourceNoAge(title)
      : t.source(title, formatDuration(secondsSince(provenance.dataTime, now)));
  return (
    <p className="rest-source" title={provenance.evidence}>
      {text}
    </p>
  );
}

function Found({
  answer,
  stops,
}: {
  answer: RestroomsNearResponse;
  stops: Parameters<typeof byStop>[1];
}) {
  const t = useRestroomT();
  if (answer.restrooms === null) return <p className="reward-quiet">{t.unreadable}</p>;
  const groups = byStop(answer, stops);
  if (groups.length === 0) return <p className="reward-quiet">{t.none(answer.withinMetres)}</p>;
  return (
    <>
      {answer.stepFree && <p className="rest-step-free">{t.stepFree}</p>}
      {groups.map((group) => (
        <section key={group.stop} className="rest-stop" aria-label={t.near(group.stop)}>
          <h3>{t.near(group.stop)}</h3>
          <ol>
            {group.restrooms.map((restroom) => (
              <Row key={`${restroom.name}|${restroom.point.join(',')}`} restroom={restroom} />
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

/**
 * "Restroom on the way": the free public restrooms in service nearest to the next stops of the
 * trip under watch, from the city's list only, with the straight line said as such and the hours
 * as published. On a step-free trip the fully accessible ones come first, and it says so.
 */
export function RestroomsOnTheWay({ journey }: { journey: Journey }) {
  const t = useRestroomT();
  const title = useId();
  const view = useRestrooms(journey);
  if (view.kind === 'none') return null;
  return (
    <section className="restrooms-trip" aria-labelledby={title}>
      <h2 id={title} className="reward-section-title">
        {t.title}
      </h2>
      <p className="reward-quiet">{t.lead}</p>
      <div aria-live="polite">
        {view.kind === 'loading' && <p className="reward-quiet">{t.looking}</p>}
        {view.kind === 'failed' && (
          <p className="reward-quiet">
            {t.failed}{' '}
            <button type="button" className="rest-retry" onClick={view.retry}>
              {t.retry}
            </button>
          </p>
        )}
      </div>
      {view.kind === 'ready' && (
        <>
          <Found answer={view.answer} stops={view.stops} />
          <Source answer={view.answer} />
        </>
      )}
    </section>
  );
}
