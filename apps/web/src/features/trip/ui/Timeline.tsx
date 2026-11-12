import type { Journey } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { CityTime } from '../../../shared/journey/CityTime';
import { ridesLine } from '../../../shared/journey/rides';
import { useJourneyT } from '../../../shared/journey/texts';
import { formatCityTime } from '../../../shared/time/city';
import { riskyLegs } from '../model/projection';
import { buildTimeline, type Span } from '../model/timeline';
import { useTripT } from '../texts';

const place = (span: Span) => ({ left: `${String(span.left)}%`, width: `${String(span.width)}%` });

/** Where a marker stands on the axis. */
const at = (left: number) => ({ left: `${String(left)}%` });

/**
 * The plan on one axis, leg by leg, with the deadline as a red rule and the server's projected
 * arrival as a second rule. Without a projection it says the times are from the timetable.
 */
export function Timeline({ journey }: { journey: Journey }) {
  const t = useTripT().timeline;
  const j = useJourneyT();
  const locale = useLocale();
  const { itinerary, request, incidents, watch } = journey;
  const projected = watch.projectedArriveAt;
  const timeline = buildTimeline(itinerary, request.arriveBy, projected);
  const risky = riskyLegs(incidents);
  const time = (instant: string) => formatCityTime(instant, locale);
  const late = projected !== null && Date.parse(projected) > Date.parse(itinerary.arriveAt);
  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <header>
        <h2 id="timeline-title">{t.title}</h2>
        <span>{t.zone}</span>
      </header>
      <div className="tl-body">
        <div className="tl-axis" aria-hidden="true">
          {timeline.ticks.map((tick) => (
            <span key={tick.at} style={at(tick.left)}>
              <CityTime at={tick.at} />
            </span>
          ))}
        </div>
        <ol className="tl-lanes">
          {itinerary.legs.map((leg, index) => {
            const name = ridesLine({ ...itinerary, legs: [leg] }, j);
            const span = timeline.lanes[index];
            return (
              <li key={`${leg.departAt}-${String(index)}`} className={`tl-lane ${leg.mode}`}>
                <span className="tl-name">{name}</span>
                <span className="tl-track" aria-hidden="true">
                  {span !== undefined && (
                    <i className={`tl-bar${risky.has(index) ? ' risk' : ''}`} style={place(span)} />
                  )}
                </span>
                <span className="visually-hidden">
                  {t.lane(name, `${time(leg.departAt)}–${time(leg.arriveAt)}`)}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="tl-overlay">
          <div className="tl-deadline" style={at(timeline.deadline)}>
            <span>
              {t.deadline} {time(request.arriveBy)}
            </span>
          </div>
          {projected !== null && timeline.expected !== null && (
            <div className={`tl-expected${late ? ' late' : ''}`} style={at(timeline.expected)}>
              <span>{t.expectedAt(time(projected))}</span>
            </div>
          )}
        </div>
      </div>
      {projected === null ? (
        <p className="tl-key">{t.noProjection}</p>
      ) : (
        <p className="tl-key" aria-hidden="true">
          <i className="tl-bar" /> {t.planned} <i className="tl-mark" /> {t.expected}
        </p>
      )}
    </section>
  );
}
