import type { SourceDetail } from '@moviq/contracts';

import { useT } from '../../../../shared/i18n';
import { Icon } from '../../../../shared/ui/Icon';
import { opsApi } from '../../api';
import { opsHref } from '../../routes';
import { AgeMeter } from '../../ui/AgeMeter';
import { ConnectionNotice } from '../../ui/ConnectionNotice';
import { Clock } from '../../ui/LiveTime';
import { PageHead } from '../../ui/PageHead';
import { StateLabel } from '../../ui/StateLabel';
import { useResource } from '../../useResource';
import { FailureCatalogue } from './FailureCatalogue';
import { Incidents } from './Incidents';
import { Licence } from './Licence';
import { RefreshPanel } from './RefreshPanel';
import { RunsGrid } from './RunsGrid';
import { SourceFacts } from './SourceFacts';
import { formatLimit } from '../../../../shared/time/duration';

function AgeHero({ source }: { source: SourceDetail }) {
  const t = useT().ops.source;
  const f = source.freshness;
  return (
    <div className="age-hero">
      <span className="eyebrow">{t.age}</span>
      {source.dataTime === null ? (
        <p className="hero-line">{t.ageNone}</p>
      ) : (
        <AgeMeter dataTime={source.dataTime} freshness={f} state={source.state} large />
      )}
      <p className="muted small">
        {t.limits(
          formatLimit(f.degradedAfterSeconds),
          formatLimit(f.staleAfterSeconds),
          formatLimit(f.unavailableAfterSeconds),
        )}
      </p>
    </div>
  );
}

function Body({ source, reload }: { source: SourceDetail; reload: () => void }) {
  const t = useT();
  return (
    <>
      <div className="source-state">
        <StateLabel state={source.state} />
        {source.stateSince !== null && (
          <span className="muted">
            {t.ops.source.since} <Clock at={source.stateSince} />
          </span>
        )}
        <p className="evidence">{source.evidence}</p>
      </div>
      <AgeHero source={source} />
      <div className="split">
        <SourceFacts source={source} />
        <div className="stack">
          <RefreshPanel source={source} onQueued={reload} />
          <Licence licence={source.licence} />
        </div>
      </div>
      <Incidents incidents={source.incidents} />
      <FailureCatalogue failures={source.failures} />
      <RunsGrid runs={source.runs} />
    </>
  );
}

/** One source in full: its state and age, facts, manual refresh, licence, failures and history. */
export function SourceView({ id }: { id: string }) {
  const t = useT();
  const detail = useResource(`source:${id}`, (signal) => opsApi.source(id, signal));
  const failure = detail.failure;
  const missing = failure?.kind === 'http' && failure.code === 'not_found';
  const source = detail.data;
  return (
    <section className="stack">
      <a className="back link" href={opsHref.sources}>
        <Icon name="back" />
        {t.ops.source.back}
      </a>
      <PageHead
        title={source?.title ?? id}
        {...(source === null ? {} : { lead: `${source.provider} · ${t.kinds[source.kind]}` })}
      >
        <span className="mono muted">{id}</span>
      </PageHead>
      {missing ? <p>{t.ops.source.notFound}</p> : <ConnectionNotice resource={detail} />}
      {source !== null && <Body source={source} reload={detail.reload} />}
    </section>
  );
}
