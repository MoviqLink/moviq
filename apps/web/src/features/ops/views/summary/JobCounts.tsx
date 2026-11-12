import type { OpsSummary } from '@moviq/contracts';

import { useT } from '../../../../shared/i18n';
import { opsHref } from '../../routes';
import { SectionHead } from '../../ui/Facts';

/** The queue in three numbers. */
export function JobCounts({ jobs }: { jobs: OpsSummary['jobs'] }) {
  const t = useT().ops.summary;
  const items = [
    [t.pending, jobs.pending, false],
    [t.running, jobs.running, false],
    [t.failed24, jobs.failedLast24h, jobs.failedLast24h > 0],
  ] as const;
  return (
    <section className="panel" aria-labelledby="jobs-title">
      <SectionHead id="jobs-title" title={t.jobs}>
        <a className="link" href={opsHref.jobs}>
          {t.seeJobs}
        </a>
      </SectionHead>
      <dl className="counts">
        {items.map(([label, value, alarm]) => (
          <div key={label} className={alarm ? 'count st-unavailable' : 'count'}>
            <dt>{label}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
