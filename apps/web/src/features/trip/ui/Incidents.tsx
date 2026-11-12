import type { Incident, Journey } from '@moviq/contracts';

import { useT } from '../../../shared/i18n';
import { ridesLine } from '../../../shared/journey/rides';
import { useJourneyT } from '../../../shared/journey/texts';
import { useNow } from '../../../shared/time/clock';
import { formatDuration } from '../../../shared/time/duration';
import { secondsSince } from '../../../shared/time/instant';
import { useTripT } from '../texts';

/** Where the proof behind an incident comes from and how old it is; the detail on hover. */
function Proof({ incident }: { incident: Incident }) {
  const j = useJourneyT();
  const states = useT().states;
  const now = useNow();
  const { provenance } = incident;
  const state = states[provenance.state].label.toLowerCase();
  const text =
    provenance.dataTime === null
      ? j.sourceNoAge(provenance.sourceId, state)
      : j.source(
          provenance.sourceId,
          state,
          formatDuration(secondsSince(provenance.dataTime, now)),
        );
  return (
    <p className="inc-proof" title={provenance.evidence}>
      {text}
    </p>
  );
}

/** What changed on the trip, newest first, each with what was observed and its source. */
export function Incidents({ journey }: { journey: Journey }) {
  const t = useTripT().incidents;
  const j = useJourneyT();
  if (journey.incidents.length === 0) return null;
  const newest = [...journey.incidents].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <section className="incidents" aria-labelledby="incidents-title">
      <h2 id="incidents-title">{t.title}</h2>
      <ol>
        {newest.map((incident) => {
          const leg = journey.itinerary.legs[incident.legIndex];
          const where =
            leg === undefined
              ? t.leg(incident.legIndex + 1)
              : `${t.leg(incident.legIndex + 1)} · ${ridesLine({ ...journey.itinerary, legs: [leg] }, j)}`;
          return (
            <li key={incident.id} className={`incident ${incident.kind}`}>
              <div className="inc-head">
                <b>{t.kinds[incident.kind]}</b>
                <span className="num">
                  {incident.impactMinutes === null ? t.noImpact : t.impact(incident.impactMinutes)}
                </span>
              </div>
              <p className="inc-evidence">{incident.evidence}</p>
              <p className="inc-where">{where}</p>
              <Proof incident={incident} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
