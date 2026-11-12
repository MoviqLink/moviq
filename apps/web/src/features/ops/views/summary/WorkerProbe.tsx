import type { WorkerStatus } from '@moviq/contracts';

import { useLocale, useT } from '../../../../shared/i18n';
import { formatDuration, formatMs } from '../../../../shared/time/duration';
import { Ago, Clock, Until } from '../../ui/LiveTime';
import { Facts, SectionHead } from '../../ui/Facts';

/** Gaps can only be seen since the oldest heartbeat kept, so an empty list says since when. */
function Gaps({ worker }: { worker: WorkerStatus }) {
  const t = useT().ops.summary;
  const gaps = worker.gapsLast24h;
  if (worker.observedFrom === null) return <p className="muted">{t.noHistory}</p>;
  if (gaps.length === 0) {
    return (
      <p className="muted">
        {t.noGapsSince} <Clock at={worker.observedFrom} />
      </p>
    );
  }
  return (
    <ol className="rail">
      {gaps.map((gap) => (
        <li key={gap.from} className="rail-node st-degraded">
          <span>
            <span className="mono">
              <Clock at={gap.from} /> – <Clock at={gap.to} />
            </span>
            <span className="muted"> · {formatDuration(gap.seconds)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The worker's lease and the hosting probe: who holds the turn and how steady its pulse is. */
export function WorkerProbe({ worker }: { worker: WorkerStatus }) {
  const t = useT().ops.summary;
  const locale = useLocale();
  const leader = worker.leader;
  const latency = worker.latencyMs;
  return (
    <section className="panel" aria-labelledby="worker-title">
      <SectionHead id="worker-title" title={t.worker} />
      <div className="split even">
        <Facts
          items={[
            [
              t.holder,
              leader === null ? (
                <span className="state st-unavailable">{t.noHolder}</span>
              ) : (
                <span className="mono">{leader.holder}</span>
              ),
            ],
            [
              t.fencing,
              leader === null ? '—' : <span className="mono">{leader.fencingToken}</span>,
            ],
            [t.leaseEnds, leader === null ? '—' : <Until at={leader.expiresAt} />],
            [t.lastBeat, worker.lastBeatAt === null ? t.noBeat : <Ago at={worker.lastBeatAt} />],
            [t.beats24, <span className="mono">{worker.beatsLast24h}</span>],
            [t.changes24, <span className="mono">{worker.leaderChangesLast24h}</span>],
            [
              t.latency,
              latency === null ? (
                t.noLatency
              ) : (
                <span className="mono">
                  {t.latencyValue(formatMs(latency.p50, locale), formatMs(latency.p95, locale))}
                </span>
              ),
            ],
          ]}
        />
        <div>
          <h3 className="sub-title">
            {t.gaps24} <span className="mono muted">{worker.gapsLast24h.length}</span>
          </h3>
          <Gaps worker={worker} />
        </div>
      </div>
    </section>
  );
}
