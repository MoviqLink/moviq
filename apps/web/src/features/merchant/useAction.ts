import { useCallback, useState } from 'react';

import { ApiRequestError, type ApiFailure } from '../../shared/api/errors';
import { useMerchantSession } from './session';

export interface Action {
  readonly pending: boolean;
  /** Why the last attempt failed, or null. */
  readonly failure: ApiFailure | null;
  /** Runs one request; while it is in flight a second press does nothing. */
  readonly run: <T>(work: () => Promise<T>) => Promise<T | undefined>;
  readonly clear: () => void;
}

/**
 * One thing the merchant asks the server to do (charge, refund, save, move a ticket): one request
 * at a time, its failure kept to tell, and a lapsed session sent back to choosing a merchant.
 */
export function useAction(): Action {
  const { expire } = useMerchantSession();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const run = useCallback(
    async <T>(work: () => Promise<T>): Promise<T | undefined> => {
      setPending(true);
      setFailure(null);
      try {
        return await work();
      } catch (error) {
        if (!(error instanceof ApiRequestError)) throw error;
        if (error.code === 'unauthorized') expire();
        else setFailure(error.failure);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [expire],
  );
  const clear = useCallback(() => {
    setFailure(null);
  }, []);
  return { pending, failure, run, clear };
}
