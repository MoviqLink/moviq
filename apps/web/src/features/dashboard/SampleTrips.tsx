import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { SAMPLE_NOTICE, SAMPLE_TRIPS, sampleDate } from '../triplog/sample';

/** How many trips of the sample history the overview lists. */
const TRIPS_SHOWN = 4;

/** The latest trips of the sample history, labelled as such. */
export function SampleTrips() {
  const lang = useLang();
  const es = lang === 'es';
  const locale = useLocale();
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const trips = SAMPLE_TRIPS.filter((item) => item.dayOffset < 0)
    .sort((a, b) => b.dayOffset - a.dayOffset)
    .slice(0, TRIPS_SHOWN);
  return (
    <section className="dash-trips" aria-labelledby="dash-trips-title">
      <div className="dash-section-head">
        <div>
          <p className="dash-kicker">{es ? 'HISTORIAL DE MUESTRA' : 'SAMPLE HISTORY'}</p>
          <h2 id="dash-trips-title">{es ? 'Viajes recientes' : 'Recent trips'}</h2>
        </div>
        <a className="dash-head-link" href="#/dashboard?section=trips">
          {es ? 'Todos mis viajes' : 'All my trips'} <span aria-hidden="true">→</span>
        </a>
      </div>
      <ul className="trip-lines">
        {trips.map((item) => {
          const when = sampleDate(item);
          return (
            <li key={item.id}>
              <div className="trip-route">
                <strong aria-label={`${item.from} ${es ? 'a' : 'to'} ${item.to}`}>
                  {item.from} <span aria-hidden="true">→</span> {item.to}
                </strong>
                <time dateTime={when.toISOString()}>{day.format(when)}</time>
                {item.rerouted !== null && <p className="trip-rerouted">{item.rerouted[lang]}</p>}
              </div>
              <ul className="trip-legs" aria-label={es ? 'Líneas' : 'Lines'}>
                {item.legs.map((leg, index) => (
                  <li key={`${leg.line}-${String(index)}`} data-mode={leg.mode}>
                    {leg.line}
                  </li>
                ))}
              </ul>
              <span className="trip-minutes">{item.actualMinutes} min</span>
            </li>
          );
        })}
      </ul>
      <p className="dash-sample">
        <span aria-hidden="true">i</span>
        {SAMPLE_NOTICE[lang]}
      </p>
    </section>
  );
}
