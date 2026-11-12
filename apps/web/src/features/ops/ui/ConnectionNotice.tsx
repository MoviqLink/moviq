import type { ApiFailure } from '../../../shared/api/errors';
import { useLocale, useT } from '../../../shared/i18n';
import { useNow } from '../../../shared/time/clock';
import { formatClock } from '../../../shared/time/instant';
import { Icon } from '../../../shared/ui/Icon';
import type { Resource } from '../useResource';

type Dict = ReturnType<typeof useT>;

function message(failure: ApiFailure, t: Dict): string {
  switch (failure.kind) {
    case 'network':
      return failure.timedOut ? t.conn.timedOut : t.conn.lost;
    case 'contract':
      return t.conn.contract;
    case 'http':
      return failure.requestId === null
        ? t.conn.serverNoId(String(failure.status))
        : t.conn.server(String(failure.status), failure.requestId);
    case 'aborted':
      return t.conn.lost;
  }
}

/**
 * Says plainly when the API is not giving good answers, since when the shown data dates, and lets
 * the person ask again for real. Nothing is drawn while answers are good.
 */
export function ConnectionNotice({ resource }: { resource: Resource<unknown> }) {
  const t = useT();
  const locale = useLocale();
  const now = useNow();
  const { failure, receivedAt, loading, reload } = resource;
  if (failure === null) return null;
  const since =
    receivedAt === null
      ? t.conn.nothingYet
      : t.conn.lastGood(formatClock(new Date(receivedAt).toISOString(), locale, now));
  return (
    <div className="notice" role="status">
      <Icon name="offline" />
      <p>
        <strong>{message(failure, t)}</strong> <span>{since}</span>
      </p>
      <button type="button" className="btn small" onClick={reload} disabled={loading}>
        {loading ? t.conn.retrying : t.conn.retry}
      </button>
    </div>
  );
}
