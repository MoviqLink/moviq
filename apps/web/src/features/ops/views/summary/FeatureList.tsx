import type { OpsSummary } from '@moviq/contracts';

import { useT } from '../../../../shared/i18n';
import { opsHref } from '../../routes';
import { SectionHead } from '../../ui/Facts';
import { FeatureState } from '../../ui/FeatureState';

const ORDER = { unavailable: 0, degraded: 1, available: 2 } as const;

/** Each product feature with its state, the evidence behind it and the sources it needs. */
export function FeatureList({ features }: { features: OpsSummary['features'] }) {
  const all = useT();
  const t = all.ops.summary;
  const name = all.productFeatures;
  const rows = [...features].sort(
    (a, b) => ORDER[a.state] - ORDER[b.state] || name[a.id].localeCompare(name[b.id]),
  );
  return (
    <section className="panel" aria-labelledby="features-title">
      <SectionHead id="features-title" title={t.features} />
      <p className="hint">{t.featuresHint}</p>
      <ul className="rows">
        {rows.map((feature) => (
          <li key={feature.id} className="row feature">
            <div className="row-main">
              <span className="row-title">{name[feature.id]}</span>
              <FeatureState state={feature.state} />
            </div>
            <p className="row-evidence">{feature.evidence}</p>
            <p className="row-links">
              {feature.sources.map((id) => (
                <a key={id} className="link mono" href={opsHref.source(id)}>
                  {id}
                </a>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
