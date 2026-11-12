import type { OpsSummary } from '@moviq/contracts';

import { useT } from '../../../../shared/i18n';
import { opsApi } from '../../api';
import { ConnectionNotice } from '../../ui/ConnectionNotice';
import { Clock } from '../../ui/LiveTime';
import { PageHead } from '../../ui/PageHead';
import { useResource } from '../../useResource';
import { FeatureList } from './FeatureList';
import { JobCounts } from './JobCounts';
import { StateMix } from './StateMix';
import { WorkerProbe } from './WorkerProbe';

function Hero({ features }: { features: OpsSummary['features'] }) {
  const t = useT().ops.summary;
  const count = (state: string) => features.filter((feature) => feature.state === state).length;
  const ready = count('available');
  if (features.length === 0) return <p className="hero-line">{t.featuresNone}</p>;
  return (
    <p className="hero">
      <span className="visually-hidden">{t.featuresReady(ready, features.length)}</span>
      <span className="hero-num mono" aria-hidden="true">
        {ready}
        <span className="hero-of">/{features.length}</span>
      </span>
      <span className="hero-text" aria-hidden="true">
        <span className="hero-line">{t.featuresLine}</span>
        <span className="hero-sub">{t.notReady(count('degraded'), count('unavailable'))}</span>
      </span>
    </p>
  );
}

/** The first screen: what works, what does not and why, the queue and the worker's pulse. */
export function SummaryView() {
  const t = useT().ops.summary;
  const summary = useResource('summary', (signal) => opsApi.summary(signal));
  const data = summary.data;
  return (
    <section className="stack">
      <PageHead title={t.title}>
        {data !== null && (
          <p className="meta">
            <span className="mono">{t.version(data.version)}</span>
            <span>
              {t.generated} <Clock at={data.generatedAt} />
            </span>
          </p>
        )}
      </PageHead>
      <ConnectionNotice resource={summary} />
      {data !== null && (
        <>
          <Hero features={data.features} />
          <div className="split">
            <FeatureList features={data.features} />
            <div className="stack">
              <StateMix counts={data.sourcesByState} />
              <JobCounts jobs={data.jobs} />
            </div>
          </div>
          <WorkerProbe worker={data.worker} />
        </>
      )}
    </section>
  );
}
