import type { SourceDetail } from '@moviq/contracts';

import { useLocale, useT } from '../../../../shared/i18n';
import { formatDuration, formatMs } from '../../../../shared/time/duration';
import { Facts, SectionHead } from '../../ui/Facts';
import { Ago, Clock, Until } from '../../ui/LiveTime';

/** The source's times and schedule, every value with its unit or its absence said in words. */
export function SourceFacts({ source }: { source: SourceDetail }) {
  const t = useT();
  const f = t.ops.source;
  const locale = useLocale();
  const none = t.time.none;
  const error = source.lastError;
  return (
    <section className="panel" aria-labelledby="facts-title">
      <SectionHead id="facts-title" title={f.facts} />
      <Facts
        items={[
          [f.dataTime, source.dataTime === null ? none : <Clock at={source.dataTime} />],
          [f.lastSuccess, <Ago at={source.lastSuccessAt} />],
          [f.lastAttempt, <Ago at={source.lastAttemptAt} />],
          [
            f.lastError,
            error === null ? (
              none
            ) : (
              <span className="stack tight">
                <span>
                  <span className="mono">{error.code}</span> · <Ago at={error.at} clock={false} />
                </span>
                <span className="muted">{error.detail}</span>
              </span>
            ),
          ],
          [
            f.latency,
            source.latencyMs === null ? (
              none
            ) : (
              <span className="mono">{formatMs(source.latencyMs, locale)}</span>
            ),
          ],
          [
            f.rhythm,
            <span>
              {t.rhythms[source.rhythm]} ·{' '}
              <span className="mono">
                {t.ops.sources.every(formatDuration(source.intervalSeconds))}
              </span>
            </span>,
          ],
          [
            f.next,
            <span>
              <Until at={source.nextRunAt} /> · {t.nextReasons[source.nextRunReason]}
            </span>,
          ],
          [f.interest, source.interested ? f.interestYes : f.interestNo],
          [f.coverage, source.coverage ?? none],
          [
            f.version,
            source.servedVersion === null ? (
              none
            ) : (
              <span className="mono">{source.servedVersion}</span>
            ),
          ],
          [
            f.consumers,
            source.consumers.length === 0
              ? none
              : source.consumers.map((id) => t.productFeatures[id]).join(' · '),
          ],
          [f.fallback, source.fallback ?? f.noFallback],
        ]}
      />
    </section>
  );
}
