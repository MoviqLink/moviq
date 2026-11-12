import { lazy, Suspense, useMemo } from 'react';

import { useLocale } from '../../shared/i18n';
import { useLang, type Lang } from '../../shared/i18n/lang';
import { roadmapFromSample } from '../roadmap/from-itinerary';
import { clock, fare, LineBadges, SampleNotice, ScreenHead } from './parts';
import { SAMPLE_TRIPS, sampleDate, type SampleTrip } from './sample';
import './triplog.css';

/** The timeline is loaded only on this screen: its library stays out of the first load. */
const TripRoadmap = lazy(() =>
  import('../roadmap/TripRoadmap').then((module) => ({ default: module.TripRoadmap })),
);

interface Dated {
  readonly trip: SampleTrip;
  readonly at: Date;
}

const dayKey = (at: Date): string =>
  `${String(at.getFullYear())}-${String(at.getMonth())}-${String(at.getDate())}`;

/** Monday to Sunday in the reader's language, from a week known to start on a Monday. */
function weekdays(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, index) => format.format(new Date(2024, 0, 1 + index)));
}

interface MonthProps {
  readonly first: Date;
  readonly today: Date;
  readonly byDay: ReadonlyMap<string, readonly Dated[]>;
  readonly locale: string;
  readonly es: boolean;
}

function Month({ first, today, byDay, locale, es }: MonthProps) {
  const title = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(first);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const todayKey = dayKey(today);
  return (
    <section className="triplog-month" aria-label={title}>
      <h2>{title}</h2>
      <div className="triplog-weekdays" aria-hidden="true">
        {weekdays(locale).map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <ol className="triplog-days">
        {Array.from({ length: lead }, (_, index) => (
          <li key={`blank-${String(index)}`} className="triplog-day is-blank" aria-hidden="true" />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const date = new Date(first.getFullYear(), first.getMonth(), index + 1);
          const key = dayKey(date);
          const trips = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <li key={key} className={`triplog-day${isToday ? ' is-today' : ''}`}>
              <span className="triplog-day-number num">
                {date.getDate()}
                {isToday && <span className="visually-hidden">{es ? ' (hoy)' : ' (today)'}</span>}
              </span>
              {trips.map(({ trip, at }) => (
                <span
                  key={trip.id}
                  className={`triplog-pill ${trip.dayOffset > 0 ? 'is-scheduled' : 'is-past'}`}
                  title={`${trip.from} → ${trip.to}`}
                >
                  <span className="mono">{clock(at, locale)}</span> {trip.to}
                </span>
              ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Scheduled({
  dated,
  lang,
  locale,
}: {
  dated: readonly Dated[];
  lang: Lang;
  locale: string;
}) {
  const es = lang === 'es';
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const scheduled = dated.filter(({ trip }) => trip.dayOffset > 0);
  return (
    <section className="triplog-card triplog-scheduled" aria-labelledby="triplog-scheduled">
      <h2 id="triplog-scheduled">{es ? 'Viajes programados' : 'Scheduled trips'}</h2>
      <ol className="triplog-plan">
        {scheduled.map(({ trip, at }) => (
          <li key={trip.id}>
            <p className="triplog-kicker">
              {day.format(at)} · <span className="mono">{clock(at, locale)}</span>
            </p>
            <h3>
              {trip.from} → {trip.to}
            </h3>
            <p className="triplog-plan-facts">
              <LineBadges legs={trip.legs} />
              <span className="num">
                {trip.plannedMinutes} min ·{' '}
                {es
                  ? `${String(trip.tickets)} ${trip.tickets === 1 ? 'billete' : 'billetes'}`
                  : `${String(trip.tickets)} ${trip.tickets === 1 ? 'ticket' : 'tickets'}`}{' '}
                · {fare(trip.fareMinor, locale)}
              </span>
            </p>
            <p className="triplog-plan-note">
              {es
                ? 'Sara vigilará este viaje y comprará sus billetes.'
                : 'Sara will watch this trip and buy its tickets.'}
            </p>
          </li>
        ))}
      </ol>
      <SampleNotice lang={lang} />
    </section>
  );
}

/** The next scheduled trip leg by leg, on a timeline. */
function NextRoadmap({ next, today, lang }: { next: Dated; today: Date; lang: Lang }) {
  const es = lang === 'es';
  const legs = useMemo(() => roadmapFromSample(next.trip, today, lang), [next, today, lang]);
  return (
    <section className="triplog-card triplog-roadmap" aria-labelledby="triplog-roadmap">
      <p className="triplog-kicker">{es ? 'HOJA DE RUTA' : 'ROADMAP'}</p>
      <h2 id="triplog-roadmap">
        {es ? 'Tu próximo viaje, tramo a tramo' : 'Your next trip, leg by leg'}
      </h2>
      <p className="triplog-plan-facts">
        {next.trip.from} → {next.trip.to}
      </p>
      <div className="triplog-roadmap-frame">
        <Suspense fallback={null}>
          <TripRoadmap legs={legs} />
        </Suspense>
      </div>
      <SampleNotice lang={lang} />
    </section>
  );
}

/** Calendar: this month's trips day by day, with the trips Sara has scheduled next. */
export function CalendarScreen() {
  const lang = useLang();
  const locale = useLocale();
  const es = lang === 'es';
  const today = useMemo(() => new Date(), []);
  const dated = useMemo(
    () =>
      SAMPLE_TRIPS.map((trip) => ({ trip, at: sampleDate(trip, today) })).sort(
        (a, b) => a.at.getTime() - b.at.getTime(),
      ),
    [today],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Dated[]>();
    for (const item of dated) {
      const key = dayKey(item.at);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [dated]);
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const spills = dated.some(({ trip, at }) => trip.dayOffset > 0 && at.getTime() >= next.getTime());
  const months = spills ? [first, next] : [first];
  const upcoming = dated.find(({ trip }) => trip.dayOffset > 0);
  return (
    <main id="main" className="page triplog" tabIndex={-1}>
      <ScreenHead
        kicker={es ? 'MOVIQ / CALENDARIO' : 'MOVIQ / CALENDAR'}
        title={es ? 'Viajes programados' : 'Scheduled trips'}
        lead={
          es
            ? 'Los viajes del mes día a día; los programados, en color.'
            : "This month's trips day by day; the scheduled ones in colour."
        }
      />
      <div className="triplog-calendar-layout">
        <div className="triplog-card triplog-calendar">
          {months.map((month) => (
            <Month
              key={month.getTime()}
              first={month}
              today={today}
              byDay={byDay}
              locale={locale}
              es={es}
            />
          ))}
          <SampleNotice lang={lang} />
        </div>
        <Scheduled dated={dated} lang={lang} locale={locale} />
      </div>
      {upcoming !== undefined && <NextRoadmap next={upcoming} today={today} lang={lang} />}
    </main>
  );
}
