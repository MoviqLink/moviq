/**
 * Keeps only the newest request alive: starting one cancels the previous, so a slow answer to an
 * old question can never overwrite a newer one.
 */
interface Latest {
  /** Cancels the request in flight, if any, and returns the signal for the new one. */
  next(): AbortSignal;
  /** Cancels the request in flight, if any, for example when the screen closes. */
  cancel(): void;
}

export function createLatest(): Latest {
  let current: AbortController | null = null;
  return {
    next() {
      current?.abort();
      current = new AbortController();
      return current.signal;
    },
    cancel() {
      current?.abort();
      current = null;
    },
  };
}
