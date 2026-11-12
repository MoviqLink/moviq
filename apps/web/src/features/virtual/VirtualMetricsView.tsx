import { Head } from '../merchant/ui/Head';
import { Loaded } from '../merchant/ui/Loaded';
import { useResource } from '../merchant/useResource';
import { virtualApi } from './api';
import { useVirtualT } from './texts';

/** The authenticated merchant sees only counts for its own demo business. */
export function VirtualMetricsView() {
  const t = useVirtualT();
  const resource = useResource(virtualApi.metrics);
  return (
    <>
      <Head title={t.metrics} lead={t.metricsLead} receivedAt={resource.receivedAt} />
      <Loaded resource={resource}>
        {(data) => (
          <dl className="mc-figures">
            <div>
              <dt>{t.visits}</dt>
              <dd>{data.visits}</dd>
            </div>
            <div>
              <dt>{t.reserved}</dt>
              <dd>{data.reserved}</dd>
            </div>
            <div>
              <dt>{t.real}</dt>
              <dd>{data.visitedReal}</dd>
            </div>
          </dl>
        )}
      </Loaded>
    </>
  );
}
