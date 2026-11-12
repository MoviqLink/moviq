import type { ApiFailure } from '../../../shared/api/errors';
import { Icon } from '../../../shared/ui/Icon';
import { usePlanT, type PlanDict } from '../texts';

function reason(failure: ApiFailure, t: PlanDict['failed']): string {
  switch (failure.kind) {
    case 'network':
      return failure.timedOut ? t.timedOut : t.network;
    case 'contract':
      return t.contract;
    case 'http':
      return t.server(String(failure.status));
    case 'aborted':
      return t.network;
  }
}

/** Says why Sara did not answer and sends the same message again for real. */
export function TurnFailure({ failure, onRetry }: { failure: ApiFailure; onRetry: () => void }) {
  const t = usePlanT().failed;
  return (
    <div className="turn-failed" role="alert">
      <Icon name="offline" />
      <p>
        <strong>{reason(failure, t)}</strong> {t.kept}
      </p>
      <button type="button" className="btn small" onClick={onRetry}>
        {t.retry}
      </button>
    </div>
  );
}
