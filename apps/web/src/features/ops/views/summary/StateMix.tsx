import type { OpsSummary } from '@moviq/contracts';

import { useT } from '../../../../shared/i18n';
import { SEVERITY } from '../../model/severity';
import { opsHref } from '../../routes';
import { SectionHead } from '../../ui/Facts';
import { StateLabel } from '../../ui/StateLabel';

/** The sources split by state: one line in proportion, then the count of each state. */
export function StateMix({ counts }: { counts: OpsSummary['sourcesByState'] }) {
  const t = useT().ops.summary;
  const entries = SEVERITY.map((state) => ({ state, count: counts[state] })).filter(
    (e) => e.count > 0,
  );
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <section className="panel" aria-labelledby="mix-title">
      <SectionHead id="mix-title" title={t.sourcesBy}>
        <a className="link" href={opsHref.sources}>
          {t.sourcesTotal(total)}
        </a>
      </SectionHead>
      <div className="mix-line" aria-hidden="true">
        {entries.map((entry) => (
          <span
            key={entry.state}
            className={`mix-seg st-${entry.state}`}
            style={{ flexGrow: entry.count }}
          />
        ))}
      </div>
      <ul className="mix-list">
        {entries.map((entry) => (
          <li key={entry.state}>
            <StateLabel state={entry.state} />
            <span className="mono">{entry.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
