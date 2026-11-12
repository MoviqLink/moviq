import type { SourceDetail } from '@moviq/contracts';

import { useT } from '../../../../shared/i18n';
import { SectionHead } from '../../ui/Facts';
import { Ago } from '../../ui/LiveTime';
import { StateLabel } from '../../ui/StateLabel';

/** State changes on the route rail, newest first; each node is coloured by the state reached. */
export function Incidents({ incidents }: { incidents: SourceDetail['incidents'] }) {
  const t = useT().ops.source;
  const ordered = [...incidents].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <section className="panel" aria-labelledby="incidents-title">
      <SectionHead id="incidents-title" title={t.incidents} />
      {ordered.length === 0 ? (
        <p className="muted">{t.incidentsEmpty}</p>
      ) : (
        <ol className="rail">
          {ordered.map((incident) => (
            <li
              key={`${incident.at}-${incident.toState}`}
              className={`rail-node st-${incident.toState}`}
            >
              <div className="rail-head">
                <StateLabel state={incident.fromState} />
                <span className="muted" aria-hidden="true">
                  →
                </span>
                <StateLabel state={incident.toState} />
                <Ago at={incident.at} />
              </div>
              <p className="row-evidence">{incident.evidence}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
