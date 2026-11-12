import type { Job, SourceDetail } from '@moviq/contracts';
import { useId, useState } from 'react';

import { useT } from '../../../../shared/i18n';
import { Icon } from '../../../../shared/ui/Icon';
import { opsApi } from '../../api';
import { opsHref } from '../../routes';
import { useSession } from '../../session';
import { SectionHead } from '../../ui/Facts';
import { ReasonDialog } from '../../ui/ReasonDialog';

function Queued({ job }: { job: Job }) {
  const t = useT();
  return (
    <p className="done" role="status">
      <Icon name="check" />
      <span>
        {t.ops.source.queued(String(job.id))} {t.jobStates[job.state]} ·{' '}
        <span className="mono">{job.reason}</span>
      </span>
      <a className="link" href={opsHref.jobs}>
        {t.ops.source.seeJob}
      </a>
    </p>
  );
}

/** Manual refresh: an admin gives a reason and a job is queued; a viewer sees why it is off. */
export function RefreshPanel({ source, onQueued }: { source: SourceDetail; onQueued: () => void }) {
  const t = useT();
  const f = t.ops.source;
  const { session } = useSession();
  const whyOff = useId();
  const [asking, setAsking] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const viewer = session.role === 'viewer';

  async function confirm(reason: string) {
    const created = await opsApi.refresh(source.id, reason);
    setJob(created);
    onQueued();
  }

  return (
    <section className="panel" aria-labelledby="refresh-title">
      <SectionHead id="refresh-title" title={f.refresh} />
      <p className="hint">{f.refreshLead}</p>
      <div className="actions">
        <button
          type="button"
          className="btn primary"
          disabled={viewer}
          aria-describedby={viewer ? whyOff : undefined}
          onClick={() => {
            setAsking(true);
          }}
        >
          <Icon name="refresh" />
          {f.refreshButton}
        </button>
      </div>
      {viewer && (
        <p id={whyOff} className="hint">
          {f.viewerOnly}
        </p>
      )}
      {job !== null && <Queued job={job} />}
      {asking && (
        <ReasonDialog
          title={t.ops.reason.refreshTitle(source.title)}
          lead={f.refreshLead}
          onConfirm={confirm}
          onClose={() => {
            setAsking(false);
          }}
        />
      )}
    </section>
  );
}
