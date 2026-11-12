import type { ApiFailure } from '../../../shared/api/errors';
import type { MerchantDict } from '../texts';

/** What went wrong, said plainly, and what to do about it. */
export interface Problem {
  readonly what: string;
  /** Whether `what` is the server's own sentence, which is written in English. */
  readonly serverWords: boolean;
  readonly todo: string;
  readonly reference: string | null;
}

function todoFor(status: number, t: MerchantDict['problem']): string {
  if (status === 403) return t.forbidden;
  if (status === 404) return t.missing;
  if (status === 409 || status === 400) return t.conflict;
  return t.later;
}

/**
 * A failed request as the panel tells it: the server's own reason when it gave one, otherwise
 * what happened; then what to do. An aborted request is never shown, so it has no problem.
 */
export function problemOf(failure: ApiFailure, t: MerchantDict['problem']): Problem | null {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'network':
      return {
        what: failure.timedOut ? t.timedOut : t.lost,
        serverWords: false,
        todo: t.checkConnection,
        reference: null,
      };
    case 'contract':
      return { what: t.contract, serverWords: false, todo: t.later, reference: null };
    case 'http':
      if (failure.status === 401) {
        return { what: t.ended, serverWords: false, todo: t.choose, reference: null };
      }
      return {
        what: failure.message ?? t.status(failure.status),
        serverWords: failure.message !== null,
        todo: todoFor(failure.status, t),
        reference: failure.requestId,
      };
  }
}
