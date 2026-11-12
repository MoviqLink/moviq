import type { ApiFailure } from '../../../shared/api/errors';
import { Icon } from '../../../shared/ui/Icon';
import { problemOf } from '../model/problem';
import { useMerchantT } from '../texts';

interface Props {
  readonly failure: ApiFailure | null;
  /** Asks again for real; left out when trying again needs a change first. */
  readonly onRetry?: () => void;
  readonly retrying?: boolean;
}

/** What went wrong and what to do, with the server's reference; nothing when all is well. */
export function ProblemNote({ failure, onRetry, retrying = false }: Props) {
  const t = useMerchantT();
  const problem = failure === null ? null : problemOf(failure, t.problem);
  if (problem === null) return null;
  return (
    <div className="mc-problem" role="alert">
      <Icon name="alert" />
      <div>
        <p className="mc-problem-what" lang={problem.serverWords ? 'en' : undefined}>
          {problem.what}
        </p>
        <p className="mc-problem-todo">
          {problem.todo}
          {problem.reference !== null && (
            <span className="mono mc-ref"> {t.reference(problem.reference)}</span>
          )}
        </p>
      </div>
      {onRetry !== undefined && (
        <button type="button" className="btn small" onClick={onRetry} disabled={retrying}>
          {retrying ? t.retrying : t.retry}
        </button>
      )}
    </div>
  );
}
