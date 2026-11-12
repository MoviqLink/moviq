import type { SourceDetail } from '@moviq/contracts';

import { useT } from '../../../../shared/i18n';
import { SectionHead } from '../../ui/Facts';
import { StateLabel } from '../../ui/StateLabel';

/** Every failure this source is known to have: how it is detected, what state it causes, the remedy. */
export function FailureCatalogue({ failures }: { failures: SourceDetail['failures'] }) {
  const t = useT().ops.source;
  return (
    <section className="panel" aria-labelledby="failures-title">
      <SectionHead id="failures-title" title={t.failures} />
      {failures.length === 0 ? (
        <p className="muted">{t.failuresEmpty}</p>
      ) : (
        <ul className="rows">
          {failures.map((failure) => (
            <li key={failure.code} className="row failure">
              <div className="row-main">
                <span className="row-title mono">{failure.code}</span>
                <StateLabel state={failure.state} />
              </div>
              <dl className="pairs">
                <div>
                  <dt>{t.detection}</dt>
                  <dd>{failure.detection}</dd>
                </div>
                <div>
                  <dt>{t.remedy}</dt>
                  <dd>{failure.remedy}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
